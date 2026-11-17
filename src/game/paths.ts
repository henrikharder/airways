// Pathfinding. Passengers follow flow fields (one breadth-first distance map
// per destination), so any reachable destination is always found and agents
// can't get stuck on each other's paths. Aircraft use A* over taxiways.

import { accessTile, drivable, idx, inside, layoutStamp, walkable } from './grid';
import type { Building, GameState } from './types';

export const UNREACHABLE = 0x7fff;

interface Field { stamp: number; dist: Int16Array }
const fields = new Map<string, Field>();

/**
 * Distance (in tiles) from every walkable tile to a building's access tile.
 * `arriving` fields may pass through arrivals exits; departing ones may not.
 */
export function fieldFor(s: GameState, b: Building, arriving = false): Int16Array {
  const stamp = layoutStamp();
  const key = `${b.id}:${arriving ? 'a' : 'd'}`;
  const hit = fields.get(key);
  if (hit && hit.stamp === stamp) return hit.dist;
  const dist = new Int16Array(s.W * s.H).fill(UNREACHABLE);
  const [ax, ay] = accessTile(b);
  if (inside(s, ax, ay)) {
    const q = new Int32Array(s.W * s.H);
    let head = 0, tail = 0;
    dist[idx(s, ax, ay)] = 0;
    q[tail++] = idx(s, ax, ay);
    while (head < tail) {
      const i = q[head++];
      const x = i % s.W;
      const y = (i - x) / s.W;
      const d = dist[i] + 1;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (!walkable(s, nx, ny, arriving)) continue;
        const j = idx(s, nx, ny);
        if (dist[j] <= d) continue;
        dist[j] = d;
        q[tail++] = j;
      }
    }
  }
  fields.set(key, { stamp, dist });
  return dist;
}

export function distanceTo(s: GameState, b: Building, x: number, y: number, arriving = false): number {
  if (!inside(s, x, y)) return UNREACHABLE;
  return fieldFor(s, b, arriving)[idx(s, Math.floor(x), Math.floor(y))];
}

/** Next tile centre to walk to, descending the field. Null at the goal or if unreachable. */
export function nextStep(s: GameState, b: Building, x: number, y: number, arriving = false): [number, number] | null {
  const f = fieldFor(s, b, arriving);
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  const here = inside(s, tx, ty) ? f[idx(s, tx, ty)] : UNREACHABLE;
  if (here === 0) return null;
  let best: [number, number] | null = null;
  let bd = here;
  for (const [nx, ny] of [[tx + 1, ty], [tx - 1, ty], [tx, ty + 1], [tx, ty - 1]]) {
    if (!inside(s, nx, ny)) continue;
    const d = f[idx(s, nx, ny)];
    if (d < bd) { bd = d; best = [nx, ny]; }
  }
  return best;
}

/** A* over drivable tiles; returns tile centres from start to goal, or null. */
export function aircraftPath(s: GameState, sx: number, sy: number, gx: number, gy: number): [number, number][] | null {
  const W = s.W;
  const start = idx(s, sx, sy);
  const goal = idx(s, gx, gy);
  if (!inside(s, sx, sy) || !inside(s, gx, gy) || !drivable(s, gx, gy)) return null;
  const g = new Float32Array(W * s.H).fill(Infinity);
  const from = new Int32Array(W * s.H).fill(-1);
  const open: number[] = [start];
  const fscore = new Float32Array(W * s.H).fill(Infinity);
  g[start] = 0;
  fscore[start] = Math.abs(sx - gx) + Math.abs(sy - gy);
  const inOpen = new Uint8Array(W * s.H);
  inOpen[start] = 1;
  let guard = 0;
  while (open.length && guard++ < 60000) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (fscore[open[k]] < fscore[open[bi]]) bi = k;
    const cur = open[bi];
    open.splice(bi, 1);
    inOpen[cur] = 0;
    if (cur === goal) {
      const out: [number, number][] = [];
      for (let c = cur; c !== -1; c = from[c]) out.push([(c % W) + 0.5, Math.floor(c / W) + 0.5]);
      return out.reverse();
    }
    const x = cur % W;
    const y = (cur - x) / W;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (!(nx === sx && ny === sy) && !drivable(s, nx, ny) && !(nx === gx && ny === gy)) continue;
      const j = idx(s, nx, ny);
      // prefer taxiways over cutting across aprons
      const step = s.tiles[j] === 2 ? 1 : 1.6;
      const ng = g[cur] + step;
      if (ng >= g[j]) continue;
      g[j] = ng;
      from[j] = cur;
      fscore[j] = ng + Math.abs(nx - gx) + Math.abs(ny - gy);
      if (!inOpen[j]) { inOpen[j] = 1; open.push(j); }
    }
  }
  return null;
}

/** Collapse straight runs so aircraft move smoothly between corners. */
export function simplify(path: [number, number][]): [number, number][] {
  if (path.length < 3) return path;
  const out: [number, number][] = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const [ax, ay] = out[out.length - 1];
    const [bx, by] = path[i];
    const [cx, cy] = path[i + 1];
    if ((bx - ax) * (cy - by) !== (by - ay) * (cx - bx)) out.push(path[i]);
  }
  out.push(path[path.length - 1]);
  return out;
}
