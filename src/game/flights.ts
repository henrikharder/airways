// Airlines, contracts, the daily schedule and aircraft movement.

import { acType, econSeatsFor } from '../data/aircraft';
import { AIRLINES } from '../data/airlines';
import { airport, AIRPORT_BY_CODE } from '../data/airports';
import { BAGS, FEES, NIGHT, standClassFor, standFits, turnaroundMin } from './catalog';
import { drivable, getLayout, idx, layoutStamp, runwayLine, standPoints } from './grid';
import { aircraftPath, simplify } from './paths';
import type { Building, Contract, Flight, GameState } from './types';
import { readyAt } from './types';
import { T } from './types';
import { addNews } from './news';
import { CURFEWS, curfewBlocks } from './night';
import { gateAllows } from './border';

const DAY = 1440;
const TAXI = 14; // tiles per game minute
const ROLL = 26;

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <X,>(xs: X[]): X => xs[Math.floor(Math.random() * xs.length)];

export function runway(s: GameState): Building | undefined {
  return s.buildings.find((b) => b.kind === 'runway');
}

export function runways(s: GameState): Building[] {
  return s.buildings.filter((b) => b.kind === 'runway');
}

/** Manhattan distance from a stand to a runway's threshold or far end, whichever is nearer. */
function runwayDistance(rw: Building, st: Building | undefined): number {
  if (!st) return 0;
  const { start, end } = runwayLine(rw);
  const cx = st.x + st.w / 2, cy = st.y + st.h / 2;
  return Math.min(Math.abs(start[0] - cx) + Math.abs(start[1] - cy), Math.abs(end[0] - cx) + Math.abs(end[1] - cy));
}

export function hasTower(s: GameState): boolean {
  return s.buildings.some((b) => b.kind === 'tower');
}

