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

TILE_PX = 128  # width of one tile diamond at render resolution (game shows it at 32 px at zoom 1); keep SRC_TILE in scene.ts in sync
PPU = TILE_PX / math.sqrt(2)  # pixels per world unit in the camera plane
ELEV = math.atan(0.5)  # 2:1 dimetric
CAM_ROT = (math.pi / 2 - ELEV, 0.0, math.radians(45))
if 'side' in ONLY:  # debug: orthographic side view
    CAM_ROT = (math.pi / 2, 0.0, 0.0)
elif 'top' in ONLY:
    CAM_ROT = (0.0, 0.0, 0.0)
M = 0.2  # tiles per metre
SAMPLES = 48
SUN_ROT = (math.radians(35), 0.0, math.radians(-20))

manifest = {}

# ---------------------------------------------------------------- scene setup


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    # Cycles for soft contact shadows (shadow catcher) and natural ambient occlusion
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 4
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        sc.cycles.device = 'GPU'
    except Exception as e:  # noqa: BLE001 - CPU fallback is fine
        print('GPU unavailable, using CPU:', e)
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'WEBP'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.render.image_settings.quality = 88  # lossy WebP with alpha: a fraction of the PNG size
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    world = bpy.data.worlds.new('World')
    sc.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get('Background')
    bg.inputs[0].default_value = (0.78, 0.82, 0.92, 1)
    bg.inputs[1].default_value = 0.5
    sun = bpy.data.lights.new('Sun', 'SUN')
    sun.energy = 2.7
    sun.angle = math.radians(8)
    sun_obj = bpy.data.objects.new('Sun', sun)
    # fairly high sun from the upper left of the screen so shadows stay short and fall behind objects
    sun_obj.rotation_euler = SUN_ROT
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

    def sphere(self, gx, gy, z, radius, m, tag=None, seg=10, soft=False, squash=1.0):
        x, y = self.tf(gx, gy)
        bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=max(6, seg // 2), radius=radius, location=(x, -y, z))
        o = bpy.context.active_object
        if squash != 1.0:
            o.scale = (1, 1, squash)
            bpy.ops.object.transform_apply(scale=True)
        if soft:
            smooth(o)
        return self._add(o, m, tag)

    def wheel(self, gx, gy, z, radius, width, m, axis='y', verts=14):
        """Cylinder lying on its side: axis 'y' rolls along gx, 'x' rolls along gy."""
        x, y = self.tf(gx, gy)
        rot = (math.pi / 2, 0, 0) if axis == 'y' else (0, math.pi / 2, 0)
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=width, location=(x, -y, z), rotation=rot)
        o = bpy.context.active_object
        smooth(o)
        return self._add(o, m)

    def rbox(self, cx, cy, cz, sx, sy, sz, pitch, m, bevel=0.0):
        """Box centred at (cx, cy, cz) with size (sx along gx, sy, sz), front raised by `pitch` degrees."""
        x, y = self.tf(cx, cy)
        bpy.ops.mesh.primitive_cube_add(size=1, location=(x, -y, cz))
        o = bpy.context.active_object
        o.scale = (sx, sy, sz)
        bpy.ops.object.transform_apply(scale=True)
        o.rotation_euler = (0, -math.radians(pitch), 0)
        if bevel:
            mod = o.modifiers.new('bevel', 'BEVEL')
            mod.width = bevel
            mod.segments = 2
        return self._add(o, m)

    def turn(self, facing):
        """Rotate everything built so far about the origin: facing 0 = +gx, 1 = +gy, 2 = -gx, 3 = -gy."""
        rz = Matrix.Rotation(-facing * math.pi / 2, 4, 'Z')
        for o in self.objs:
            o.matrix_world = rz @ o.matrix_world
        return self.objs

    def cone(self, gx, gy, z0, z1, r0, r1, m, verts=8):
        x, y = self.tf(gx, gy)
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r0, radius2=r1, depth=z1 - z0, location=(x, -y, (z0 + z1) / 2))
        return self._add(bpy.context.active_object, m)


def smooth(o):
    """Smooth shading, keeping flat caps on cylinders (faces facing along the local Z axis stay flat)."""
    for poly in o.data.polygons:
        poly.use_smooth = abs(poly.normal.z) < 0.95 or len(poly.vertices) <= 4
    return o


def clear_objects():
    for o in list(bpy.data.objects):
        if o.type == 'MESH':
            bpy.data.objects.remove(o, do_unlink=True)
    for me in list(bpy.data.meshes):
        bpy.data.meshes.remove(me)


# ---------------------------------------------------------------- rendering


def sun_dir():
    return Matrix.Rotation(SUN_ROT[2], 3, 'Z') @ Matrix.Rotation(SUN_ROT[1], 3, 'Y') @ Matrix.Rotation(SUN_ROT[0], 3, 'X') @ Vector((0, 0, -1))


def render(name, objs, ppu=PPU, mask=False, shadow=True):
    """Frame the objects (and their ground shadow) tightly, render to PNG and record the world-origin anchor."""
    sc = bpy.context.scene
    cam = sc.camera
    rot = cam.rotation_euler.to_matrix()
    inv = rot.transposed()
    d = sun_dir()
    xs, ys = [], []
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            pts = [w]
            if shadow and w.z > 0.01:
                pts.append(w + d * (w.z / -d.z))
            for q in pts:
                p = inv @ q
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
    path = os.path.join(OUT, f'{name}.webp')
    sc.render.filepath = path

    catcher = None
    if shadow and not mask:
        bpy.ops.mesh.primitive_plane_add(size=600, location=(0, 0, 0))
        catcher = bpy.context.active_object
        catcher.is_shadow_catcher = True
    saved = {}
    if mask:
        hold = holdout_mat()
        white = mat('#ffffff', 0.7, name='mask_white')
        for o in objs:
            saved[o.name] = list(o.data.materials)
            for i in range(len(o.data.materials)):
                o.data.materials[i] = white if o.get('livery') else hold
    bpy.ops.render.render(write_still=True)
    for o in objs:
        if o.name in saved:
            for i, m in enumerate(saved[o.name]):
                o.data.materials[i] = m
    if catcher:
        bpy.data.objects.remove(catcher, do_unlink=True)

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


# ---- small props shared by modules (all in footprint coordinates)


def plant(b, x, y, big=False):
    r = 0.16 if big else 0.11
    b.cyl(x, y, 0, r * 1.5, r * 0.85, mat('#e8e2d6', 0.6), 16)
    b.cyl(x, y, r * 1.5 - 0.01, r * 1.5, r * 0.75, mat('#5a3e2b'), 16)
    for i, (dx, dy, dz, rr) in enumerate(((0, 0, 1.0, 1.0), (0.45, 0.2, 0.75, 0.7), (-0.4, 0.3, 0.8, 0.75), (0.1, -0.45, 0.7, 0.7))):
        b.sphere(x + dx * r, y + dy * r, r * 1.5 + r * dz, r * rr, mat('#3f9b4f' if i % 2 else '#4fb562', 0.8), seg=8)


def bin_(b, x, y):
    b.cyl(x, y, 0, 0.17, 0.055, mat('#5b6472', 0.4), 14)
    b.cyl(x, y, 0.17, 0.19, 0.06, mat('#2b3240', 0.4), 14)


def suitcase(b, x, y, col, rot=0.0):
    w, d, h = (0.1, 0.06, 0.15)
    b.box(x - w / 2, y - d / 2, 0.015, x + w / 2, y + d / 2, 0.015 + h, mat(col, 0.45), 0.012)
    b.box(x - 0.012, y - 0.012, 0.165, x + 0.012, y + 0.012, 0.21, mat(C['dark']))
    for dx in (-0.035, 0.035):
        b.cyl(x + dx, y + d / 2 - 0.01, 0, 0.015, 0.014, mat(C['dark']), 8)


def backpack(b, x, y, z, col):
    b.box(x - 0.05, y - 0.035, z, x + 0.05, y + 0.035, z + 0.1, mat(col, 0.7), 0.02)


def screen(b, x0, y, z0, x1, z1, col='#3b82f6'):
    """Wall/standing screen facing +gy: dark bezel with a lit face."""
    b.box(x0, y, z0, x1, y + 0.04, z1, mat('#1f2530', 0.3), 0.01)
    b.box(x0 + 0.025, y + 0.04, z0 + 0.025, x1 - 0.025, y + 0.045, z1 - 0.025, mat(col, 0.3, 1.2))


def stanchion(b, x, y):
    b.cyl(x, y, 0, 0.012, 0.035, mat('#9aa5b5', 0.25), 12)
    b.cyl(x, y, 0, 0.2, 0.01, mat('#c7ced8', 0.2), 8)
    b.cyl(x, y, 0.2, 0.215, 0.016, mat('#c7ced8', 0.2), 8)


def belt(b, x0, y0, x1, y1):
    b.box(min(x0, x1), min(y0, y1) - 0.006, 0.17, max(x0, x1), max(y0, y1) + 0.006, 0.19, mat('#1e40af', 0.6))


def seat_row(b, x0, y, n, col, facing=-1, bags=()):
    """Beam of n seats; facing -1 = seats face -gy (towards the desk)."""
    pitch = 0.36
    b.box(x0, y - 0.03, 0.075, x0 + n * pitch, y + 0.03, 0.095, mat('#9aa5b5', 0.25))
    for lx in (x0 + 0.12, x0 + n * pitch - 0.12):
        b.box(lx - 0.025, y - 0.13, 0, lx + 0.025, y + 0.13, 0.02, mat('#9aa5b5', 0.25))
        b.box(lx - 0.015, y - 0.015, 0.02, lx + 0.015, y + 0.015, 0.08, mat('#9aa5b5', 0.25))
    back = y - facing * 0.13
    for i in range(n):
        x = x0 + i * pitch + 0.03
        b.box(x, y - 0.13, 0.095, x + pitch - 0.06, y + 0.13, 0.135, mat(col, 0.55), 0.02)
        b.box(x, back - 0.035, 0.12, x + pitch - 0.06, back + 0.035, 0.32, mat(col, 0.55), 0.02)
        b.box(x - 0.03, y - 0.1, 0.13, x - 0.005, y + 0.1, 0.19, mat('#2b3240', 0.4))  # armrest
        if i in bags:
            backpack(b, x + 0.14, y, 0.135, ['#f97316', '#334155', '#be123c', '#0f766e'][i % 4])
    xe = x0 + n * pitch - 0.03
    b.box(xe, y - 0.1, 0.13, xe + 0.025, y + 0.1, 0.19, mat('#2b3240', 0.4))


