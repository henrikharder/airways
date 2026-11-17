"""Model and render every Airways sprite in Blender.

Run with:  npm run art   (blender --background --python art/build.py)

All models are built from code in a stylised low-poly look and rendered with
a fixed 2:1 isometric orthographic camera. Grid units: 1 tile = 5 m. Grid +x
maps to Blender +X, grid +y maps to Blender -Y (so +x is screen lower-right and
+y is screen lower-left). Each render records the pixel position of the world
origin so the game can anchor sprites exactly on the tile grid.
"""

import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'sprites')
MANIFEST = os.path.join(ROOT, 'src', 'generated', 'sprites.json')
ONLY = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []

TILE_PX = 64  # width of one tile diamond at render resolution (game shows it at 32 px at zoom 1)
PPU = TILE_PX / math.sqrt(2)  # pixels per world unit in the camera plane
ELEV = math.atan(0.5)  # 2:1 dimetric
CAM_ROT = (math.pi / 2 - ELEV, 0.0, math.radians(45))
if 'side' in ONLY:  # debug: orthographic side view
    CAM_ROT = (math.pi / 2, 0.0, 0.0)
elif 'top' in ONLY:
    CAM_ROT = (0.0, 0.0, 0.0)
M = 0.2  # tiles per metre

manifest = {}

# ---------------------------------------------------------------- scene setup


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    for engine in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'):
        try:
            sc.render.engine = engine
            break
        except TypeError:
            continue
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    try:
        sc.eevee.taa_render_samples = 16
    except AttributeError:
        pass
    world = bpy.data.worlds.new('World')
    sc.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get('Background')
    bg.inputs[0].default_value = (0.78, 0.82, 0.92, 1)
    bg.inputs[1].default_value = 0.42
    sun = bpy.data.lights.new('Sun', 'SUN')
    sun.energy = 2.4
    sun.angle = math.radians(12)
    sun_obj = bpy.data.objects.new('Sun', sun)
    sun_obj.rotation_euler = (math.radians(50), math.radians(-18), math.radians(-35))
    sc.collection.objects.link(sun_obj)
    cam = bpy.data.cameras.new('Cam')
    cam.type = 'ORTHO'
    cam_obj = bpy.data.objects.new('Cam', cam)
    cam_obj.rotation_euler = CAM_ROT
    sc.collection.objects.link(cam_obj)
    sc.camera = cam_obj


_mats = {}


def mat(color, rough=0.75, emit=0.0, name=None):
    key = name or (str(color), rough, emit)
    if key in _mats:
        return _mats[key]
    m = bpy.data.materials.new(str(key))
    if not m.node_tree:
        m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*srgb(color), 1)
    p.inputs['Roughness'].default_value = rough
    if emit:
        p.inputs['Emission Color'].default_value = (*srgb(color), 1)
        p.inputs['Emission Strength'].default_value = emit
    _mats[key] = m
    return m


def srgb(c):
    """Hex or 0-1 sRGB tuple to linear."""
    if isinstance(c, str):
        c = tuple(int(c[i:i + 2], 16) / 255 for i in (1, 3, 5))
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def holdout_mat():
    if 'holdout' in _mats:
        return _mats['holdout']
    m = bpy.data.materials.new('holdout')
    if not m.node_tree:
        m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    ho = nt.nodes.new('ShaderNodeHoldout')
    nt.links.new(ho.outputs[0], out.inputs['Surface'])
    _mats['holdout'] = m
    return m


# ---------------------------------------------------------------- geometry
# Builders work in grid coordinates (gx, gy, z) where z is in tiles too.


