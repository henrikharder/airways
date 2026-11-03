// Daily simulation: builds every airline's seat offers, splits passenger demand
// between them, routes connecting passengers through hubs, then books revenue
// and costs.

import { acType } from '../data/aircraft';
import { airport } from '../data/airports';
import { aiMonthly, aiWeekly } from './ai';
import { checkAchievements } from './achievements';
import { boardTick } from './board';
import { maybeSpawnDecision } from './decisions';
import { maybeWriteReviews } from './reviews';
import { tickEvents } from './events';
import { distance, pairKey } from './geo';
import { refreshUsedMarket } from './market';
import {
  baseDemand, brandFactor, cateringPerPax, flightCosts, freqFactor, MARKET_ELASTICITY, OUTSIDE_OPTION,
  HQ_PER_AIRCRAFT, OVERHEAD_SHARE, paxCharges, PRICE_SENS, qualityFactor, refFareJ, refFareY,
} from './model';
import { addNews, flyingByRoute, player, refreshBookValue, type Flying } from './state';
import { formatDate, isFirstOfMonth, monthLabel } from './time';
import type { Aircraft, Airline, GameState, Ledger, Route, ServiceLevel } from './types';
import { emptyLedger, emptyStats, totalCost } from './types';

type Cls = 'y' | 'j';

// Low-cost carriers run leaner crews and back offices.
const LOWCOST_CREW = 0.7;
const LOWCOST_OVERHEAD = 0.6;

export interface Offer {
  route: Route;
  airline: Airline;
  seats: Record<Cls, number>; // per direction per day
  fare: Record<Cls, number>;
  ref: Record<Cls, number>;
  freq: number; // departures per direction per day
  dist: number;
  quality: number;
  brand: number;
  pax: Record<Cls, number>;
  tPax: Record<Cls, number>;
  tRev: number; // transfer revenue per direction
}

export interface DayContext {
  day: number;
  fuelPrice: number;
  closed: Set<string>;
  exempt: Map<string, Set<string>>; // airport → airlines still flying through its closure
  airportMult: Map<string, number>;
  regionMult: Map<string, number>;
  sale: Set<string>;
}

export function buildContext(s: GameState, day = s.day): DayContext {
  const ctx: DayContext = { day, fuelPrice: s.fuelPrice, closed: new Set(), exempt: new Map(), airportMult: new Map(), regionMult: new Map(), sale: new Set() };
  for (const e of s.events) {
    if (e.fuelMult) ctx.fuelPrice *= e.fuelMult;
    if (e.closed) {
      e.airports?.forEach((a) => {
        ctx.closed.add(a);
        if (e.exempt?.length) ctx.exempt.set(a, new Set([...(ctx.exempt.get(a) ?? []), ...e.exempt]));
      });
    }
    if (e.demandMult) {
      e.airports?.forEach((a) => ctx.airportMult.set(a, (ctx.airportMult.get(a) ?? 1) * e.demandMult!));
      if (e.region) ctx.regionMult.set(e.region, (ctx.regionMult.get(e.region) ?? 1) * e.demandMult);
    }
    if (e.airline) ctx.sale.add(e.airline);
  }
  return ctx;
}

export function isClosedFor(ctx: DayContext, code: string, airline: string): boolean {
  return ctx.closed.has(code) && !ctx.exempt.get(code)?.has(airline);
}

export function demandMult(ctx: DayContext, a: string, b: string): number {
  const A = airport(a);
  const B = airport(b);
  let m = (ctx.airportMult.get(a) ?? 1) * (ctx.airportMult.get(b) ?? 1);
  m *= ctx.regionMult.get(A.region) ?? 1;
  if (B.region !== A.region) m *= ctx.regionMult.get(B.region) ?? 1;
  return m;
}

export function awarenessOf(airline: Airline, a: string, b: string): number {
  if (!airline.isPlayer) return airline.bases.includes(a) || airline.bases.includes(b) ? 1 : 0.85;
  return ((airline.awareness[a] ?? 0) + (airline.awareness[b] ?? 0)) / 2;
}

export function effectiveFare(route: Route, ctx: DayContext, cls: Cls): number {
  let f = cls === 'y' ? route.fareY : route.fareJ;
  if (route.warUntil > ctx.day) f *= 0.85;
  if (ctx.sale.has(route.owner)) f *= 0.85;
  return f;
}

