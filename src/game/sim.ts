// Main simulation step: time, flights, passengers, money and the daily cycle.

import { FEES, MODULES } from './catalog';
import { weeklyMeeting } from './board';
import { airlineName, allocateStands, generateOffers, landingFee, scheduleContract, updateFlight } from './flights';
import { addNews } from './news';
import { spawnPax, updatePax } from './passengers';
import type { Flight, GameState, Ledger, Pax } from './types';
import { emptyLedger, T } from './types';

const DAY = 1440;
const STEP = 0.5; // game minutes per sub-step

export function upkeepPerDay(s: GameState): number {
  let n = 0;
  for (const b of s.buildings) n += MODULES[b.kind].upkeep;
  for (const t of s.tiles) n += t === T.Floor ? 6 : t === T.Taxiway ? 2 : t === T.Apron ? 1 : 0;
  return n;
}

function add(into: Ledger, key: keyof Ledger, v: number): void {
  into[key] += v;
}

function book(s: GameState, key: keyof Ledger, v: number): void {
  add(s.today, key, v);
  add(s.board.week, key, v);
}

export function advance(s: GameState, minutes: number): void {
  let left = minutes;
  while (left > 1e-9 && !s.gameOver) {
    const dt = Math.min(STEP, left);
    step(s, dt);
    left -= dt;
  }
}

function step(s: GameState, dt: number): void {
  const before = Math.floor(s.minute / DAY);
  s.minute += dt;
  const day = Math.floor(s.minute / DAY);
  if (day !== before) newDay(s, day);

  const up = (upkeepPerDay(s) * dt) / DAY;
  s.cash -= up;
  book(s, 'upkeep', up);

  const flights = new Map(s.flights.map((f) => [f.id, f]));
  for (const f of s.flights) {
    spawnPax(s, f, dt);
    updateFlight(s, f, dt, (x) => departed(s, x), () => {});
  }
  updatePax(s, dt, flights, (p) => paxDone(s, p));

  // forget old flights
  if (Math.random() < 0.01) s.flights = s.flights.filter((f) => !((f.phase === 'departed' || f.phase === 'cancelled') && f.dep < s.minute - 6 * 60));
}

function departed(s: GameState, f: Flight): void {
  const fee = landingFee(f.typeId);
  const pf = f.boarded * FEES.perDepartingPax;
  s.cash += fee + pf;
  book(s, 'landing', fee);
  book(s, 'paxFees', pf);
  book(s, 'departures', 1);
  book(s, 'passengers', f.boarded + f.paxIn);
  const c = s.contracts.find((x) => x.id === f.contract);
  if (c) {
    const missRate = f.paxOut ? f.missed / f.paxOut : 0;
    c.happiness = Math.max(0, Math.min(100, c.happiness + (f.delayed > 15 ? -4 : 1.5) - missRate * 20));
  }
  if (f.delayed > 30) addNews(s, `${f.number} left ${f.delayed} minutes late. ${airlineName(f.airline)} is not amused.`, 'bad');
}

function paxDone(s: GameState, p: Pax): void {
  s.rating += (p.mood - s.rating) * 0.004;
}

function newDay(s: GameState, day: number): void {
  s.history.push({ ...s.today, day: day - 1 });
  if (s.history.length > 60) s.history.shift();
  s.today = emptyLedger();
  // airlines walk away when unhappy
  for (const c of [...s.contracts]) {
    if (c.happiness < 15) {
      s.contracts = s.contracts.filter((x) => x !== c);
      s.flights = s.flights.filter((f) => !(f.contract === c.id && f.phase === 'scheduled'));
      addNews(s, `${airlineName(c.airline)} pulls out after too many delays and unhappy passengers.`, 'bad');
    }
  }
  for (const c of s.contracts) scheduleContract(s, c, day);
  s.scheduledDay = day;
  allocateStands(s);
  generateOffers(s);
  if (day % 7 === 0) weeklyMeeting(s);
  if (s.cash < -3_000_000) {
    s.gameOver = true;
    addNews(s, 'The airport has run out of money. The bank takes over.', 'bad');
  }
}

export { DAY };