class Builder:
    """Places primitives in a footprint w×h, optionally rotated by r quarter turns."""

    def __init__(self, w=1, h=1, r=0):
        self.w, self.h, self.r = w, h, r
        self.objs = []

    def tf(self, gx, gy):
        w, h, r = self.w, self.h, self.r
        if r == 0:
            return gx, gy
        if r == 1:
            return h - gy, gx
        if r == 2:
            return w - gx, h - gy
        return gy, w - gx

    def _add(self, obj, m, tag=None):
        obj.data.materials.append(m)
        obj['livery'] = tag == 'livery'
        self.objs.append(obj)
        return obj

    def box(self, x0, y0, z0, x1, y1, z1, m, bevel=0.0, tag=None):
        a = self.tf(x0, y0)
        b = self.tf(x1, y1)
        gx0, gx1 = sorted((a[0], b[0]))
        gy0, gy1 = sorted((a[1], b[1]))
        bpy.ops.mesh.primitive_cube_add(size=1, location=((gx0 + gx1) / 2, -(gy0 + gy1) / 2, (z0 + z1) / 2))
        o = bpy.context.active_object
        o.scale = (max(gx1 - gx0, 1e-3), max(gy1 - gy0, 1e-3), max(z1 - z0, 1e-3))
        bpy.ops.object.transform_apply(scale=True)
        if bevel:
            mod = o.modifiers.new('bevel', 'BEVEL')
            mod.width = bevel
            mod.segments = 2
        return self._add(o, m, tag)

    def cyl(self, gx, gy, z0, z1, radius, m, verts=16, tag=None):
        x, y = self.tf(gx, gy)
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=z1 - z0, location=(x, -y, (z0 + z1) / 2))
        return self._add(bpy.context.active_object, m, tag)

    def sphere(self, gx, gy, z, radius, m, tag=None):
        x, y = self.tf(gx, gy)
        bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=6, radius=radius, location=(x, -y, z))
        return self._add(bpy.context.active_object, m, tag)

    def cone(self, gx, gy, z0, z1, r0, r1, m, verts=8):
        x, y = self.tf(gx, gy)
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r0, radius2=r1, depth=z1 - z0, location=(x, -y, (z0 + z1) / 2))
        return self._add(bpy.context.active_object, m)


def clear_objects():
    for o in list(bpy.data.objects):
        if o.type == 'MESH':
            bpy.data.objects.remove(o, do_unlink=True)
    for me in list(bpy.data.meshes):
        bpy.data.meshes.remove(me)


# ---------------------------------------------------------------- rendering


def render(name, objs, ppu=PPU, mask=False):
    """Frame the objects tightly, render to PNG and record the world-origin anchor."""
    sc = bpy.context.scene
    cam = sc.camera
    rot = cam.rotation_euler.to_matrix()
    inv = rot.transposed()
    xs, ys = [], []
    for o in objs:
        for c in o.bound_box:
            p = inv @ (o.matrix_world @ Vector(c))
            xs.append(p.x)
            ys.append(p.y)
    pad = 0.08
    x0, x1, y0, y1 = min(xs) - pad, max(xs) + pad, min(ys) - pad, max(ys) + pad
    wu, hu = x1 - x0, y1 - y0
    cam.data.ortho_scale = max(wu, hu)
    cam.location = rot @ Vector(((x0 + x1) / 2, (y0 + y1) / 2, 200))
    cam.data.clip_end = 1000
    sc.render.resolution_x = max(2, math.ceil(wu * ppu))
    sc.render.resolution_y = max(2, math.ceil(hu * ppu))
    sc.render.resolution_percentage = 100
    path = os.path.join(OUT, f'{name}.png')
    sc.render.filepath = path

    saved = {}
    if mask:
        hold = holdout_mat()
        white = mat('#ffffff', 0.7, name='mask_white')
        for o in objs:
            saved[o.name] = o.data.materials[0]
            o.data.materials[0] = white if o.get('livery') else hold
    bpy.ops.render.render(write_still=True)
    for o in objs:
        if o.name in saved:
            o.data.materials[0] = saved[o.name]

    scale = sc.render.resolution_x / wu
    manifest[name] = {
        'w': sc.render.resolution_x, 'h': sc.render.resolution_y,
        'ax': round((0 - x0) * scale, 2), 'ay': round((y1 - 0) * scale, 2),
        'scale': round(TILE_PX / (math.sqrt(2) * scale) if scale else 1, 4),
    }
    print(f'rendered {name} {sc.render.resolution_x}x{sc.render.resolution_y}')


