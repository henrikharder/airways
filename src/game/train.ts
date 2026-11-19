// People mover. Stations on the same side of security form a line, west to
// east; a passenger at one station's platform door can ride to the next. To the
// walking maps a ride is a shortcut costing the tiles they could have walked in
// the same time, so passengers take the train exactly when it is quicker.

import { accessTile, idx, inside, layoutStamp } from './grid';
import { landsideMask } from './security';
import type { Building, GameState } from './types';

export const TRAIN = { speed: 40, board: 1.5 }; // tiles per game minute; minutes waiting and boarding
const WALK = 4.2; // passenger walking speed, tiles per game minute (see passengers.ts)

export interface Ride { to: number; cost: number; minutes: number } // to: tile index of the next platform door

let cache: { stamp: number; links: Map<number, Ride[]>; stations: Building[] } | null = null;

export function trainNetwork(s: GameState): { links: Map<number, Ride[]>; stations: Building[] } {
  if (cache && cache.stamp === layoutStamp()) return cache;
  const links = new Map<number, Ride[]>();
  const all = s.buildings.filter((b) => b.kind === 'station').sort((a, b) => a.x - b.x || a.y - b.y);
  const land = landsideMask(s);
  // one line per side of security, so the train never bypasses screening
  for (const side of [0, 1]) {
    const line = all.filter((b) => { const [x, y] = accessTile(b); return inside(s, x, y) && (land[idx(s, x, y)] === 1 ? 1 : 0) === side; });
    for (let k = 0; k + 1 < line.length; k++) {
      const [ax, ay] = accessTile(line[k]), [bx, by] = accessTile(line[k + 1]);
      const minutes = (Math.abs(ax - bx) + Math.abs(ay - by)) / TRAIN.speed + TRAIN.board;
      const cost = Math.ceil(minutes * WALK);
      const a = idx(s, ax, ay), b = idx(s, bx, by);
      (links.get(a) ?? links.set(a, []).get(a)!).push({ to: b, cost, minutes });
      (links.get(b) ?? links.set(b, []).get(b)!).push({ to: a, cost, minutes });
    }
  }
  cache = { stamp: layoutStamp(), links, stations: all };
  return cache;
}