def m_gate(b):
    # carpeted waiting area with a border
    b.box(0.08, 0.7, 0, 3.92, 3.92, 0.012, mat('#4b5d82', 0.95))
    b.box(0.18, 0.8, 0.012, 3.82, 3.82, 0.016, mat('#56698f', 0.95))
    # seat rows: two facing the desk, one back-to-back pair at the rear
    seat_row(b, 0.35, 1.25, 9, C['seat'], -1, bags=(2, 7))
    seat_row(b, 0.35, 2.15, 9, C['seat'], -1, bags=(4,))
    seat_row(b, 0.35, 3.05, 9, C['seat'], -1, bags=(0, 6))
    # charging pillars at the row ends
    for y in (1.25, 2.15, 3.05):
        b.box(3.68, y - 0.06, 0, 3.8, y + 0.06, 0.34, mat('#e5e7eb', 0.4), 0.015)
        b.box(3.67, y - 0.03, 0.22, 3.68, y + 0.03, 0.28, mat('#22d3ee', 0.3, 1.5))
    # luggage and travellers' clutter
    suitcase(b, 0.2, 1.55, '#be123c')
    suitcase(b, 3.55, 2.45, '#0ea5e9')
    suitcase(b, 1.7, 3.4, '#a855f7')
    # boarding desk with monitors and printer
    b.box(2.6, 0.18, 0, 3.75, 0.55, 0.26, mat(C['white'], 0.35), 0.03)
    b.box(2.6, 0.5, 0.04, 3.75, 0.56, 0.22, mat(C['accent'], 0.4))
    b.box(2.58, 0.16, 0.26, 3.77, 0.57, 0.285, mat('#d6dbe3', 0.3), 0.01)
    for x in (2.8, 3.35):
        b.box(x, 0.28, 0.285, x + 0.22, 0.3, 0.42, mat('#1f2530', 0.3))
        b.box(x + 0.02, 0.3, 0.3, x + 0.2, 0.305, 0.405, mat('#93c5fd', 0.3, 0.8))
        b.box(x + 0.09, 0.24, 0.285, x + 0.13, 0.28, 0.33, mat('#1f2530', 0.3))
    b.box(3.55, 0.36, 0.285, 3.7, 0.5, 0.33, mat('#e5e7eb', 0.4))
    # stanchion queue lane in front of the desk
    posts = [(2.55, 0.85), (3.15, 0.85), (3.8, 0.85)]
    for (x, y) in posts:
        stanchion(b, x, y)
    belt(b, 2.55, 0.85, 3.8, 0.85)
    # self-boarding e-gates to the jet bridge
    for x in (1.35, 1.75, 2.15):
        b.box(x, 0.12, 0, x + 0.12, 0.5, 0.28, mat('#cbd5e1', 0.3), 0.02)
        b.box(x + 0.02, 0.12, 0.28, x + 0.1, 0.2, 0.3, mat('#22c55e', 0.3, 1.2))
    for x in (1.47, 1.87):
        b.box(x, 0.28, 0.12, x + 0.28, 0.3, 0.26, mat(C['glass'], 0.05))
    # gate sign and departure screen on a column
    b.box(0.22, 0.2, 0, 0.32, 0.3, 1.0, mat('#2b3240', 0.4))
    b.box(0.0, 0.18, 0.78, 0.66, 0.32, 1.05, mat('#2b3240', 0.4), 0.02)
    b.box(0.03, 0.32, 0.81, 0.27, 0.325, 1.02, mat(C['yellow'], 0.4, 0.9))
    b.box(0.09, 0.325, 0.86, 0.21, 0.33, 0.97, mat('#1f2530'))
    b.box(0.3, 0.32, 0.81, 0.63, 0.325, 1.02, mat('#1f2530', 0.3))
    for i in range(4):
        b.box(0.33, 0.325, 0.83 + i * 0.045, 0.6 - (i % 2) * 0.1, 0.33, 0.855 + i * 0.045, mat('#fde68a', 0.3, 1.0))
    # planters and a bin
    plant(b, 0.25, 0.65, big=True)
    plant(b, 3.75, 3.7)
    bin_(b, 0.25, 3.7)


def staff(b, x, y, facing, shirt='#1e3a8a', vest=False):
    """A standing person inside a module, facing 0 = +gx, 1 = +gy, 2 = -gx, 3 = -gy (footprint coords)."""
    objs = build_person(shirt, (facing + b.r) % 4, 0, vest=vest, pants='#1f2937')
    wx, wy = b.tf(x, y)
    for o in objs:
        o.matrix_world = Matrix.Translation((wx, -wy, 0)) @ o.matrix_world
    b.objs.extend(objs)


def tray(b, x, y, z, items=()):
    b.box(x - 0.11, y - 0.08, z, x + 0.11, y + 0.08, z + 0.035, mat('#64748b', 0.5), 0.008)
    for i, col in enumerate(items):
        b.box(x - 0.08 + i * 0.07, y - 0.05, z + 0.035, x - 0.02 + i * 0.07, y + 0.04, z + 0.06 + (i % 2) * 0.02, mat(col, 0.5), 0.005)


def chair(b, x, y, facing, col):
    """Café chair; facing is the direction the sitter looks (0 = +gx, 1 = +gy, 2 = -gx, 3 = -gy)."""
    dx, dy = ((1, 0), (0, 1), (-1, 0), (0, -1))[facing]
    b.box(x - 0.08, y - 0.08, 0.1, x + 0.08, y + 0.08, 0.125, mat(col, 0.5), 0.01)
    bx, by = x - dx * 0.075, y - dy * 0.075
    hx, hy = (0.012, 0.08) if dx else (0.08, 0.012)
    b.box(bx - hx, by - hy, 0.125, bx + hx, by + hy, 0.27, mat(col, 0.5), 0.008)
    for lx, ly in ((-0.06, -0.06), (0.06, -0.06), (-0.06, 0.06), (0.06, 0.06)):
        b.box(x + lx - 0.01, y + ly - 0.01, 0, x + lx + 0.01, y + ly + 0.01, 0.1, mat('#475569', 0.3))


def cup(b, x, y, z, col='#f8fafc'):
    b.cyl(x, y, z, z + 0.04, 0.018, mat(col, 0.4), 10)


def products(b, x0, x1, y0, y1, z, seed, h=0.07):
    """A row of small boxed products on a shelf."""
    cols = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6', '#f8fafc', '#1f2937']
    x, i = x0, seed
    while x < x1 - 0.05:
        w = 0.04 + (i * 7 % 3) * 0.015
        hh = h * (0.6 + (i * 5 % 4) * 0.15)
        b.box(x, y0, z, min(x + w, x1), y1, z + hh, mat(cols[i % len(cols)], 0.45))
        x += w + 0.012
        i += 3