# ---------------------------------------------------------------- palette

C = {
    'floor': '#e9e4da', 'desk': '#f4f1ea', 'deskTop': '#c9cfd8', 'accent': '#2f7de1', 'accent2': '#ff8a3d', 'dark': '#2b3240',
    'metal': '#9aa5b5', 'glass': '#9fd3f5', 'seat': '#3b82f6', 'seatJ': '#14b8a6', 'green': '#22c55e', 'red': '#ef4444',
    'wood': '#c08a52', 'roof': '#e04f5f', 'white': '#f7f8fa', 'yellow': '#facc15', 'pink': '#f472b6', 'tree': '#3fae5a',
    'trunk': '#8a5a35', 'skin': '#f1c7a1', 'skin2': '#a8714a', 'hair': '#3a2a20', 'asphalt': '#4a505c', 'concrete': '#cfd3da',
}


# ---------------------------------------------------------------- modules
# Every module: footprint (w, h) and a build(b) function. Front (service side) faces +gy.


def m_checkin(b):
    for i in range(4):
        x = 0.1 + i * 0.95
        b.box(x, 0.9, 0, x + 0.8, 1.35, 0.22, mat(C['desk']), 0.02)
        b.box(x, 0.9, 0.22, x + 0.8, 1.35, 0.24, mat(C['deskTop']))
        b.box(x + 0.5, 1.0, 0.24, x + 0.62, 1.04, 0.36, mat(C['dark']))
        b.box(x + 0.05, 0.55, 0, x + 0.5, 0.85, 0.06, mat(C['dark']))  # bag belt
    b.box(0, 0.05, 0, 4, 0.25, 0.75, mat(C['accent']), 0.02)
    b.box(0.2, 0.25, 0.48, 3.8, 0.28, 0.66, mat(C['white'], 0.4, 0.4))
    for i in range(4):
        b.box(0.35 + i * 0.95, 0.27, 0.52, 0.65 + i * 0.95, 0.29, 0.62, mat(C['accent2'], 0.5, 0.6))


def m_security(b):
    b.box(0.2, 0.3, 0, 1.8, 0.9, 0.06, mat(C['metal']))
    b.box(0.6, 1.0, 0, 1.4, 2.0, 0.32, mat(C['white']), 0.04)
    b.box(0.72, 0.98, 0.06, 1.28, 2.02, 0.24, mat(C['dark']))
    b.box(0.6, 2.0, 0, 1.4, 3.2, 0.12, mat(C['metal']))
    b.box(0.25, 2.4, 0, 0.35, 2.6, 0.5, mat(C['accent']))
    b.box(0.25, 2.4, 0.5, 0.35, 3.0, 0.55, mat(C['accent']))
    b.box(0.25, 2.9, 0, 0.35, 3.0, 0.5, mat(C['accent']))
    b.box(0.2, 3.4, 0, 1.8, 3.9, 0.06, mat(C['metal']))
    for x in (0.0, 1.95):
        b.box(x, 0.2, 0, x + 0.05, 3.9, 0.18, mat(C['dark']))


def m_gate(b):
    for row in range(3):
        y = 0.9 + row * 0.9
        b.box(0.4, y, 0, 3.6, y + 0.35, 0.1, mat(C['metal']))
        for i in range(8):
            x = 0.42 + i * 0.4
            b.box(x, y, 0.1, x + 0.34, y + 0.32, 0.16, mat(C['seat']), 0.02)
            b.box(x, y, 0.16, x + 0.34, y + 0.06, 0.3, mat(C['seat']), 0.02)
    b.box(3.0, 0.1, 0, 3.8, 0.5, 0.24, mat(C['white']), 0.03)
    b.box(3.0, 0.1, 0.24, 3.8, 0.5, 0.26, mat(C['deskTop']))
    b.box(0.2, 0.15, 0, 0.27, 0.22, 0.75, mat(C['dark']))
    b.box(0.0, 0.12, 0.75, 0.6, 0.25, 0.95, mat(C['dark']))
    b.box(0.03, 0.11, 0.78, 0.57, 0.12, 0.92, mat(C['yellow'], 0.4, 0.5))


