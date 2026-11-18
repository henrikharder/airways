// Hub play. Once there is a transfer desk, some arriving passengers connect to
// a later departure instead of leaving: network airlines connect more, and
// more the more destinations the airport serves. Premium travellers use
// lounges if there is one with room.

import { AIRLINES } from '../data/airlines';
import { acType, econSeatsFor } from '../data/aircraft';
import type { Flight, GameState } from './types';

const styleOf = (code: string) => AIRLINES.find((a) => a.code === code)?.style ?? 'legacy';

export function hasTransferDesk(s: GameState): boolean {
  return s.buildings.some((b) => b.kind === 'transfer');
}

/** How much of a hub the airport is: the connecting share for network airlines, 0–25%. */
export function hubShare(s: GameState): number {
  const dests = new Set(s.contracts.map((c) => c.dest)).size;
  return Math.max(0, Math.min(0.25, 0.025 * (dests - 3)));
}

/** Share of an arriving flight's passengers who connect onward. */
export function transferShare(s: GameState, f: Flight): number {
  if (!hasTransferDesk(s)) return 0;
  return hubShare(s) * (styleOf(f.airline) === 'lowcost' ? 0.3 : 1);
}

/** Share of a flight's passengers travelling premium (business class, frequent flyers). */
export function premiumShare(airline: string): number {
  const st = styleOf(airline);
  return st === 'premium' ? 0.18 : st === 'lowcost' ? 0.03 : 0.1;
}

function seats(f: Flight): number {
  const t = acType(f.typeId);
  return t.defaultBiz + econSeatsFor(t, t.defaultBiz);
}

/** A departure 50–240 minutes from now with a free seat, same airline preferred. */
export function pickConnection(s: GameState, from: Flight): Flight | undefined {
  const now = s.minute;
  const ok = s.flights.filter((f) => (f.phase === 'scheduled' || f.phase === 'approach' || f.phase === 'landing' || f.phase === 'taxi_in' || f.phase === 'parking' || f.phase === 'parked')
    && f.dep - now >= 50 && f.dep - now <= 240 && f.dest !== from.dest && f.paxOut < seats(f));
  if (!ok.length) return undefined;
  const same = ok.filter((f) => f.airline === from.airline);
  const pool = same.length && Math.random() < 0.7 ? same : ok;
  return pool[Math.floor(Math.random() * pool.length)];
}
