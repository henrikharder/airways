// Isometric renderer (PixiJS). Ground is painted with vector graphics; every
// building, aircraft and passenger is a Blender-rendered sprite, depth sorted.

import { Application, Assets, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import manifest from '../generated/sprites.json';
import { MODULES, spriteType } from '../game/catalog';
import { airlineColor, runway } from '../game/flights';
import { footprint, getLayout, idx, localPoint, standPoints } from '../game/grid';
import type { Building, GameState, ModuleKind } from '../game/types';
import { T } from '../game/types';
import { AC_SIZE, isoX, isoY, screenToGrid, TH, TW, ZPX } from './iso';
import { Lights } from './lights';

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


/** Car park bay rows (y offsets inside the 6×6 lot) and the way cars face when parked nose-in. */
const CARPARK_ROWS: [number, number, 1 | 3][] = [[0.15, 1.15, 3], [2.45, 3.45, 1], [3.45, 4.45, 3]];
const CAR_COLORS = [0xf8fafc, 0xcbd5e1, 0x475569, 0x1f2937, 0xdc2626, 0x2563eb, 0x0f766e, 0xd6c7a1, 0x7c2d12];
const hash01 = (a: number, b: number) => { const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return v - Math.floor(v); };

interface Traffic { sp: Sprite; x: number; y: number; dir: 1 | -1; speed: number; len: number }

interface Vehicle { sp: Sprite; base?: string; path: [number, number][]; i: number; x: number; y: number; leaving: boolean }

const facingOf = (dx: number, dy: number) => (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 0 : 2) : dy > 0 ? 1 : 3);

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
  private vehicles = new Map<string, Vehicle>();
  private traffic: Traffic[] = [];
  private parked = new Map<string, Sprite>();
  private bridges = new Map<number, { c: Container; g: Graphics; rot: Sprite; cab: Sprite; len: number; drawn: string }>();
  private paxSprites = new Map<number, Sprite>();
  private ghostSprite: Sprite | null = null;
  private groundStamp = -1;
  zoom = 1.6;
  private walkClock = 0;

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({ resizeTo: host, background: 0x2e5a34, antialias: true, autoDensity: true, resolution: window.devicePixelRatio || 1 });
    host.appendChild(this.app.canvas);
    this.objects.sortableChildren = true;
    this.world.addChild(this.ground, this.heat, this.objects);
    // night shade over the world, then lights and UI overlays that follow the world's transform
    this.top.addChild(this.lights.layer, this.overlay, this.labels);
    this.app.stage.addChild(this.world, this.lights.shade, this.top);
    const base = import.meta.env.BASE_URL;
    // aircraft are most of the texture memory, so each type loads the first time it appears
    const names = Object.keys(FRAMES).filter((n) => !n.startsWith('ac_'));
    const loaded = await Assets.load(names.map((n) => ({ alias: n, src: `${base}sprites/${n}.png` })));
    for (const n of names) this.textures.set(n, loaded[n] as Texture);
  }

  private aircraftLoading = new Set<string>();

  /** True once the sprites for an aircraft type are ready; starts loading them otherwise. */
  private aircraftReady(type: string): boolean {
    if (this.textures.has(`ac_${type}_0`)) return true;
    if (!this.aircraftLoading.has(type)) {
      this.aircraftLoading.add(type);
      const base = import.meta.env.BASE_URL;
      const names = Object.keys(FRAMES).filter((n) => n.startsWith(`ac_${type}_`));
      Assets.load(names.map((n) => ({ alias: n, src: `${base}sprites/${n}.png` }))).then((loaded) => {
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
    const rw = runway(s);
    if (rw) {
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
      if (!indoor(t(x, y - 1))) wall(x, y, x + 1, y, 0x9fd3f5);
      if (!indoor(t(x - 1, y))) wall(x, y, x, y + 1, 0x86c3ec);
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
      for (const [dx, dy] of n.sort((a, b) => a[0] + a[1] - (b[0] + b[1]))) panel(cx, cy, cx + dx * 0.5, cy + dy * 0.5);
      if (!n.length) panel(cx - 0.3, cy, cx + 0.3, cy);
    }
  }

  // ---------------------------------------------------------------- objects

  private spriteFor(b: Building): Container | null {
    const m = MODULES[b.kind];
    const c = new Container();
    if (m.sprite) {
      const name = `${m.sprite}_${m.rotatable ? b.rot : 0}`;
      const sp = this.makeSprite(name);
      sp.position.set(isoX(b.x, b.y), isoY(b.x, b.y));
      c.addChild(sp);
    }
    let z = b.x + b.y + b.w + b.h;
    if (!c.children.length) return null;
    c.zIndex = z;
    return c;
  }

  private syncBuildings(s: GameState): void {
    const live = new Set<number>();
    for (const b of s.buildings) {
      const key = b.id;
      live.add(key);
      const tag = `${b.kind}:${b.x}:${b.y}:${b.rot}:${b.link ?? 0}`;
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
      const key = `ac_${type}_${f.facing}`;
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
      c.zIndex = f.x + f.y + (f.alt > 0.5 ? 400 : 1.5);
    }
    for (const [id, c] of this.aircraftSprites) if (!live.has(id)) { c.destroy({ children: true }); this.aircraftSprites.delete(id); }
  }

  /**
   * Turnaround life around parked aircraft: belt loader and baggage train at the
   * forward hold, catering at the rear service door, a fuel truck by the engine,
   * cones, ground crew, and the pushback tug near departure. Purely visual.
   */
  private syncService(s: GameState, dtReal: number): void {
    // key -> final sprite and spot; vehicles that drive also carry their approach path
    const want = new Map<string, { sprite: string; x: number; y: number; base?: string; path?: [number, number][] }>();
    const now = s.minute;
    for (const f of s.flights) {
      if ((f.phase !== 'parked' && f.phase !== 'pushback') || f.stand === null) continue;
      const st = getLayout(s).byId.get(f.stand);
      if (!st) continue;
      const [Lt, St, D] = AC_SIZE[spriteType(f.typeId)] ?? AC_SIZE.A20N;
      // aircraft frame: fwd along the fuselage, side towards the service side (away from the jet bridge)
      const o = localPoint(st, 0, 0), ly = localPoint(st, 0, 1), lx = localPoint(st, 1, 0);
      const fwd = [ly[0] - o[0], ly[1] - o[1]];
      const side = [o[0] - lx[0], o[1] - lx[1]];
      const at = (u: number, v: number): [number, number] => [f.x + side[0] * u + fwd[0] * v, f.y + side[1] * u + fwd[1] * v];
      const face = (du: number, dv: number) => facingOf(side[0] * du + fwd[0] * dv, side[1] * du + fwd[1] * dv);
      const put = (name: string, sprite: string, u: number, v: number) => {
        const [x, y] = at(u, v);
        want.set(`${f.id}:${name}`, { sprite, x, y });
      };
      // drive in from beyond the wingtip on the service side, ending with the final heading
      const U = St / 2 + 2.5;
      const drive = (name: string, base: string, u: number, v: number, du: number, dv: number) => {
        const pts: [number, number][] = du ? [[U, v - 3], [U, v], [u, v]] : [[U, v - 4], [u, v - 4], [u, v]];
        const [x, y] = at(u, v);
        want.set(`${f.id}:${name}`, { sprite: `${base}_${face(du, dv)}`, x, y, base, path: pts.map(([a, b]) => at(a, b)) });
      };
      const parked = f.phase === 'parked';
      const since = now - f.arr, left = f.dep - now;
      if (parked) {
        put('cone1', 'gse_cone', St / 2, -Lt * 0.12);
        put('cone2', 'gse_cone', -St / 2, -Lt * 0.12);
        put('cone3', 'gse_cone', 0, -Lt / 2 - 0.4);
        put('crew1', `crew_${face(-1, 0)}_0`, D / 2 + 1.3, Lt * 0.22 - 0.45);
        put('crew2', `crew_${face(0, -1)}_0`, -D / 2 - 0.2, Lt / 2 - 0.2);
        if (left > 8) {
          drive('belt', 'gse_belt', D / 2 + 0.85, Lt * 0.22, -1, 0);
          if (since > 2) drive('bags', 'gse_bags', D / 2 + 1.9, Lt * 0.22 + 1.0, 0, 1);
        }
        if (since > 6 && left > 20) drive('fuel', 'gse_fuel', St * 0.34, 0.2, 0, 1);
        if (since > 8 && left > 14) drive('catering', 'gse_catering', D / 2 + 0.95, -Lt * 0.36, -1, 0);
      }
      if ((parked && left < 12) || f.phase === 'pushback') put('tug', `gse_tug_${face(0, -1)}`, 0, Lt / 2 + 0.7);
    }
    const step = 2.4 * dtReal; // tiles per real second
    for (const [key, w] of want) {
      let v = this.vehicles.get(key);
      if (!v) {
        const start = w.path ? w.path[0] : ([w.x, w.y] as [number, number]);
        const sp = this.makeSprite(w.sprite);
        this.objects.addChild(sp);
        v = { sp, base: w.base, path: w.path ?? [], i: 1, x: start[0], y: start[1], leaving: false };
        this.vehicles.set(key, v);
      }
      if (!w.path) { v.x = w.x; v.y = w.y; this.setFrame(v.sp, w.sprite); }
      else if (!v.leaving) this.moveVehicle(v, step, w.sprite);
    }
    for (const [key, v] of this.vehicles) {
      if (want.has(key)) continue;
      if (!v.base) { v.sp.destroy(); this.vehicles.delete(key); continue; }
      if (!v.leaving) {
        // head back out the way it came, from wherever it got to
        v.leaving = true;
        v.path = [[v.x, v.y], ...v.path.slice(0, v.i).reverse()];
        v.i = 1;
      }
      if (this.moveVehicle(v, step, null)) { v.sp.destroy(); this.vehicles.delete(key); }
    }
    for (const v of this.vehicles.values()) {
      v.sp.position.set(isoX(v.x, v.y), isoY(v.x, v.y));
      v.sp.zIndex = v.x + v.y + 0.2;
    }
  }

  /**
   * Landside life: cars, taxis and buses on the two-lane road (busier when the
   * terminal is busy), and car parks that fill up with passengers' cars.
   */
  private syncTraffic(s: GameState, dtReal: number): void {
    const activity = Math.min(1, s.pax.filter((p) => p.dep).length / 160);
    const lanes: [number, 1 | -1][] = [[s.H - 3 + 0.5, -1], [s.H - 2 + 0.5, 1]];
    for (const [y, dir] of lanes) {
      if (s.tiles[idx(s, 0, Math.floor(y))] !== T.Road) continue;
      if (Math.random() < (0.15 + 0.6 * activity) * dtReal) {
        const x = dir > 0 ? -3 : s.W + 3;
        const clear = this.traffic.every((t) => t.y !== y || Math.abs(t.x - x) > 3);
        if (clear) {
          const r = Math.random();
          const kind = r < 0.1 ? 'bus' : r < 0.28 ? 'taxi' : 'car';
          const sp = this.makeSprite(`${kind}_${dir > 0 ? 0 : 2}`);
          if (kind === 'car') sp.tint = CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];
          this.objects.addChild(sp);
          this.traffic.push({ sp, x, y, dir, speed: kind === 'bus' ? 2.2 : 2.6 + Math.random() * 1.2, len: kind === 'bus' ? 2.4 : 0.92 });
        }
      }
    }
    // simple car following: never close within a car length of the one ahead
    for (const t of this.traffic) {
      let gap = Infinity;
      for (const o of this.traffic) {
        if (o === t || o.y !== t.y) continue;
        const d = (o.x - t.x) * t.dir;
        if (d > 0) gap = Math.min(gap, d - (o.len + t.len) / 2);
      }
      const v = Math.max(0, Math.min(t.speed, (gap - 0.5) * 2));
      t.x += t.dir * v * dtReal;
      t.sp.position.set(isoX(t.x, t.y), isoY(t.x, t.y));
      t.sp.zIndex = t.x + t.y + 0.3;
    }
    this.traffic = this.traffic.filter((t) => {
      const out = t.x < -4 || t.x > s.W + 4;
      if (out) t.sp.destroy();
      return !out;
    });
    // parked cars: occupancy follows the departing passengers in the building
    const want = new Set<string>();
    const occ = 0.12 + 0.83 * activity;
    for (const b of s.buildings) {
      if (b.kind !== 'carpark') continue;
      CARPARK_ROWS.forEach(([y0, y1, facing], row) => {
        for (let k = 0; k < 11; k++) {
          const i = row * 11 + k;
          if (hash01(i, b.id) >= occ) continue;
          const key = `${b.id}:${i}`;
          want.add(key);
          if (this.parked.has(key)) continue;
          const sp = this.makeSprite(`car_${facing}`);
          sp.tint = CAR_COLORS[Math.floor(hash01(b.id, i) * CAR_COLORS.length)];
          const x = b.x + 0.5 + k * 0.5, y = b.y + (y0 + y1) / 2;
          sp.position.set(isoX(x, y), isoY(x, y));
          sp.zIndex = x + y + 0.2;
          this.objects.addChild(sp);
          this.parked.set(key, sp);
        }
      });
    }
    for (const [key, sp] of this.parked) if (!want.has(key)) { sp.destroy(); this.parked.delete(key); }
  }

  /** Advance a vehicle along its path; true when it reached the end. */
  private moveVehicle(v: Vehicle, step: number, parked: string | null): boolean {
    while (step > 0 && v.i < v.path.length) {
      const [tx, ty] = v.path[v.i];
      const dx = tx - v.x, dy = ty - v.y;
      const d = Math.hypot(dx, dy);
      if (d > 1e-3) this.setFrame(v.sp, `${v.base}_${facingOf(dx, dy)}`);
      if (d <= step) { v.x = tx; v.y = ty; v.i++; step -= d; }
      else { v.x += (dx / d) * step; v.y += (dy / d) * step; step = 0; }
    }
    const done = v.i >= v.path.length;
    if (done && parked) this.setFrame(v.sp, parked);
    return done;
  }

  private setFrame(sp: Sprite, name: string): void {
    if (sp.label === name) return;
    sp.label = name;
    sp.texture = this.textures.get(name) ?? sp.texture;
    const fr = FRAMES[name];
    if (fr) sp.anchor.set(fr.ax / fr.w, fr.ay / fr.h);
    sp.scale.set(this.frameScale(name));
  }

  /**
   * Telescoping jet bridges: a rotunda at the terminal edge, a tunnel that runs
   * alongside the nose, and a cab that mates with the L1 door. The bridge extends
   * when an aircraft is on stand and retracts before pushback.
   */
  private syncBridges(s: GameState, dtReal: number): void {
    const live = new Set<number>();
    for (const b of s.buildings) {
      if (!b.kind.startsWith('stand_') || !b.link) continue;
      live.add(b.id);
      const m = MODULES[b.kind];
      const f = s.flights.find((x) => x.stand === b.id && (x.phase === 'parked' || x.phase === 'parking'));
      const [Lt, , D] = f ? AC_SIZE[spriteType(f.typeId)] ?? AC_SIZE.A20N : AC_SIZE.A20N;
      const docked = f && f.phase === 'parked' && f.dep - s.minute > 3;
      // local stand coordinates: the aircraft parks at (w/2, h/2) nose towards +y (the terminal)
      const lineX = m.w / 2 + D / 2 + 0.7;
      const start = m.h - 0.3;
      const want = docked ? Math.max(0.9, start - (m.h / 2 + Lt / 2 - 1.3 * D)) : 1.0;
      let st = this.bridges.get(b.id);
      if (!st) {
        const c = new Container();
        const g = new Graphics();
        const rot = this.makeSprite('jbrot');
        const cab = this.makeSprite('jbcab_0');
        c.addChild(g, rot, cab);
        this.objects.addChild(c);
        st = { c, g, rot, cab, len: want, drawn: '' };
        this.bridges.set(b.id, st);
      }
      const step = 1.2 * dtReal; // tiles per real second
      st.len += Math.max(-step, Math.min(step, want - st.len));
      const key = `${b.x}:${b.y}:${b.rot}:${st.len.toFixed(3)}`;
      if (key === st.drawn) continue;
      st.drawn = key;
      const P = (lx: number, ly: number) => localPoint(b, lx, ly);
      const endY = start - st.len;
      // cab faces local -x (towards the fuselage)
      const a = P(0, 0), bx = P(1, 0);
      const dx = a[0] - bx[0], dy = a[1] - bx[1];
      const cabFacing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 0 : 2) : dy > 0 ? 1 : 3;
      st.cab.texture = this.textures.get(`jbcab_${cabFacing}`) ?? st.cab.texture;
      const cf = FRAMES[`jbcab_${cabFacing}`];
      if (cf) st.cab.anchor.set(cf.ax / cf.w, cf.ay / cf.h);
      const cabAt = P(lineX - 0.45, endY);
      const rotAt = P(lineX, start);
      st.cab.position.set(isoX(...cabAt), isoY(...cabAt));
      st.rot.position.set(isoX(...rotAt), isoY(...rotAt));
      // tunnel: outer section from the rotunda, inner section sliding out of it
      const g = st.g.clear();
      const outerLen = Math.min(st.len, 1.1);
      const sections: [number, number, number, number, number][] = [
        [start - 0.2, start - outerLen, 0.25, 0.52, 0.93],
        [start - outerLen + 0.1, endY, 0.21, 0.55, 0.9],
      ];
      for (const [y0, y1, hw, , z1] of sections) {
        if (y0 - y1 < 0.05) continue;
        const cs = [P(lineX - hw, y0), P(lineX + hw, y0), P(lineX - hw, y1), P(lineX + hw, y1)];
        const x0 = Math.min(...cs.map((p) => p[0])), x1 = Math.max(...cs.map((p) => p[0]));
        const gy0 = Math.min(...cs.map((p) => p[1])), gy1 = Math.max(...cs.map((p) => p[1]));
        this.shadowBox(g, x0, gy0, x1, gy1, z1);
      }
      for (const [y0, y1, hw, z0, z1] of sections) {
        if (y0 - y1 < 0.05) continue;
        const cs = [P(lineX - hw, y0), P(lineX + hw, y0), P(lineX - hw, y1), P(lineX + hw, y1)];
        const x0 = Math.min(...cs.map((p) => p[0])), x1 = Math.max(...cs.map((p) => p[0]));
        const gy0 = Math.min(...cs.map((p) => p[1])), gy1 = Math.max(...cs.map((p) => p[1]));
        this.tunnelBox(g, x0, gy0, x1, gy1, z0, z1);
      }
      // paint order inside the bridge: whichever end is nearer the camera goes last
      const nearCab = cabAt[0] + cabAt[1] > rotAt[0] + rotAt[1];
      st.c.setChildIndex(st.rot, nearCab ? 0 : 2);
      st.c.setChildIndex(st.g, 1);
      st.c.setChildIndex(st.cab, nearCab ? 2 : 0);
      // in front of or behind the parked aircraft depending on which side faces the camera
      const side = P(1, 0), o = P(0, 0);
      const towardsCamera = side[0] - o[0] + side[1] - o[1] > 0;
      const park = P(m.w / 2, m.h / 2);
      st.c.zIndex = park[0] + park[1] + 1.5 + (towardsCamera ? 0.1 : -0.1);
    }
    for (const [id, st] of this.bridges) if (!live.has(id)) { st.c.destroy({ children: true }); this.bridges.delete(id); }
  }

  /** Soft ground shadow of a raised box, cast with the same sun as the Blender renders. */
  private shadowBox(g: Graphics, x0: number, y0: number, x1: number, y1: number, z: number): void {
    const sx = 0.24 * z, sy = -0.66 * z; // ground offset per tile of height
    const pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].flatMap(([x, y]) => [isoX(x + sx, y + sy), isoY(x + sx, y + sy)]);
    g.poly(pts).fill({ color: 0x1b2430, alpha: 0.18 });
  }

  /** Axis-aligned box drawn as its three camera-facing faces, lit like the sprites. */
  private tunnelBox(g: Graphics, x0: number, y0: number, x1: number, y1: number, z0: number, z1: number): void {
    const p = (x: number, y: number, z: number) => [isoX(x, y), isoY(x, y) - z * ZPX];
    const face = (pts: number[][], color: number) => g.poly(pts.flat()).fill({ color });
    // +y face (lit), +x face (shade), top
    face([p(x0, y1, z0), p(x1, y1, z0), p(x1, y1, z1), p(x0, y1, z1)], 0xd3dbe5);
    face([p(x1, y0, z0), p(x1, y1, z0), p(x1, y1, z1), p(x1, y0, z1)], 0x9ba7b5);
    face([p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1), p(x0, y1, z1)], 0xe9eef3);
    // window strip and accent band on both visible sides
    const band = (za: number, zb: number, cy: number, cx: number) => {
      const i = 0.08;
      if (x1 - x0 > 2 * i) face([p(x0 + i, y1, za), p(x1 - i, y1, za), p(x1 - i, y1, zb), p(x0 + i, y1, zb)], cy);
      if (y1 - y0 > 2 * i) face([p(x1, y0 + i, za), p(x1, y1 - i, za), p(x1, y1 - i, zb), p(x1, y0 + i, zb)], cx);
    };
    const h = z1 - z0;
    band(z0 + h * 0.38, z0 + h * 0.62, 0x334155, 0x273244);
    band(z1 - h * 0.18, z1 - h * 0.1, 0x2f7de1, 0x2563c0);
  }

  private syncPax(s: GameState, dtReal: number): void {
    this.walkClock += dtReal;
    const step = Math.floor(this.walkClock * 6) % 2;
    const live = new Set<number>();
    for (const p of s.pax) {
      live.add(p.id);
      const moving = p.state.startsWith('to') || p.state === 'boarding' || p.state === 'queue';
      const key = `pax_${p.color}_${p.facing}_${moving ? (step + (p.id % 2)) % 2 : 0}`;
      let sp = this.paxSprites.get(p.id);
      if (!sp) {
        sp = this.makeSprite(key);
        this.objects.addChild(sp);
        this.paxSprites.set(p.id, sp);
      }
      const tex = this.textures.get(key);
      if (tex && sp.texture !== tex) sp.texture = tex;
      sp.position.set(isoX(p.x, p.y), isoY(p.x, p.y));
      sp.zIndex = p.x + p.y + 0.6;
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
        const sp = this.makeSprite(`${m.sprite}_${m.rotatable ? ghost.rot : 0}`);
        sp.position.set(isoX(ghost.x, ghost.y), isoY(ghost.x, ghost.y));
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

  render(s: GameState, groundStamp: number, dtReal: number, ghost: Ghost | null, hover: [number, number] | null, selected: Building | null): void {
    this.drawHeat(s, dtReal);
    if (groundStamp !== this.groundStamp) {
      this.groundStamp = groundStamp;
      this.drawGround(s);
    }
    this.syncBuildings(s);
    this.syncAircraft(s);
    this.syncService(s, dtReal);
    this.syncBridges(s, dtReal);
    this.syncTraffic(s, dtReal);
    this.syncPax(s, dtReal);
    this.drawOverlay(s, ghost, hover, selected);
    this.placeLabels();
    this.top.position.copyFrom(this.world.position);
    this.top.scale.copyFrom(this.world.scale);
    this.lights.update(s, groundStamp, this.app.screen.width, this.app.screen.height, this.traffic);
  }

  /** Thumbnail URL of a module's sprite for the build menu. */
  static thumb(kind: ModuleKind): string | null {
    const m = MODULES[kind];
    return m.sprite ? `${import.meta.env.BASE_URL}sprites/${m.sprite}_0.png` : null;
  }
}