def m_food(b):
    b.box(0.2, 0.2, 0, 3.8, 1.2, 0.26, mat(C['wood']), 0.03)
    b.box(0.2, 0.2, 0.26, 3.8, 1.2, 0.28, mat(C['white']))
    b.box(0.2, 0.05, 0, 3.8, 0.2, 0.9, mat(C['white']))
    b.box(0.1, 0.0, 0.9, 3.9, 1.35, 1.0, mat(C['roof']), 0.03)
    for i, col in enumerate([C['yellow'], C['green'], C['accent2']]):
        b.box(0.5 + i * 1.1, 0.21, 0.55, 1.3 + i * 1.1, 0.23, 0.82, mat(col, 0.4, 0.5))
    for (x, y) in ((0.8, 2.2), (2.0, 2.2), (3.2, 2.2), (1.4, 3.3), (2.6, 3.3)):
        b.cyl(x, y, 0, 0.22, 0.28, mat(C['white']), 14)
        for dx, dy in ((-0.38, 0), (0.38, 0), (0, -0.38), (0, 0.38)):
            b.box(x + dx - 0.08, y + dy - 0.08, 0, x + dx + 0.08, y + dy + 0.08, 0.12, mat(C['accent']))


def m_shop(b):
    b.box(0.1, 0.1, 0, 2.9, 2.0, 0.03, mat('#f6efe2'))
    b.box(0.1, 0.1, 0, 2.9, 0.3, 0.8, mat(C['white']))
    b.box(0.1, 0.1, 0, 0.3, 2.0, 0.8, mat(C['white']))
    for i in range(3):
        b.box(0.35 + i * 0.85, 0.35, 0, 1.0 + i * 0.85, 0.55, 0.6, mat(C['wood']))
        for j, col in enumerate([C['pink'], C['yellow'], C['accent'], C['green']]):
            b.box(0.4 + i * 0.85 + j * 0.15, 0.4, 0.2 + (j % 2) * 0.2, 0.52 + i * 0.85 + j * 0.15, 0.53, 0.32 + (j % 2) * 0.2, mat(col))
    b.box(1.2, 1.1, 0, 2.2, 1.6, 0.3, mat(C['wood']))
    b.box(0.0, 1.95, 0.75, 3.0, 2.25, 0.85, mat(C['pink']), 0.03)
    b.box(0.0, 1.95, 0, 0.12, 2.05, 0.75, mat(C['glass'], 0.1))


def m_toilets(b):
    b.box(0.1, 0.1, 0, 1.9, 1.5, 0.75, mat('#d9e4ef'), 0.03)
    b.box(0.05, 0.05, 0.75, 1.95, 1.55, 0.8, mat(C['dark']))
    b.box(0.3, 1.5, 0, 0.8, 1.53, 0.55, mat(C['accent']))
    b.box(1.2, 1.5, 0, 1.7, 1.53, 0.55, mat(C['pink']))
    b.box(0.85, 1.5, 0.45, 1.15, 1.53, 0.7, mat(C['white'], 0.4, 0.4))


def m_seats(b):
    b.box(0.1, 0.3, 0, 1.9, 0.7, 0.1, mat(C['metal']))
    for i in range(4):
        x = 0.12 + i * 0.45
        b.box(x, 0.3, 0.1, x + 0.4, 0.68, 0.16, mat(C['seatJ']), 0.02)
        b.box(x, 0.3, 0.16, x + 0.4, 0.36, 0.32, mat(C['seatJ']), 0.02)


