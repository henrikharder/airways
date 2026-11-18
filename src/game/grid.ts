// Tile grid, footprints and the rules for building.

import { BULLDOZE_REFUND, MODULES, PAINTS } from './catalog';
import { planningMultiplier } from './night';
import type { Building, GameState, ModuleKind, PaintKind } from './types';
import { T } from './types';

export const idx = (s: GameState, x: number, y: number) => y * s.W + x;
export const inside = (s: GameState, x: number, y: number) => x >= 0 && y >= 0 && x < s.W && y < s.H;
export const tileAt = (s: GameState, x: number, y: number) => (inside(s, x, y) ? s.tiles[idx(s, x, y)] : -1);

/** Derived lookups rebuilt whenever the layout changes. */
export interface Layout {
  version: number;
  occ: Int32Array; // building id per tile, 0 = free
  byId: Map<number, Building>;
}

let layout: Layout | null = null;
let layoutVersion = 0;

export function invalidate(): void {
  layout = null;
  layoutVersion++;
}

export function getLayout(s: GameState): Layout {
  if (layout) return layout;
  const occ = new Int32Array(s.W * s.H);
  const byId = new Map<number, Building>();
  for (const b of s.buildings) {
    byId.set(b.id, b);
    if (b.kind === 'runway') continue; // runway tiles are marked by tile type
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) if (inside(s, x, y)) occ[idx(s, x, y)] = b.id;
  }
  layout = { version: layoutVersion, occ, byId };
  return layout;
}

export function footprint(kind: ModuleKind, rot: number): { w: number; h: number } {
  const m = MODULES[kind];
  return rot % 2 ? { w: m.h, h: m.w } : { w: m.w, h: m.h };
}

/** Rotate a local point (in the unrotated w×h footprint) into the rotated footprint. */
export function rotPoint(w: number, h: number, rot: number, gx: number, gy: number): [number, number] {
  switch (rot) {
    case 1: return [h - gy, gx];
    case 2: return [w - gx, h - gy];
    case 3: return [gy, w - gx];
    default: return [gx, gy];
  }
}

const FRONT: [number, number][] = [[0, 1], [-1, 0], [0, -1], [1, 0]];

/** Outward direction of a building's front (service) side. */
export function frontDir(b: Pick<Building, 'rot'>): [number, number] {
  return FRONT[b.rot];
}

/** Tile just in front of the middle of the front edge, where passengers are served. */
export function accessTile(b: Building): [number, number] {
  const m = MODULES[b.kind];
  const [cx, cy] = rotPoint(m.w, m.h, b.rot, m.w / 2, m.h + 0.5);
  return [Math.floor(b.x + cx), Math.floor(b.y + cy)];
}

/** Point in a building, given in its unrotated local coordinates. */
export function localPoint(b: Building, gx: number, gy: number): [number, number] {
  const m = MODULES[b.kind];
  const [x, y] = rotPoint(m.w, m.h, b.rot, gx, gy);
  return [b.x + x, b.y + y];
}

/** Stand geometry: where aircraft enter (behind) and park (centre, nose to the front). */
export function standPoints(b: Building): { entry: [number, number]; park: [number, number]; gateSide: [number, number] } {
  const m = MODULES[b.kind];
  const e = localPoint(b, m.w / 2, -0.5);
  return {
    entry: [Math.floor(e[0]), Math.floor(e[1])],
    park: localPoint(b, m.w / 2, m.h / 2),
    gateSide: localPoint(b, m.w / 2, m.h),
  };
}

export function runwayLine(b: Building): { start: [number, number]; end: [number, number]; axis: 'x' | 'y' } {
  if (b.rot % 2 === 0) {
    const y = b.y + b.h / 2;
    return { start: [b.x + 1.5, y], end: [b.x + b.w - 1.5, y], axis: 'x' };
  }
  const x = b.x + b.w / 2;
  return { start: [x, b.y + 1.5], end: [x, b.y + b.h - 1.5], axis: 'y' };
}

export interface Check { ok: boolean; reason?: string; cost: number }