def m_checkin(b):
    # back wall with airline screens and desk numbers
    b.box(0, 0.0, 0, 4, 0.16, 0.98, mat(C['accent'], 0.45), 0.02)
    b.box(0, 0.0, 0.98, 4, 0.18, 1.02, mat('#1e3a8a', 0.4))
    for i in range(4):
        x = 0.1 + i * 0.95
        screen(b, x + 0.05, 0.16, 0.58, x + 0.6, 0.88, ['#60a5fa', '#fbbf24', '#60a5fa', '#34d399'][i])
        b.box(x + 0.66, 0.16, 0.74, x + 0.82, 0.2, 0.88, mat(C['yellow'], 0.4, 0.9))
        b.box(x + 0.71, 0.2, 0.77, x + 0.77, 0.205, 0.85, mat('#1f2530'))
    # bag belt running behind the desks
    b.box(0.05, 0.36, 0, 3.95, 0.68, 0.1, mat('#475569', 0.4))
    b.box(0.08, 0.39, 0.1, 3.92, 0.65, 0.115, mat('#1f2328', 0.8))
    suitcase(b, 0.9, 0.52, '#0ea5e9')
    suitcase(b, 2.6, 0.52, '#be123c')
    for i in range(4):
        x = 0.1 + i * 0.95
        # desk with a raised transaction counter, monitor and printer
        b.box(x, 0.95, 0, x + 0.62, 1.32, 0.24, mat(C['white'], 0.35), 0.03)
        b.box(x, 1.31, 0.03, x + 0.62, 1.33, 0.2, mat(C['accent'], 0.4))
        b.box(x - 0.01, 1.2, 0.24, x + 0.63, 1.36, 0.3, mat('#d6dbe3', 0.3), 0.01)
        b.box(x + 0.08, 1.0, 0.24, x + 0.3, 1.02, 0.38, mat('#1f2530', 0.3))
        b.box(x + 0.1, 1.02, 0.26, x + 0.28, 1.025, 0.36, mat('#93c5fd', 0.3, 0.8))
        b.box(x + 0.4, 1.0, 0.24, x + 0.55, 1.12, 0.29, mat('#e5e7eb', 0.4))
        # bag scale and in-feed belt next to the desk
        b.box(x + 0.64, 0.75, 0, x + 0.9, 1.4, 0.07, mat('#475569', 0.4))
        b.box(x + 0.66, 0.77, 0.07, x + 0.88, 1.38, 0.08, mat('#1f2328', 0.8))
        if i in (0, 2):
            suitcase(b, x + 0.77, 1.15, ['#a855f7', '#16a34a'][i // 2])
        staff(b, x + 0.31, 0.82, 1, '#1e3a8a')
        # lane posts in front of each desk
        for px in (x + 0.02, x + 0.88):
            stanchion(b, px, 1.8)
    # floor mat and lane belts
    for i in range(4):
        x = 0.1 + i * 0.95
        belt(b, x + 0.02, 1.8, x + 0.18, 1.8)


def m_security(b):
    glass = mat(C['glass'], 0.05)
    # lane side screens
    for x in (0.0, 1.95):
        b.box(x, 0.15, 0, x + 0.05, 3.9, 0.04, mat('#475569', 0.4))
        b.box(x + 0.015, 0.15, 0.04, x + 0.035, 3.9, 0.5, glass)
    # divest table at the entry with a stack of trays
    b.box(0.5, 3.25, 0, 1.4, 3.9, 0.2, mat('#cbd5e1', 0.3), 0.02)
    for k in range(5):
        b.box(1.45, 3.45, 0.0 + k * 0.04, 1.75, 3.7, 0.035 + k * 0.04, mat('#64748b', 0.5), 0.006)
    tray(b, 0.75, 3.5, 0.2, ('#1f2937', '#f59e0b'))
    # roller conveyor into the scanner
    b.box(0.55, 2.0, 0, 1.35, 3.25, 0.14, mat('#94a3b8', 0.3))
    for k in range(15):
        b.wheel(0.95, 2.05 + k * 0.08, 0.16, 0.022, 0.76, mat('#cbd5e1', 0.25), axis='x', verts=8)
    tray(b, 0.95, 2.6, 0.18, ('#ef4444', '#1f2937', '#3b82f6'))
    tray(b, 0.95, 2.95, 0.18, ('#22c55e',))
    # X-ray machine with tunnel, lead curtains and status light
    b.box(0.45, 1.0, 0, 1.45, 2.0, 0.46, mat(C['white'], 0.35), 0.04)
    b.box(0.44, 0.99, 0.34, 1.46, 2.01, 0.39, mat(C['accent'], 0.4))
    for y in (0.99, 2.0):
        b.box(0.6, y, 0.12, 1.3, y + 0.01, 0.34, mat('#1f2328', 0.5))
        for k in range(6):
            b.box(0.62 + k * 0.115, y - 0.005, 0.13, 0.72 + k * 0.115, y + 0.015, 0.33, mat('#334155', 0.6))
    b.cyl(1.35, 1.9, 0.46, 0.5, 0.025, mat('#22c55e', 0.3, 2.0), 10)
    # operator console beside the scanner
    b.box(1.5, 1.15, 0, 1.92, 1.65, 0.24, mat('#cbd5e1', 0.35), 0.02)
    b.box(1.55, 1.2, 0.24, 1.58, 1.6, 0.42, mat('#1f2530', 0.3))
    b.box(1.58, 1.22, 0.26, 1.585, 1.58, 0.4, mat('#a5f3fc', 0.3, 0.9))
    staff(b, 1.75, 1.4, 2, '#334155')
    # walk-through metal detector
    for x in (0.08, 0.41):
        b.box(x, 2.55, 0, x + 0.05, 2.75, 0.52, mat('#e5e7eb', 0.35), 0.01)
    b.box(0.06, 2.53, 0.52, 0.48, 2.77, 0.6, mat('#e5e7eb', 0.35), 0.015)
    b.box(0.2, 2.77, 0.54, 0.34, 2.78, 0.58, mat('#22c55e', 0.3, 1.5))
    staff(b, 0.27, 2.1, 1, '#334155')
    # reclaim rollers and bench on the airside
    b.box(0.55, 0.2, 0, 1.35, 1.0, 0.14, mat('#94a3b8', 0.3))
    for k in range(10):
        b.wheel(0.95, 0.25 + k * 0.08, 0.16, 0.022, 0.76, mat('#cbd5e1', 0.25), axis='x', verts=8)
    tray(b, 0.95, 0.5, 0.18, ('#a855f7', '#f8fafc'))
    b.box(1.5, 0.25, 0, 1.9, 0.75, 0.12, mat('#475569', 0.4), 0.02)


def stadium(b, cx, y0, y1, r, z0, z1, m):
    """Rounded-end slab (two half circles joined by straight sides) as one closed mesh."""
    pts = []
    for k in range(17):
        a = math.pi + k / 16 * math.pi  # end at y0, bulging towards -gy
        pts.append((cx + r * math.cos(a), y0 + r * math.sin(a)))
    for k in range(17):
        a = k / 16 * math.pi
        pts.append((cx + r * math.cos(a), y1 + r * math.sin(a)))
    me = bpy.data.meshes.new('stadium')
    bm = bmesh.new()
    lo, hi = [], []
    for (gx, gy) in pts:
        x, y = b.tf(gx, gy)
        lo.append(bm.verts.new((x, -y, z0)))
        hi.append(bm.verts.new((x, -y, z1)))
    bm.faces.new(lo)
    bm.faces.new(hi)
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    for poly in me.polygons:
        poly.use_smooth = abs(poly.normal.z) < 0.95
    ob = bpy.data.objects.new('stadium', me)
    bpy.context.scene.collection.objects.link(ob)
    return b._add(ob, m)


def m_baggage(b):
    steel = mat('#cbd5e1', 0.25)
    belt_m = mat('#1f2328', 0.75)
    # stadium-shaped carousel: steel skirt, rubber slat belt, sloped steel island
    for (z0, z1, r, m_) in ((0, 0.2, 0.78, steel), (0.2, 0.225, 0.74, belt_m), (0.225, 0.3, 0.42, steel)):
        stadium(b, 1.5, 1.35, 2.85, r, z0, z1, m_)
    b.box(1.47, 1.2, 0.3, 1.53, 3.0, 0.34, mat('#94a3b8', 0.3))
    # feed chute from the wall with curtains
    b.box(1.15, 0.0, 0, 1.85, 0.6, 0.7, mat('#475569', 0.4), 0.02)
    b.box(1.25, 0.6, 0.22, 1.75, 0.62, 0.5, mat('#1f2328', 0.5))
    b.rbox(1.5, 0.75, 0.32, 0.4, 0.35, 0.03, 0, mat('#1f2328', 0.8))
    # bags travelling around the belt
    cols = ['#be123c', '#0ea5e9', '#334155', '#f59e0b', '#16a34a', '#a855f7', '#f97316', '#0f766e', '#1f2937']
    k = 0
    for i in range(10):
        a = i / 10 * 2 * math.pi
        cy = 2.85 if math.sin(a) > 0 else 1.35
        x = 1.5 + 0.6 * math.cos(a)
        y = cy + 0.6 * math.sin(a)
        if i in (3, 7):
            continue
        w, h = (0.1, 0.07) if i % 3 else (0.13, 0.09)
        b.box(x - w / 2, y - 0.06, 0.225, x + w / 2, y + 0.06, 0.225 + h, mat(cols[k % len(cols)], 0.5), 0.012)
        k += 1
    # arrivals screen and a row of baggage trolleys
    b.box(2.72, 0.3, 0, 2.8, 0.38, 0.75, mat('#2b3240', 0.4))
    screen(b, 2.5, 0.38, 0.5, 2.98, 0.8, '#fbbf24')
    for k in range(4):
        x = 0.1 + k * 0.07
        b.box(x, 3.45, 0.05, x + 0.04, 3.85, 0.07, mat('#94a3b8', 0.3))
        b.box(x, 3.45, 0.07, x + 0.04, 3.48, 0.3, mat('#94a3b8', 0.3))
        b.box(x, 3.8, 0.07, x + 0.04, 3.85, 0.18, mat('#94a3b8', 0.3))
    b.box(0.08, 3.42, 0.28, 0.4, 3.48, 0.31, mat('#ef4444', 0.4))
    plant(b, 2.75, 3.75)


def doorway(b, sign_col, sign_face, arrow=False):
    """Automatic sliding doors under a lit sign band (entrance and arrivals exit)."""
    frame = mat('#2b3240', 0.35)
    glass = mat(C['glass'], 0.04)
    b.box(0, 0.35, 0, 0.12, 0.65, 0.9, frame)
    b.box(1.88, 0.35, 0, 2.0, 0.65, 0.9, frame)
    b.box(0, 0.3, 0.9, 2.0, 0.7, 1.08, mat(sign_col, 0.4))
    b.box(0.45, 0.7, 0.93, 1.55, 0.71, 1.05, mat(sign_face, 0.3, 1.2))
    for k in range(5):
        b.box(0.55 + k * 0.17, 0.71, 0.96, 0.66 + k * 0.17, 0.715, 1.02, mat('#1f2530'))
    b.box(0, 0.0, 1.08, 2.0, 1.0, 1.12, mat('#e5e7eb', 0.35))  # canopy
    # two leaves slid apart, plus fixed side panes
    b.box(0.12, 0.47, 0, 0.62, 0.5, 0.9, glass)
    b.box(1.38, 0.47, 0, 1.88, 0.5, 0.9, glass)
    b.box(0.5, 0.52, 0, 0.85, 0.55, 0.9, glass)
    b.box(1.15, 0.52, 0, 1.5, 0.55, 0.9, glass)
    for x in (0.12, 0.62, 1.38, 1.88):
        b.box(x - 0.01, 0.46, 0, x + 0.01, 0.51, 0.9, frame)
    b.box(0.2, 0.62, 0, 1.8, 0.98, 0.01, mat('#334155', 0.9))  # mat
    b.box(0.2, 0.02, 0, 1.8, 0.38, 0.01, mat('#334155', 0.9))
    if arrow:
        b.box(0.88, 0.15, 0.011, 1.12, 0.3, 0.02, mat('#22c55e', 0.4, 0.5))
        b.cone(1.0, 0.08, 0.011, 0.02, 0.16, 0.0, mat('#22c55e', 0.4, 0.5), 3)


def m_entrance(b):
    doorway(b, C['accent'], '#f8fafc')


def m_exit(b):
    doorway(b, '#15803d', '#dcfce7', arrow=True)


def m_food(b):
    wall = mat('#f8fafc', 0.4)
    # kitchen wall with lit menu boards
    b.box(0.1, 0.0, 0, 3.9, 0.15, 1.0, wall, 0.02)
    for i, col in enumerate(('#fde68a', '#fecaca', '#bbf7d0')):
        screen(b, 0.4 + i * 1.15, 0.15, 0.58, 1.3 + i * 1.15, 0.9, col)
    b.box(2.95, 0.15, 0.2, 3.7, 0.4, 0.5, mat('#94a3b8', 0.25))  # fridges
    b.box(2.97, 0.4, 0.22, 3.68, 0.41, 0.48, mat(C['glass'], 0.05))
    # serving counter with glass display, coffee machine and till
    b.box(0.2, 0.75, 0, 3.8, 1.15, 0.26, mat(C['wood'], 0.5), 0.03)
    b.box(0.18, 0.73, 0.26, 3.82, 1.17, 0.29, mat('#f1f5f9', 0.25))
    b.box(0.4, 0.85, 0.29, 1.6, 1.12, 0.42, mat(C['glass'], 0.05))
    for k in range(6):
        b.cyl(0.52 + k * 0.2, 0.98, 0.29, 0.32, 0.06, mat(['#f59e0b', '#fde68a', '#b45309'][k % 3], 0.5), 12)
    b.box(2.1, 0.8, 0.29, 2.4, 1.0, 0.5, mat('#1f2328', 0.3), 0.02)
    b.box(2.15, 1.0, 0.36, 2.35, 1.01, 0.45, mat('#ef4444', 0.4, 0.6))
    b.box(3.2, 0.85, 0.29, 3.5, 1.05, 0.36, mat('#334155', 0.35))
    for k in range(4):
        cup(b, 2.6 + k * 0.08, 1.05, 0.29, ['#f8fafc', '#b45309'][k % 2])
    staff(b, 1.0, 0.5, 1, '#b91c1c')
    staff(b, 2.6, 0.5, 1, '#b91c1c')
    # canopy over the counter with the brand band
    b.box(0.1, 0.0, 1.0, 3.9, 0.55, 1.07, mat(C['roof'], 0.45), 0.02)
    b.box(0.6, 0.55, 1.005, 3.4, 0.56, 1.065, mat('#fff7ed', 0.3, 0.8))
    # tables with chairs and things left on them
    for k, (x, y) in enumerate(((0.75, 2.05), (2.0, 2.05), (3.25, 2.05), (1.35, 3.2), (2.65, 3.2))):
        b.cyl(x, y, 0, 0.02, 0.1, mat('#475569', 0.3), 12)
        b.cyl(x, y, 0.02, 0.19, 0.025, mat('#475569', 0.3), 8)
        b.cyl(x, y, 0.19, 0.21, 0.24, mat('#f8fafc', 0.35), 20)
        for f, (dx, dy) in ((0, (-0.36, 0)), (2, (0.36, 0)), (1, (0, -0.36)), (3, (0, 0.36))):
            chair(b, x + dx, y + dy, f, [C['accent'], C['accent2'], '#14b8a6'][k % 3])
        cup(b, x - 0.08, y + 0.05, 0.21)
        if k % 2:
            b.box(x, y - 0.1, 0.21, x + 0.14, y + 0.0, 0.225, mat('#f59e0b', 0.5))
    plant(b, 0.25, 3.75, big=True)
    plant(b, 3.75, 3.75, big=True)
    bin_(b, 3.8, 1.55)


def m_shop(b):
    b.box(0.05, 0.05, 0, 2.95, 2.2, 0.012, mat('#e7d3b5', 0.6))
    wall = mat('#f8fafc', 0.4)
    b.box(0.05, 0.05, 0, 2.95, 0.22, 0.95, wall, 0.02)
    b.box(0.05, 0.22, 0, 0.22, 2.2, 0.95, wall, 0.02)
    # wall shelving full of products
    wood = mat(C['wood'], 0.5)
    for i in range(3):
        x0 = 0.35 + i * 0.85
        b.box(x0, 0.22, 0, x0 + 0.75, 0.26, 0.8, wood)
        for x in (x0, x0 + 0.72):
            b.box(x, 0.26, 0, x + 0.03, 0.44, 0.8, wood)
        for k, z in enumerate((0.04, 0.24, 0.44, 0.64)):
            b.box(x0 + 0.03, 0.26, z, x0 + 0.72, 0.44, z + 0.02, mat('#f1f5f9', 0.3))
            products(b, x0 + 0.05, x0 + 0.7, 0.28, 0.42, z + 0.02, i * 5 + k)
    for k, y0 in enumerate((0.45, 1.25)):
        b.box(0.22, y0, 0, 0.26, y0 + 0.7, 0.8, wood)
        for y in (y0, y0 + 0.67):
            b.box(0.26, y, 0, 0.44, y + 0.03, 0.8, wood)
        for j, z in enumerate((0.04, 0.24, 0.44, 0.64)):
            b.box(0.26, y0 + 0.03, z, 0.44, y0 + 0.67, z + 0.02, mat('#f1f5f9', 0.3))
            products(b, 0.28, 0.42, y0 + 0.05, y0 + 0.65, z + 0.02, k * 7 + j)
    b.box(0.6, 0.22, 0.83, 2.6, 0.27, 0.95, mat(C['pink'], 0.45), 0.01)
    b.box(0.8, 0.27, 0.85, 2.4, 0.275, 0.93, mat('#fff1f2', 0.3, 1.0))
    # island display and perfume counter
    b.box(1.0, 0.95, 0, 1.9, 1.45, 0.28, mat('#f8fafc', 0.35), 0.03)
    products(b, 1.05, 1.85, 1.0, 1.4, 0.28, 11, h=0.1)
    b.cyl(2.35, 1.2, 0, 0.32, 0.18, mat('#1f2937', 0.3), 24)
    for k in range(6):
        a = k / 6 * 2 * math.pi
        b.cyl(2.35 + math.cos(a) * 0.11, 1.2 + math.sin(a) * 0.11, 0.32, 0.4, 0.025, mat(['#f9a8d4', '#fde68a', '#a5f3fc'][k % 3], 0.1), 10)
    # checkout with till and cashier
    b.box(2.1, 1.75, 0, 2.85, 2.05, 0.26, mat(C['pink'], 0.45), 0.02)
    b.box(2.08, 1.73, 0.26, 2.87, 2.07, 0.28, mat('#f1f5f9', 0.3))
    b.box(2.6, 1.8, 0.28, 2.78, 1.95, 0.36, mat('#1f2328', 0.3))
    staff(b, 2.45, 1.55, 1, '#be185d')
    # shopfront sign band and a glass return
    b.box(0.0, 2.15, 0, 0.1, 2.25, 0.82, mat(C['glass'], 0.05))
    plant(b, 2.8, 2.75)
    b.box(0.3, 2.45, 0, 0.7, 2.6, 0.45, mat('#fde68a', 0.4, 0.3), 0.02)  # promo stand


def m_toilets(b):
    tile = mat('#d9e4ef', 0.5)
    b.box(0.1, 0.1, 0, 1.9, 1.5, 0.8, tile, 0.03)
    for k in range(4):  # tile courses
        b.box(0.1, 1.5, 0.15 + k * 0.17, 1.9, 1.505, 0.16 + k * 0.17, mat('#b8c7d9', 0.5))
    b.box(0.05, 0.05, 0.8, 1.95, 1.55, 0.86, mat('#2b3240', 0.4), 0.02)
    for x0, col, icon in ((0.25, C['accent'], '#bfdbfe'), (1.25, C['pink'], '#fbcfe8')):
        b.box(x0, 1.49, 0, x0 + 0.5, 1.52, 0.6, mat('#1f2530', 0.4))  # doorway
        b.box(x0 + 0.1, 1.52, 0.63, x0 + 0.4, 1.53, 0.77, mat(col, 0.4, 0.8))
        b.box(x0 + 0.22, 1.53, 0.65, x0 + 0.28, 1.535, 0.72, mat(icon, 0.4, 1.0))
        b.sphere(x0 + 0.25, 1.535, 0.745, 0.018, mat(icon, 0.4, 1.0), seg=8)
    b.box(0.85, 1.5, 0.3, 1.15, 1.56, 0.55, mat('#e5e7eb', 0.3))  # hand dryer / baby change sign
    b.box(0.92, 1.56, 0.4, 1.08, 1.565, 0.5, mat('#facc15', 0.4, 0.8))
    # water fountain and cleaning cart outside
    b.box(0.15, 1.65, 0, 0.35, 1.8, 0.28, mat('#cbd5e1', 0.25), 0.02)
    b.box(1.55, 1.65, 0.03, 1.85, 1.9, 0.22, mat('#facc15', 0.45), 0.02)
    b.cyl(1.62, 1.78, 0.22, 0.3, 0.05, mat('#3b82f6', 0.4), 10)


def m_seats(b):
    seat_row(b, 0.1, 0.55, 5, C['seatJ'], 1, bags=(3,))
    suitcase(b, 0.4, 0.88, '#f97316')


def m_tower(b):
    # two-storey base with ribbon windows
    b.box(0.35, 0.35, 0, 2.65, 2.65, 0.75, mat(C['concrete'], 0.5), 0.04)
    for z in (0.15, 0.45):
        b.box(0.33, 0.33, z, 2.67, 2.67, z + 0.16, mat('#334155', 0.1))
    b.box(1.2, 2.66, 0, 1.8, 2.7, 0.3, mat(C['glass'], 0.05))
    b.box(0.3, 0.3, 0.75, 2.7, 2.7, 0.8, mat('#475569', 0.4))
    # shaft with service rings
    smooth(b.cyl(1.5, 1.5, 0.8, 6.2, 0.42, mat(C['white'], 0.4), 32))
    for z in (2.0, 3.6, 5.0):
        smooth(b.cyl(1.5, 1.5, z, z + 0.08, 0.45, mat('#cbd5e1', 0.35), 32))
    b.box(1.46, 1.06, 0.8, 1.54, 1.1, 6.1, mat('#334155', 0.1))  # stair window slot
    # equipment floor, then the flared glass cab with mullions
    smooth(b.cyl(1.5, 1.5, 6.2, 6.55, 0.78, mat(C['white'], 0.4), 32))
    b.cyl(1.5, 1.5, 6.55, 6.6, 0.84, mat('#475569', 0.4), 24)
    cab = b.cone(1.5, 1.5, 6.6, 7.3, 0.74, 0.92, mat('#7dd3fc', 0.05), 12)
    smooth(cab)
    b.cone(1.5, 1.5, 6.6, 7.3, 0.745, 0.925, mat('#1f2530', 0.4), 12)
    wf = b.objs[-1].modifiers.new('mullions', 'WIREFRAME')
    wf.thickness = 0.025
    b.cyl(1.5, 1.5, 7.3, 7.42, 0.98, mat('#2b3240', 0.4), 24)
    # roof kit: radar dome, masts and obstruction lights
    b.cyl(1.2, 1.5, 7.42, 7.55, 0.08, mat('#cbd5e1', 0.3), 12)
    b.sphere(1.2, 1.5, 7.68, 0.16, mat(C['white'], 0.3), seg=16, soft=True)
    for (x, y, h) in ((1.8, 1.3, 8.2), (1.75, 1.8, 7.9)):
        b.cyl(x, y, 7.42, h, 0.018, mat('#94a3b8', 0.3), 6)
        b.sphere(x, y, h, 0.035, mat(C['red'], 0.3, 4.0), seg=8)


def m_tree(b):
    b.cyl(0.5, 0.5, 0, 0.32, 0.055, mat(C['trunk'], 0.8), 8)
    tiers = ((0.22, 0.75, 0.42, '#2f8f4a'), (0.48, 0.98, 0.34, '#3aa556'), (0.72, 1.18, 0.26, '#45b862'), (0.94, 1.38, 0.17, '#55c870'))
    for k, (z0, z1, r, col) in enumerate(tiers):
        o = b.cone(0.5, 0.5, z0, z1, r, 0.0, mat(col, 0.85), 9)
        o.rotation_euler = (0, 0, k * 0.4)


def jb_cab(b):
    """Jet bridge cab, centred on the origin, bellows hood facing +gx (towards the aircraft door)."""
    b.box(-0.35, -0.27, 0.5, 0.25, 0.27, 0.92, mat('#94a3b8', 0.35), 0.02)
    b.box(-0.33, -0.275, 0.68, 0.2, 0.275, 0.76, mat('#334155', 0.1))
    b.box(0.22, -0.3, 0.48, 0.36, 0.3, 0.95, mat('#1f2328', 0.7), 0.04)  # rubber bellows
    b.box(-0.35, -0.28, 0.86, 0.25, 0.28, 0.89, mat(C['accent'], 0.4))
    # drive column with a two-wheel bogie under the cab
    b.box(-0.2, -0.05, 0.08, -0.1, 0.05, 0.5, mat('#475569', 0.35))
    b.box(-0.3, -0.2, 0.05, 0.0, 0.2, 0.11, mat('#475569', 0.35), 0.01)
    for y in (-0.17, 0.17):
        b.wheel(-0.15, y, 0.07, 0.07, 0.06, mat('#1f2328', 0.8))
    # service stair down the side
    for k in range(5):
        b.box(-0.3 + k * 0.06, 0.27, 0.42 - k * 0.09, -0.2 + k * 0.06, 0.4, 0.44 - k * 0.09, mat('#94a3b8', 0.4))


def jb_rotunda(b):
    smooth(b.cyl(0, 0, 0, 0.95, 0.3, mat('#94a3b8', 0.35), 32))
    smooth(b.cyl(0, 0, 0.6, 0.66, 0.31, mat('#334155', 0.1), 32))
    smooth(b.cyl(0, 0, 0.95, 1.0, 0.33, mat('#475569', 0.4), 32))
    smooth(b.cyl(0, 0, 0.88, 0.91, 0.315, mat(C['accent'], 0.4), 32))


def m_egates(b):
    """E-gates (3×2): four automated passport gates with glass flaps and face cameras; queue in front (+gy)."""
    b.box(0.05, 0.1, 0, 2.95, 1.9, 0.012, mat('#55657f', 0.95))
    for k in range(5):  # cabinets between the lanes
        x = 0.15 + k * 0.66
        b.box(x, 0.5, 0, x + 0.12, 1.5, 0.34, mat('#e5e7eb', 0.3), 0.02)
        b.box(x + 0.02, 1.3, 0.34, x + 0.1, 1.38, 0.5, mat('#1f2530', 0.3))  # camera post
        b.box(x + 0.03, 1.38, 0.42, x + 0.09, 1.385, 0.48, mat('#60a5fa', 0.3, 1.2))
    for k in range(4):  # glass flaps, half open
        x = 0.27 + k * 0.66
        b.box(x, 0.95, 0.12, x + 0.2, 0.97, 0.36, mat(C['glass'], 0.05))
        b.box(x + 0.34, 0.95, 0.12, x + 0.54, 0.97, 0.36, mat(C['glass'], 0.05))
        b.box(x + 0.22, 1.48, 0.3, x + 0.32, 1.5, 0.36, mat('#22c55e', 0.3, 1.5))
    b.box(0.1, 0.18, 0.78, 2.9, 0.3, 0.98, mat('#1e3a8a', 0.4), 0.02)
    b.box(0.25, 0.3, 0.82, 0.5, 0.305, 0.94, mat('#ffcc00', 0.4, 0.8))
    for k in range(5):
        b.box(0.65 + k * 0.3, 0.3, 0.84, 0.85 + k * 0.3, 0.305, 0.92, mat('#f8fafc', 0.3, 0.8))
    for x in (0.1, 2.82):
        b.box(x, 0.2, 0, x + 0.08, 0.28, 0.98, mat('#2b3240', 0.4))


def m_transfer(b):
    """Transfer desk (3×2): a compact screening point for connecting passengers, queue in front (+gy)."""
    b.box(0.05, 0.1, 0, 2.95, 1.9, 0.012, mat('#55657f', 0.95))
    b.box(0.2, 0.25, 0, 1.3, 0.8, 0.36, mat(C['white'], 0.35), 0.03)  # compact X-ray
    b.box(0.32, 0.79, 0.08, 1.18, 0.8, 0.28, mat('#1f2328', 0.5))
    b.box(0.2, 0.8, 0, 1.3, 1.5, 0.12, mat('#94a3b8', 0.3))  # roller bed
    tray(b, 0.75, 1.15, 0.12, ('#ef4444', '#1f2937'))
    for x in (1.55, 1.9):
        b.box(x, 0.85, 0, x + 0.05, 1.05, 0.5, mat('#e5e7eb', 0.35), 0.01)
    b.box(1.53, 0.83, 0.5, 1.97, 1.07, 0.56, mat('#e5e7eb', 0.35), 0.01)
    staff(b, 2.4, 0.6, 1, '#334155')
    b.box(2.2, 0.15, 0, 2.3, 0.25, 1.0, mat('#2b3240', 0.4))  # sign post
    b.box(1.7, 0.12, 0.8, 2.95, 0.28, 1.04, mat('#ffcc00', 0.4), 0.02)
    b.box(1.82, 0.28, 0.85, 2.05, 0.285, 0.99, mat('#111111'))
    for k in range(4):
        b.box(2.15 + k * 0.18, 0.28, 0.88, 2.28 + k * 0.18, 0.285, 0.95, mat('#111111'))


def m_lounge(b):
    """Airline lounge (5×4): carpeted, armchairs, a bar and buffet, glass partition, plants."""
    b.box(0.05, 0.05, 0, 4.95, 3.95, 0.012, mat('#5b4636', 0.95))  # warm carpet
    b.box(0.15, 0.15, 0.012, 4.85, 3.85, 0.016, mat('#6b5442', 0.95))
    # glass partition on the front with an entrance gap
    b.box(0.05, 3.88, 0, 2.0, 3.95, 0.7, mat(C['glass'], 0.05))
    b.box(3.0, 3.88, 0, 4.95, 3.95, 0.7, mat(C['glass'], 0.05))
    b.box(0.05, 3.86, 0.68, 4.95, 3.97, 0.74, mat('#2b3240', 0.4))
    b.box(2.1, 3.9, 0.74, 2.9, 3.97, 0.9, mat('#1e3a8a', 0.4))
    b.box(2.2, 3.97, 0.77, 2.8, 3.975, 0.87, mat('#fde68a', 0.3, 0.9))
    # bar and buffet along the back
    b.box(0.3, 0.2, 0, 2.6, 0.6, 0.3, mat(C['wood'], 0.45), 0.03)
    b.box(0.28, 0.18, 0.3, 2.62, 0.62, 0.32, mat('#f1f5f9', 0.25))
    for k in range(6):
        b.cyl(0.5 + k * 0.35, 0.4, 0.32, 0.38, 0.05, mat(['#f59e0b', '#16a34a', '#be123c'][k % 3], 0.4), 12)
    b.box(0.3, 0.05, 0.3, 2.6, 0.12, 0.85, mat('#3b2f2a', 0.5))  # back bar shelving
    for k in range(10):
        b.cyl(0.4 + k * 0.22, 0.09, 0.4, 0.55, 0.025, mat(['#7c2d12', '#065f46', '#f59e0b', '#e5e7eb'][k % 4], 0.15), 8)
    staff(b, 1.5, 0.75, 1, '#7c2d12')
    # armchair clusters with low tables
    def armchair(x, y, f):
        dx, dy = ((1, 0), (0, 1), (-1, 0), (0, -1))[f]
        b.box(x - 0.17, y - 0.17, 0.02, x + 0.17, y + 0.17, 0.16, mat('#334155', 0.7), 0.04)
        bx, by = x - dx * 0.15, y - dy * 0.15
        hx, hy = (0.04, 0.17) if dx else (0.17, 0.04)
        b.box(bx - hx, by - hy, 0.16, bx + hx, by + hy, 0.36, mat('#334155', 0.7), 0.03)
    for (cx, cy) in ((1.0, 1.6), (2.6, 1.6), (4.0, 1.4), (1.0, 3.0), (2.6, 3.0), (4.0, 2.9)):
        b.cyl(cx, cy, 0, 0.14, 0.18, mat(C['wood'], 0.4), 16)
        armchair(cx - 0.45, cy, 0)
        armchair(cx + 0.45, cy, 2)
        cup(b, cx + 0.05, cy, 0.14)
    plant(b, 4.6, 0.4, big=True)
    plant(b, 0.35, 3.55)
    screen(b, 3.2, 0.1, 0.45, 4.4, 0.85, '#60a5fa')


def m_passport(b):
    """Passport control (3×3): three glass booths with officers, a sign gantry, and a queue lane in front (+gy)."""
    b.box(0.05, 0.1, 0, 2.95, 1.6, 0.012, mat('#55657f', 0.95))
    for k in range(3):
        x0 = 0.15 + k * 0.95
        b.box(x0, 0.6, 0, x0 + 0.7, 1.15, 0.3, mat('#e5e7eb', 0.35), 0.03)  # booth base
        b.box(x0, 0.6, 0.3, x0 + 0.7, 1.15, 0.62, mat(C['glass'], 0.05))  # glass cabin
        b.box(x0 - 0.02, 0.58, 0.62, x0 + 0.72, 1.17, 0.66, mat('#1e3a8a', 0.4))
        b.box(x0 + 0.06, 1.13, 0.22, x0 + 0.64, 1.2, 0.26, mat('#d6dbe3', 0.3))  # passport counter
        b.box(x0 + 0.5, 1.12, 0.3, x0 + 0.62, 1.14, 0.38, mat('#22c55e', 0.3, 1.5))  # go light
        staff(b, x0 + 0.35, 0.82, 1, '#1e3a8a')
        b.box(x0 + 0.7, 0.4, 0, x0 + 0.78, 1.3, 0.3, mat('#94a3b8', 0.3))  # lane divider
    # sign gantry
    for x in (0.05, 2.87):
        b.box(x, 0.2, 0, x + 0.08, 0.28, 1.05, mat('#2b3240', 0.4))
    b.box(0.0, 0.18, 0.88, 2.95, 0.3, 1.08, mat('#1e3a8a', 0.4), 0.02)
    b.box(0.25, 0.3, 0.92, 0.5, 0.305, 1.04, mat('#ffcc00', 0.4, 0.8))
    for k in range(7):
        b.box(0.62 + k * 0.28, 0.3, 0.95, 0.8 + k * 0.28, 0.305, 1.01, mat('#f8fafc', 0.3, 0.8))
    # queue lane posts and belts towards the front
    for x in (0.4, 1.5, 2.6):
        stanchion(b, x, 2.2)
        stanchion(b, x, 2.85)
    belt(b, 0.4, 2.2, 2.6, 2.2)
    belt(b, 0.4, 2.85, 2.6, 2.85)


def m_busgate(b):
    """Bus gate (4×3): lounge for remote stands, glass apron doors on the airside face (-gy)."""
    b.box(0.08, 0.5, 0, 3.92, 2.92, 0.012, mat('#55657f', 0.95))
    seat_row(b, 0.4, 1.35, 8, '#14b8a6', -1, bags=(3,))
    seat_row(b, 0.4, 2.3, 8, '#14b8a6', -1, bags=(6,))
    # glass apron wall with two sliding door pairs
    b.box(0.0, 0.0, 0, 4.0, 0.08, 0.9, mat(C['glass'], 0.05))
    for x in (0.0, 1.96, 3.92):
        b.box(x, 0.0, 0, x + 0.08, 0.1, 0.92, mat('#2b3240', 0.4))
    b.box(0.0, 0.0, 0.88, 4.0, 0.1, 0.95, mat('#2b3240', 0.4))
    for x in (0.55, 2.55):
        b.box(x, 0.06, 0.0, x + 0.9, 0.12, 0.8, mat('#cfe8f7', 0.05))
        b.box(x - 0.02, 0.1, 0.8, x + 0.92, 0.14, 0.86, mat('#22c55e', 0.3, 1.0))
    # bus sign column and boarding desk with a queue lane
    b.box(3.55, 0.35, 0, 3.65, 0.45, 1.0, mat('#2b3240', 0.4))
    b.box(3.25, 0.3, 0.78, 3.95, 0.48, 1.06, mat('#ffcc00', 0.4), 0.02)
    b.box(3.35, 0.48, 0.84, 3.6, 0.485, 1.0, mat('#111111'))  # bus pictogram plate
    b.box(3.4, 0.485, 0.86, 3.55, 0.49, 0.95, mat('#ffcc00', 0.4))
    b.box(3.65, 0.48, 0.86, 3.88, 0.485, 0.98, mat('#111111'))
    b.box(0.25, 0.25, 0, 1.1, 0.55, 0.26, mat(C['white'], 0.35), 0.03)
    b.box(0.23, 0.23, 0.26, 1.12, 0.57, 0.28, mat('#d6dbe3', 0.3))
    b.box(0.4, 0.3, 0.28, 0.62, 0.32, 0.42, mat('#1f2530', 0.3))
    b.box(0.42, 0.32, 0.3, 0.6, 0.325, 0.4, mat('#93c5fd', 0.3, 0.8))
    for x in (1.3, 1.9):
        stanchion(b, x, 0.7)
    belt(b, 1.3, 0.7, 1.9, 0.7)
    screen(b, 2.1, 0.14, 0.55, 3.0, 0.82, '#fbbf24')
    plant(b, 3.7, 2.7)


def m_bagsort(b):
    """Baggage hall (6×4): clad shed, roller doors on the apron side (+gy), conveyor bridge to the terminal."""
    clad = mat('#d6dbe2', 0.55)
    b.box(0.2, 0.2, 0, 5.8, 3.2, 1.05, clad, 0.03)
    for k in range(12):  # vertical cladding ribs
        x = 0.35 + k * 0.45
        b.box(x, 3.2, 0.05, x + 0.04, 3.215, 1.0, mat('#b8c0cb', 0.5))
    b.box(0.15, 0.15, 1.05, 5.85, 3.25, 1.12, mat('#4b5563', 0.5), 0.02)  # roof edge
    for k in range(4):  # skylight strips
        b.box(0.6 + k * 1.3, 0.6, 1.12, 1.4 + k * 1.3, 2.8, 1.16, mat('#9fd3f5', 0.1))
    b.box(4.6, 0.6, 1.12, 5.4, 1.2, 1.4, mat('#94a3b8', 0.4), 0.02)  # air handling unit
    # roller doors with lit sorting interior behind them
    for k in range(3):
        x0 = 0.55 + k * 1.75
        b.box(x0, 3.19, 0, x0 + 1.25, 3.23, 0.7, mat('#1f2328', 0.6))
        b.box(x0 + 0.05, 3.2, 0.05, x0 + 1.2, 3.235, 0.4, mat('#fde68a', 0.4, 1.4))
        b.box(x0 + 0.05, 3.2, 0.4, x0 + 1.2, 3.24, 0.66, mat('#cbd5e1', 0.45))  # half-raised door
        for j in range(4):
            b.box(x0 + 0.05, 3.24, 0.43 + j * 0.06, x0 + 1.2, 3.245, 0.445 + j * 0.06, mat('#94a3b8', 0.4))
        b.box(x0 - 0.05, 3.19, 0.7, x0 + 1.3, 3.26, 0.76, mat(GSE_YELLOW, 0.4))
    # sign band
    b.box(1.6, 3.2, 0.8, 4.4, 3.26, 0.98, mat('#ffcc00', 0.4))
    b.box(1.75, 3.26, 0.84, 2.0, 3.265, 0.94, mat('#111111'))
    for k in range(6):
        b.box(2.15 + k * 0.33, 3.26, 0.86, 2.4 + k * 0.33, 3.265, 0.92, mat('#111111'))
    # covered conveyor bridge heading back towards the terminal (-gy)
    b.box(2.6, 0.0, 0.55, 3.4, 0.2, 0.95, mat('#9aa5b5', 0.4))
    b.box(2.7, -0.0, 0.62, 3.3, 0.02, 0.88, mat('#334155', 0.2))
    # baggage carts and a tractor waiting on the forecourt
    cols = ['#be123c', '#0ea5e9', '#334155', '#f59e0b', '#16a34a']
    for k in range(3):
        x0 = 0.4 + k * 0.7
        b.box(x0, 3.45, 0.05, x0 + 0.55, 3.8, 0.08, mat('#9aa5b5', 0.4))
        b.box(x0 - 0.01, 3.44, 0.32, x0 + 0.56, 3.81, 0.34, mat('#cbd5e1', 0.5))
        for j in range(3):
            b.box(x0 + 0.04 + j * 0.16, 3.5, 0.08, x0 + 0.16 + j * 0.16, 3.75, 0.18, mat(cols[(k + j) % 5], 0.5), 0.01)
        for x in (x0 + 0.08, x0 + 0.47):
            b.wheel(x, 3.63, 0.045, 0.045, 0.3, mat('#1f2328', 0.8), axis='x', verts=10)
    b.box(4.4, 3.45, 0.06, 4.95, 3.8, 0.2, mat('#e11d48', 0.5), 0.02)
    b.box(4.45, 3.47, 0.2, 4.68, 3.78, 0.38, mat('#1e293b', 0.1))


MODULES = {
    'checkin': (4, 2, m_checkin), 'security': (2, 4, m_security), 'gate': (4, 4, m_gate), 'food': (4, 4, m_food),
    'shop': (3, 3, m_shop), 'toilets': (2, 2, m_toilets), 'seats': (2, 1, m_seats), 'baggage': (3, 4, m_baggage),
    'entrance': (2, 1, m_entrance), 'bagsort': (6, 4, m_bagsort), 'busgate': (4, 3, m_busgate), 'passport': (3, 3, m_passport), 'transfer': (3, 2, m_transfer), 'egates': (3, 2, m_egates), 'lounge': (5, 4, m_lounge), 'exit': (2, 1, m_exit), 'tower': (3, 3, m_tower), 'tree': (1, 1, m_tree)
}

# ---------------------------------------------------------------- aircraft (real dimensions, metres)

WINGLET = {'A20N': 2.0, 'B38M': 2.4, 'A359': 2.8, 'E295': 1.3}  # metres (drawn a little smaller than real)

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

    # fuselage: one lofted skin through real-looking cross-sections, so nose, barrel
    # and tail are a single continuous surface. Stations: (distance in diameters,
    # half-width, half-height, centre offset), all in fuselage radii. The nose droops
    # (straight belly, curved crown); the tail keeps a level crown while the belly
    # sweeps up to the APU.
    R = D / 2
    NOSE = [(0.0, 0.04, 0.04, -0.30), (0.06, 0.30, 0.28, -0.24), (0.18, 0.55, 0.52, -0.16), (0.28, 0.67, 0.65, -0.12), (0.38, 0.76, 0.74, -0.09),
            (0.62, 0.90, 0.89, -0.04), (0.95, 0.98, 0.98, -0.01), (1.3, 1.0, 1.0, 0.0)]
    TAIL = [(2.8, 1.0, 1.0, 0.0), (2.2, 0.93, 0.9, 0.1), (1.6, 0.78, 0.74, 0.26), (1.0, 0.58, 0.52, 0.46),
            (0.45, 0.36, 0.3, 0.64), (0.1, 0.16, 0.14, 0.78), (0.0, 0.1, 0.1, 0.8)]
    stations = [(x0 + L - d * D, ry, rz, zo) for d, ry, rz, zo in NOSE] + [(x0 + d * D, ry, rz, zo) for d, ry, rz, zo in TAIL]
    N = 40
    me = bpy.data.meshes.new('fuselage')
    bm = bmesh.new()
    rings = []
    for x, ry, rz, zo in stations:
        rings.append([bm.verts.new((x, ry * R * math.cos(2 * math.pi * k / N), zc + zo * R + rz * R * math.sin(2 * math.pi * k / N))) for k in range(N)])
    for a, b in zip(rings, rings[1:]):
        for k in range(N):
            f = bm.faces.new((a[k], b[k], b[(k + 1) % N], a[(k + 1) % N]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    for poly in me.polygons:
        poly.use_smooth = True
    ob = bpy.data.objects.new('fuselage', me)
    bpy.context.scene.collection.objects.link(ob)
    add(ob, white)

    def section_at(x):
        """(half-width, half-height, centre offset) of the loft at world x, in radii."""
        for (xa, *a), (xb, *b) in zip(stations, stations[1:]):
            if xb <= x <= xa:
                t = (xa - x) / (xa - xb) if xa != xb else 0
                return [u + (v - u) * t for u, v in zip(a, b)]
        return stations[-1][1:]

    def skin_patch(xa, xb, tha, thb, m, side, out=0.004, tag=None, G=5):
        """Quad patch laid on the fuselage skin between world x xa..xb; tha/thb are the
        (low, high) angles in degrees around the axis at xa and xb (0 = side, 90 = crown)."""
        me = bpy.data.meshes.new('patch')
        bm = bmesh.new()
        grid = []
        for i in range(G + 1):
            u = i / G
            x = xa + (xb - xa) * u
            ry, rz, zo = section_at(x)
            t0 = math.radians(tha[0] + (thb[0] - tha[0]) * u)
            t1 = math.radians(tha[1] + (thb[1] - tha[1]) * u)
            row = []
            for j in range(G + 1):
                th = t0 + (t1 - t0) * j / G
                row.append(bm.verts.new((x, side * (ry * R + out) * math.cos(th), zc + zo * R + (rz * R + out) * math.sin(th))))
            grid.append(row)
        for i in range(G):
            for j in range(G):
                bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
        for poly in me.polygons:
            poly.use_smooth = True
        po = bpy.data.objects.new('patch', me)
        bpy.context.scene.collection.objects.link(po)
        return add(po, m, tag)

    # cockpit glazing: windscreen (meets its twin at the crown post), sliding side window and
    # rear side window with a sloping top; distances in diameters from the nose tip
    nx = lambda d: x0 + L - d * D  # noqa: E731
    glass = mat('#1b2433', 0.08)
    for side in (1, -1):
        skin_patch(nx(0.22), nx(0.40), (42, 86), (34, 86), glass, side)
        skin_patch(nx(0.42), nx(0.55), (27, 64), (25, 58), glass, side)
        skin_patch(nx(0.57), nx(0.66), (25, 54), (25, 40), glass, side)
        # cheatline (livery) band through the window line, following the skin into nose and tail
        skin_patch(x0 + 2.4 * D, nx(1.0), (-3, 21), (-3, 21), liv, side, out=0.002, tag='livery', G=24)

    # cabin windows, passenger doors and belly fairing
    win = mat('#2c3a4f', 0.15)
    door = mat('#e9edf2', 0.45)
    seam = mat('#8c96a6', 0.5)
    pitch = 0.53 * s
    wy = math.sqrt(max((D / 2) ** 2 - (D * 0.12) ** 2, 0)) + 0.006
    xa, xb = x0 + 2.75 * D, x0 + L - 1.55 * D  # aft of the L1 door to just ahead of the rear door
    n = int((xb - xa) / pitch) + 1
    for side in (1, -1):
        for i in range(n):
            bpy.ops.mesh.primitive_cube_add(size=1, location=(xa + i * pitch, side * wy, zc + D * 0.12))
            o = add(bpy.context.active_object, win)
            o.scale = (0.25 * s, 0.01, 0.34 * s)
        for dx in (x0 + L - 1.3 * D, x0 + 2.45 * D):  # L1 and rear doors, 0.85 x 1.85 m, on the curved skin
            ry, rz, zo = section_at(dx)
            ang = lambda z: math.degrees(math.asin(max(-1, min(1, (z - zo * R) / (rz * R)))))  # noqa: E731
            lo, hi = ang(-0.75 * s), ang(1.1 * s)
            flo, fhi = ang(-0.82 * s), ang(1.17 * s)
            skin_patch(dx + 0.49 * s, dx - 0.49 * s, (flo, fhi), (flo, fhi), seam, side, out=0.006)  # door seam
            skin_patch(dx + 0.42 * s, dx - 0.42 * s, (lo, hi), (lo, hi), door, side, out=0.009)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=1, location=(x0 + L * (1 - wingX) - chord * 0.2, 0, zc - D * 0.32))
    o = add(smooth(bpy.context.active_object), mat('#dfe4ea', 0.5))
    o.scale = (chord * 0.9, D * 0.42, D * 0.28)

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
    wl = WINGLET.get(code, 0) * s
    if wl:
        sw_tip = math.tan(math.radians(sweep)) * span / 2
        tz = wz + math.tan(math.radians(5)) * span / 2 + D * 0.08
        tip_x = root_le - sw_tip  # leading edge at the wing tip
        tc = chord * 0.3  # wing tip chord
        for side in (1, -1):
            # tapered, swept blade rising from the tip, canted slightly outboard
            me = bpy.data.meshes.new('sharklet')
            bm = bmesh.new()
            y0, y1 = side * span / 2, side * (span / 2 + wl * 0.25)
            pts = [(tip_x, y0, tz - 0.01), (tip_x - tc, y0, tz - 0.01), (tip_x - tc - wl * 0.45, y1, tz + wl), (tip_x - tc * 0.35 - wl * 0.45, y1, tz + wl)]
            a = [bm.verts.new((p[0], p[1] - 0.006, p[2])) for p in pts]
            b2 = [bm.verts.new((p[0], p[1] + 0.006, p[2])) for p in pts]
            bm.faces.new(a)
            bm.faces.new(list(reversed(b2)))
            for i in range(4):
                j = (i + 1) % 4
                bm.faces.new((a[i], a[j], b2[j], b2[i]))
            bm.to_mesh(me)
            bm.free()
            ob = bpy.data.objects.new('sharklet', me)
            bpy.context.scene.collection.objects.link(ob)
            add(ob, liv, 'livery')
    # tailplane (on top of the fin for T-tails)
    stab_z = zc + D * 0.15 if not tTail else H - D * 0.1
    stab_x = x0 + D * 1.8 if not tTail else x0 + D * 1.2 - (H - zc) * math.tan(math.radians(30)) * 0.6
    for side in (1, -1):
        slab('stab', stab_x, chord * 0.5, chord * 0.25, span * 0.17, 0 if prop else 32, stab_z, D * 0.05, grey, 3, side=side)
    # fin (livery): root sits on the tail crown, trailing edge just ahead of the tail
    # tip, swept leading edge; the tip overhangs the tail cone slightly as on the real thing
    me = bpy.data.meshes.new('fin')
    bm = bmesh.new()
    fc = chord * (0.9 if not prop else 1.0)
    z0 = zc + R * 0.82  # a little below the crown so the root is buried in the skin
    fh = H - z0
    le = x0 + D * 0.25 + fc
    tip_le = le - fh * math.tan(math.radians(40 if not prop else 32))
    pts = [(le, 0, z0), (le - fc, 0, z0), (tip_le - fc * 0.38, 0, z0 + fh), (tip_le, 0, z0 + fh)]
    th = D * 0.05
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
            bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=engD * 0.45, depth=chord * 1.4, location=(ex - chord * 0.3, side * span * 0.17, wz - engD * 0.3), rotation=(0, math.pi / 2, 0))
            add(smooth(bpy.context.active_object), liv, 'livery')
            px, py, pz = ex + chord * 0.42, side * span * 0.17, wz - engD * 0.3
            bpy.ops.mesh.primitive_cone_add(vertices=20, radius1=engD * 0.34, radius2=0.0, depth=engD * 0.8, location=(px + engD * 0.3, py, pz), rotation=(0, math.pi / 2, 0))
            add(smooth(bpy.context.active_object), mat('#d9dee6', 0.3))
            for k in range(6):  # six-blade propeller, stopped and feathered
                a = k * math.pi / 3 + 0.25
                r = engD * 1.05
                bpy.ops.mesh.primitive_cube_add(size=1, location=(px + engD * 0.1, py + math.cos(a) * r, pz + math.sin(a) * r))
                o = add(bpy.context.active_object, mat('#23272f', 0.45))
                o.scale = (engD * 0.26, 0.025, engD * 1.6)  # chord along the airflow, blade along local z
                o.rotation_mode = 'ZYX'
                o.rotation_euler = (a - math.pi / 2, 0, math.radians(25))
                bpy.ops.mesh.primitive_cube_add(size=1, location=(px + engD * 0.1, py + math.cos(a) * engD * 1.8, pz + math.sin(a) * engD * 1.8))
                o = add(bpy.context.active_object, mat('#facc15', 0.4))  # painted tips
                o.scale = (engD * 0.2, 0.027, engD * 0.12)
                o.rotation_mode = 'ZYX'
                o.rotation_euler = (a - math.pi / 2, 0, math.radians(25))
    else:
        positions = [0.33] if nEng == 2 else [0.26, 0.5]
        for side in (1, -1):
            for f in positions:
                sw = math.tan(math.radians(sweep)) * span / 2 * f
                ex = root_le - sw + engD * 0.6
                ey, ez = side * span / 2 * f, wz - engD * 0.45
                bpy.ops.mesh.primitive_cylinder_add(vertices=28, radius=engD / 2, depth=engD * 1.7, location=(ex, ey, ez), rotation=(0, math.pi / 2, 0))
                add(smooth(bpy.context.active_object), liv, 'livery')
                bpy.ops.mesh.primitive_cylinder_add(vertices=28, radius=engD * 0.53, depth=engD * 0.18, location=(ex + engD * 0.8, ey, ez), rotation=(0, math.pi / 2, 0))
                add(smooth(bpy.context.active_object), mat('#e5e9ef', 0.3))
                bpy.ops.mesh.primitive_cylinder_add(vertices=28, radius=engD * 0.42, depth=0.02, location=(ex + engD * 0.9, ey, ez), rotation=(0, math.pi / 2, 0))
                add(bpy.context.active_object, mat('#2b3240', 0.35))
                bpy.ops.mesh.primitive_cone_add(vertices=16, radius1=engD * 0.14, radius2=0.0, depth=engD * 0.22, location=(ex + engD * 1.0, ey, ez), rotation=(0, math.pi / 2, 0))
                add(smooth(bpy.context.active_object), mat('#cbd5e1', 0.3))
                bpy.ops.mesh.primitive_cone_add(vertices=20, radius1=engD * 0.32, radius2=engD * 0.08, depth=engD * 0.6, location=(ex - engD * 1.1, ey, ez), rotation=(0, -math.pi / 2, 0))
                add(smooth(bpy.context.active_object), mat('#8b95a5', 0.35))
                wing_z = wz + math.tan(math.radians(5)) * abs(ey)  # wing underside above this engine
                z_lo, z_hi = ez + engD * 0.3, wing_z + 0.01
                bpy.ops.mesh.primitive_cube_add(size=1, location=(ex - engD * 0.2, ey, (z_lo + z_hi) / 2))
                o = add(bpy.context.active_object, grey)
                o.scale = (engD * 1.4, engD * 0.12, max(z_hi - z_lo, 0.01))
    # landing gear
    tyre = mat('#1f2328', 0.85)
    leg = mat(C['metal'], 0.3)
    wr = 0.55 * s * (1.4 if L > 50 * s else 1.0)
    bogie = L > 50 * s
    for gx, gy, main in ((x0 + L * 0.88, 0, False), (root_le - chord * 0.7, D * 0.45, True), (root_le - chord * 0.7, -D * 0.45, True)):
        bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.025, depth=zc - D * 0.45, location=(gx, gy, (zc - D * 0.45) / 2 + wr * 0.5))
        add(bpy.context.active_object, leg)
        axles = (-wr * 1.1, wr * 1.1) if (main and bogie) else (0,)
        for ax in axles:
            for dy in (-wr * 0.55, wr * 0.55):
                bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=wr, depth=wr * 0.8, location=(gx + ax, gy + dy, wr), rotation=(math.pi / 2, 0, 0))
                add(smooth(bpy.context.active_object), tyre)

    # facing: 0 nose to grid +x, 1 to +y (Blender -Y), 2 to -x, 3 to -y
    rotz = -facing * math.pi / 2
    for o in objs:
        o.matrix_world = Matrix.Rotation(rotz, 4, 'Z') @ o.matrix_world
    return objs



