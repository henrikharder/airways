// Terminals: each connected area of terminal floor is a terminal (T1, T2, …,
// numbered from west to east). Gates are named after their terminal's letter:
// A1, A2 in T1; B1, B2 in T2.

import { getLayout, idx, layoutStamp } from './grid';
import type { Building, GameState } from './types';
import { T } from './types';

export interface Terminal { n: number; x0: number; y0: number; x1: number; y1: number; tiles: number }

let cache: { stamp: number; ids: Int16Array; list: Terminal[] } | null = null;

export function terminals(s: GameState): { ids: Int16Array; list: Terminal[] } {
  if (cache && cache.stamp === layoutStamp()) return cache;
  const ids = new Int16Array(s.W * s.H).fill(-1);
  const found: Terminal[] = [];
  const indoor = (i: number) => s.tiles[i] === T.Floor || s.tiles[i] === T.Barrier;
  for (let i = 0; i < ids.length; i++) {
    if (ids[i] !== -1 || !indoor(i)) continue;
    const t: Terminal = { n: found.length, x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, tiles: 0 };
    const q = [i];
    ids[i] = t.n;
    while (q.length) {
      const j = q.pop()!;
      const x = j % s.W, y = (j - x) / s.W;
      t.x0 = Math.min(t.x0, x); t.y0 = Math.min(t.y0, y); t.x1 = Math.max(t.x1, x); t.y1 = Math.max(t.y1, y); t.tiles++;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= s.W || ny >= s.H) continue;
        const k = idx(s, nx, ny);
        if (ids[k] === -1 && indoor(k)) { ids[k] = t.n; q.push(k); }
      }
    }
    found.push(t);
  }
  // number from west to east, ignoring specks
  const real = found.filter((t) => t.tiles >= 12).sort((a, b) => a.x0 - b.x0 || a.y0 - b.y0);
  const renumber = new Map(real.map((t, k) => [t.n, k]));
  for (let i = 0; i < ids.length; i++) ids[i] = ids[i] === -1 ? -1 : renumber.get(ids[i]) ?? -1;
  real.forEach((t, k) => { t.n = k; });
  cache = { stamp: layoutStamp(), ids, list: real };
  return cache;
}

/** Terminal number (0-based) a building stands in, or -1. */
export function terminalOf(s: GameState, b: Building): number {
  return terminals(s).ids[idx(s, b.x, b.y)] ?? -1;
}

/** Gate name: terminal letter plus its number in that terminal, west to east. */
export function gateName(s: GameState, id: number | undefined): string {
  if (!id) return '';
  const g = getLayout(s).byId.get(id);
  if (!g || g.kind !== 'gate') return '';
  const n = terminalOf(s, g);
  const peers = s.buildings.filter((b) => b.kind === 'gate' && terminalOf(s, b) === n).sort((a, b) => a.x - b.x || a.y - b.y);
  return `${String.fromCharCode(65 + Math.max(0, n))}${peers.indexOf(g) + 1}`;
}