function haversine(a: string, b: string): number {
  const A = airport(a), B = airport(b);
  const r = Math.PI / 180;
  const h = Math.sin(((B.lat - A.lat) * r) / 2) ** 2 + Math.cos(A.lat * r) * Math.cos(B.lat * r) * Math.sin(((B.lon - A.lon) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

// ---------- contracts ----------

/** Network airlines link you to their hubs; low-cost carriers also fly point to point. */
function destinationsOf(code: string): string[] {
  const seed = AIRLINES.find((a) => a.code === code)!;
  const set = new Set<string>(seed.hubs);
  if (seed.style === 'lowcost') for (const r of seed.routes) set.add(r.split('-')[1]);
  return [...set].filter((d) => AIRPORT_BY_CODE[d]);
}

/** New contract offers arrive each morning; better airports attract bigger airlines and aircraft. */
export function generateOffers(s: GameState): void {
  const day = Math.floor(s.minute / DAY);
  s.offers = s.offers.filter((o) => o.expires >= day);
  // happy airlines ask for more flights on routes they already fly: the late game's growth
  for (const c of s.contracts) {
    if (c.night || c.perDay >= 6 || c.happiness < 75 || Math.random() > 0.06) continue;
    if (s.offers.some((o) => o.upgrade === c.id)) continue;
    s.offers.push({ id: ++s.nextId, airline: c.airline, dest: c.dest, typeId: c.typeId, perDay: c.perDay + 1, load: c.load, expires: day + 4, minRating: 0, upgrade: c.id });
  }
  const want = 2 + (s.rating > 60 ? 1 : 0) - Math.floor(s.offers.filter((o) => o.upgrade === undefined).length / 3);
  // most offers fit the stands you already have (or regional/narrowbody ones before you have any)
  const order = ['s', 'm', 'l', 'xl'];
  const biggest = Math.max(1, ...s.buildings.filter((b) => b.kind.startsWith('stand_')).map((b) => order.indexOf(b.kind.slice(6))));
  let made = 0;
  for (let attempt = 0; attempt < want * 15 && made < want; attempt++) {
    const seed = pick(AIRLINES);
    const dests = destinationsOf(seed.code).filter((d) => d !== s.city && haversine(s.city, d) > 250
      && !s.contracts.some((c) => c.airline === seed.code && c.dest === d) && !s.offers.some((o) => o.airline === seed.code && o.dest === d));
    if (!dests.length) continue;
    const dest = pick(dests);
    const km = haversine(s.city, dest);
    const fleet = seed.fleet.filter((t) => acType(t).rangeKm >= km * 1.05);
    if (!fleet.length) continue;
    const stretch = Math.random() < 0.2 ? 1 : 0; // now and then, a reason to build bigger
    const sized = fleet.filter((t) => order.indexOf(standClassFor(t)) <= biggest + stretch && (s.rating >= 55 || standClassFor(t) !== 'xl'));
    if (!sized.length) continue;
    made++;
    const typeId = pick(sized).toString();
    const A = airport(s.city), B = airport(dest);
    const demand = Math.sqrt(A.pop * B.pop) * (A.wealth + B.wealth) * (0.6 + B.tourism * 0.4) / Math.sqrt(Math.max(1, km / 800));
    const perDay = Math.max(1, Math.min(3, Math.round(demand / 4 + rnd(-0.4, 0.4))));
    const cls = standClassFor(typeId);
    const minRating = (cls === 'xl' ? 60 : cls === 'l' ? 45 : 0) + (seed.style === 'premium' ? 10 : 0);
    // without a curfew some airlines want late-night or red-eye slots (one rotation, premium fees)
    const night = s.curfew === 'none' && seed.style !== 'premium' && Math.random() < 0.22;
    s.offers.push({ id: ++s.nextId, airline: seed.code, dest, typeId, perDay: night ? 1 : perDay, load: Math.min(0.95, 0.62 + s.rating / 400 + rnd(0, 0.08)), expires: day + 3, minRating, night });
  }
}

export function acceptOffer(s: GameState, id: number): string | null {
  const o = s.offers.find((x) => x.id === id);
  if (!o) return 'Offer no longer available';
  if (o.upgrade !== undefined) {
    // a happy airline adds a daily flight on a route it already flies
    const c = s.contracts.find((x) => x.id === o.upgrade);
    s.offers = s.offers.filter((x) => x.id !== id);
    if (!c) return 'That airline no longer flies here';
    c.perDay++;
    c.happiness = Math.min(100, c.happiness + 5);
    addNews(s, `${airlineName(c.airline)} now flies ${c.perDay}× daily to ${airport(c.dest).city}.`, 'good');
    return null;
  }
  if (s.rating < o.minRating) return `${airlineName(o.airline)} wants a rating of at least ${o.minRating}`;
  s.offers = s.offers.filter((x) => x.id !== id);
  if (o.night && s.curfew !== 'none') return 'Night flights are banned by your curfew';
  const c: Contract = { id: ++s.nextId, airline: o.airline, dest: o.dest, typeId: o.typeId, perDay: o.perDay, load: o.load, since: Math.floor(s.minute / DAY), happiness: 70, night: o.night };
  s.contracts.push(c);
  scheduleContract(s, c, Math.floor(s.minute / DAY), s.minute + 120);
  addNews(s, `${airlineName(o.airline)} signs up: ${o.night ? 'a nightly red-eye' : `${o.perDay}× daily`} to ${airport(o.dest).city} with the ${acType(o.typeId).name}.`, 'good');
  return null;
}

export function declineOffer(s: GameState, id: number): void {
  s.offers = s.offers.filter((x) => x.id !== id);
}

export function airlineName(code: string): string {
  return AIRLINES.find((a) => a.code === code)?.name ?? code;
}

export function airlineColor(code: string): string {
  return AIRLINES.find((a) => a.code === code)?.color ?? '#888888';
}

// ---------- schedule ----------

function seatsOf(typeId: string): number {
  const t = acType(typeId);
  return t.defaultBiz + econSeatsFor(t, t.defaultBiz);
}

/** Create a contract's flights for one day (only those still in the future). */
export function scheduleContract(s: GameState, c: Contract, day: number, notBefore = 0): void {
  const span = 15 * 60;
  // Each contract keeps the same timetable every day (like a real airline), offset
  // from the others by the golden ratio so departures spread through the day.
  const phase = (c.id * 0.6180339887) % 1;
  for (let k = 0; k < c.perDay; k++) {
    // day rotations 06:30–21:30; night rotations leave between 22:30 and 05:00; a few minutes' daily variation
    const dep = c.night
      ? day * DAY + NIGHT.start + 30 + Math.round(phase * 6.5 * 60 + rnd(-8, 8))
      : day * DAY + 6 * 60 + 30 + Math.round(((k + phase) * span) / c.perDay + rnd(-8, 8));
    let arr = dep - turnaroundMin(c.typeId);
    // airlines plan around a curfew: a day rotation that would land or leave inside it moves to the edge of the window
    if (!c.night && s.curfew !== 'none') {
      const { from, to } = CURFEWS[s.curfew];
      const m = (t: number) => ((t % DAY) + DAY) % DAY;
      if (m(arr) < to) { const shift = to + 5 - m(arr); arr += shift; }
      if (m(arr + turnaroundMin(c.typeId)) >= from) arr -= m(arr + turnaroundMin(c.typeId)) - from + 5;
    }
    const depAt = arr + turnaroundMin(c.typeId);
    if (arr - 15 < notBefore) continue;
    const base = 100 + ((c.id * 37) % 800);
    const seats = seatsOf(c.typeId);
    const f: Flight = {
      id: ++s.nextId, contract: c.id, airline: c.airline, number: `${c.airline}${base + k * 2}`, dest: c.dest, typeId: c.typeId,
      arr, dep: depAt, stand: null, phase: 'scheduled',
      paxOut: Math.round(seats * Math.min(0.97, c.load * rnd(0.88, 1.08))), paxIn: Math.round(seats * Math.min(0.97, c.load * rnd(0.85, 1.05))),
      boarded: 0, deplaned: 0, spawned: 0, missed: 0, delayed: 0, path: [], pathI: 0, x: 0, y: 0, alt: 0, facing: 0, speed: 0, waitUntil: 0,
      bagsChecked: 0, bagsSorted: 0, bagsLoaded: 0, bagsIn: 0, bagsUnloaded: 0, bagsDelivered: 0, bagsLeft: 0, night: !!c.night,
    };
    s.flights.push(f);
  }
  allocateStands(s);
}

/** Stands reachable by taxi from the runway (cached per layout). */
let reachStamp = -1;
let reachable = new Set<number>();
export function reachableStands(s: GameState): Set<number> {
  if (reachStamp === layoutStamp()) return reachable;
  reachStamp = layoutStamp();
  reachable = new Set();
  const rws = runways(s);
  if (!rws.length) return reachable;
  const seen = new Uint8Array(s.W * s.H);
  const q: number[] = [];
  for (const rw of rws) for (let y = rw.y; y < rw.y + rw.h; y++) for (let x = rw.x; x < rw.x + rw.w; x++) { seen[idx(s, x, y)] = 1; q.push(idx(s, x, y)); }
  while (q.length) {
    const i = q.pop()!;
    const x = i % s.W, y = (i - x) / s.W;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (!drivable(s, nx, ny) || seen[idx(s, nx, ny)]) continue;
      seen[idx(s, nx, ny)] = 1;
      q.push(idx(s, nx, ny));
    }
  }
  for (const b of s.buildings) {
    if (!b.kind.startsWith('stand_')) continue;
    const { entry } = standPoints(b);
    if (drivable(s, entry[0], entry[1]) && seen[idx(s, entry[0], entry[1])]) reachable.add(b.id);
  }
  return reachable;
}

/** Give every unassigned future flight a free stand of the right size, preferring stands with a gate. */
export function allocateStands(s: GameState): void {
  const ok = reachableStands(s);
  const stands = s.buildings.filter((b) => b.kind.startsWith('stand_') && ok.has(b.id))
    .sort((a, b) => Number(!!b.link) - Number(!!a.link) || a.w - b.w);
  const busy = (st: number, a: number, d: number, self: number) =>
    s.flights.some((f) => f.id !== self && f.stand === st && f.phase !== 'cancelled' && f.phase !== 'departed' && f.arr - 15 < d && f.dep + 15 > a);
  const L = getLayout(s);
  for (const f of s.flights.filter((x) => x.phase === 'scheduled' && x.stand === null).sort((a, b) => a.arr - b.arr)) {
    // the stand's gate must accept this flight (Schengen / non-Schengen zoning); remote stands take anyone
    const st = stands.find((b) => standFits(b.kind, f.typeId) && gateAllows(s, b.link ? L.byId.get(b.link) : undefined, f) && !busy(b.id, f.arr, f.dep, f.id));
    if (st) f.stand = st.id;
  }
}

export function gateOf(s: GameState, f: Flight): Building | undefined {
  if (f.stand === null) return undefined;
  const L = getLayout(s);
  const st = L.byId.get(f.stand);
  return st?.link ? L.byId.get(st.link) : undefined;
}

// ---------- aircraft motion ----------

// When each runway is next free, per game (a module-level value would leak into the next game).
const runwayFree = new WeakMap<GameState, Map<number, number>>();
const freeMap = (s: GameState) => { let m = runwayFree.get(s); if (!m) { m = new Map(); runwayFree.set(s, m); } return m; };
const freeAt = (s: GameState, rw: Building) => freeMap(s).get(rw.id) ?? 0;
const occupy = (s: GameState, rw: Building, until: number) => freeMap(s).set(rw.id, until);

const GROUND: Flight['phase'][] = ['taxi_in', 'taxi_out', 'pushback', 'lineup', 'parking', 'landing'];
const HALF_LEN: Record<string, number> = { s: 2.6, m: 3.8, l: 6.2, xl: 7.4 };
const holdingSince = new WeakMap<Flight, number>();

/**
 * Hold short if another aircraft on the ground sits ahead on our path. After a
 * few minutes of waiting we go anyway, so a head-on standoff can't jam the airport.
 */
export function held(s: GameState, f: Flight, now: number): boolean {
  const next = f.path[f.pathI];
  if (!next) return false;
  const dx = next[0] - f.x, dy = next[1] - f.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return false;
  const ux = dx / d, uy = dy / d;
  const mine = HALF_LEN[standClassFor(f.typeId)];
  for (const o of s.flights) {
    if (o === f || !GROUND.includes(o.phase) || o.alt > 0.2) continue;
    const ox = o.x - f.x, oy = o.y - f.y;
    const ahead = ox * ux + oy * uy;
    const side = Math.abs(ox * uy - oy * ux);
    if (ahead > 0 && ahead < mine + HALF_LEN[standClassFor(o.typeId)] + 1.5 && side < 2.2) {
      const since = holdingSince.get(f) ?? now;
      holdingSince.set(f, since);
      if (now - since < 4) return true;
    }
  }
  holdingSince.delete(f);
  return false;
}

/** Roll out to the first taxiway leaving the runway after 35% of its length (else 62%). */
function exitFraction(s: GameState, rw: Building): number {
  const along = rw.rot % 2 === 0;
  const len = along ? rw.w : rw.h;
  for (let a = Math.floor(len * 0.35); a < len - 2; a++) {
    // the tiles just beyond either long edge of the runway at this point
    const sides: [number, number][] = along ? [[rw.x + a, rw.y - 1], [rw.x + a, rw.y + rw.h]] : [[rw.x - 1, rw.y + a], [rw.x + rw.w, rw.y + a]];
    if (sides.some(([x, y]) => x >= 0 && y >= 0 && x < s.W && y < s.H && s.tiles[idx(s, x, y)] === T.Taxiway)) {
      return Math.max(0, Math.min(1, (a + 0.5 - 1.5) / (len - 3)));
    }
  }
  return 0.62;
}

function moveAlong(f: Flight, speed: number, dt: number): boolean {
  let left = speed * dt;
  while (left > 0 && f.pathI < f.path.length) {
    const [tx, ty] = f.path[f.pathI];
    const dx = tx - f.x, dy = ty - f.y;
    const d = Math.hypot(dx, dy);
    if (d > 1e-6) {
      if (Math.abs(dx) > Math.abs(dy)) f.facing = dx > 0 ? 0 : 2;
      else f.facing = dy > 0 ? 1 : 3;
    }
    if (d <= left) { f.x = tx; f.y = ty; left -= d; f.pathI++; }
    else { f.x += (dx / d) * left; f.y += (dy / d) * left; left = 0; }
  }
  return f.pathI >= f.path.length;
}

function cancel(s: GameState, f: Flight, why: string): void {
  f.phase = 'cancelled';
  const c = s.contracts.find((x) => x.id === f.contract);
  if (c) c.happiness = Math.max(0, c.happiness - 12);
  addNews(s, `${f.number} to ${airport(f.dest).city} cancelled: ${why}.`, 'bad');
}

function facingTo(dx: number, dy: number): 0 | 1 | 2 | 3 {
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 0 : 2) : dy > 0 ? 1 : 3;
}

/** Advance one aircraft by dt game minutes. */
export function updateFlight(s: GameState, f: Flight, dt: number, onDepart: (f: Flight) => void, onLand: (f: Flight) => void): void {
  const now = s.minute;
  const rws = runways(s);
  const rw = (f.rwy !== undefined ? rws.find((r) => r.id === f.rwy) : undefined) ?? rws[0];
  const L = getLayout(s);
  switch (f.phase) {
    case 'scheduled': {
      if (now < f.arr - 14) return;
      if (!rw || !hasTower(s)) return cancel(s, f, rw ? 'no control tower' : 'no runway');
      if (curfewBlocks(s, f.arr) || curfewBlocks(s, f.dep)) return cancel(s, f, 'airport curfew');
      if (f.stand === null) allocateStands(s);
      if (f.stand === null) {
        if (now > f.arr + 60) cancel(s, f, 'no free stand');
        return;
      }
      // land on the runway that frees up first; on a tie, the one nearer the stand
      const stand = L.byId.get(f.stand);
      const pick = [...rws].sort((a, b) => freeAt(s, a) - freeAt(s, b) || runwayDistance(a, stand) - runwayDistance(b, stand))[0];
      if (now < freeAt(s, pick) - 6) return; // hold until a runway is nearly free
      f.rwy = pick.id;
      const { start, axis } = runwayLine(pick);
      const dir: [number, number] = axis === 'x' ? [1, 0] : [0, 1];
      f.x = start[0] - dir[0] * 40;
      f.y = start[1] - dir[1] * 40;
      f.alt = 9;
      f.facing = axis === 'x' ? 0 : 1;
      f.path = [[start[0] + dir[0] * 4, start[1] + dir[1] * 4]];
      f.pathI = 0;
      f.phase = 'approach';
      return;
    }
    case 'approach': {
      const total = 44;
      const done = moveAlong(f, 18, dt);
      const [tx, ty] = f.path[0];
      f.alt = Math.max(0, (9 * Math.hypot(tx - f.x, ty - f.y)) / total);
      if (done) {
        occupy(s, rw!, now + 3);
        const { start, end } = runwayLine(rw!);
        const k = exitFraction(s, rw!);
        f.path = [[start[0] + (end[0] - start[0]) * k, start[1] + (end[1] - start[1]) * k]];
        f.pathI = 0;
        f.alt = 0;
        f.phase = 'landing';
        onLand(f);
      }
      return;
    }
    case 'landing': {
      if (moveAlong(f, ROLL * 0.7, dt)) {
        const st = L.byId.get(f.stand!);
        const p = st && aircraftPath(s, Math.floor(f.x), Math.floor(f.y), standPoints(st).entry[0], standPoints(st).entry[1]);
        if (!st || !p) return cancel(s, f, 'no taxi route to the stand');
        f.path = simplify(p);
        f.pathI = 0;
        f.phase = 'taxi_in';
      }
      return;
    }
    case 'taxi_in': {
      if (held(s, f, now)) return;
      if (moveAlong(f, TAXI, dt)) {
        const st = L.byId.get(f.stand!)!;
        f.path = [standPoints(st).park];
        f.pathI = 0;
        f.phase = 'parking';
      }
      return;
    }
    case 'parking': {
      if (moveAlong(f, TAXI * 0.4, dt)) {
        const st = L.byId.get(f.stand!)!;
        const front: [number, number][] = [[0, 1], [-1, 0], [0, -1], [1, 0]];
        f.facing = facingTo(...front[st.rot]);
        f.phase = 'parked';
        f.waitUntil = now;
        f.onStand = now;
      }
      return;
    }
    case 'parked': {
      const boardingDone = f.boarded + f.missed >= f.paxOut;
      const bagsDone = f.bagsLoaded >= f.bagsChecked - 0.5 && f.bagsUnloaded >= f.bagsIn - 0.5;
      const ready = readyAt(f);
      if (now >= ready && now >= f.waitUntil && ((boardingDone && bagsDone) || now >= ready + BAGS.maxWait)) {
        f.delayed = Math.max(0, Math.round(now - f.dep));
        if (!bagsDone) f.bagsLeft = Math.round(Math.max(0, f.bagsChecked - f.bagsLoaded));
        const st = L.byId.get(f.stand!)!;
        f.path = [[standPoints(st).entry[0] + 0.5, standPoints(st).entry[1] + 0.5]];
        f.pathI = 0;
        f.phase = 'pushback';
      }
      return;
    }
    case 'pushback': {
      const keep = f.facing;
      const done = moveAlong(f, TAXI * 0.25, dt);
      f.facing = keep; // backwards
      if (done) {
        // take off from the runway nearest the stand
        const dep = [...rws].sort((a, b) => runwayDistance(a, L.byId.get(f.stand!)) - runwayDistance(b, L.byId.get(f.stand!)))[0];
        f.rwy = dep.id;
        const { start } = runwayLine(dep);
        const p = aircraftPath(s, Math.floor(f.x), Math.floor(f.y), Math.floor(start[0]), Math.floor(start[1]));
        if (!p) { f.phase = 'departed'; return; }
        f.path = simplify(p);
        f.pathI = 0;
        f.phase = 'taxi_out';
      }
      return;
    }
    case 'taxi_out': {
      if (held(s, f, now)) return;
      if (moveAlong(f, TAXI, dt)) f.phase = 'lineup';
      return;
    }
    case 'lineup': {
      if (now < freeAt(s, rw!)) return;
      occupy(s, rw!, now + 3);
      const { end, axis } = runwayLine(rw!);
      const dir: [number, number] = axis === 'x' ? [1, 0] : [0, 1];
      f.facing = axis === 'x' ? 0 : 1;
      f.path = [end, [end[0] + dir[0] * 40, end[1] + dir[1] * 40]];
      f.pathI = 0;
      f.speed = 4;
      f.phase = 'takeoff';
      return;
    }
    case 'takeoff': {
      f.speed = Math.min(ROLL * 1.4, f.speed + 30 * dt);
      const before = f.pathI;
      moveAlong(f, f.speed, dt);
      if (f.pathI >= 1) f.alt += f.speed * dt * 0.22;
      if (before === 0 && f.pathI === 1) f.alt = 0.1;
      if (f.pathI >= f.path.length || f.alt > 10) {
        f.phase = 'departed';
        onDepart(f);
      }
      return;
    }
    default:
  }
}

export function landingFee(typeId: string): number {
  return acType(typeId).mtowT * FEES.landingPerTonne;
}
