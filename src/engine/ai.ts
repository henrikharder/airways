// Rival airline behaviour: right-size frequencies, tune fares, fight the
// player with fare wars and copycat routes, and expand into new markets.

import { acType, econSeatsFor, type AircraftType } from '../data/aircraft';
import { AIRPORTS } from '../data/airports';
import { distance, pairKey } from './geo';
import { baseDemand, cycleMinutes, leaseRate, maxWeekly, refFareJ, refFareY } from './model';
import { addNews, airlineByCode, flyingByRoute, freeMinutes, newId, player, recentProfit } from './state';
import { rivalEntryDecision, rivalWarDecision } from './decisions';
import { dayOfIso } from './time';
import type { Aircraft, Airline, GameState, Route } from './types';
import { emptyStats } from './types';

const FARE_LEVEL: Record<Airline['style'], number> = { player: 1, legacy: 1, premium: 1.08, lowcost: 0.72 };

export function aiConfig(a: Airline, t: AircraftType): { biz: number; econ: number } {
  const biz = a.style === 'lowcost' ? 0 : Math.round(t.defaultBiz * (a.style === 'premium' ? 1.15 : 1));
  return { biz, econ: econSeatsFor(t, biz) };
}

function typeAvailable(t: AircraftType, day: number): boolean {
  return !t.availableFrom || dayOfIso(t.availableFrom) <= day;
}

/** Pick the aircraft type and weekly frequency that best match the seats wanted per direction per day. */
export function chooseService(a: Airline, d: number, targetPerDir: number, day: number): { typeId: string; weekly: number } | null {
  let best: { typeId: string; weekly: number; fit: number } | null = null;
  const minWeekly = d > 6000 ? 3 : 7;
  for (const id of a.fleetTypes) {
    const t = acType(id);
    if (t.rangeKm < d * 1.02 || !typeAvailable(t, day)) continue;
    const { biz, econ } = aiConfig(a, t);
    const seats = biz + econ;
    const weekly = Math.max(1, Math.min(maxWeekly(t, d) * 10, Math.round((targetPerDir * 7) / seats)));
    let fit = Math.abs((weekly * seats) / 7 - targetPerDir) / targetPerDir;
    if (weekly < minWeekly) fit += (minWeekly - weekly) * 0.12; // airlines prefer frequency
    if (d > 4500 && t.category !== 'widebody' && t.category !== 'superjumbo') fit += 0.5; // and widebodies on long-haul
    fit += t.burn / seats / 300; // and efficient aircraft
    if (!best || fit < best.fit) best = { typeId: id, weekly, fit };
  }
  return best && { typeId: best.typeId, weekly: best.weekly };
}

function makeAIAircraft(s: GameState, a: Airline, typeId: string): Aircraft {
  const t = acType(typeId);
  const { biz, econ } = aiConfig(a, t);
  const age = Math.floor(Math.random() * 10);
  const ac: Aircraft = {
    id: newId(s, 'ac'), reg: `${a.code}-${s.nextId}`, typeId, owner: a.code, ownership: 'leased',
    ageDays: age * 365, biz, econ, assignments: [], readyDay: 0, groundedUntil: 0,
    leaseMonthly: leaseRate(t, age), bookValue: 0, phase: Math.random(),
  };
  s.aircraft.push(ac);
  return ac;
}

/** Schedule `weekly` round trips of `typeId` on a route, filling spare aircraft first and leasing more as needed. */
export function addFrequency(s: GameState, a: Airline, typeId: string, route: Route, weekly: number): void {
  const t = acType(typeId);
  const cycle = cycleMinutes(t, distance(route.from, route.to));
  const fleet = s.aircraft.filter((x) => x.owner === a.code && x.typeId === typeId);
  let left = weekly;
  for (const ac of [...fleet].sort((x, y) => freeMinutes(y) - freeMinutes(x))) {
    if (left <= 0) break;
    const fit = Math.min(left, Math.floor(freeMinutes(ac) / cycle));
    if (fit > 0) { assign(ac, route.id, fit, cycle); left -= fit; }
  }
  while (left > 0) {
    const ac = makeAIAircraft(s, a, typeId);
    const fit = Math.max(1, Math.min(left, Math.floor(freeMinutes(ac) / cycle)));
    assign(ac, route.id, fit, cycle);
    left -= fit;
  }
}

