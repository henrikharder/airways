// Everything the player can do. Each action validates and returns an error
// string on failure so the UI can show it.

import { acType, econSeatsFor, maxBizSeats } from '../data/aircraft';
import { airport, REG_PREFIX } from '../data/airports';
import { distance } from './geo';
import { availableNew } from './market';
import { cycleMinutes, leaseRate, refFareJ, refFareY, WEEK_MINUTES } from './model';
import { addNews, creditLimit, debt, loanRate, newId, player, refreshBookValue } from './state';
import type { Aircraft, GameState, Livery, Route, ServiceLevel } from './types';
import { emptyStats } from './types';

export type Result = string | null; // error message or null on success

const LETTERS = 'ABCDEFGHJKLMNPRSTUVWXYZ';
const rl = () => LETTERS[Math.floor(Math.random() * LETTERS.length)];
const rd = () => Math.floor(Math.random() * 10);

function registration(s: GameState): string {
  const country = airport(player(s).bases[0]).country;
  const prefix = REG_PREFIX[country] ?? 'N';
  const taken = new Set(s.aircraft.map((a) => a.reg));
  for (let i = 0; i < 50; i++) {
    let reg: string;
    if (prefix.endsWith('-')) reg = prefix + rl() + rl() + rl();
    else if (prefix === 'N') reg = `N${1 + rd()}${rd()}${rd()}${rl()}${rl()}`;
    else if (prefix === 'JA' || prefix === 'HL') reg = `${prefix}${rd()}${rd()}${rd()}${rd()}`;
    else reg = prefix + rl() + rl() + rl();
    if (!taken.has(reg)) return reg;
  }
  return `${prefix}${s.nextId}`;
}

function clampBiz(typeId: string, biz: number): number {
  return Math.max(0, Math.min(maxBizSeats(acType(typeId)), Math.round(biz)));
}

function addPlayerAircraft(s: GameState, typeId: string, biz: number, ownership: Aircraft['ownership'], ageYears: number, readyIn: number): Aircraft {
  const t = acType(typeId);
  const b = clampBiz(typeId, biz);
  const ac: Aircraft = {
    id: newId(s, 'ac'), reg: registration(s), typeId, owner: s.playerCode, ownership,
    ageDays: Math.round(ageYears * 365), biz: b, econ: econSeatsFor(t, b), assignments: [],
    readyDay: s.day + readyIn, groundedUntil: 0,
    leaseMonthly: ownership === 'leased' ? leaseRate(t, ageYears) : 0, bookValue: 0, phase: Math.random(),
  };
  refreshBookValue(ac);
  s.aircraft.push(ac);
  return ac;
}

export function leaseAircraft(s: GameState, typeId: string, biz: number): Result {
  const t = acType(typeId);
  if (!availableNew(t, s.day)) return `${t.name} is not available from lessors.`;
  const deposit = leaseRate(t) * 2;
  const p = player(s);
  if (p.cash < deposit) return `You need ${money(deposit)} for the lease deposit.`;
  p.cash -= deposit;
  const ac = addPlayerAircraft(s, typeId, biz, 'leased', 0, 3);
  addNews(s, `${ac.reg}, a brand-new ${t.name}, is leased and arrives in 3 days.`, 'neutral');
  return null;
}

export function buyNewAircraft(s: GameState, typeId: string, biz: number): Result {
  const t = acType(typeId);
  if (!availableNew(t, s.day)) return `${t.name} is not in production.`;
  const price = t.priceM * 1e6;
  const p = player(s);
  if (p.cash < price) return `You need ${money(price)} to buy a ${t.name}.`;
  p.cash -= price;
  const ac = addPlayerAircraft(s, typeId, biz, 'owned', 0, 45);
  addNews(s, `Order placed: ${t.name} ${ac.reg} will be delivered in 45 days.`, 'neutral');
  return null;
}

export function buyUsedAircraft(s: GameState, listingId: string, biz: number): Result {
  const l = s.used.find((u) => u.id === listingId);
  if (!l) return 'That aircraft has already been sold.';
  const p = player(s);
  if (p.cash < l.price) return `You need ${money(l.price)}.`;
  p.cash -= l.price;
  s.used = s.used.filter((u) => u.id !== listingId);
  const ac = addPlayerAircraft(s, l.typeId, biz, 'owned', l.ageYears, 7);
  ac.bookValue = l.price;
  addNews(s, `Bought a ${l.ageYears}-year-old ${acType(l.typeId).name} (${ac.reg}). Ready in 7 days after a repaint.`, 'neutral');
  return null;
}