export function checkPlace(s: GameState, kind: ModuleKind, x: number, y: number, rot: number): Check {
  const base = MODULES[kind];
  // airside expansion needs planning permission, which gets pricey when the neighbours are unhappy
  const airside = base.category === 'airside';
  const spec = airside ? { ...base, cost: Math.round(base.cost * planningMultiplier(s)) } : base;
  const { w, h } = footprint(kind, rot);
  const L = getLayout(s);
  if (s.cash < spec.cost) return { ok: false, reason: 'Not enough cash', cost: spec.cost };
  for (let ty = y; ty < y + h; ty++) {
    for (let tx = x; tx < x + w; tx++) {
      if (!inside(s, tx, ty)) return { ok: false, reason: 'Outside the site', cost: spec.cost };
      const t = s.tiles[idx(s, tx, ty)];
      const o = L.occ[idx(s, tx, ty)];
      if (o && (kind === 'tree' || L.byId.get(o)?.kind !== 'tree')) return { ok: false, reason: 'Something is already here', cost: spec.cost };
      if (spec.indoor && t !== T.Floor && !(kind === 'exit' && t === T.Barrier)) return { ok: false, reason: 'Must be inside the terminal (paint terminal floor first)', cost: spec.cost };
      if (!spec.indoor) {
        if (t === T.Floor || t === T.Road || t === T.Runway) return { ok: false, reason: 'Needs open ground', cost: spec.cost };
        if ((kind === 'tower' || kind === 'carpark' || kind === 'tree' || kind === 'bagsort') && t !== T.Grass) return { ok: false, reason: 'Needs grass', cost: spec.cost };
      }
    }
  }
  if (spec.indoor) {
    // don't cover another module's service tile (its queue would be cut off)
    for (const o of s.buildings) {
      if (!MODULES[o.kind].indoor || o.kind === 'entrance' || o.kind === 'exit') continue;
      const [ox, oy] = accessTile(o);
      if (ox >= x && ox < x + w && oy >= y && oy < y + h) return { ok: false, reason: `Blocks the front of the ${MODULES[o.kind].name.toLowerCase()}`, cost: spec.cost };
    }
    const b = { id: 0, kind, x, y, w, h, rot: rot as Building['rot'] };
    const [ax, ay] = accessTile(b);
    if (kind !== 'entrance' && kind !== 'exit' && (tileAt(s, ax, ay) !== T.Floor || L.occ[idx(s, ax, ay)])) {
      return { ok: false, reason: 'Keep the front side open (passengers queue there)', cost: spec.cost };
    }
  }
  if (kind === 'carpark') {
    let road = false;
    for (let ty = y - 1; ty <= y + h && !road; ty++) for (let tx = x - 1; tx <= x + w; tx++) if (tileAt(s, tx, ty) === T.Road) road = true;
    if (!road) return { ok: false, reason: 'Must touch the road', cost: spec.cost };
  }
  if (kind === 'bagsort') {
    let apron = false;
    for (let ty = y - 1; ty <= y + h && !apron; ty++) for (let tx = x - 1; tx <= x + w; tx++) {
      const t = tileAt(s, tx, ty);
      if (t === T.Apron || t === T.Taxiway) apron = true;
    }
    if (!apron) return { ok: false, reason: 'Must touch apron or taxiway (for the baggage trains)', cost: spec.cost };
  }
  if (kind === 'runway' && s.buildings.some((b) => b.kind === 'runway')) return { ok: false, reason: 'One runway is enough for now', cost: spec.cost };
  return { ok: true, cost: spec.cost };
}

export function place(s: GameState, kind: ModuleKind, x: number, y: number, rot: number): Check {
  const c = checkPlace(s, kind, x, y, rot);
  if (!c.ok) return c;
  const { w, h } = footprint(kind, rot);
  // trees are cleared automatically
  s.buildings = s.buildings.filter((o) => o.kind !== 'tree' || o.x < x || o.x >= x + w || o.y < y || o.y >= y + h);
  const b: Building = { id: ++s.nextId, kind, x, y, w, h, rot: rot as Building['rot'] };
  s.buildings.push(b);
  s.cash -= c.cost;
  s.today.construction += c.cost;
  if (kind === 'runway') for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) s.tiles[idx(s, tx, ty)] = T.Runway;
  if (kind.startsWith('stand_')) for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) s.tiles[idx(s, tx, ty)] = T.Apron;
  if (kind === 'carpark') for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) s.tiles[idx(s, tx, ty)] = T.Parking;
  if (kind === 'exit') for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) s.tiles[idx(s, tx, ty)] = T.Floor;
  invalidate();
  linkGates(s);
  return c;
}

export function paintCheck(s: GameState, paint: PaintKind, x: number, y: number): boolean {
  if (!inside(s, x, y)) return false;
  const t = s.tiles[idx(s, x, y)];
  const o = getLayout(s).occ[idx(s, x, y)];
  if (o && getLayout(s).byId.get(o)?.kind !== 'tree') return false;
  if (paint === 'floor') return t === T.Grass;
  if (paint === 'barrier') return t === T.Floor && !o;
  return t === T.Grass || t === T.Apron || t === T.Taxiway;
}

