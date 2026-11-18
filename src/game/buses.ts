// Remote stands. A stand with no gate within reach is a remote stand: its
// passengers wait at a bus gate and ride apron buses to and from the aircraft.
// Bus boarding is slower than a jet bridge and passengers like it less, but
// remote stands can go anywhere on the apron.

import { BUSES } from './catalog';
import { getLayout } from './grid';
import { groundFactor } from './staff';
import type { Building, Flight, GameState } from './types';
import { readyAt } from './types';

export function isRemote(s: GameState, f: Flight): boolean {
  if (f.stand === null) return false;
  return !getLayout(s).byId.get(f.stand)?.link;
}

export function busGates(s: GameState): Building[] {
  return s.buildings.filter((b) => b.kind === 'busgate');
}

/** Buses in service: two per bus gate, or one improvised bus without any. */
export function busCount(s: GameState): number {
  const n = busGates(s).length;
  return n ? n * BUSES.perGate : 1;
}

/** Minutes for one bus round trip between the nearest (bus) gate and the stand. */
export function busTrip(s: GameState, f: Flight): number {
  const st = f.stand !== null ? getLayout(s).byId.get(f.stand) : undefined;
  const from = busGates(s).length ? busGates(s) : s.buildings.filter((b) => b.kind === 'gate');
  if (!st || !from.length) return 2 * 20 / BUSES.speed + BUSES.handling;
  const cx = st.x + st.w / 2, cy = st.y + st.h / 2;
  const d = Math.min(...from.map((g) => Math.abs(g.x + g.w / 2 - cx) + Math.abs(g.y + g.h / 2 - cy)));
  return (2 * d) / BUSES.speed + BUSES.handling;
}

/** Remote flights currently boarding or deplaning share the buses. */
function busyRemote(s: GameState): Flight[] {
  return s.flights.filter((f) => f.phase === 'parked' && isRemote(s, f) && (f.deplaned < f.paxIn || s.minute >= readyAt(f) - 35));
}

/** Passengers per game minute the buses can move for this flight. */
export function busRate(s: GameState, f: Flight): number {
  const n = Math.max(1, busyRemote(s).length);
  return ((busCount(s) / n) * BUSES.seats / busTrip(s, f)) * groundFactor(s);
}

// Seats on buses currently at the gate, per flight (transient; refills each step).
const seats = new Map<number, number>();

/** Each step: buses bring seats to the bus gates of flights that are boarding. */
export function runBuses(s: GameState, dt: number): void {
  for (const f of busyRemote(s)) {
    if (s.minute < readyAt(f) - 35) continue;
    seats.set(f.id, Math.min(BUSES.seats * 2, (seats.get(f.id) ?? 0) + busRate(s, f) * dt));
  }
}

/** A passenger at the bus gate takes a seat if a bus is there; false means keep waiting. */
export function takeSeat(f: Flight): boolean {
  const n = seats.get(f.id) ?? 0;
  if (n < 1) return false;
  seats.set(f.id, n - 1);
  return true;
}