# ---------------------------------------------------------------- ground support vehicles
# Built facing +gx around the origin, in tiles (1 tile = 5 m).

GSE_YELLOW = '#f2b705'


def gse_tug(b):
    y = mat(GSE_YELLOW, 0.5)
    b.box(-0.6, -0.28, 0.07, 0.6, 0.28, 0.24, y, 0.03)
    b.box(-0.62, -0.26, 0.09, -0.58, 0.26, 0.16, mat(C['dark']))
    b.box(0.58, -0.26, 0.09, 0.62, 0.26, 0.16, mat(C['dark']))
    for i in range(5):  # hazard stripes on the push face
        b.box(0.6, -0.25 + i * 0.1, 0.16, 0.615, -0.2 + i * 0.1, 0.235, mat(C['dark']))
    b.box(-0.5, -0.27, 0.24, -0.15, -0.02, 0.27, mat(C['dark']))
    b.box(-0.48, -0.25, 0.27, -0.17, -0.04, 0.42, mat('#1e293b', 0.1))
    b.box(-0.5, -0.27, 0.42, -0.15, -0.02, 0.45, mat(GSE_YELLOW, 0.5))
    b.cyl(-0.32, -0.15, 0.45, 0.49, 0.025, mat('#fb923c', 0.3, 3.0), 10)
    for x in (-0.4, 0.4):
        for yy in (-0.26, 0.26):
            b.wheel(x, yy, 0.1, 0.1, 0.08, mat('#1f2328', 0.8))