export function buildOffer(route: Route, airline: Airline, flying: Flying[], ctx: DayContext): Offer {
  const d = distance(route.from, route.to);
  let sy = 0, sj = 0, freq = 0, comfortW = 0, seatW = 0;
  for (const { ac, weekly } of flying) {
    const t = acType(ac.typeId);
    const rot = weekly / 7;
    sy += rot * ac.econ;
    sj += rot * ac.biz;
    freq += rot;
    comfortW += t.comfort * (ac.biz + ac.econ) * rot;
    seatW += (ac.biz + ac.econ) * rot;
  }
  const comfort = seatW ? comfortW / seatW : 3;
  return {
    route, airline,
    seats: { y: sy, j: sj },
    fare: { y: effectiveFare(route, ctx, 'y'), j: effectiveFare(route, ctx, 'j') },
    ref: { y: refFareY(d), j: refFareJ(d) },
    freq,
    dist: d,
    quality: qualityFactor(comfort, airline.service as ServiceLevel),
    brand: brandFactor(airline.reputation, awarenessOf(airline, route.from, route.to)),
    pax: { y: 0, j: 0 },
    tPax: { y: 0, j: 0 },
    tRev: 0,
  };
}

function score(o: Offer, cls: Cls): number {
  if (o.seats[cls] <= 0 || o.fare[cls] <= 0) return 0;
  return (o.ref[cls] / o.fare[cls]) ** PRICE_SENS[cls] * freqFactor(o.freq, o.dist) * o.quality * o.brand;
}

/** Stand-in for the many real carriers not modelled as AI (JetBlue, El Al, Vueling…). */
export const OTHERS: Airline = {
  code: '··', name: 'Other airlines', color: '#7a8699', isPlayer: false, style: 'legacy', bases: [], cash: 0,
  reputation: 65, baseReputation: 65, lifetimePax: 0, awareness: {}, service: 1, marketingPerMonth: 0, aggression: 0,
  fleetTypes: [], loans: [], today: emptyLedger(), recent: [], month: emptyLedger(), history: [], fareWarUntil: 0,
};
const OTHERS_SHARE = 0.5; // of the demand modelled airlines leave unserved
const OTHERS_SEATS_PER_FLIGHT = 160;

/** Add an "other airlines" offer covering part of the demand the modelled airlines don't serve. */
export function withOthers(list: Offer[], from: string, to: string, ctx: DayContext): Offer[] {
  const base = baseDemand(from, to);
  const mult = demandMult(ctx, from, to);
  const aiSeats = list.reduce((n, o) => n + (o.airline.isPlayer ? 0 : o.seats.y + o.seats.j), 0);
  const cap = (base.total * mult - aiSeats) * OTHERS_SHARE;
  if (cap < 20) return list;
  const d = distance(from, to);
  const ref = { y: refFareY(d), j: refFareJ(d) };
  const route = { id: '_others', owner: OTHERS.code, from, to, fareY: ref.y, fareJ: ref.j, openedDay: 0, warUntil: 0, last: emptyStats(), week: [] };
  const jShare = base.j / Math.max(1, base.total);
  return [...list, {
    route, airline: OTHERS, seats: { y: cap * (1 - jShare), j: cap * jShare }, fare: { y: ref.y * 0.95, j: ref.j * 0.95 }, ref,
    freq: cap / OTHERS_SEATS_PER_FLIGHT, dist: d, quality: 1, brand: brandFactor(OTHERS.reputation, 0.8),
    pax: { y: 0, j: 0 }, tPax: { y: 0, j: 0 }, tRev: 0,
  }];
}

/** Split one class of one city pair's demand between competing offers. */
export function allocate(offers: Offer[], demand: number, cls: Cls): void {
  const scores = offers.map((o) => score(o, cls));
  const sum = scores.reduce((n, x) => n + x, 0);
  if (sum <= 0 || demand <= 0) return;
  const avgFare = offers.reduce((n, o, i) => n + o.fare[cls] * scores[i], 0) / sum;
  const ref = offers[0].ref[cls];
  const total = demand * Math.min(2.5, Math.max(0.2, (ref / avgFare) ** MARKET_ELASTICITY[cls]));
  const captured = (total * sum) / (sum + OUTSIDE_OPTION);
  const pax = scores.map((sc) => (captured * sc) / sum);
  for (let pass = 0; pass < 3; pass++) {
    let spill = 0;
    pax.forEach((p, i) => {
      const cap = offers[i].seats[cls];
      if (p > cap) { spill += p - cap; pax[i] = cap; }
    });
    const spareScore = pax.reduce((n, p, i) => n + (p < offers[i].seats[cls] - 0.5 ? scores[i] : 0), 0);
    if (spill < 1 || spareScore <= 0) break;
    pax.forEach((p, i) => {
      if (p < offers[i].seats[cls] - 0.5) pax[i] += (spill * 0.75 * scores[i]) / spareScore;
    });
  }
  offers.forEach((o, i) => { o.pax[cls] = Math.min(pax[i], o.seats[cls]); });
}