function assign(ac: Aircraft, routeId: string, weekly: number, cycle: number): void {
  const existing = ac.assignments.find((x) => x.routeId === routeId);
  if (existing) existing.weekly += weekly;
  else ac.assignments.push({ routeId, weekly, cycle });
}

function removeFrequency(s: GameState, route: Route, weekly: number): void {
  let left = weekly;
  for (const ac of s.aircraft) {
    if (left <= 0) break;
    const x = ac.assignments.find((a) => a.routeId === route.id);
    if (!x) continue;
    const cut = Math.min(left, x.weekly);
    x.weekly -= cut;
    left -= cut;
    if (x.weekly <= 0) ac.assignments = ac.assignments.filter((a) => a !== x);
  }
}

function pruneIdle(s: GameState): void {
  s.aircraft = s.aircraft.filter((ac) => ac.owner === s.playerCode || ac.assignments.length > 0);
}

export function createAIRoute(s: GameState, a: Airline, from: string, to: string, targetPerDir: number): Route | null {
  const d = distance(from, to);
  const pick = chooseService(a, d, targetPerDir, s.day);
  if (!pick) return null;
  const level = FARE_LEVEL[a.style];
  const route: Route = {
    id: newId(s, 'rt'), owner: a.code, from, to,
    fareY: Math.round(refFareY(d) * level), fareJ: Math.round(refFareJ(d) * level),
    openedDay: s.day, warUntil: 0, last: emptyStats(), week: [],
  };
  s.routes.push(route);
  addFrequency(s, a, pick.typeId, route, pick.weekly);
  return route;
}

function weekTotals(r: Route) {
  let pax = 0, seats = 0, profit = 0;
  for (const w of r.week) {
    pax += w.paxY + w.paxJ + w.transfer;
    seats += w.seatsY + w.seatsJ;
    profit += w.revenue - w.cost;
  }
  return { lf: seats ? pax / seats : 0, profit, seats };
}

/** Weekly: fares and frequencies follow load factor; rivals react to the player. */
export function aiWeekly(s: GameState, warmup = false): void {
  const flying = flyingByRoute(s);
  for (const r of s.routes) {
    const a = airlineByCode(s, r.owner)!;
    if (a.isPlayer) continue;
    const { lf, seats } = weekTotals(r);
    const fl = flying.get(r.id) ?? [];
    if (!seats || !fl.length) continue;
    const d = distance(r.from, r.to);
    const level = FARE_LEVEL[a.style];
    if (lf > 0.9) { r.fareY *= 1.04; r.fareJ *= 1.03; }
    else if (lf < 0.62) { r.fareY *= 0.96; r.fareJ *= 0.97; }
    r.fareY = Math.round(Math.min(1.5 * level * refFareY(d), Math.max(0.6 * level * refFareY(d), r.fareY)));
    r.fareJ = Math.round(Math.min(1.5 * level * refFareJ(d), Math.max(0.6 * level * refFareJ(d), r.fareJ)));

    const weekly = fl.reduce((n, f) => n + f.weekly, 0);
    const step = Math.max(1, Math.round(weekly * (warmup ? 0.2 : 0.1)));
    const typeId = fl[0].ac.typeId;
    if (lf > 0.92 && weekly < 140 && (warmup || Math.random() < 0.4)) {
      addFrequency(s, a, typeId, r, step);
    } else if (lf < 0.6 && weekly > 3 && (warmup || Math.random() < 0.4)) {
      removeFrequency(s, r, Math.min(step, weekly - 3));
    } else if (lf < 0.5 && weekly <= 3) {
      const cur = acType(typeId);
      const smaller = a.fleetTypes.map(acType)
        .filter((t) => t.rangeKm >= d * 1.02 && t.maxSeats < cur.maxSeats && typeAvailable(t, s.day))
        .sort((x, y) => y.maxSeats - x.maxSeats)[0];
      if (smaller) {
        removeFrequency(s, r, weekly);
        addFrequency(s, a, smaller.id, r, weekly);
      }
    }
  }
  pruneIdle(s);
  if (!warmup) fightPlayer(s);
}