def gse_bags(b):
    # tractor
    b.box(0.55, -0.15, 0.06, 1.1, 0.15, 0.2, mat('#e11d48', 0.5), 0.02)
    b.box(0.6, -0.14, 0.2, 0.82, 0.14, 0.24, mat(C['dark']))
    for x, yy in ((0.62, -0.13), (0.62, 0.13), (0.8, -0.13), (0.8, 0.13)):
        b.box(x - 0.01, yy - 0.01, 0.24, x + 0.01, yy + 0.01, 0.38, mat(C['dark']))
    b.box(0.58, -0.15, 0.38, 0.84, 0.15, 0.4, mat('#e11d48', 0.5))
    for x in (0.68, 1.0):
        for yy in (-0.15, 0.15):
            b.wheel(x, yy, 0.06, 0.06, 0.05, mat('#1f2328', 0.8))
    # two baggage carts with canopies and a load of bags
    cols = ['#be123c', '#0ea5e9', '#334155', '#f59e0b', '#16a34a', '#a855f7', '#f97316', '#0f766e']
    for k, x0 in enumerate((-0.08, -0.78)):
        x1 = x0 + 0.58
        b.box(x0 - 0.06, -0.012, 0.06, x0 + 0.02, 0.012, 0.075, mat(C['dark']))  # drawbar
        b.box(x0, -0.16, 0.06, x1, 0.16, 0.09, mat('#9aa5b5', 0.4))
        for x in (x0, x1 - 0.02):
            for yy in (-0.16, 0.14):
                b.box(x, yy, 0.09, x + 0.02, yy + 0.02, 0.36, mat('#64748b', 0.4))
        b.box(x0 - 0.01, -0.17, 0.36, x1 + 0.01, 0.17, 0.38, mat('#cbd5e1', 0.5), 0.01)
        for i in range(6):
            bx = x0 + 0.05 + (i % 3) * 0.17
            by = -0.12 + (i // 3) * 0.13
            h = 0.08 + ((i + k) % 3) * 0.025
            b.box(bx, by, 0.09, bx + 0.14, by + 0.1, 0.09 + h, mat(cols[(i + k * 3) % len(cols)], 0.5), 0.01)
        for x in (x0 + 0.1, x1 - 0.1):
            for yy in (-0.16, 0.16):
                b.wheel(x, yy, 0.045, 0.045, 0.04, mat('#1f2328', 0.8))


def gse_belt(b):
    y = mat(GSE_YELLOW, 0.5)
    b.box(-0.75, -0.22, 0.06, 0.45, 0.22, 0.17, y, 0.02)
    b.box(-0.55, -0.22, 0.17, -0.35, 0.0, 0.22, mat(C['dark']))  # driver seat
    b.box(-0.55, -0.22, 0.22, -0.52, 0.0, 0.32, mat(C['dark']))
    # inclined conveyor rising to the cargo door at the front
    L = 1.55
    pitch = 17
    cx, cz = 0.0, 0.17 + math.sin(math.radians(pitch)) * L / 2 + 0.03
    b.rbox(cx, 0.0, cz, L, 0.2, 0.04, pitch, mat('#3f4652', 0.7))
    for side in (-0.11, 0.11):
        b.rbox(cx, side, cz + 0.035, L, 0.02, 0.05, pitch, mat(GSE_YELLOW, 0.5))
    b.rbox(0.35, 0.0, 0.25, 0.05, 0.05, 0.22, 0, mat(C['dark']))  # lift strut
    for i, col in enumerate(('#334155', '#be123c')):
        t = 0.2 + i * 0.35
        b.rbox(cx - L / 2 + t * L + 0.1, 0.0, 0.2 + math.sin(math.radians(pitch)) * (t * L + 0.1) + 0.05, 0.12, 0.09, 0.07, pitch, mat(col, 0.5))
    for x in (-0.55, 0.3):
        for yy in (-0.22, 0.22):
            b.wheel(x, yy, 0.07, 0.07, 0.06, mat('#1f2328', 0.8))


def gse_fuel(b):
    b.box(-1.0, -0.2, 0.08, 1.0, 0.2, 0.14, mat(C['dark']))
    # cab
    b.box(0.6, -0.25, 0.1, 1.0, 0.25, 0.52, mat(C['white'], 0.4), 0.04)
    b.box(0.98, -0.22, 0.32, 1.005, 0.22, 0.48, mat('#1e293b', 0.1))
    b.box(0.62, -0.255, 0.32, 0.9, 0.25, 0.47, mat('#1e293b', 0.1))
    b.cyl(0.8, 0.0, 0.52, 0.55, 0.03, mat('#fb923c', 0.3, 3.0), 10)
    # tank
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.24, depth=1.5, location=(-0.2, 0, 0.4), rotation=(0, math.pi / 2, 0))
    b._add(smooth(bpy.context.active_object), mat('#eef0f3', 0.3))
    for x in (-0.95, -0.2, 0.55):
        bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.245, depth=0.05, location=(x, 0, 0.4), rotation=(0, math.pi / 2, 0))
        b._add(smooth(bpy.context.active_object), mat('#dc2626', 0.4))
    b.box(-0.8, -0.04, 0.64, 0.4, 0.04, 0.66, mat('#9aa5b5', 0.3))  # walkway
    b.box(-1.02, -0.18, 0.12, -0.96, 0.18, 0.36, mat('#64748b', 0.4))  # hose reel cabinet
    b.cyl(-1.0, 0.0, 0.18, 0.3, 0.05, mat('#1f2328'), 12)
    for x in (-0.75, -0.45, 0.8):
        for yy in (-0.21, 0.21):
            b.wheel(x, yy, 0.1, 0.1, 0.08, mat('#1f2328', 0.8))