interface Connection { o1: Offer; o2: Offer; x: string; y: string; hub: string; detour: number }

function otherEnd(r: Route, hub: string): string {
  return r.from === hub ? r.to : r.from;
}

/** Hub-and-spoke: passengers between two spokes of the same airline's hub. */
function routeTransfers(offers: Offer[], markets: Map<string, Offer[]>, ctx: DayContext): void {
  const byAirline = new Map<string, Offer[]>();
  for (const o of offers) {
    const list = byAirline.get(o.airline.code) ?? [];
    list.push(o);
    byAirline.set(o.airline.code, list);
  }
  const groups = new Map<string, Connection[]>();
  for (const list of byAirline.values()) {
    const airline = list[0].airline;
    for (const hub of airline.bases) {
      const spokes = list.filter((o) => o.route.from === hub || o.route.to === hub);
      for (let i = 0; i < spokes.length; i++) {
        const x = otherEnd(spokes[i].route, hub);
        for (let j = i + 1; j < spokes.length; j++) {
          const y = otherEnd(spokes[j].route, hub);
          if (x === y) continue;
          const dxy = distance(x, y);
          if (dxy < 400) continue;
          const detour = (distance(x, hub) + distance(hub, y)) / dxy;
          if (detour > 1.5) continue;
          const key = pairKey(x, y);
          const g = groups.get(key) ?? [];
          g.push({ o1: spokes[i], o2: spokes[j], x, y, hub, detour });
          groups.set(key, g);
        }
      }
    }
  }
  const ordered = [...groups.entries()].sort((a, b) => baseDemand(b[1][0].x, b[1][0].y).total - baseDemand(a[1][0].x, a[1][0].y).total);
  for (const [key, cands] of ordered) {
    const { x, y } = cands[0];
    const base = baseDemand(x, y);
    const poolFactor = markets.has(key) ? 0.12 : 0.35;
    const mult = demandMult(ctx, x, y);
    const dxy = distance(x, y);
    for (const cls of ['y', 'j'] as Cls[]) {
      const ref = cls === 'y' ? refFareY(dxy) : refFareJ(dxy);
      const ratios = cands.map((c) => (c.o1.fare[cls] / c.o1.ref[cls] + c.o2.fare[cls] / c.o2.ref[cls]) / 2);
      const scores = cands.map((c, i) => {
        if (c.o1.seats[cls] <= 0 || c.o2.seats[cls] <= 0) return 0;
        return ratios[i] ** -PRICE_SENS[cls] * Math.min(freqFactor(c.o1.freq, c.o1.dist), freqFactor(c.o2.freq, c.o2.dist)) * ((c.o1.quality + c.o2.quality) / 2) * c.o1.brand * c.detour ** -3;
      });
      const sum = scores.reduce((n, v) => n + v, 0);
      if (sum <= 0) continue;
      const captured = (base[cls] * mult * poolFactor * sum) / (sum + OUTSIDE_OPTION);
      cands.forEach((c, i) => {
        const spare1 = c.o1.seats[cls] - c.o1.pax[cls] - c.o1.tPax[cls];
        const spare2 = c.o2.seats[cls] - c.o2.pax[cls] - c.o2.tPax[cls];
        const take = Math.max(0, Math.min((captured * scores[i]) / sum, spare1, spare2));
        if (take <= 0) return;
        c.o1.tPax[cls] += take;
        c.o2.tPax[cls] += take;
        const rev = take * ref * 0.85 * ratios[i];
        const d1 = distance(x, c.hub);
        const d2 = distance(c.hub, y);
        c.o1.tRev += (rev * d1) / (d1 + d2);
        c.o2.tRev += (rev * d2) / (d1 + d2);
      });
    }
  }
}

function addLedger(into: Ledger, l: Ledger): void {
  for (const k of Object.keys(into) as (keyof Ledger)[]) into[k] += l[k];
}

