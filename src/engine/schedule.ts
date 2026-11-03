// Turns weekly frequencies into concrete daily flights so the map, flight
// cards and departure boards all agree on where every aircraft is.
//
// Each aircraft flies its assignments back-to-back, in whole round trips,
// starting from its own daily offset (`phase`). A route flown 4×/week is
// spread over the week: some days it flies, some days it doesn't.

import { acType } from '../data/aircraft';
import { distance } from './geo';
import { blockMinutes } from './model';
import type { Aircraft, Route } from './types';

export interface Leg {
  ac: Aircraft;
  route: Route;
  outbound: boolean; // from → to
  dep: number; // absolute game minute
  arr: number;
  trip: number; // index of the round trip that day (for stable flight numbers)
}

/** Round trips flown on a given day so that a week adds up to `weekly`. */
function tripsOnDay(weekly: number, day: number, salt: number): number {
  const d = (((day + salt * 3) % 7) + 7) % 7;
  return Math.floor(((d + 1) * weekly) / 7) - Math.floor((d * weekly) / 7);
}

/** All legs an aircraft flies on its local day `D` (local day starts at phase offset). */
export function legsOnDay(ac: Aircraft, routes: Map<string, Route>, D: number): Leg[] {
  const out: Leg[] = [];
  const offset = ac.phase * 1440;
  let start = 0;
  ac.assignments.forEach((a, i) => {
    const r = routes.get(a.routeId);
    if (!r) return;
    const block = blockMinutes(acType(ac.typeId), distance(r.from, r.to));
    const turn = (a.cycle - 2 * block) / 2;
    const n = tripsOnDay(a.weekly, D, i);
    for (let k = 0; k < n; k++) {
      const t0 = D * 1440 + start + k * a.cycle - offset;
      out.push({ ac, route: r, outbound: true, dep: t0, arr: t0 + block, trip: k * 2 });
      out.push({ ac, route: r, outbound: false, dep: t0 + block + turn, arr: t0 + 2 * block + turn, trip: k * 2 + 1 });
    }
    start += n * a.cycle;
  });
  return out;
}

/** The leg an aircraft is flying at `minute`, with progress 0..1, or null if on the ground. */
export function currentLeg(ac: Aircraft, routes: Map<string, Route>, minute: number): { leg: Leg; p: number } | null {
  if (!ac.assignments.length) return null;
  const D = Math.floor((minute + ac.phase * 1440) / 1440);
  // A long leg can start the previous local day and still be in the air.
  for (const day of [D, D - 1]) {
    for (const leg of legsOnDay(ac, routes, day)) {
      if (minute >= leg.dep && minute < leg.arr) return { leg, p: (minute - leg.dep) / (leg.arr - leg.dep) };
    }
  }
  return null;
}

/** Stable, realistic-looking flight number for a leg. */
export function flightNumber(leg: Pick<Leg, 'route' | 'outbound' | 'trip'>): string {
  let h = 0;
  for (const c of leg.route.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const base = 100 + (h % 400) * 2;
  return `${leg.route.owner}${base + leg.trip * 2 + (leg.outbound ? 0 : 1)}`;
}

export function gateFor(leg: Pick<Leg, 'route' | 'outbound'>): string {
  let h = 7;
  for (const c of leg.route.id + (leg.outbound ? 'o' : 'i')) h = (h * 33 + c.charCodeAt(0)) >>> 0;
  return `${'ABCDEF'[h % 6]}${1 + ((h >> 3) % 40)}`;
}