def gse_catering(b):
    b.box(-0.95, -0.22, 0.08, 0.9, 0.22, 0.15, mat(C['dark']))
    b.box(0.55, -0.24, 0.1, 0.92, 0.24, 0.5, mat(C['white'], 0.4), 0.04)
    b.box(0.9, -0.21, 0.3, 0.925, 0.21, 0.46, mat('#1e293b', 0.1))
    # scissor lift
    for side in (-0.16, 0.16):
        b.rbox(-0.25, side, 0.42, 1.0, 0.03, 0.03, 32, mat('#64748b', 0.4))
        b.rbox(-0.25, side, 0.42, 1.0, 0.03, 0.03, -32, mat('#64748b', 0.4))
    # raised box body with platform at the front
    b.box(-0.95, -0.25, 0.68, 0.45, 0.25, 1.12, mat('#e2e7ee', 0.4), 0.03)
    b.box(-0.95, -0.255, 0.86, 0.45, 0.255, 0.93, mat('#2f7de1', 0.4))
    b.box(0.45, -0.22, 0.68, 0.62, 0.22, 0.7, mat('#9aa5b5', 0.3))
    b.box(0.6, -0.22, 0.7, 0.62, 0.22, 0.82, mat(GSE_YELLOW, 0.4))
    for x in (-0.7, 0.75):
        for yy in (-0.22, 0.22):
            b.wheel(x, yy, 0.1, 0.1, 0.08, mat('#1f2328', 0.8))