function fightPlayer(s: GameState): void {
  const p = player(s);
  const aiOnPair = new Map<string, Route[]>();
  for (const r of s.routes) {
    if (r.owner === p.code) continue;
    const k = pairKey(r.from, r.to);
    aiOnPair.set(k, [...(aiOnPair.get(k) ?? []), r]);
  }
  for (const pr of s.routes.filter((r) => r.owner === p.code)) {
    const rivals = aiOnPair.get(pairKey(pr.from, pr.to)) ?? [];
    const mine = weekTotals(pr);
    for (const rv of rivals) {
      const a = airlineByCode(s, rv.owner)!;
      if (rv.warUntil > s.day || mine.lf < 0.5) continue;
      if (Math.random() < a.aggression * 0.12) {
        rv.warUntil = s.day + 28;
        addNews(s, `${a.name} slashes fares 15% on ${pr.from}–${pr.to} to squeeze out ${p.name}.`, 'rival');
        rivalWarDecision(s, a, pr);
      }
    }
    if (rivals.length === 0 && mine.profit > 150_000 && s.day - pr.openedDay > 28) {
      const d = distance(pr.from, pr.to);
      const contenders = s.airlines.filter((a) => !a.isPlayer && (a.bases.includes(pr.from) || a.bases.includes(pr.to))
        && a.fleetTypes.some((t) => acType(t).rangeKm >= d * 1.02));
      for (const a of contenders) {
        if (Math.random() < a.aggression * 0.15) {
          const hub = a.bases.includes(pr.from) ? pr.from : pr.to;
          const dest = hub === pr.from ? pr.to : pr.from;
          if (createAIRoute(s, a, hub, dest, baseDemand(hub, dest).total * 0.45)) {
            addNews(s, `${a.name} spots ${p.name}'s success and launches ${hub}–${dest}.`, 'rival');
            rivalEntryDecision(s, a, pr);
            break;
          }
        }
      }
    }
  }
}

/** Monthly: profitable rivals open new routes from their hubs. */
export function aiMonthly(s: GameState): void {
  const served = new Map<string, number>();
  for (const r of s.routes) served.set(pairKey(r.from, r.to), (served.get(pairKey(r.from, r.to)) ?? 0) + 1);
  for (const a of s.airlines) {
    if (a.isPlayer || Math.random() > 0.25 || recentProfit(a) <= 0) continue;
    const hub = a.bases[Math.floor(Math.random() * a.bases.length)];
    const maxRange = Math.max(...a.fleetTypes.map((t) => acType(t).rangeKm));
    const own = new Set(s.routes.filter((r) => r.owner === a.code).map((r) => pairKey(r.from, r.to)));
    const options = AIRPORTS
      .filter((x) => x.iata !== hub && !own.has(pairKey(hub, x.iata)))
      .map((x) => ({ code: x.iata, d: distance(hub, x.iata) }))
      .filter((x) => x.d >= 300 && x.d <= maxRange * 0.98)
      .map((x) => ({ ...x, v: baseDemand(hub, x.code).total / (1 + (served.get(pairKey(hub, x.code)) ?? 0)) }))
      .sort((x, y) => y.v - x.v)
      .slice(0, 6);
    if (!options.length) continue;
    const pick = options[Math.floor(Math.random() * options.length)];
    const n = served.get(pairKey(hub, pick.code)) ?? 0;
    if (createAIRoute(s, a, hub, pick.code, (baseDemand(hub, pick.code).total * 0.8) / (n + 1))) {
      addNews(s, `${a.name} announces new service ${hub}–${pick.code}.`, 'rival');
    }
  }
}