export function sellAircraft(s: GameState, acId: string): Result {
  const ac = s.aircraft.find((a) => a.id === acId && a.owner === s.playerCode);
  if (!ac) return 'Aircraft not found.';
  const p = player(s);
  unassign(ac);
  if (ac.ownership === 'owned') {
    const proceeds = ac.readyDay > s.day ? acType(ac.typeId).priceM * 1e6 * 0.9 : ac.bookValue * 0.92;
    p.cash += proceeds;
    addNews(s, `Sold ${ac.reg} for ${money(proceeds)}.`, 'neutral');
  } else {
    p.cash -= ac.leaseMonthly * 2;
    addNews(s, `Returned ${ac.reg} to the lessor early (fee ${money(ac.leaseMonthly * 2)}).`, 'neutral');
  }
  s.aircraft = s.aircraft.filter((a) => a.id !== acId);
  return null;
}

export function reconfigureCost(typeId: string): number {
  const c = acType(typeId).category;
  return c === 'widebody' || c === 'superjumbo' ? 400_000 : 100_000;
}

export function reconfigure(s: GameState, acId: string, biz: number): Result {
  const ac = s.aircraft.find((a) => a.id === acId && a.owner === s.playerCode);
  if (!ac) return 'Aircraft not found.';
  const b = clampBiz(ac.typeId, biz);
  if (b === ac.biz) return null;
  const cost = reconfigureCost(ac.typeId);
  const p = player(s);
  if (p.cash < cost) return `Cabin refit costs ${money(cost)}.`;
  p.cash -= cost;
  ac.biz = b;
  ac.econ = econSeatsFor(acType(ac.typeId), b);
  ac.groundedUntil = Math.max(ac.groundedUntil, s.day + 3);
  return null;
}

function unassign(ac: Aircraft): void {
  ac.assignments = [];
}

export function canFly(typeId: string, from: string, to: string): boolean {
  return acType(typeId).rangeKm >= distance(from, to);
}

/** Set how many weekly round trips an aircraft flies on a route (0 removes it). */
export function assignAircraft(s: GameState, acId: string, routeId: string, weekly: number): Result {
  const ac = s.aircraft.find((a) => a.id === acId && a.owner === s.playerCode);
  if (!ac) return 'Aircraft not found.';
  const r = s.routes.find((x) => x.id === routeId && x.owner === s.playerCode);
  if (!r) return 'Route not found.';
  const t = acType(ac.typeId);
  if (!canFly(ac.typeId, r.from, r.to)) return `${t.name} can't fly ${distance(r.from, r.to).toLocaleString()} km.`;
  const n = Math.max(0, Math.round(weekly));
  const others = ac.assignments.filter((x) => x.routeId !== routeId);
  if (n === 0) { ac.assignments = others; return null; }
  const cycle = cycleMinutes(t, distance(r.from, r.to));
  const busy = others.reduce((m, x) => m + x.weekly * x.cycle, 0);
  if (busy + n * cycle > WEEK_MINUTES) {
    return `${ac.reg} only has time for ${Math.floor((WEEK_MINUTES - busy) / cycle)} more weekly round trips on this route.`;
  }
  ac.assignments = [...others, { routeId, weekly: n, cycle }];
  return null;
}

/** Most weekly round trips this aircraft could add on a route, given its other flying. */
export function spareWeekly(ac: Aircraft, from: string, to: string, routeId?: string): number {
  const cycle = cycleMinutes(acType(ac.typeId), distance(from, to));
  const busy = ac.assignments.filter((x) => x.routeId !== routeId).reduce((m, x) => m + x.weekly * x.cycle, 0);
  return Math.max(0, Math.floor((WEEK_MINUTES - busy) / cycle));
}

export function suggestedFares(from: string, to: string): { y: number; j: number } {
  const d = distance(from, to);
  return { y: Math.round(refFareY(d)), j: Math.round(refFareJ(d)) };
}