def gse_cone(b):
    b.box(-0.05, -0.05, 0, 0.05, 0.05, 0.01, mat('#ea580c', 0.5))
    b.cone(0, 0, 0.01, 0.14, 0.04, 0.008, mat('#f97316', 0.5), 12)
    b.cyl(0, 0, 0.06, 0.085, 0.029, mat('#f8fafc', 0.4), 12)


GSE = {'tug': gse_tug, 'bags': gse_bags, 'belt': gse_belt, 'fuel': gse_fuel, 'catering': gse_catering}



# ---------------------------------------------------------------- landside traffic


def road_car(b, body='#f1f5f9', taxi=False):
    """Hatchback facing +gx, centred. Built in near-white so the game can tint it any colour."""
    paint = mat(body, 0.35)
    b.box(-0.46, -0.18, 0.05, 0.46, 0.18, 0.17, paint, 0.03)
    b.box(-0.3, -0.16, 0.17, 0.2, 0.16, 0.28, mat('#1e293b', 0.1), 0.03)  # glasshouse
    b.box(-0.28, -0.165, 0.27, 0.16, 0.165, 0.295, paint, 0.02)  # roof
    b.box(0.455, -0.15, 0.11, 0.47, -0.08, 0.14, mat('#fff7d6', 0.2, 4.0))  # headlights
    b.box(0.455, 0.08, 0.11, 0.47, 0.15, 0.14, mat('#fff7d6', 0.2, 4.0))
    b.box(-0.47, -0.15, 0.11, -0.455, -0.09, 0.14, mat('#ef4444', 0.3, 3.0))  # tail lights
    b.box(-0.47, 0.09, 0.11, -0.455, 0.15, 0.14, mat('#ef4444', 0.3, 3.0))
    for x in (-0.28, 0.28):
        for y in (-0.17, 0.17):
            b.wheel(x, y, 0.06, 0.06, 0.05, mat('#1f2328', 0.8))
    if taxi:
        b.box(-0.08, -0.06, 0.295, 0.04, 0.06, 0.34, mat('#fef9c3', 0.3, 1.5))


