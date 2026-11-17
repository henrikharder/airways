// Is the airside actually secure? Departing passengers must only reach the
// gates through a security lane, and arriving passengers must be able to get
// back out through an arrivals exit.

import { MODULES } from './catalog';
import { accessTile, idx, inside, layoutStamp, localPoint, walkable } from './grid';
import type { Building, GameState } from './types';

export interface SecurityReport {
  applies: boolean; // there is a terminal with gates, security and an entrance
  breach: boolean; // a gate can be reached from the entrance without screening
  badLanes: number; // lanes whose airside end is blocked or opens back into the landside
  trapped: boolean; // arriving passengers can't reach an entrance
}

function flood(s: GameState, starts: [number, number][], arriving: boolean): Uint8Array {
  const seen = new Uint8Array(s.W * s.H);
  const q: number[] = [];
  for (const [x, y] of starts) {
    if (!inside(s, x, y) || !walkable(s, x, y, arriving)) continue;
    seen[idx(s, x, y)] = 1;
    q.push(idx(s, x, y));
  }
  while (q.length) {
    const i = q.pop()!;
    const x = i % s.W, y = (i - x) / s.W;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (!walkable(s, nx, ny, arriving) || seen[idx(s, nx, ny)]) continue;
      seen[idx(s, nx, ny)] = 1;
      q.push(idx(s, nx, ny));
    }
  }
  return seen;
}

/** Tile where passengers come out after screening (behind the lane). */
export function laneExit(b: Building): [number, number] {
  const m = MODULES[b.kind];
  const [x, y] = localPoint(b, m.w / 2, -0.4);
  return [Math.floor(x), Math.floor(y)];
}

let cache: { stamp: number; report: SecurityReport } | null = null;

export function securityReport(s: GameState): SecurityReport {
  if (cache && cache.stamp === layoutStamp()) return cache.report;
  const of = (k: Building['kind']) => s.buildings.filter((b) => b.kind === k);
  const gates = of('gate'), entrances = of('entrance'), lanes = of('security');
  const applies = gates.length > 0 && entrances.length > 0 && lanes.length > 0;
  let breach = false, badLanes = 0, trapped = false;
  if (applies) {
    const landside = flood(s, entrances.map(accessTile), false);
    breach = gates.some((g) => { const [x, y] = accessTile(g); return inside(s, x, y) && landside[idx(s, x, y)] === 1; });
    badLanes = lanes.filter((l) => {
      const [x, y] = laneExit(l);
      return !walkable(s, x, y) || (!breach && landside[idx(s, x, y)] === 1);
    }).length;
    const out = flood(s, gates.map(accessTile), true);
    trapped = !entrances.some((e) => { const [x, y] = accessTile(e); return inside(s, x, y) && out[idx(s, x, y)] === 1; });
  }
  const report = { applies, breach, badLanes, trapped };
  cache = { stamp: layoutStamp(), report };
  return report;
}

export const SECURITY_FINE = 40_000;
