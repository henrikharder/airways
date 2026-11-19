// Isometric renderer (PixiJS). Ground is painted with vector graphics; every
// building, aircraft and passenger is a Blender-rendered sprite, depth sorted.

import { Application, Assets, Container, Graphics, Matrix, Sprite, Text, Texture } from 'pixi.js';
import manifest from '../generated/sprites.json';
import { MODULES, spriteType } from '../game/catalog';
import { airlineColor, runways } from '../game/flights';
import { footprint, getLayout, idx, layoutStamp, localPoint, standPoints } from '../game/grid';
import type { Building, GameState, ModuleKind } from '../game/types';
import { T } from '../game/types';
import { depth, dirToView, footprintView, isoX, isoY, screenToGrid, toView, towardsCamera, TH, TW, vface, view, vX, vY, ZPX } from './iso';
import { CARPARK_ROWS, GroundLife } from './life';
import { terminals } from '../game/terminals';
import { trainNetwork } from '../game/train';
import { Lights } from './lights';

const SKYWALK_Z = 0.75; // deck height in tiles
const GUIDE_Z = 1.25; // people mover guideway height in tiles

/** The edge of a unit view tile facing view direction (dx, dy), as [a0, b0, a1, b1]. */
function edgeInView(dx: number, dy: number): [number, number, number, number] {
  return dx === 1 ? [1, 0, 1, 1] : dx === -1 ? [0, 0, 0, 1] : dy === 1 ? [0, 1, 1, 1] : [0, 0, 1, 0];
}

const SRC_TILE = 128; // tile width in rendered sprites (manifest scale 1); matches TILE_PX in art/build.py

type Frame = { w: number; h: number; ax: number; ay: number; scale: number };
const FRAMES = manifest as Record<string, Frame>;

const COLORS = {
  grass: [0x7cc96a, 0x76c464, 0x82cf70],
  apron: 0xc7cbd3,
  taxiway: 0x8e949f,
  runway: 0x51565f,
  floor: 0xefe9de,
  floorAlt: 0xe8e1d4,
  road: 0x5b616b,
  parking: 0x6a707a,
};






export interface Badge { key: string; x: number; y: number; text: string; color: number }

export interface Ghost {
  kind?: ModuleKind;
  x: number;
  y: number;
  rot: number;
  ok: boolean;
  rect?: [number, number, number, number]; // paint/bulldoze rectangle
}