def m_baggage(b):
    b.box(0.3, 0.6, 0, 2.7, 3.4, 0.2, mat(C['metal']), 0.15)
    b.box(0.6, 0.9, 0.2, 2.4, 3.1, 0.22, mat(C['dark']))
    b.box(1.05, 1.35, 0.2, 1.95, 2.65, 0.28, mat(C['metal']))
    for i, col in enumerate([C['red'], C['accent'], C['yellow'], C['green'], C['dark'], C['pink']]):
        y = 1.0 + i * 0.35
        b.box(0.65 if i % 2 else 2.0, y, 0.22, 1.0 if i % 2 else 2.35, y + 0.25, 0.38, mat(col), 0.03)
    b.box(1.2, 0.05, 0, 1.8, 0.6, 0.9, mat(C['dark']))
    b.box(1.25, 0.04, 0.3, 1.75, 0.05, 0.8, mat(C['white'], 0.3, 0.4))


def m_entrance(b):
    b.box(0, 0.35, 0, 0.12, 0.65, 0.85, mat(C['dark']))
    b.box(1.88, 0.35, 0, 2.0, 0.65, 0.85, mat(C['dark']))
    b.box(0, 0.35, 0.85, 2.0, 0.65, 1.0, mat(C['accent']))
    b.box(0.12, 0.45, 0, 0.95, 0.55, 0.85, mat(C['glass'], 0.05))
    b.box(1.05, 0.45, 0, 1.88, 0.55, 0.85, mat(C['glass'], 0.05))


def m_exit(b):
    # one-way arrivals door: frame, glass, green exit sign with arrow
    b.box(0, 0.35, 0, 0.12, 0.65, 0.85, mat(C['dark']))
    b.box(1.88, 0.35, 0, 2.0, 0.65, 0.85, mat(C['dark']))
    b.box(0, 0.35, 0.85, 2.0, 0.65, 1.0, mat(C['green']))
    b.box(0.6, 0.33, 0.87, 1.4, 0.34, 0.98, mat(C['white'], 0.4, 0.5))
    b.box(0.12, 0.45, 0, 1.88, 0.55, 0.85, mat(C['glass'], 0.05))
    b.box(0.85, 0.2, 0.01, 1.15, 0.8, 0.03, mat(C['green']))
    b.cone(1.0, 0.95, 0.01, 0.03, 0.22, 0.0, mat(C['green']), 3)


def m_tower(b):
    b.box(0.6, 0.6, 0, 2.4, 2.4, 0.5, mat(C['concrete']), 0.05)
    b.cyl(1.5, 1.5, 0.5, 6.4, 0.42, mat(C['white']), 12)
    b.cyl(1.5, 1.5, 6.4, 6.7, 0.8, mat(C['white']), 12)
    b.cyl(1.5, 1.5, 6.7, 7.3, 0.85, mat(C['glass'], 0.1), 12)
    b.cyl(1.5, 1.5, 7.3, 7.45, 0.92, mat(C['dark']), 12)
    b.cyl(1.5, 1.5, 7.45, 7.9, 0.05, mat(C['red'], 0.4, 2), 6)


def m_tree(b):
    b.cyl(0.5, 0.5, 0, 0.35, 0.06, mat(C['trunk']), 6)
    b.cone(0.5, 0.5, 0.3, 1.1, 0.38, 0.0, mat(C['tree']), 7)
    b.cone(0.5, 0.5, 0.65, 1.35, 0.28, 0.0, mat('#4cc36a'), 7)


def m_jetbridge(b):
    b.box(0.0, 0.3, 0.42, 3.0, 0.7, 0.72, mat(C['metal']), 0.03)
    b.box(0.0, 0.29, 0.6, 3.0, 0.71, 0.64, mat(C['accent']))
    b.box(2.6, 0.25, 0.4, 3.1, 0.75, 0.76, mat(C['dark']))
    b.box(1.8, 0.4, 0, 1.9, 0.6, 0.42, mat(C['dark']))
    b.cyl(1.85, 0.5, 0.0, 0.08, 0.18, mat(C['dark']), 8)


MODULES = {
    'checkin': (4, 2, m_checkin), 'security': (2, 4, m_security), 'gate': (4, 4, m_gate), 'food': (4, 4, m_food),
    'shop': (3, 3, m_shop), 'toilets': (2, 2, m_toilets), 'seats': (2, 1, m_seats), 'baggage': (3, 4, m_baggage),
    'entrance': (2, 1, m_entrance), 'exit': (2, 1, m_exit), 'tower': (3, 3, m_tower), 'tree': (1, 1, m_tree), 'jetbridge': (3, 1, m_jetbridge),
}

