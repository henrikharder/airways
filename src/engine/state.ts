import { acType } from '../data/aircraft';
import { marketValue, WEEK_MINUTES } from './model';
import type { Aircraft, Airline, GameState, NewsItem, Route } from './types';
import { totalCost } from './types';

export function player(s: GameState): Airline {
  return s.airlines[0];
}

export function airlineByCode(s: GameState, code: string): Airline | undefined {
  return s.airlines.find((a) => a.code === code);
}

export function newId(s: GameState, prefix: string): string {
  return `${prefix}${++s.nextId}`;
}

export function addNews(s: GameState, text: string, tone: NewsItem['tone'] = 'neutral'): void {
  s.news.unshift({ day: s.day, text, tone });
  if (s.news.length > 150) s.news.length = 150;
}

export function fleetOf(s: GameState, code: string): Aircraft[] {
  return s.aircraft.filter((a) => a.owner === code);
}

export function routesOf(s: GameState, code: string): Route[] {
  return s.routes.filter((r) => r.owner === code);
}

export function aircraftValue(ac: Aircraft): number {
  return ac.ownership === 'owned' ? ac.bookValue : 0;
}

export function debt(a: Airline): number {
  return a.loans.reduce((n, l) => n + l.balance, 0);
}

export function fleetValue(s: GameState, code: string): number {
  return fleetOf(s, code).reduce((n, ac) => n + aircraftValue(ac), 0);
}

/** Net profit over the last `days` days. */
export function recentProfit(a: Airline, days = 30): number {
  return a.recent.slice(-days).reduce((n, l) => n + l.revenue - totalCost(l), 0);
}

export function recentSum(a: Airline, key: 'revenue' | 'pax' | 'transferPax', days = 30): number {
  return a.recent.slice(-days).reduce((n, l) => n + l[key], 0);
}

export function companyValue(s: GameState, a: Airline): number {
  const annualised = (recentProfit(a, 30) / 30) * 365;
  return a.cash + fleetValue(s, a.code) - debt(a) + Math.max(0, annualised * 4);
}

export function creditLimit(s: GameState, a: Airline): number {
  const annualised = (recentProfit(a, 30) / 30) * 365;
  return Math.max(0, 40e6 + 0.7 * fleetValue(s, a.code) + 2 * Math.max(0, annualised));
}

export function loanRate(s: GameState, a: Airline, extra = 0): number {
  const limit = creditLimit(s, a);
  const used = (debt(a) + extra) / Math.max(1, limit);
  const base = s.difficulty === 'easy' ? 0.04 : s.difficulty === 'hard' ? 0.07 : 0.055;
  return base + 0.06 * Math.min(1, used);
}

export function refreshBookValue(ac: Aircraft): void {
  if (ac.ownership === 'owned') ac.bookValue = marketValue(acType(ac.typeId), ac.ageDays / 365);
}

export function isActive(ac: Aircraft, day: number): boolean {
  return ac.readyDay <= day && ac.groundedUntil <= day;
}

export function usedMinutes(ac: Aircraft): number {
  return ac.assignments.reduce((n, x) => n + x.weekly * x.cycle, 0);
}

export function freeMinutes(ac: Aircraft): number {
  return WEEK_MINUTES - usedMinutes(ac);
}

export interface Flying {
  ac: Aircraft;
  weekly: number;
}

/** Aircraft flying each route, keyed by route id. Pass `day` to keep only aircraft able to fly that day. */
export function flyingByRoute(s: GameState, day?: number): Map<string, Flying[]> {
  const m = new Map<string, Flying[]>();
  for (const ac of s.aircraft) {
    if (day !== undefined && !isActive(ac, day)) continue;
    for (const a of ac.assignments) {
      const list = m.get(a.routeId) ?? [];
      list.push({ ac, weekly: a.weekly });
      m.set(a.routeId, list);
    }
  }
  return m;
}