function closeMonth(s: GameState, day: number): void {
  for (const a of s.airlines) {
    if (a.isPlayer) {
      a.history.push({
        label: monthLabel(day - 1), revenue: a.month.revenue, costs: totalCost(a.month),
        profit: a.month.revenue - totalCost(a.month), pax: a.month.pax, cash: a.cash,
      });
      if (a.history.length > 60) a.history.shift();
    }
    a.month = emptyLedger();
  }
  for (const ac of s.aircraft) refreshBookValue(ac);
}

export interface SimOptions { warmup?: boolean }

export function simulateDay(s: GameState, opts: SimOptions = {}): void {
  if (s.gameOver) return;
  s.day += 1;
  const day = s.day;
  if (isFirstOfMonth(day) && !opts.warmup) closeMonth(s, day);
  if (!opts.warmup) {
    boardTick(s);
    tickEvents(s);
  }
  const ctx = buildContext(s, day);

  for (const a of s.airlines) a.today = emptyLedger();
  const airlineBy = new Map(s.airlines.map((a) => [a.code, a]));
  const flyingBy = flyingByRoute(s, day);

  const offers: Offer[] = [];
  const offerBy = new Map<Route, Offer>();
  const markets = new Map<string, Offer[]>();
  for (const route of s.routes) {
    const flying = flyingBy.get(route.id) ?? [];
    if (!flying.length || isClosedFor(ctx, route.from, route.owner) || isClosedFor(ctx, route.to, route.owner)) continue;
    const o = buildOffer(route, airlineBy.get(route.owner)!, flying, ctx);
    offers.push(o);
    offerBy.set(route, o);
    const key = pairKey(route.from, route.to);
    const m = markets.get(key) ?? [];
    m.push(o);
    markets.set(key, m);
  }

  for (const list of markets.values()) {
    const { from, to } = list[0].route;
    const base = baseDemand(from, to);
    const mult = demandMult(ctx, from, to);
    const all = withOthers(list, from, to, ctx);
    allocate(all, base.y * mult, 'y');
    allocate(all, base.j * mult, 'j');
  }
  routeTransfers(offers, markets, ctx);

  for (const route of s.routes) {
    const airline = airlineBy.get(route.owner)!;
    const o = offerBy.get(route);
    const st = emptyStats();
    if (o) {
      const d = distance(route.from, route.to);
      const L = airline.today;
      st.paxY = o.pax.y * 2;
      st.paxJ = o.pax.j * 2;
      st.transfer = (o.tPax.y + o.tPax.j) * 2;
      st.seatsY = o.seats.y * 2;
      st.seatsJ = o.seats.j * 2;
      st.legs = o.freq * 2;
      st.revenue = 2 * (o.pax.y * o.fare.y + o.pax.j * o.fare.j + o.tRev);
      let cost = 0;
      const lowcost = airline.style === 'lowcost';
      const fuelPrice = airline.isPlayer && s.fuelLock && s.fuelLock.until > day ? s.fuelLock.price : ctx.fuelPrice;
      for (const { ac, weekly } of flyingBy.get(route.id)!) {
        const t = acType(ac.typeId);
        const c = flightCosts(t, d, (2 * weekly) / 7, ac.biz + ac.econ, ac.ageDays / 365, fuelPrice, route.from, route.to);
        if (lowcost) c.crew *= LOWCOST_CREW;
        L.fuel += c.fuel; L.crew += c.crew; L.maintenance += c.maintenance; L.airport += c.landing;
        cost += c.fuel + c.crew + c.maintenance + c.landing;
      }
      const paxAll = st.paxY + st.paxJ + st.transfer;
      const charges = paxCharges(route.from, route.to, paxAll);
      const svc = airline.service as ServiceLevel;
      const catering = (st.paxY + o.tPax.y * 2) * cateringPerPax(svc, d, false) + (st.paxJ + o.tPax.j * 2) * cateringPerPax(svc, d, true);
      L.airport += charges;
      L.service += catering;
      cost += charges + catering;
      st.cost = cost;
      L.revenue += st.revenue;
      L.pax += st.paxY + st.paxJ + st.transfer / 2;
      L.transferPax += st.transfer / 2;
      L.seats += st.seatsY + st.seatsJ;
      L.rpk += paxAll * d;
      L.ask += (st.seatsY + st.seatsJ) * d;
    }
    route.last = st;
    route.week.push(st);
    if (route.week.length > 7) route.week.shift();
  }

  const fleetBy = new Map<string, Aircraft[]>();
  for (const ac of s.aircraft) {
    if (ac.readyDay <= day) ac.ageDays += 1;
    const list = fleetBy.get(ac.owner) ?? [];
    list.push(ac);
    fleetBy.set(ac.owner, list);
  }

  for (const a of s.airlines) {
    const L = a.today;
    const delivered = (fleetBy.get(a.code) ?? []).filter((ac) => ac.readyDay <= day);
    L.leases += delivered.reduce((n, ac) => n + (ac.ownership === 'leased' ? ac.leaseMonthly / 30 : 0), 0);
    L.overhead += (HQ_PER_AIRCRAFT * delivered.length + OVERHEAD_SHARE * L.revenue) * (a.style === 'lowcost' ? LOWCOST_OVERHEAD : 1);
    if (a.isPlayer) L.overhead += a.bases.reduce((n, b) => n + 1000 * airport(b).size, 0);
    L.marketing += a.marketingPerMonth / 30;
    L.interest += a.loans.reduce((n, l) => n + (l.balance * l.rate) / 365, 0) + (a.cash < 0 ? (-a.cash * 0.18) / 365 : 0);
    a.cash += L.revenue - totalCost(L);
    a.recent.push(L);
    if (a.recent.length > 30) a.recent.shift();
    addLedger(a.month, L);
  }

  updatePlayerBrand(s, fleetBy.get(s.playerCode) ?? []);
  for (const a of s.airlines) if (!a.isPlayer) a.reputation += (a.baseReputation - a.reputation) * 0.02;

  if (!opts.warmup) {
    const p = player(s);
    p.lifetimePax += p.today.pax;
    addLedger(s.board.quarter, p.today);
    maybeSpawnDecision(s);
    maybeWriteReviews(s);
    if (day % 7 === 0) aiWeekly(s);
    if (isFirstOfMonth(day)) {
      aiMonthly(s);
      refreshUsedMarket(s);
    }
    checkAchievements(s);
    checkBankruptcy(s);
  } else if (day % 7 === 0) {
    aiWeekly(s, true);
  }
}