# ---------------------------------------------------------------- aircraft (real dimensions, metres)

AIRCRAFT = {
    #       length span  diam  height wingX  chord sweep engD  engines prop  tTail
    'AT76': (27.2, 27.1, 2.8, 7.6, 0.40, 2.6, 2, 1.0, 2, True, True),
    'E295': (41.5, 35.1, 3.0, 10.9, 0.42, 5.0, 26, 2.0, 2, False, False),
    'A20N': (37.6, 35.8, 3.95, 11.8, 0.38, 6.1, 25, 2.3, 2, False, False),
    'B38M': (39.5, 35.9, 3.76, 12.3, 0.40, 6.4, 25, 2.1, 2, False, False),
    'B789': (62.8, 60.1, 5.77, 17.0, 0.40, 10.6, 32, 3.3, 2, False, False),
    'A359': (66.8, 64.8, 5.96, 17.1, 0.40, 11.5, 31, 3.4, 2, False, False),
    'A388': (72.7, 79.8, 7.1, 24.1, 0.40, 17.7, 33, 3.0, 4, False, False),
}


def build_aircraft(code, facing):
    L, span, D, H, wingX, chord, sweep, engD, nEng, prop, tTail = AIRCRAFT[code]
    s = M
    L, span, D, H, chord, engD = L * s, span * s, D * s, H * s, chord * s, engD * s
    objs = []
    white = mat(C['white'], 0.45)
    grey = mat('#c7ced8', 0.6)
    dark = mat(C['dark'], 0.5)
    liv = mat('#ffffff', 0.5, name='livery_white')
    zc = D * 0.55 + (0.28 if code != 'AT76' else 0.12)  # fuselage centre height (gear)
    x0 = -L / 2

    def add(o, m, tag=None):
        o.data.materials.append(m)
        o['livery'] = tag == 'livery'
        objs.append(o)
        return o

    # fuselage: cylinder along X with nose and tail cones
    nose = D * 1.3
    tail = D * 2.4
    body_len = L - nose - tail
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=D / 2, depth=body_len, location=(x0 + tail + body_len / 2, 0, zc), rotation=(0, math.pi / 2, 0))
    add(bpy.context.active_object, white)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=1, location=(x0 + L - nose, 0, zc))
    o = add(bpy.context.active_object, white)
    o.scale = (nose, D / 2, D / 2)
    for v in o.data.vertices:
        if v.co.x < 0:
            v.co.x = 0
    bpy.ops.mesh.primitive_cone_add(vertices=16, radius1=D / 2, radius2=D * 0.12, depth=tail, location=(x0 + tail / 2, 0, zc + D * 0.18), rotation=(0, -math.pi / 2, 0))
    o = add(bpy.context.active_object, white)
    # cockpit windows
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x0 + L - nose * 0.55, 0, zc + D * 0.22))
    o = add(bpy.context.active_object, dark)
    o.scale = (nose * 0.35, D * 0.82, D * 0.16)
    # cheatline (livery stripe)
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=D / 2 + 0.004, depth=body_len * 0.98, location=(x0 + tail + body_len / 2, 0, zc), rotation=(0, math.pi / 2, 0))
    o = add(bpy.context.active_object, liv, 'livery')
    o.scale = (1, 1, 1)
    bpy.ops.object.transform_apply(scale=True)
    for v in o.data.vertices:
        v.co.y *= 1.0
    # keep only a band below the windows
    bm = bmesh.new()
    bm.from_mesh(o.data)
    for f in list(bm.faces):
        cz = sum(v.co.z for v in f.verts) / len(f.verts)
        cx = sum(v.co.x for v in f.verts) / len(f.verts)
        if not (-D * 0.18 < cx < D * 0.02):  # cylinder local axis: rotated, x maps to world -z
            bm.faces.remove(f)
    bm.to_mesh(o.data)
    bm.free()

    # wings: swept tapered slab
    def slab(name, root_x, root_chord, tip_chord, half_span, sweep_deg, z, thick, m, dihedral=4, tag=None, side=1):
        me = bpy.data.meshes.new(name)
        bm = bmesh.new()
        sw = math.tan(math.radians(sweep_deg)) * half_span
        dz = math.tan(math.radians(dihedral)) * half_span
        pts = [(root_x, 0, z), (root_x - root_chord, 0, z), (root_x - sw - tip_chord, side * half_span, z + dz), (root_x - sw, side * half_span, z + dz)]
        top = [bm.verts.new((p[0], p[1], p[2] + thick)) for p in pts]
        bot = [bm.verts.new(p) for p in pts]
        bm.faces.new(top)
        bm.faces.new(list(reversed(bot)))
        for i in range(4):
            j = (i + 1) % 4
            bm.faces.new((bot[i], bot[j], top[j], top[i]))
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        return add(ob, m, tag)

    root_le = x0 + L * (1 - wingX) + chord * 0.3
    wz = zc + (D * 0.42 if prop else -D * 0.3)
    for side in (1, -1):
        slab('wing', root_le, chord, chord * 0.3, span / 2, 0 if prop else sweep, wz, D * 0.08, grey, 0 if prop else 5, side=side)
    # tailplane (on top of the fin for T-tails)
    stab_z = zc + D * 0.15 if not tTail else H - D * 0.1
    stab_x = x0 + tail * 0.7 if not tTail else x0 + tail * 0.75 - (H - zc) * math.tan(math.radians(30)) * 0.9
    for side in (1, -1):
        slab('stab', stab_x, chord * 0.5, chord * 0.25, span * 0.17, 0 if prop else 32, stab_z, D * 0.05, grey, 3, side=side)
    # fin (livery): root from just ahead of the tail cone to the tail end, swept back
    me = bpy.data.meshes.new('fin')
    bm = bmesh.new()
    fh = H - zc - D * 0.35
    fc = chord * (0.9 if not prop else 1.0)
    le = x0 + tail * 1.05
    z0 = zc + D * 0.3
    tip_le = le - fh * math.tan(math.radians(38 if not prop else 30))
    pts = [(le, 0, z0), (max(x0 + 0.05, le - fc), 0, z0), (tip_le - fc * 0.45, 0, z0 + fh), (tip_le, 0, z0 + fh)]
    th = D * 0.06
    vl = [bm.verts.new((p[0], -th, p[2])) for p in pts]
    vr = [bm.verts.new((p[0], th, p[2])) for p in pts]
    bm.faces.new(vl)
    bm.faces.new(list(reversed(vr)))
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((vl[i], vl[j], vr[j], vr[i]))
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new('fin', me)
    bpy.context.scene.collection.objects.link(ob)
    add(ob, liv, 'livery')

    # engines
    if prop:
        for side in (1, -1):
            ex = root_le - chord * 0.1
            bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=engD * 0.45, depth=chord * 1.4, location=(ex - chord * 0.3, side * span * 0.17, wz - engD * 0.15), rotation=(0, math.pi / 2, 0))
            add(bpy.context.active_object, liv, 'livery')
            bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=engD * 1.85, depth=0.01, location=(ex + chord * 0.42, side * span * 0.17, wz - engD * 0.15), rotation=(0, math.pi / 2, 0))
            add(bpy.context.active_object, mat('#dfe6ef', 0.9))
    else:
        positions = [0.33] if nEng == 2 else [0.26, 0.5]
        for side in (1, -1):
            for f in positions:
                sw = math.tan(math.radians(sweep)) * span / 2 * f
                ex = root_le - sw + engD * 0.6
                bpy.ops.mesh.primitive_cylinder_add(vertices=14, radius=engD / 2, depth=engD * 1.7, location=(ex, side * span / 2 * f, wz - engD * 0.45), rotation=(0, math.pi / 2, 0))
                add(bpy.context.active_object, liv, 'livery')
                bpy.ops.mesh.primitive_cylinder_add(vertices=14, radius=engD * 0.36, depth=0.02, location=(ex + engD * 0.86, side * span / 2 * f, wz - engD * 0.45), rotation=(0, math.pi / 2, 0))
                add(bpy.context.active_object, dark)
    # landing gear
    for gx, gy in ((x0 + L * 0.88, 0), (root_le - chord * 0.7, D * 0.45), (root_le - chord * 0.7, -D * 0.45)):
        bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.025, depth=zc - D * 0.45, location=(gx, gy, (zc - D * 0.45) / 2))
        add(bpy.context.active_object, mat(C['metal']))
        bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=0.07, depth=0.06, location=(gx, gy, 0.07), rotation=(math.pi / 2, 0, 0))
        add(bpy.context.active_object, dark)

    # facing: 0 nose to grid +x, 1 to +y (Blender -Y), 2 to -x, 3 to -y
    rotz = -facing * math.pi / 2
    for o in objs:
        o.matrix_world = Matrix.Rotation(rotz, 4, 'Z') @ o.matrix_world
    return objs


