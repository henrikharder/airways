// A small but complete airport, used by tests and the dev console (airways.demo()).

import { acceptOffer } from './flights';
import { invalidate, paintRect, place } from './grid';
import { createGame } from './newgame';
import type { GameState } from './types';

export function buildDemo(s: GameState): string[] {
  const errors: string[] = [];
  const ok = (r: { ok: boolean; reason?: string }, what: string) => { if (!r.ok) errors.push(`${what}: ${r.reason}`); };
  s.cash = Math.max(s.cash, 50e6);
  s.buildings = s.buildings.filter((b) => b.kind !== 'tree' || b.x > 95 || b.x < 15);
  invalidate();
  ok(place(s, 'runway', 20, 10, 0), 'runway');
  ok(place(s, 'tower', 90, 30, 0), 'tower');
  paintRect(s, 'taxiway', 50, 15, 51, 41);
  paintRect(s, 'taxiway', 28, 40, 74, 41);
  for (const x of [30, 41, 52, 63]) ok(place(s, 'stand_m', x, 42, 0), `stand ${x}`);
  paintRect(s, 'floor', 28, 52, 74, 79);
  for (const x of [33, 44, 55, 66]) ok(place(s, 'gate', x, 52, 0), `gate ${x}`);
  ok(place(s, 'security', 48, 62, 0), 'security');
  ok(place(s, 'security', 52, 62, 0), 'security 2');
  // glass barrier between landside and airside; the lanes and one exit are the only ways through
  paintRect(s, 'barrier', 28, 63, 74, 63);
  ok(place(s, 'exit', 70, 63, 0), 'exit');
  ok(place(s, 'checkin', 40, 72, 0), 'checkin');
  ok(place(s, 'checkin', 56, 72, 0), 'checkin 2');
  ok(place(s, 'entrance', 50, 79, 2), 'entrance');
  ok(place(s, 'food', 62, 58, 0), 'food');
  ok(place(s, 'shop', 36, 58, 0), 'shop');
  ok(place(s, 'toilets', 44, 58, 0), 'toilets');
  ok(place(s, 'baggage', 32, 68, 0), 'baggage');
  for (const x of [58, 60]) ok(place(s, 'seats', x, 66, 0), 'seats');
  ok(place(s, 'carpark', 80, 81, 0), 'car park');
  const sk = ++s.nextId;
  const fr = ++s.nextId;
  s.offers.push(
    { id: sk, airline: 'SK', dest: 'LHR', typeId: 'A20N', perDay: 3, load: 0.8, expires: 9, minRating: 0 },
    { id: fr, airline: 'FR', dest: 'STN', typeId: 'B38M', perDay: 2, load: 0.85, expires: 9, minRating: 0 },
  );
  acceptOffer(s, sk);
  acceptOffer(s, fr);
  return errors;
}

export function demoGame(): GameState {
  const s = createGame({ name: 'Test', code: 'TST', city: 'CPH' });
  const errors = buildDemo(s);
  if (errors.length) throw new Error(errors.join('; '));
  return s;
}