function updatePlayerBrand(s: GameState, fleet: Aircraft[]): void {
  const p = player(s);
  const day = s.day;
  const active = fleet.filter((ac) => ac.readyDay <= day && ac.assignments.length);
  if (active.length) {
    let comfort = 0, age = 0, seats = 0;
    for (const ac of active) {
      const n = ac.biz + ac.econ;
      comfort += acType(ac.typeId).comfort * n;
      age += (ac.ageDays / 365) * n;
      seats += n;
    }
    const target = Math.max(5, Math.min(95, 20 + 9 * (comfort / seats) + 10 * p.service - 0.5 * (age / seats)));
    p.reputation += (target - p.reputation) * 0.015;
  }

  const deps = new Map<string, number>();
  for (const r of s.routes) {
    if (r.owner !== p.code) continue;
    deps.set(r.from, (deps.get(r.from) ?? 0) + r.last.legs / 2);
    deps.set(r.to, (deps.get(r.to) ?? 0) + r.last.legs / 2);
  }
  const served = [...deps.keys()];
  const mkt = (0.003 * (p.marketingPerMonth / 1e6)) / Math.sqrt(Math.max(1, served.length / 4));
  for (const code of Object.keys(p.awareness)) {
    if (!deps.has(code)) p.awareness[code] *= 0.998;
  }
  for (const code of served) {
    const now = p.awareness[code] ?? 0;
    p.awareness[code] = Math.min(1, now + Math.min(0.008, 0.0025 * deps.get(code)!) + mkt);
  }
  for (const b of p.bases) p.awareness[b] = Math.max(0.2, p.awareness[b] ?? 0);
}

function checkBankruptcy(s: GameState): void {
  const p = player(s);
  const floor = s.difficulty === 'easy' ? -60e6 : s.difficulty === 'hard' ? -15e6 : -30e6;
  if (p.cash < floor) {
    s.bankruptDays += 1;
    if (s.bankruptDays === 1) addNews(s, `${p.name} is deep in the red. Creditors give you 30 days to recover.`, 'bad');
    if (s.bankruptDays >= 30) {
      s.gameOver = true;
      s.gameOverReason = 'bankrupt';
      addNews(s, `${p.name} files for bankruptcy on ${formatDate(s.day)}. The receivers have been called in.`, 'bad');
    }
  } else {
    s.bankruptDays = 0;
  }
}