# ---------------------------------------------------------------- passengers

SHIRTS = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#14b8a6']


def build_person(shirt, facing, frame):
    b = Builder(1, 1, 0)
    skin = mat(C['skin2'] if shirt in ('#22c55e', '#a855f7') else C['skin'])
    pants = mat('#334155')
    step = 0.03 if frame else -0.03
    # local: centred at origin, facing +gx
    b.box(-0.025 + step, -0.05, 0, 0.025 + step, -0.01, 0.16, pants)
    b.box(-0.025 - step, 0.01, 0, 0.025 - step, 0.05, 0.16, pants)
    b.box(-0.04, -0.065, 0.16, 0.04, 0.065, 0.3, mat(shirt), 0.01)
    b.sphere(0, 0, 0.345, 0.045, skin)
    b.box(-0.045, -0.04, 0.36, 0.02, 0.04, 0.395, mat(C['hair']))
    rotz = -facing * math.pi / 2
    for o in b.objs:
        o.matrix_world = Matrix.Rotation(rotz, 4, 'Z') @ o.matrix_world
    return b.objs


# ---------------------------------------------------------------- main


def want(name):
    return not ONLY or any(name.startswith(p) for p in ONLY)


def debug_views():
    reset()
    out = os.path.join(ROOT, 'art', 'debug')
    os.makedirs(out, exist_ok=True)
    global OUT
    OUT = out
    for code in AIRCRAFT:
        clear_objects()
        render(f'{code}_{ONLY[0]}', build_aircraft(code, 0), ppu=PPU * 0.75)