export function openRoute(s: GameState, from: string, to: string, plan: { acId: string; weekly: number }[], fareY?: number, fareJ?: number): string | Route {
  const p = player(s);
  if (!p.bases.includes(from)) return 'Routes must start at one of your bases.';
  if (from === to) return 'Pick a different destination.';
  const d = distance(from, to);
  if (d < 150) return 'Too short — passengers will take the train.';
  if (s.routes.some((r) => r.owner === p.code && ((r.from === from && r.to === to) || (r.from === to && r.to === from)))) return 'You already fly this route.';
  const fares = suggestedFares(from, to);
  const route: Route = {
    id: newId(s, 'rt'), owner: p.code, from, to,
    fareY: Math.round(fareY ?? fares.y), fareJ: Math.round(fareJ ?? fares.j),
    openedDay: s.day, warUntil: 0, last: emptyStats(), week: [],
  };
  s.routes.push(route);
  for (const { acId, weekly } of plan) {
    const err = assignAircraft(s, acId, route.id, weekly);
    if (err) {
      closeRoute(s, route.id);
      return err;
    }
  }
  addNews(s, `${p.name} launches ${airport(from).city} (${from}) – ${airport(to).city} (${to}).`, 'good');
  return route;
}

export function setFares(s: GameState, routeId: string, y: number, j: number): Result {
  const r = s.routes.find((x) => x.id === routeId && x.owner === s.playerCode);
  if (!r) return 'Route not found.';
  r.fareY = Math.max(10, Math.round(y));
  r.fareJ = Math.max(20, Math.round(j));
  return null;
}

export function closeRoute(s: GameState, routeId: string): Result {
  const r = s.routes.find((x) => x.id === routeId && x.owner === s.playerCode);
  if (!r) return 'Route not found.';
  for (const ac of s.aircraft) ac.assignments = ac.assignments.filter((x) => x.routeId !== routeId);
  s.routes = s.routes.filter((x) => x.id !== routeId);
  return null;
}

export function baseCost(code: string): { setup: number; monthly: number } {
  const size = airport(code).size;
  return { setup: 2e6 * size, monthly: 30_000 * size };
}

export function openBase(s: GameState, code: string): Result {
  const p = player(s);
  if (p.bases.includes(code)) return 'Already a base.';
  const { setup } = baseCost(code);
  if (p.cash < setup) return `Opening a base at ${code} costs ${money(setup)}.`;
  p.cash -= setup;
  p.bases.push(code);
  p.awareness[code] = Math.max(p.awareness[code] ?? 0, 0.2);
  addNews(s, `${p.name} opens a new base at ${airport(code).name}, ${airport(code).city}.`, 'good');
  return null;
}

export function takeLoan(s: GameState, amount: number): Result {
  const p = player(s);
  const room = creditLimit(s, p) - debt(p);
  if (amount > room) return `Your bank will lend at most ${money(Math.max(0, room))} more.`;
  const rate = loanRate(s, p, amount);
  p.loans.push({ id: newId(s, 'ln'), principal: amount, balance: amount, rate, takenDay: s.day });
  p.cash += amount;
  return null;
}

export function repayLoan(s: GameState, loanId: string, amount: number): Result {
  const p = player(s);
  const l = p.loans.find((x) => x.id === loanId);
  if (!l) return 'Loan not found.';
  const pay = Math.min(amount, l.balance);
  if (p.cash < pay) return 'Not enough cash.';
  p.cash -= pay;
  l.balance -= pay;
  if (l.balance <= 1) p.loans = p.loans.filter((x) => x.id !== loanId);
  return null;
}

export function repaintCost(s: GameState): number {
  return 100_000 * s.aircraft.filter((a) => a.owner === s.playerCode && a.readyDay <= s.day).length;
}

/** Change the livery; repainting the delivered fleet costs money. */
export function repaint(s: GameState, livery: Livery): Result {
  const p = player(s);
  const cost = repaintCost(s);
  if (p.cash < cost) return `Repainting the fleet costs ${money(cost)}.`;
  p.cash -= cost;
  p.livery = { ...livery };
  p.color = livery.primary;
  if (cost) addNews(s, `${p.name} unveils a new livery. Aviation fans have opinions.`, 'neutral');
  return null;
}

export function setMarketing(s: GameState, perMonth: number): void {
  player(s).marketingPerMonth = Math.max(0, perMonth);
}

export function setService(s: GameState, level: ServiceLevel): void {
  player(s).service = level;
}

export function money(n: number): string {
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(0)}k`;
  return `${sign}$${a.toFixed(0)}`;
}