export class Scene {
  app = new Application();
  world = new Container();
  private ground = new Graphics();
  private groundText = new Container(); // stand numbers painted on the apron
  private heat = new Graphics();
  private density: Float32Array | null = null;
  private heatAt = 0;
  heatmap = false;
  private overlay = new Graphics();
  private lights = new Lights();
  private top = new Container();
  private labels = new Container();
  private labelPool = new Map<string, Container>();
  private labelAt = new Map<string, [number, number]>();
  private objects = new Container();
  private textures = new Map<string, Texture>();
  private buildingSprites = new Map<number, Container>();
  private aircraftSprites = new Map<number, Container>();
  private skywalkGfx = new Map<number, Graphics>();
  private skywalkKey = '';
  private guideKey = '';
  private guideGfx: Graphics[] = [];
  private trains: { sp: Sprite; path: [number, number][]; i: number; dir: 1 | -1; x: number; y: number; wait: number }[] = [];
  private life!: GroundLife;
  private paxSprites = new Map<number, Sprite>();
  private ghostSprite: Sprite | null = null;
  private groundStamp = -1;
  zoom = 1.6;
  private walkClock = 0;

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({ resizeTo: host, background: 0x2e5a34, antialias: true, autoDensity: true, resolution: window.devicePixelRatio || 1 });
    host.appendChild(this.app.canvas);
    this.objects.sortableChildren = true;
    this.world.addChild(this.ground, this.groundText, this.heat, this.objects);
    // night shade over the world, then lights and UI overlays that follow the world's transform
    this.top.addChild(this.lights.layer, this.overlay, this.labels);
    this.app.stage.addChild(this.world, this.lights.shade, this.top);
    const base = import.meta.env.BASE_URL;
    // aircraft are most of the texture memory, so each type loads the first time it appears
    const names = Object.keys(FRAMES).filter((n) => !n.startsWith('ac_'));
    const loaded = await Assets.load(names.map((n) => ({ alias: n, src: `${base}sprites/${n}.webp` })));
    for (const n of names) this.textures.set(n, loaded[n] as Texture);
    this.life = new GroundLife({ make: (n) => this.makeSprite(n), frames: FRAMES, textures: this.textures, scale: (n) => this.frameScale(n), layer: this.objects });
  }

  private aircraftLoading = new Set<string>();

  /** True once the sprites for an aircraft type are ready; starts loading them otherwise. */
  private aircraftReady(type: string): boolean {
    if (this.textures.has(`ac_${type}_0`)) return true;
    if (!this.aircraftLoading.has(type)) {
      this.aircraftLoading.add(type);
      const base = import.meta.env.BASE_URL;
      const names = Object.keys(FRAMES).filter((n) => n.startsWith(`ac_${type}_`));
      Assets.load(names.map((n) => ({ alias: n, src: `${base}sprites/${n}.webp` }))).then((loaded) => {
        for (const n of names) this.textures.set(n, loaded[n] as Texture);
      }).catch(() => this.aircraftLoading.delete(type)); // try again next frame
    }
    return false;
  }

  frameScale(name: string): number {
    return (TW / SRC_TILE) * (FRAMES[name]?.scale ?? 1);
  }

  private makeSprite(name: string): Sprite {
    const tex = this.textures.get(name) ?? Texture.WHITE;
    const sp = new Sprite(tex);
    const fr = FRAMES[name];
    if (fr) sp.anchor.set(fr.ax / fr.w, fr.ay / fr.h);
    sp.scale.set(this.frameScale(name));
    return sp;
  }

  centerOn(gx: number, gy: number): void {
    const w = this.app.screen.width, h = this.app.screen.height;
    this.world.scale.set(this.zoom);
    this.world.position.set(w / 2 - isoX(gx, gy) * this.zoom, h / 2 - isoY(gx, gy) * this.zoom);
  }

  /** Zoom so the whole site fits between the side panels. */
  fitSite(W: number, H: number, padLeft = 200, padRight = 400): void {
    const w = this.app.screen.width - padLeft - padRight;
    const h = this.app.screen.height - 40;
    const siteW = ((W + H) * TW) / 2;
    const siteH = ((W + H) * TH) / 2;
    this.zoom = Math.max(0.3, Math.min(2, Math.min(w / siteW, h / siteH)));
    this.world.scale.set(this.zoom);
    const cx = isoX(W / 2, H / 2), cy = isoY(W / 2, H / 2);
    this.world.position.set(padLeft + w / 2 - cx * this.zoom, 20 + h / 2 - cy * this.zoom);
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    const z = Math.max(0.3, Math.min(5, this.zoom * factor));
    const wx = (sx - this.world.x) / this.zoom;
    const wy = (sy - this.world.y) / this.zoom;
    this.zoom = z;
    this.world.scale.set(z);
    this.world.position.set(sx - wx * z, sy - wy * z);
  }

  panBy(dx: number, dy: number): void {
    this.world.position.set(this.world.x + dx, this.world.y + dy);
  }

  toGrid(sx: number, sy: number): [number, number] {
    return screenToGrid((sx - this.world.x) / this.zoom, (sy - this.world.y) / this.zoom);
  }

  // ---------------------------------------------------------------- ground

  private diamond(g: Graphics, x: number, y: number, color: number, alpha = 1): void {
    const cx = isoX(x, y), cy = isoY(x, y);
    g.poly([cx, cy, cx + TW / 2, cy + TH / 2, cx, cy + TH, cx - TW / 2, cy + TH / 2]).fill({ color, alpha });
  }

  private line(g: Graphics, x0: number, y0: number, x1: number, y1: number, color: number, width: number, alpha = 1): void {
    g.moveTo(isoX(x0, y0), isoY(x0, y0)).lineTo(isoX(x1, y1), isoY(x1, y1)).stroke({ color, width, alpha });
  }

  private dashed(g: Graphics, x0: number, y0: number, x1: number, y1: number, color: number, width: number, dash: number): void {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.floor(len / (dash * 2)));
    for (let i = 0; i < n; i++) {
      const a = (i * 2 * dash) / len, b = Math.min(1, ((i * 2 + 1) * dash) / len);
      this.line(g, x0 + (x1 - x0) * a, y0 + (y1 - y0) * a, x0 + (x1 - x0) * b, y0 + (y1 - y0) * b, color, width);
    }
  }

  /** Text painted flat on the ground plane, reading along +x; size in tiles. */
  private paintText(text: string, x: number, y: number, size: number, color: number): void {
    const t = new Text({ text, style: { fontFamily: 'Source Sans 3 Variable, sans-serif', fontSize: 64, fontWeight: '700', fill: color } });
    const u = size / 64;
    t.setFromMatrix(new Matrix((TW / 2) * u, (TH / 2) * u, (-TW / 2) * u, (TH / 2) * u, isoX(x, y), isoY(x, y)));
    t.alpha = 0.9;
    this.groundText.addChild(t);
  }

  private drawGround(s: GameState): void {
    const g = this.ground;
    g.clear();
    const t = (x: number, y: number) => (x < 0 || y < 0 || x >= s.W || y >= s.H ? -1 : s.tiles[idx(s, x, y)]);
    const indoor = (v: number) => v === T.Floor || v === T.Barrier;
    for (let y = 0; y < s.H; y++) {
      for (let x = 0; x < s.W; x++) {
        const v = s.tiles[idx(s, x, y)];
        let c: number;
        switch (v) {
          case T.Apron: c = COLORS.apron; break;
          case T.Taxiway: c = COLORS.taxiway; break;
          case T.Runway: c = COLORS.runway; break;
          case T.Floor:
          case T.Barrier: c = (x + y) % 2 ? COLORS.floor : COLORS.floorAlt; break;
          case T.Road: c = COLORS.road; break;
          case T.Parking: c = COLORS.parking; break;
          default: c = COLORS.grass[(x * 7 + y * 13) % 3];
        }
        this.diamond(g, x, y, c);
      }
    }
    // forest beyond the site boundary
    for (let k = -6; k < Math.max(s.W, s.H) + 6; k++) {
      for (let d = 1; d <= 6; d++) {
        for (const [x, y] of [[k, -d], [k, s.H - 1 + d], [-d, k], [s.W - 1 + d, k]]) this.diamond(g, x, y, d % 2 ? 0x3c7a3f : 0x377238);
      }
    }
    // taxiway centre lines
    for (let y = 0; y < s.H; y++) for (let x = 0; x < s.W; x++) {
      if (t(x, y) !== T.Taxiway) continue;
      if (t(x + 1, y) === T.Taxiway) this.line(g, x + 0.5, y + 0.5, x + 1.5, y + 0.5, 0xf5c518, 1.1);
      if (t(x, y + 1) === T.Taxiway) this.line(g, x + 0.5, y + 0.5, x + 0.5, y + 1.5, 0xf5c518, 1.1);
    }
    // road dashes
    for (let x = 0; x < s.W; x += 2) if (t(x, s.H - 2) === T.Road) this.line(g, x + 0.2, s.H - 2, x + 1.0, s.H - 2, 0xf3f4f6, 0.8, 0.8);
    // runway markings
    for (const rw of runways(s)) {
      const along = rw.rot % 2 === 0;
      const len = along ? rw.w : rw.h;
      const cx = along ? rw.y + rw.h / 2 : rw.x + rw.w / 2;
      const P = (a: number, c: number): [number, number] => (along ? [rw.x + a, c] : [c, rw.y + a]);
      for (let a = 6; a < len - 6; a += 3) this.line(g, ...P(a, cx), ...P(a + 1.6, cx), 0xffffff, 1.2);
      for (const a0 of [1, len - 3]) for (let k = -1.6; k <= 1.6; k += 0.55) this.line(g, ...P(a0, cx + k), ...P(a0 + 2, cx + k), 0xffffff, 1.4);
      for (const side of [-2.3, 2.3]) this.line(g, ...P(0.5, cx + side), ...P(len - 0.5, cx + side), 0xffffff, 0.8, 0.85);
    }
    // stand markings: lead-in line and stop bar
    for (const b of s.buildings) {
      if (!b.kind.startsWith('stand_')) continue;
      const m = MODULES[b.kind];
      const a = localPoint(b, m.w / 2, 0);
      const c = localPoint(b, m.w / 2, m.h * 0.82);
      this.line(g, a[0], a[1], c[0], c[1], 0xf5c518, 1.4);
      const l = localPoint(b, m.w / 2 - 1, m.h * 0.82);
      const r = localPoint(b, m.w / 2 + 1, m.h * 0.82);
      this.line(g, l[0], l[1], r[0], r[1], 0xf5c518, 1.8);
      const corners = [localPoint(b, 0, 0), localPoint(b, m.w, 0), localPoint(b, m.w, m.h), localPoint(b, 0, m.h)];
      for (let i = 0; i < 4; i++) this.line(g, ...corners[i], ...corners[(i + 1) % 4], 0xffffff, 0.7, 0.6);
      // red equipment restraint line: ground vehicles stay outside it while the aircraft moves
      const k = 0.45;
      const er = [localPoint(b, k, 0.2), localPoint(b, k, m.h - k), localPoint(b, m.w - k, m.h - k), localPoint(b, m.w - k, 0.2)];
      for (let i = 0; i < 3; i++) this.dashed(g, ...er[i], ...er[i + 1], 0xd0261b, 1.1, 0.45);
    }
    // terminal names painted at each terminal's north-west corner
    const terms = terminals(s).list;
    if (terms.length) for (const t of terms) this.paintText(`T${t.n + 1}`, t.x0 + 0.6, t.y0 + 0.6, 1.6, 0x8a8a84);
    // stand numbers painted on the apron, in order along the terminal
    for (const c of this.groundText.removeChildren()) c.destroy();
    const stands = s.buildings.filter((b) => b.kind.startsWith('stand_')).sort((a, b) => a.x - b.x || a.y - b.y);
    stands.forEach((b, i) => {
      const m = MODULES[b.kind];
      const [x, y] = localPoint(b, m.w / 2 + 1.3, 1.2);
      this.paintText(`A${i + 1}`, x, y, 1.1, 0xffcc00);
    });
    // runway holding position markings where taxiways meet the runway, and taxiway edge lines
    for (let y = 0; y < s.H; y++) for (let x = 0; x < s.W; x++) {
      if (t(x, y) !== T.Taxiway) continue;
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const n = t(x + dx, y + dy);
        if (n === T.Runway) {
          // two solid lines on the runway side, two dashed ones on the taxiway side
          for (const [off, solid] of [[0.15, true], [0.27, true], [0.45, false], [0.57, false]] as [number, boolean][]) {
            const ax = dx ? (dx < 0 ? x + off : x + 1 - off) : x, ay = dy ? (dy < 0 ? y + off : y + 1 - off) : y;
            const bx = dx ? ax : x + 1, by = dy ? ay : y + 1;
            if (solid) this.line(g, ax, ay, bx, by, 0xf5c518, 1.2);
            else this.dashed(g, ax, ay, bx, by, 0xf5c518, 1.2, 0.25);
          }
        } else if (n !== T.Taxiway && n !== T.Apron && n !== T.Runway && n !== -1) {
          const i = 0.08;
          if (dy === -1) this.line(g, x, y + i, x + 1, y + i, 0xf5c518, 0.7, 0.8);
          if (dy === 1) this.line(g, x, y + 1 - i, x + 1, y + 1 - i, 0xf5c518, 0.7, 0.8);
          if (dx === -1) this.line(g, x + i, y, x + i, y + 1, 0xf5c518, 0.7, 0.8);
          if (dx === 1) this.line(g, x + 1 - i, y, x + 1 - i, y + 1, 0xf5c518, 0.7, 0.8);
        }
      }
    }
    // parking bays
    for (const b of s.buildings) {
      if (b.kind !== 'carpark') continue;
      for (const [y0, y1] of CARPARK_ROWS) {
        for (let k = 0; k <= 11; k++) this.line(g, b.x + 0.25 + k * 0.5, b.y + y0, b.x + 0.25 + k * 0.5, b.y + y1, 0xffffff, 0.6, 0.75);
        this.line(g, b.x + 0.25, b.y + y0, b.x + 5.75, b.y + y0, 0xffffff, 0.5, 0.5);
      }
    }
    // terminal walls: low glass edges where floor meets the outside
    for (let y = 0; y < s.H; y++) for (let x = 0; x < s.W; x++) {
      if (!indoor(t(x, y))) continue;
      const h = ZPX * 0.32;
      const wall = (x0: number, y0: number, x1: number, y1: number, shade: number) => {
        const ax = isoX(x0, y0), ay = isoY(x0, y0), bx = isoX(x1, y1), by = isoY(x1, y1);
        g.poly([ax, ay, bx, by, bx, by - h, ax, ay - h]).fill({ color: shade, alpha: 0.55 });
        g.moveTo(ax, ay - h).lineTo(bx, by - h).stroke({ color: 0xffffff, width: 0.8, alpha: 0.9 });
      };
      // only the edges on the far side of the tile (as seen in this view) get a wall face
      const edges: [number, number, number, number, number, number][] = [[0, -1, x, y, x + 1, y], [-1, 0, x, y, x, y + 1], [0, 1, x, y + 1, x + 1, y + 1], [1, 0, x + 1, y, x + 1, y + 1]];
      for (const [dx, dy, x0, y0, x1, y1] of edges) {
        if (indoor(t(x + dx, y + dy))) continue;
        const [vx, vy] = dirToView(dx, dy);
        if (vx + vy > 0) continue; // a near edge: it would hide the floor
        wall(x0, y0, x1, y1, vx < 0 ? 0x86c3ec : 0x9fd3f5);
      }
    }
    // structural columns on a 6-tile grid inside the terminal
    const occ = getLayout(s).occ;
    for (let y = 0; y < s.H; y++) for (let x = 0; x < s.W; x++) {
      if (x % 6 || y % 6 || t(x, y) !== T.Floor || occ[idx(s, x, y)]) continue;
      if (!indoor(t(x - 1, y)) || !indoor(t(x, y - 1)) || !indoor(t(x - 1, y - 1))) continue; // not on the facade
      const c = 0.14, h = ZPX * 0.9;
      const [vx, vy] = toView(x, y);
      const p = (a: number, b: number) => [vX(vx + a, vy + b), vY(vx + a, vy + b)];
      const [lx, ly] = p(-c, c), [fx, fy] = p(c, c), [rx, ry] = p(c, -c), [tx, ty] = p(-c, -c);
      g.poly([lx, ly, fx, fy, fx, fy - h, lx, ly - h]).fill({ color: 0xc9c3b8 });
      g.poly([fx, fy, rx, ry, rx, ry - h, fx, fy - h]).fill({ color: 0xa9a399 });
      g.poly([tx, ty - h, rx, ry - h, fx, fy - h, lx, ly - h]).fill({ color: 0xe6e1d8 });
    }
    // security barriers: taller frosted glass through the tile centres
    const exitAt = (x: number, y: number) => {
      const o = getLayout(s).occ[idx(s, x, y)];
      return !!o && getLayout(s).byId.get(o)?.kind === 'exit';
    };
    const joins = (x: number, y: number) => t(x, y) === T.Barrier || (x >= 0 && y >= 0 && x < s.W && y < s.H && exitAt(x, y));
    const panel = (x0: number, y0: number, x1: number, y1: number) => {
      const h = ZPX * 0.55;
      const ax = isoX(x0, y0), ay = isoY(x0, y0), bx = isoX(x1, y1), by = isoY(x1, y1);
      g.moveTo(ax, ay).lineTo(bx, by).stroke({ color: 0x475569, width: 1.6 });
      g.poly([ax, ay, bx, by, bx, by - h, ax, ay - h]).fill({ color: 0x7fb2d6, alpha: 0.55 });
      g.moveTo(ax, ay - h).lineTo(bx, by - h).stroke({ color: 0xe11d48, width: 1.2 });
    };
    for (let y = 0; y < s.H; y++) for (let x = 0; x < s.W; x++) {
      if (t(x, y) !== T.Barrier) continue;
      const cx = x + 0.5, cy = y + 0.5;
      const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => joins(x + dx, y + dy));
      // draw back-to-front so the near panel overlaps the far one
      for (const [dx, dy] of n.sort((a, b) => towardsCamera(a[0], a[1]) - towardsCamera(b[0], b[1]))) panel(cx, cy, cx + dx * 0.5, cy + dy * 0.5);
      if (!n.length) panel(cx - 0.3, cy, cx + 0.3, cy);
    }
  }

  // ---------------------------------------------------------------- objects

  private spriteFor(b: Building): Container | null {
    const m = MODULES[b.kind];
    const c = new Container();
    if (m.sprite) {
      const name = `${m.sprite}_${m.rotatable ? vface(b.rot) : 0}`;
      const sp = this.makeSprite(name);
      const o = footprintView(b.x, b.y, b.w, b.h);
      sp.position.set(isoX(o.ox, o.oy), isoY(o.ox, o.oy));
      c.addChild(sp);
    }
    const z = footprintView(b.x, b.y, b.w, b.h).far;
    if (!c.children.length) return null;
    c.zIndex = z;
    return c;
  }

  private syncBuildings(s: GameState): void {
    const live = new Set<number>();
    for (const b of s.buildings) {
      const key = b.id;
      live.add(key);
      const tag = `${b.kind}:${b.x}:${b.y}:${b.rot}:${b.link ?? 0}:${view.k}`;
      const cur = this.buildingSprites.get(key);
      if (cur && cur.label === tag) continue;
      if (cur) { cur.destroy({ children: true }); this.buildingSprites.delete(key); }
      const c = this.spriteFor(b);
      if (!c) continue;
      c.label = tag;
      this.objects.addChild(c);
      this.buildingSprites.set(key, c);
    }
    for (const [id, c] of this.buildingSprites) if (!live.has(id)) { c.destroy({ children: true }); this.buildingSprites.delete(id); }
  }

  private syncAircraft(s: GameState): void {
    const live = new Set<number>();
    for (const f of s.flights) {
      if (f.phase === 'scheduled' || f.phase === 'departed' || f.phase === 'cancelled') continue;
      const type = spriteType(f.typeId);
      if (!this.aircraftReady(type)) continue;
      live.add(f.id);
      let c = this.aircraftSprites.get(f.id);
      const key = `ac_${type}_${vface(f.facing)}`;
      if (!c || c.label !== key) {
        c?.destroy({ children: true });
        c = new Container();
        c.label = key;
        let shadow: Container;
        if (FRAMES[`${key}_shadow`]) shadow = this.makeSprite(`${key}_shadow`);
        else {
          const fr = FRAMES[key];
          const r = fr ? (fr.w * this.frameScale(key)) / 4.2 : 20;
          shadow = new Graphics().ellipse(0, 0, r, r / 2).fill({ color: 0x1b2a1b, alpha: 0.16 });
        }
        shadow.label = 'shadow';
        const base = this.makeSprite(key);
        const mask = this.makeSprite(`${key}_mask`);
        mask.tint = parseInt(airlineColor(f.airline).slice(1), 16);
        base.label = 'body';
        mask.label = 'livery';
        c.addChild(shadow, base, mask);
        this.objects.addChild(c);
        this.aircraftSprites.set(f.id, c);
      }
      const px = isoX(f.x, f.y), py = isoY(f.x, f.y);
      c.position.set(px, py);
      const lift = f.alt * ZPX;
      for (const ch of c.children) {
        if (ch.label === 'shadow') { ch.position.set(0, 0); ch.alpha = Math.max(0, 1 - f.alt / 5); }
        else ch.position.set(0, -lift);
      }
      c.alpha = f.phase === 'approach' ? Math.min(1, 1.4 - f.alt / 9) : f.phase === 'takeoff' ? Math.max(0, 1 - f.alt / 10) : 1;
      c.zIndex = depth(f.x, f.y) + (f.alt > 0.5 ? 400 : 1.5);
    }
    for (const [id, c] of this.aircraftSprites) if (!live.has(id)) { c.destroy({ children: true }); this.aircraftSprites.delete(id); }
  }

  private syncPax(s: GameState, dtReal: number): void {
    const walkTiles = s.skywalks?.length ? getLayout(s).walk : null;
    this.walkClock += dtReal;
    const step = Math.floor(this.walkClock * 6) % 2;
    const live = new Set<number>();
    for (const p of s.pax) {
      live.add(p.id);
      const moving = p.state.startsWith('to') || p.state === 'boarding' || p.state === 'queue';
      const key = `pax_${p.color}_${vface(p.facing)}_${moving ? (step + (p.id % 2)) % 2 : 0}`;
      let sp = this.paxSprites.get(p.id);
      if (!sp) {
        sp = this.makeSprite(key);
        this.objects.addChild(sp);
        this.paxSprites.set(p.id, sp);
      }
      const tex = this.textures.get(key);
      if (tex && sp.texture !== tex) sp.texture = tex;
      sp.visible = !p.ride; // riding the people mover
      // on a skywalk, passengers walk on the raised deck
      const up = walkTiles?.[Math.floor(p.y) * s.W + Math.floor(p.x)] ? SKYWALK_Z * ZPX : 0;
      sp.position.set(isoX(p.x, p.y), isoY(p.x, p.y) - up);
      sp.zIndex = depth(p.x, p.y) + (up ? 1.05 : 0.6);
      sp.tint = p.state === 'lost' ? 0xff8080 : 0xffffff;
    }
    for (const [id, sp] of this.paxSprites) if (!live.has(id)) { sp.destroy(); this.paxSprites.delete(id); }
  }

  // ---------------------------------------------------------------- overlay

  private drawOverlay(s: GameState, ghost: Ghost | null, hover: [number, number] | null, selected: Building | null): void {
    const g = this.overlay;
    g.clear();
    if (this.ghostSprite) { this.ghostSprite.destroy(); this.ghostSprite = null; }
    if (selected) {
      for (let y = selected.y; y < selected.y + selected.h; y++) for (let x = selected.x; x < selected.x + selected.w; x++) this.diamond(g, x, y, 0xf2b544, 0.28);
      if (selected.link) {
        const other = getLayout(s).byId.get(selected.link);
        if (other) for (let y = other.y; y < other.y + other.h; y++) for (let x = other.x; x < other.x + other.w; x++) this.diamond(g, x, y, 0x5cc8ff, 0.18);
      }
    }
    if (ghost?.rect) {
      const [x0, y0, x1, y1] = ghost.rect;
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
        if (x >= 0 && y >= 0 && x < s.W && y < s.H) this.diamond(g, x, y, ghost.ok ? 0x5cc8ff : 0xf2637a, 0.35);
      }
    } else if (ghost?.kind) {
      const { w, h } = footprint(ghost.kind, ghost.rot);
      for (let y = ghost.y; y < ghost.y + h; y++) for (let x = ghost.x; x < ghost.x + w; x++) this.diamond(g, x, y, ghost.ok ? 0x4ade9b : 0xf2637a, 0.38);
      const m = MODULES[ghost.kind];
      if (m.sprite) {
        const sp = this.makeSprite(`${m.sprite}_${m.rotatable ? vface(ghost.rot) : 0}`);
        const o = footprintView(ghost.x, ghost.y, w, h);
        sp.position.set(isoX(o.ox, o.oy), isoY(o.ox, o.oy));
        sp.alpha = 0.7;
        if (!ghost.ok) sp.tint = 0xff9090;
        this.overlay.addChild(sp);
        this.ghostSprite = sp;
      }
      if (ghost.kind.startsWith('stand_')) {
        const fake = { id: 0, kind: ghost.kind, x: ghost.x, y: ghost.y, w, h, rot: ghost.rot as Building['rot'] };
        const { entry } = standPoints(fake);
        this.diamond(g, entry[0], entry[1], 0xf5c518, 0.6);
      }
    } else if (hover) {
      this.diamond(g, Math.floor(hover[0]), Math.floor(hover[1]), 0xffffff, 0.25);
    }
  }

  // ---------------------------------------------------------------- frame

  /** Floating badges (e.g. queue length and wait) that stay the same size on screen. */
  setBadges(badges: Badge[]): void {
    const live = new Set<string>();
    for (const b of badges) {
      live.add(b.key);
      let c = this.labelPool.get(b.key);
      if (!c) {
        c = new Container();
        const bg = new Graphics();
        const t = new Text({ text: '', style: { fontFamily: 'Source Sans 3 Variable, sans-serif', fontSize: 12, fontWeight: '700', fill: 0xffffff } });
        t.anchor.set(0.5, 0.5);
        c.addChild(bg, t);
        this.labels.addChild(c);
        this.labelPool.set(b.key, c);
      }
      const bg = c.children[0] as Graphics;
      const t = c.children[1] as Text;
      if (t.text !== b.text || c.label !== String(b.color)) {
        t.text = b.text;
        c.label = String(b.color);
        const w = t.width + 14, h = 20;
        // square sign plate; black lettering on light plates, white on dark ones
        const lum = (((b.color >> 16) & 255) * 0.3 + ((b.color >> 8) & 255) * 0.59 + (b.color & 255) * 0.11) / 255;
        t.style.fill = lum > 0.6 ? 0x111111 : 0xffffff;
        bg.clear().rect(-w / 2, -h / 2, w, h).fill({ color: b.color });
        bg.rect(-w / 2, h / 2 - 3, w, 3).fill({ color: 0x111111 });
        bg.moveTo(-5, h / 2).lineTo(0, h / 2 + 6).lineTo(5, h / 2).fill({ color: 0x111111 });
      }
      this.labelAt.set(b.key, [b.x, b.y]);
    }
    for (const [k, c] of this.labelPool) if (!live.has(k)) { c.destroy({ children: true }); this.labelPool.delete(k); this.labelAt.delete(k); }
    this.placeLabels();
  }

  private placeLabels(): void {
    for (const [k, c] of this.labelPool) {
      const [x, y] = this.labelAt.get(k)!;
      c.position.set(isoX(x, y), isoY(x, y) - 34 / this.zoom);
      c.scale.set(1 / this.zoom);
    }
  }

  /** Crowding heatmap: a moving average of passengers per tile, drawn green → amber → red. */
  private drawHeat(s: GameState, dtReal: number): void {
    if (!this.density || this.density.length !== s.W * s.H) this.density = new Float32Array(s.W * s.H);
    const d = this.density;
    const k = Math.min(1, dtReal * 0.8);
    for (let i = 0; i < d.length; i++) d[i] *= 1 - k;
    for (const p of s.pax) {
      const x = Math.floor(p.x), y = Math.floor(p.y);
      if (x >= 0 && y >= 0 && x < s.W && y < s.H) d[y * s.W + x] += k;
    }
    const now = performance.now();
    if (now - this.heatAt < 200) return;
    this.heatAt = now;
    const g = this.heat;
    g.clear();
    if (!this.heatmap) return;
    for (let y = 0; y < s.H; y++) for (let x = 0; x < s.W; x++) {
      const v = d[y * s.W + x];
      if (s.tiles[y * s.W + x] !== T.Floor) continue;
      const color = v < 1.5 ? 0x4ade9b : v < 4 ? 0xf2b544 : 0xf2637a;
      this.diamond(g, x, y, color, v < 0.2 ? 0.12 : Math.min(0.75, 0.25 + v * 0.08));
    }
  }

  /**
   * Skywalks: a raised deck with glass sides over grass, apron or taxiway. Each
   * tile is its own drawing so aircraft passing underneath sort correctly.
   */
  private syncSkywalks(s: GameState): void {
    const list = s.skywalks ?? [];
    const key = `${list.length}:${list[0] ?? 0}:${list[list.length - 1] ?? 0}:${view.k}:${s.tiles.length}`;
    if (key === this.skywalkKey) return;
    this.skywalkKey = key;
    for (const g of this.skywalkGfx.values()) g.destroy();
    this.skywalkGfx.clear();
    const walk = getLayout(s).walk;
    const linked = (x: number, y: number) => x >= 0 && y >= 0 && x < s.W && y < s.H && (walk[y * s.W + x] === 1 || s.tiles[y * s.W + x] === T.Floor);
    for (const i of list) {
      const x = i % s.W, y = (i - x) / s.W;
      const g = new Graphics();
      const z0 = SKYWALK_Z * ZPX, zt = z0 + 0.1 * ZPX, zg = z0 + 0.62 * ZPX;
      const [vx, vy] = toView(x, y);
      const P = (a: number, b: number, z: number) => [vX(vx + a, vy + b), vY(vx + a, vy + b) - z];
      // support pillar under the middle
      g.poly([...P(0.42, 0.58, 0), ...P(0.58, 0.58, 0), ...P(0.58, 0.58, z0), ...P(0.42, 0.58, z0)]).fill({ color: 0x9aa5b5 });
      // far glass walls, deck, then near glass walls
      const sides: [number, number, number, number, number, number][] = [[0, -1, 0, 0, 1, 0], [-1, 0, 0, 0, 0, 1], [0, 1, 0, 1, 1, 1], [1, 0, 1, 0, 1, 1]];
      const glass = (a0: number, b0: number, a1: number, b1: number) => g.poly([...P(a0, b0, zt), ...P(a1, b1, zt), ...P(a1, b1, zg), ...P(a0, b0, zg)]).fill({ color: 0xbfe3f5, alpha: 0.45 }).stroke({ color: 0xffffff, width: 0.6, alpha: 0.8 });
      const open = sides.map(([dx, dy, ...r]) => ({ dx, dy, r, link: linked(x + dx, y + dy) }));
      const towards = (dx: number, dy: number) => { const [a, b] = dirToView(dx, dy); return a + b; };
      for (const e of open) if (!e.link && towards(e.dx, e.dy) < 0) { const [vdx, vdy] = dirToView(e.dx, e.dy); glass(...edgeInView(vdx, vdy)); }
      g.poly([...P(0, 0, zt), ...P(1, 0, zt), ...P(1, 1, zt), ...P(0, 1, zt)]).fill({ color: 0xdedad2 });
      g.poly([...P(0, 1, z0), ...P(1, 1, z0), ...P(1, 1, zt), ...P(0, 1, zt)]).fill({ color: 0x8f97a3 });
      g.poly([...P(1, 0, z0), ...P(1, 1, z0), ...P(1, 1, zt), ...P(1, 0, zt)]).fill({ color: 0x7a838f });
      for (const e of open) if (!e.link && towards(e.dx, e.dy) > 0) { const [vdx, vdy] = dirToView(e.dx, e.dy); glass(...edgeInView(vdx, vdy)); }
      g.zIndex = depth(x + 0.5, y + 0.5) + 1.0;
      this.objects.addChild(g);
      this.skywalkGfx.set(i, g);
    }
  }

  /**
   * People mover: an elevated guideway between consecutive stations (an L along
   * x then y), one tile per drawing so it sorts against everything below it, and
   * a two-car train shuttling along each section.
   */
  private syncTrains(s: GameState, dtReal: number): void {
    const net = trainNetwork(s);
    const key = `${layoutStamp()}:${net.stations.map((b) => b.id).join(',')}:${view.k}`;
    if (key !== this.guideKey) {
      this.guideKey = key;
      for (const g of this.guideGfx) g.destroy();
      for (const t of this.trains) t.sp.destroy();
      this.guideGfx = [];
      this.trains = [];
      const done = new Set<string>();
      const z = GUIDE_Z * ZPX;
      for (const [from, rides] of net.links) for (const r of rides) {
        const pair = [from, r.to].sort((a, b) => a - b).join('-');
        if (done.has(pair)) continue;
        done.add(pair);
        const ax = from % s.W, ay = (from - ax) / s.W, bx = r.to % s.W, by = (r.to - bx) / s.W;
        const tiles: [number, number][] = [];
        for (let x = ax; x !== bx; x += Math.sign(bx - ax)) tiles.push([x, ay]);
        const sy = Math.sign(by - ay);
        for (let y = ay; ; y += sy) { tiles.push([bx, y]); if (y === by || sy === 0) break; }
        tiles.forEach(([x, y], n) => {
          const g = new Graphics();
          const [vx, vy] = toView(x + 0.5, y + 0.5);
          const P = (a: number, b: number, h: number) => [vX(vx + a, vy + b), vY(vx + a, vy + b) - h];
          if (n % 3 === 0) g.poly([...P(-0.08, 0.08, 0), ...P(0.08, 0.08, 0), ...P(0.08, 0.08, z), ...P(-0.08, 0.08, z)]).fill({ color: 0xa3a9b3 }); // column
          const w = 0.3;
          g.poly([...P(-0.5, -w, z), ...P(0.5, -w, z), ...P(0.5, w, z), ...P(-0.5, w, z)]).fill({ color: 0xc9ccd2 }); // deck seen from above
          g.poly([...P(-0.5, w, z - 4), ...P(0.5, w, z - 4), ...P(0.5, w, z), ...P(-0.5, w, z)]).fill({ color: 0x8f96a1 });
          g.poly([...P(-w, -0.5, z), ...P(w, -0.5, z), ...P(w, 0.5, z), ...P(-w, 0.5, z)]).fill({ color: 0xc9ccd2 });
          g.zIndex = depth(x + 0.5, y + 0.5) + 1.1;
          this.objects.addChild(g);
          this.guideGfx.push(g);
        });
        const path: [number, number][] = [[ax + 0.5, ay + 0.5], [bx + 0.5, ay + 0.5], [bx + 0.5, by + 0.5]];
        const sp = this.makeSprite('apm_0');
        this.objects.addChild(sp);
        this.trains.push({ sp, path, i: 1, dir: 1, x: path[0][0], y: path[0][1], wait: 0 });
      }
    }
    for (const t of this.trains) {
      if (t.wait > 0) t.wait -= dtReal;
      else {
        let step = 7 * dtReal; // tiles per real second
        while (step > 0) {
          const [tx, ty] = t.path[t.i];
          const dx = tx - t.x, dy = ty - t.y, d = Math.hypot(dx, dy);
          if (d > 1e-3) {
            const name = `apm_${vface(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 0 : 2) : dy > 0 ? 1 : 3)}`;
            const tex = this.textures.get(name);
            if (tex && t.sp.texture !== tex) { t.sp.texture = tex; const fr = FRAMES[name]; if (fr) t.sp.anchor.set(fr.ax / fr.w, fr.ay / fr.h); }
          }
          if (d > step) { t.x += (dx / d) * step; t.y += (dy / d) * step; break; }
          t.x = tx; t.y = ty; step -= d;
          const next = t.i + t.dir;
          if (next < 0 || next >= t.path.length) { t.dir = t.dir === 1 ? -1 : 1; t.wait = 2; break; } // dwell at the station
          t.i = next;
        }
      }
      t.sp.position.set(isoX(t.x, t.y), isoY(t.x, t.y) - GUIDE_Z * ZPX);
      t.sp.zIndex = depth(t.x, t.y) + 1.15;
    }
  }

  /** Turn the camera a quarter (+1 clockwise, -1 anticlockwise), keeping the same spot in the middle of the screen. */
  rotateView(s: GameState, step: 1 | -1): void {
    const w = this.app.screen.width, h = this.app.screen.height;
    const [gx, gy] = this.toGrid(w / 2, h / 2);
    view.W = s.W; view.H = s.H;
    view.k = ((view.k + step + 4) % 4) as 0 | 1 | 2 | 3;
    this.groundStamp = -1;
    this.life.resetView();
    this.centerOn(gx, gy);
  }

  render(s: GameState, groundStamp: number, dtReal: number, ghost: Ghost | null, hover: [number, number] | null, selected: Building | null): void {
    view.W = s.W; view.H = s.H;
    this.drawHeat(s, dtReal);
    if (groundStamp !== this.groundStamp) {
      this.groundStamp = groundStamp;
      this.drawGround(s);
    }
    this.syncBuildings(s);
    this.syncAircraft(s);
    this.life.update(s, dtReal);
    this.syncSkywalks(s);
    this.syncTrains(s, dtReal);
    this.syncPax(s, dtReal);
    this.drawOverlay(s, ghost, hover, selected);
    this.placeLabels();
    this.top.position.copyFrom(this.world.position);
    this.top.scale.copyFrom(this.world.scale);
    this.lights.update(s, groundStamp * 4 + view.k, this.app.screen.width, this.app.screen.height, this.life.traffic);
  }

  /** Thumbnail URL of a module's sprite for the build menu. */
  static thumb(kind: ModuleKind): string | null {
    const m = MODULES[kind];
    return m.sprite ? `${import.meta.env.BASE_URL}sprites/${m.sprite}_0.webp` : null;
  }
}
