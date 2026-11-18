// Life on the ground around the terminal: turnaround vehicles, jet bridges,
// road traffic and parked cars. Purely visual; reads the game state only.

import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { MODULES, spriteType } from '../game/catalog';
import { drivable, getLayout, idx, localPoint, standPoints } from '../game/grid';
import { aircraftPath, simplify } from '../game/paths';
import type { GameState } from '../game/types';
import { T } from '../game/types';
import { AC_SIZE, isoX, isoY, ZPX } from './iso';

type Frame = { w: number; h: number; ax: number; ay: number; scale: number };

/** What the scene lends us to make and retexture sprites. */
export interface SpriteKit {
  make(name: string): Sprite;
  frames: Record<string, Frame>;
  textures: Map<string, Texture>;
  scale(name: string): number;
  layer: Container;
}

/** Car park bay rows (y offsets inside the 6×6 lot) and the way cars face when parked nose-in. */
export const CARPARK_ROWS: [number, number, 1 | 3][] = [[0.15, 1.15, 3], [2.45, 3.45, 1], [3.45, 4.45, 3]];
const CAR_COLORS = [0xf8fafc, 0xcbd5e1, 0x475569, 0x1f2937, 0xdc2626, 0x2563eb, 0x0f766e, 0xd6c7a1, 0x7c2d12];
const hash01 = (a: number, b: number) => { const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return v - Math.floor(v); };
const facingOf = (dx: number, dy: number) => (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 0 : 2) : dy > 0 ? 1 : 3);

interface Traffic { sp: Sprite; x: number; y: number; dir: 1 | -1; speed: number; len: number }
interface Vehicle { sp: Sprite; base?: string; path: [number, number][]; i: number; x: number; y: number; leaving: boolean }

export class GroundLife {
  traffic: Traffic[] = [];
  private vehicles = new Map<string, Vehicle>();
  private parked = new Map<string, Sprite>();
  private bridges = new Map<number, { c: Container; g: Graphics; rot: Sprite; cab: Sprite; len: number; drawn: string }>();
  private shuttles = new Map<number, { sp: Sprite; path: [number, number][]; i: number; dir: 1 | -1; x: number; y: number; retiring: boolean }>();

  constructor(private kit: SpriteKit) {}

  update(s: GameState, dtReal: number): void {
    this.syncService(s, dtReal);
    this.syncBridges(s, dtReal);
    this.syncTraffic(s, dtReal);
    this.syncShuttles(s, dtReal);
  }

  /**
   * Baggage trains running between the baggage hall and aircraft on stand while
   * there are bags to move, along the real taxiway and apron network.
   */
  private syncShuttles(s: GameState, dtReal: number): void {
    const halls = s.buildings.filter((b) => b.kind === 'bagsort');
    const L = getLayout(s);
    const active = new Set<number>();
    if (halls.length) {
      for (const f of s.flights) {
        if (f.phase !== 'parked' || f.stand === null) continue;
        if (f.bagsSorted - f.bagsLoaded < 1 && f.bagsIn - f.bagsUnloaded < 1) continue;
        active.add(f.id);
        if (this.shuttles.has(f.id)) continue;
        const st = L.byId.get(f.stand);
        if (!st) continue;
        const [ex, ey] = standPoints(st).entry;
        // the drivable tile next to the nearest hall
        let best: [number, number] | null = null, bd = Infinity;
        for (const h of halls) for (let y = h.y - 1; y <= h.y + h.h; y++) for (let x = h.x - 1; x <= h.x + h.w; x++) {
          if (!drivable(s, x, y)) continue;
          const d = Math.abs(x - ex) + Math.abs(y - ey);
          if (d < bd) { bd = d; best = [x, y]; }
        }
        if (!best) continue;
        const raw = aircraftPath(s, best[0], best[1], ex, ey);
        if (!raw) continue;
        const path = simplify(raw);
        const sp = this.kit.make('gse_bags_0');
        this.kit.layer.addChild(sp);
        this.shuttles.set(f.id, { sp, path, i: 1, dir: 1, x: path[0][0], y: path[0][1], retiring: false });
      }
    }
    const speed = 2.4 * dtReal;
    for (const [id, t] of this.shuttles) {
      if (!active.has(id) && !t.retiring) {
        // finish by driving back to the hall
        t.retiring = true;
        if (t.dir === 1) { t.dir = -1; t.i = Math.max(0, t.i - 1); }
      }
      let step = speed;
      while (step > 0) {
        const [tx, ty] = t.path[t.i];
        const dx = tx - t.x, dy = ty - t.y, d = Math.hypot(dx, dy);
        if (d > 1e-3) this.setFrame(t.sp, `gse_bags_${facingOf(dx, dy)}`);
        if (d > step) { t.x += (dx / d) * step; t.y += (dy / d) * step; step = 0; break; }
        t.x = tx; t.y = ty; step -= d;
        const next = t.i + t.dir;
        if (next < 0 || next >= t.path.length) {
          if (t.retiring && t.dir === -1) { step = -1; break; }
          t.dir = t.dir === 1 ? -1 : 1; // turn round at the stand or the hall
          step = 0;
          break;
        }
        t.i = next;
      }
      if (step === -1) { t.sp.destroy(); this.shuttles.delete(id); continue; }
      t.sp.position.set(isoX(t.x, t.y), isoY(t.x, t.y));
      t.sp.zIndex = t.x + t.y + 1.2;
    }
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
        const sp = this.kit.make(w.sprite);
        this.kit.layer.addChild(sp);
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
          const sp = this.kit.make(`${kind}_${dir > 0 ? 0 : 2}`);
          if (kind === 'car') sp.tint = CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];
          this.kit.layer.addChild(sp);
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
          const sp = this.kit.make(`car_${facing}`);
          sp.tint = CAR_COLORS[Math.floor(hash01(b.id, i) * CAR_COLORS.length)];
          const x = b.x + 0.5 + k * 0.5, y = b.y + (y0 + y1) / 2;
          sp.position.set(isoX(x, y), isoY(x, y));
          sp.zIndex = x + y + 0.2;
          this.kit.layer.addChild(sp);
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
    sp.texture = this.kit.textures.get(name) ?? sp.texture;
    const fr = this.kit.frames[name];
    if (fr) sp.anchor.set(fr.ax / fr.w, fr.ay / fr.h);
    sp.scale.set(this.kit.scale(name));
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
        const rot = this.kit.make('jbrot');
        const cab = this.kit.make('jbcab_0');
        c.addChild(g, rot, cab);
        this.kit.layer.addChild(c);
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
      st.cab.texture = this.kit.textures.get(`jbcab_${cabFacing}`) ?? st.cab.texture;
      const cf = this.kit.frames[`jbcab_${cabFacing}`];
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
}
