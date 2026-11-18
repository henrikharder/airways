// Baggage flow. Checked bags are sorted at a baggage hall and carried to the
// aircraft by baggage trains; arriving bags go the other way to the carousels.
// Without a hall a small manual team does it all, slowly. Aircraft wait for
// their bags (up to a limit), so baggage is a real bottleneck as the airport grows.

import { BAGS } from './catalog';
import { getLayout } from './grid';
import { groundFactor } from './staff';
import type { Building, Flight, GameState } from './types';

const rnd = Math.random;

/** Checked bags for one passenger: most check one, some none, a few two. */
export function drawBags(): number {
  const r = rnd();
  return r < 0.3 ? 0 : r < 0.85 ? 1 : 2;
}

export function halls(s: GameState): Building[] {
  return s.buildings.filter((b) => b.kind === 'bagsort');
}

/** Bags per game minute the sorting can handle right now. */
export function sortRate(s: GameState): number {
  const n = halls(s).length;
  return (n ? n * BAGS.hallRate : BAGS.manualRate) * groundFactor(s);
}

/** Nearest hall to a stand, and the train round-trip time to it. */
export function tripMinutes(s: GameState, f: Flight): number {
  const st = f.stand !== null ? getLayout(s).byId.get(f.stand) : undefined;
  const hs = halls(s);
  if (!st || !hs.length) return 2 * 15 / BAGS.trainSpeed + BAGS.handling; // manual carts from the terminal
  const cx = st.x + st.w / 2, cy = st.y + st.h / 2;
  const d = Math.min(...hs.map((h) => Math.abs(h.x + h.w / 2 - cx) + Math.abs(h.y + h.h / 2 - cy)));
  return (2 * d) / BAGS.trainSpeed + BAGS.handling;
}

/** Everything still waiting for this flight's bags. */
export function bagsPending(f: Flight): { load: number; unload: number } {
  return { load: Math.max(0, f.bagsChecked - f.bagsLoaded), unload: Math.max(0, f.bagsIn - f.bagsUnloaded) };
}

export function updateBaggage(s: GameState, dt: number): void {
  const gf = groundFactor(s);
  let sort = sortRate(s) * dt;
  // arriving bags first (their owners are standing at the carousel), oldest arrivals first
  const inbound = s.flights.filter((f) => f.bagsUnloaded > f.bagsDelivered).sort((a, b) => a.arr - b.arr);
  for (const f of inbound) {
    const k = Math.min(sort, f.bagsUnloaded - f.bagsDelivered);
    f.bagsDelivered += k;
    sort -= k;
    if (sort <= 0) break;
  }
  // then departing bags, earliest departure first
  const outbound = s.flights
    .filter((f) => f.bagsChecked > f.bagsSorted && f.phase !== 'departed' && f.phase !== 'cancelled' && f.phase !== 'pushback' && f.phase !== 'taxi_out' && f.phase !== 'lineup' && f.phase !== 'takeoff')
    .sort((a, b) => a.dep - b.dep);
  for (const f of outbound) {
    if (sort <= 0) break;
    const k = Math.min(sort, f.bagsChecked - f.bagsSorted);
    f.bagsSorted += k;
    sort -= k;
  }
  // baggage trains shuttle between the hall and aircraft on stand
  const n = halls(s).length;
  const trains = n ? n * BAGS.trainsPerHall : BAGS.manualTrains;
  const busy = s.flights.filter((f) => f.phase === 'parked' && (f.bagsSorted > f.bagsLoaded || f.bagsIn > f.bagsUnloaded));
  if (!busy.length) return;
  const share = trains / busy.length;
  for (const f of busy) {
    let cap = ((share * BAGS.perTrain) / tripMinutes(s, f)) * gf * dt;
    const u = Math.min(cap, f.bagsIn - f.bagsUnloaded);
    f.bagsUnloaded += u;
    cap -= u;
    f.bagsLoaded += Math.min(cap, Math.max(0, f.bagsSorted - f.bagsLoaded));
  }
}