/** Paint a rectangle of tiles; returns tiles painted. */
export function paintRect(s: GameState, paint: PaintKind, x0: number, y0: number, x1: number, y1: number): number {
  const target = paint === 'floor' ? T.Floor : paint === 'taxiway' ? T.Taxiway : paint === 'barrier' ? T.Barrier : T.Apron;
  const cost = PAINTS[paint].costPerTile;
  let n = 0;
  const cleared = new Set<number>();
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
      if (!paintCheck(s, paint, x, y) || s.tiles[idx(s, x, y)] === target || s.cash < cost) continue;
      const o = getLayout(s).occ[idx(s, x, y)];
      if (o) cleared.add(o); // a tree
      s.tiles[idx(s, x, y)] = target;
      s.cash -= cost;
      s.today.construction += cost;
      n++;
    }
  }
  if (cleared.size) s.buildings = s.buildings.filter((b) => !cleared.has(b.id));
  if (n) invalidate();
  return n;
}

export function bulldozeAt(s: GameState, x: number, y: number): string | null {
  if (!inside(s, x, y)) return null;
  const L = getLayout(s);
  let id = L.occ[idx(s, x, y)];
  if (!id && s.tiles[idx(s, x, y)] === T.Runway) id = s.buildings.find((b) => b.kind === 'runway')?.id ?? 0;
  if (id) {
    const b = L.byId.get(id)!;
    if (b.kind.startsWith('stand_') && s.flights.some((f) => f.stand === b.id && f.phase !== 'scheduled' && f.phase !== 'departed' && f.phase !== 'cancelled')) return 'An aircraft is using this stand';
    s.buildings = s.buildings.filter((o) => o.id !== id);
    s.cash += MODULES[b.kind].cost * BULLDOZE_REFUND;
    const revert = b.kind === 'runway' || b.kind.startsWith('stand_') || b.kind === 'carpark';
    if (revert) for (let ty = b.y; ty < b.y + b.h; ty++) for (let tx = b.x; tx < b.x + b.w; tx++) s.tiles[idx(s, tx, ty)] = T.Grass;
    for (const f of s.flights) if (f.stand === b.id && f.phase === 'scheduled') f.stand = null;
    invalidate();
    linkGates(s);
    return `${MODULES[b.kind].name} removed`;
  }
  const t = s.tiles[idx(s, x, y)];
  if (t === T.Barrier) {
    s.tiles[idx(s, x, y)] = T.Floor;
    invalidate();
    return 'Barrier removed';
  }
  if (t === T.Floor || t === T.Taxiway || t === T.Apron) {
    s.tiles[idx(s, x, y)] = T.Grass;
    invalidate();
    return 'Cleared';
  }
  return null;
}

/** Pair each stand with the nearest free gate within reach (greedy, nearest first). */
export function linkGates(s: GameState): void {
  const stands = s.buildings.filter((b) => b.kind.startsWith('stand_'));
  const gates = s.buildings.filter((b) => b.kind === 'gate');
  for (const b of [...stands, ...gates]) delete b.link;
  const pairs: { st: Building; g: Building; d: number }[] = [];
  for (const st of stands) {
    const gs = standPoints(st).gateSide;
    for (const g of gates) {
      const [ax, ay] = accessTile(g);
      const d = Math.hypot(ax + 0.5 - gs[0], ay + 0.5 - gs[1]);
      if (d <= 16) pairs.push({ st, g, d });
    }
  }
  pairs.sort((a, b) => a.d - b.d);
  for (const { st, g } of pairs) {
    if (st.link || g.link) continue;
    st.link = g.id;
    g.link = st.id;
  }
}

/** Walkable for passengers: terminal floor not covered by a module. Arriving passengers may also pass through arrivals exits. */
export function walkable(s: GameState, x: number, y: number, arriving = false): boolean {
  if (tileAt(s, x, y) !== T.Floor) return false;
  const o = getLayout(s).occ[idx(s, x, y)];
  return !o || (arriving && getLayout(s).byId.get(o)?.kind === 'exit');
}

/** Drivable for aircraft. */
export function drivable(s: GameState, x: number, y: number): boolean {
  const t = tileAt(s, x, y);
  return t === T.Apron || t === T.Taxiway || t === T.Runway;
}

export function layoutStamp(): number {
  return layoutVersion;
}