def main():
    if ONLY and ONLY[0] in ('side', 'top'):
        return debug_views()
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(os.path.dirname(MANIFEST), exist_ok=True)
    if os.path.exists(MANIFEST) and ONLY:
        manifest.update(json.load(open(MANIFEST)))
    reset()
    for name, (w, h, fn) in MODULES.items():
        rots = (0,) if name in ('tower', 'tree') else (0, 1, 2, 3)
        for r in rots:
            key = f'{name}_{r}'
            if not want(key):
                continue
            clear_objects()
            b = Builder(w, h, r)
            fn(b)
            render(key, b.objs)
    for code in AIRCRAFT:
        for f in range(4):
            key = f'ac_{code}_{f}'
            if not want(key):
                continue
            clear_objects()
            objs = build_aircraft(code, f)
            render(key, objs, ppu=PPU * 0.75)
            render(key + '_mask', objs, ppu=PPU * 0.75, mask=True)
            # both renders share the framing, so copy the anchor
            manifest[key + '_mask'] = dict(manifest[key])
    for i, shirt in enumerate(SHIRTS):
        for f in range(4):
            for fr in range(2):
                key = f'pax_{i}_{f}_{fr}'
                if not want(key):
                    continue
                clear_objects()
                render(key, build_person(shirt, f, fr), ppu=PPU * 1.5)
    json.dump(manifest, open(MANIFEST, 'w'), indent=1, sort_keys=True)
    print('wrote', len(manifest), 'sprites')


main()