def road_bus(b):
    white = mat('#f1f5f9', 0.35)
    b.box(-1.2, -0.25, 0.06, 1.2, 0.25, 0.62, white, 0.04)
    b.box(-1.15, -0.255, 0.33, 1.1, 0.255, 0.5, mat('#1e293b', 0.1))  # window band
    b.box(1.19, -0.22, 0.2, 1.205, 0.22, 0.55, mat('#1e293b', 0.1))  # windscreen
    b.box(-1.205, -0.255, 0.12, 1.205, 0.255, 0.2, mat(C['accent'], 0.4))
    b.box(-1.15, -0.2, 0.62, 0.9, 0.2, 0.66, mat('#cbd5e1', 0.4))  # roof pods
    b.box(1.2, -0.2, 0.1, 1.215, -0.12, 0.15, mat('#fff7d6', 0.2, 4.0))
    b.box(1.2, 0.12, 0.1, 1.215, 0.2, 0.15, mat('#fff7d6', 0.2, 4.0))
    b.box(-1.215, -0.2, 0.1, -1.2, -0.12, 0.16, mat('#ef4444', 0.3, 3.0))
    b.box(-1.215, 0.12, 0.1, -1.2, 0.2, 0.16, mat('#ef4444', 0.3, 3.0))
    for x in (-0.75, 0.8):
        for y in (-0.24, 0.24):
            b.wheel(x, y, 0.09, 0.09, 0.07, mat('#1f2328', 0.8))


ROAD = {'car': road_car, 'taxi': lambda b: road_car(b, '#facc15', taxi=True), 'bus': road_bus}


# ---------------------------------------------------------------- passengers

SHIRTS = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#14b8a6']
CARRY = ['case', None, 'pack', 'case', 'pack', None]  # what each passenger variety travels with
HAIR = ['#3a2a20', '#d6a756', '#1f1a17', '#7c3f1d', '#3a2a20', '#9ca3af']


def build_person(shirt, facing, frame, vest=False, pants='#334155', carry=None, hair=None):
    """A small person facing +gx before rotation: legs and arms swing with the walk frame."""
    b = Builder(1, 1, 0)
    skin = mat(C['skin2'] if shirt in ('#22c55e', '#a855f7') else C['skin'])
    trousers = mat(pants, 0.7)
    shoe = mat('#1f2328', 0.6)
    top = mat(shirt, 0.6)
    step = 0.035 if frame else -0.035
    for sgn, dy in ((1, -0.03), (-1, 0.03)):
        x = sgn * step
        b.box(x - 0.022, dy - 0.02, 0.02, x + 0.022, dy + 0.02, 0.165, trousers)
        b.box(x - 0.022, dy - 0.022, 0, x + 0.04, dy + 0.022, 0.025, shoe)
    b.box(-0.042, -0.062, 0.16, 0.042, 0.062, 0.305, top, 0.015)
    for sgn, dy in ((-1, -0.075), (1, 0.075)):  # arms swing opposite to the legs
        x = sgn * step * 0.8
        b.box(x - 0.016, dy - 0.014, 0.17, x + 0.016, dy + 0.014, 0.295, top, 0.008)
        b.sphere(x, dy, 0.165, 0.016, skin, seg=8)
    b.box(-0.014, -0.016, 0.3, 0.014, 0.016, 0.32, skin)
    b.sphere(0, 0, 0.35, 0.043, skin, seg=12, soft=True)
    hc = mat(hair or C['hair'], 0.8)
    b.sphere(-0.008, 0, 0.365, 0.043, hc, seg=12, soft=True, squash=0.75)
    if vest:
        b.box(-0.044, -0.064, 0.2, 0.044, 0.064, 0.3, mat('#d4f33a', 0.5, 0.3))
        b.box(-0.045, -0.065, 0.23, 0.045, 0.065, 0.245, mat('#e2e8f0', 0.2, 0.6))
        b.box(-0.05, -0.048, 0.375, 0.03, 0.048, 0.4, mat('#f8fafc', 0.4))  # ear defenders band
    if carry == 'case':  # trolley case pulled behind, handle up to the hand
        col = mat(['#0ea5e9', '#be123c', '#1f2937'][(SHIRTS.index(shirt) if shirt in SHIRTS else 0) % 3], 0.45)
        b.box(-0.2, 0.04, 0.012, -0.11, 0.1, 0.17, col, 0.012)
        b.rbox(-0.12, 0.075, 0.2, 0.012, 0.012, 0.1, 0, mat('#1f2328', 0.4))
        b.rbox(-0.06, 0.075, 0.2, 0.12, 0.01, 0.01, -35, mat('#1f2328', 0.4))
        for x in (-0.19, -0.12):
            b.wheel(x, 0.07, 0.012, 0.012, 0.05, shoe, axis='y', verts=8)
    elif carry == 'pack':
        b.box(-0.08, -0.045, 0.18, -0.042, 0.045, 0.29, mat('#334155', 0.7), 0.01)
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
    bpy.context.scene.render.film_transparent = False  # grey backdrop so white parts stay visible
    for code in AIRCRAFT:
        clear_objects()
        zoom = ONLY[0] == 'zoom'
        if zoom and len(ONLY) > 1 and code not in ONLY[1:]:
            continue
        render(f'{code}_{ONLY[0]}', build_aircraft(code, 1 if zoom else 0), ppu=PPU * (2.5 if zoom else 0.75), shadow=False)


def main():
    if ONLY and ONLY[0] in ('side', 'top', 'zoom'):  # debug views into art/debug
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
            render(key, objs, ppu=PPU * 0.75, shadow=False)
            render(key + '_mask', objs, ppu=PPU * 0.75, mask=True, shadow=False)
            # both renders share the framing, so copy the anchor
            manifest[key + '_mask'] = dict(manifest[key])
            # ground shadow on its own, so it can stay on the ground while the aircraft climbs
            for o in objs:
                o.visible_camera = False
            render(key + '_shadow', objs, ppu=PPU * 0.35)  # soft anyway, so half resolution saves memory
    for name, fn in GSE.items():
        for f in range(4):
            key = f'gse_{name}_{f}'
            if not want(key):
                continue
            clear_objects()
            b = Builder(1, 1, 0)
            fn(b)
            render(key, b.turn(f))
    for f in range(4):
        if want(f'jbcab_{f}'):
            clear_objects()
            b = Builder(1, 1, 0)
            jb_cab(b)
            render(f'jbcab_{f}', b.turn(f))
    if want('jbrot'):
        clear_objects()
        b = Builder(1, 1, 0)
        jb_rotunda(b)
        render('jbrot', b.objs)
    for name, fn in ROAD.items():
        for f in range(4):
            key = f'{name}_{f}'
            if want(key):
                clear_objects()
                b = Builder(1, 1, 0)
                fn(b)
                render(key, b.turn(f))
    if want('gse_cone'):
        clear_objects()
        b = Builder(1, 1, 0)
        gse_cone(b)
        render('gse_cone', b.objs, ppu=PPU * 1.5)
    for f in range(4):
        for fr in range(2):
            key = f'crew_{f}_{fr}'
            if want(key):
                clear_objects()
                render(key, build_person('#f97316', f, fr, vest=True), ppu=PPU * 1.5)
    for i, shirt in enumerate(SHIRTS):
        for f in range(4):
            for fr in range(2):
                key = f'pax_{i}_{f}_{fr}'
                if not want(key):
                    continue
                clear_objects()
                render(key, build_person(shirt, f, fr, carry=CARRY[i], hair=HAIR[i]), ppu=PPU * 1.5)
    json.dump(manifest, open(MANIFEST, 'w'), indent=1, sort_keys=True)
    print('wrote', len(manifest), 'sprites')


main()
