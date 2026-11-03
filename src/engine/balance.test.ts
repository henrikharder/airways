import { describe, expect, it } from 'vitest';
import { acType, econSeatsFor } from '../data/aircraft';
import { leaseAircraft, openRoute, spareWeekly, suggestedFares } from './actions';
import { distance } from './geo';
import { leaseRate, maxWeekly } from './model';
import { createGame } from './newgame';
import { estimateRoute, type PlanAircraft } from './planner';
import { simulateDay } from './sim';
import { player, recentProfit } from './state';
import type { GameState, Route } from './types';
import { totalCost } from './types';

function newGame(hub = 'CPH'): GameState {
  return createGame({ name: 'Test Air', code: 'ZZ', color: '#fff', hub, difficulty: 'normal' });
}

function launch(s: GameState, typeId: string, to: string, weekly: number, biz = 12): Route {
  const before = new Set(s.aircraft.map((a) => a.id));
  expect(leaseAircraft(s, typeId, biz)).toBeNull();
  const ac = s.aircraft.find((a) => !before.has(a.id))!;
  const r = openRoute(s, player(s).bases[0], to, [{ acId: ac.id, weekly: Math.min(weekly, spareWeekly(ac, player(s).bases[0], to)) }]);
  if (typeof r === 'string') throw new Error(r);
  return r;
}

function routeSummary(r: Route) {
  const w = r.week;
  const pax = w.reduce((n, x) => n + x.paxY + x.paxJ + x.transfer, 0);
  const seats = w.reduce((n, x) => n + x.seatsY + x.seatsJ, 0);
  const profit = w.reduce((n, x) => n + x.revenue - x.cost, 0) / Math.max(1, w.length);
  return { lf: +(seats ? pax / seats : 0).toFixed(2), profitPerDay: Math.round(profit) };
}

function planFor(typeId: string, biz: number, weekly: number): { ac: PlanAircraft; weekly: number }[] {
  const t = acType(typeId);
  return [{ ac: { typeId, biz, econ: econSeatsFor(t, biz), ageDays: 0, ownership: 'leased', leaseMonthly: leaseRate(t) }, weekly }];
}

describe('world seeding', () => {
  it('creates a believable rival world', () => {
    const s = newGame();
    const ai = s.airlines.filter((a) => !a.isPlayer);
    const lfs = s.routes.map(routeSummary).map((x) => x.lf);
    const avgLf = lfs.reduce((n, x) => n + x, 0) / lfs.length;
    const profitable = ai.filter((a) => recentProfit(a) > 0).length;
    console.log({ airlines: ai.length, aiRoutes: s.routes.length, aircraft: s.aircraft.length, avgLf: avgLf.toFixed(2), profitable });
    for (const a of ai) {
      const r = a.recent.slice(-7);
      const rev = r.reduce((n, l) => n + l.revenue, 0) / 7;
      const cost = r.reduce((n, l) => n + totalCost(l), 0) / 7;
      const fleet = s.aircraft.filter((x) => x.owner === a.code).length;
      console.log(a.code.padEnd(3), 'fleet', String(fleet).padStart(4), ' rev/day', (rev / 1e6).toFixed(2), 'M  margin', ((1 - cost / rev) * 100).toFixed(1).padStart(6), '%  pax/day', Math.round(r.reduce((n, l) => n + l.pax, 0) / 7));
    }
    expect(avgLf).toBeGreaterThan(0.6);
    expect(avgLf).toBeLessThan(0.95);
    expect(profitable).toBeGreaterThan(ai.length * 0.6);
  });
});

describe('route economics', () => {
  it('a well-chosen startup route is profitable over two months', () => {
    const s = newGame('LHR');
    const r = launch(s, 'A20N', 'IAD', 7);
    for (let i = 0; i < 60; i++) simulateDay(s);
    const sum = routeSummary(r);
    console.log('LHR-IAD A320neo 7/wk', sum, 'awareness IAD', player(s).awareness.IAD.toFixed(2), 'cash', Math.round(player(s).cash / 1e6), 'M');
    expect(sum.lf).toBeGreaterThan(0.6);
    expect(sum.profitPerDay).toBeGreaterThan(0);
  });

  it('a contested route against an incumbent is hard', () => {
    const s = newGame();
    const r = launch(s, 'A20N', 'BCN', 14);
    for (let i = 0; i < 60; i++) simulateDay(s);
    console.log('CPH-BCN A320neo 14/wk vs SAS', routeSummary(r));
  });

  it('a superjumbo on a thin long route loses money', () => {
    const s = newGame();
    expect(distance('CPH', 'PER')).toBeGreaterThan(13000);
    const f = suggestedFares('CPH', 'PER');
    const est = estimateRoute(s, 'CPH', 'PER', planFor('A388', 76, 3), f.y, f.j);
    console.log('CPH-PER A380 3/wk estimate', { lf: est.lf.toFixed(2), profit: Math.round(est.profit) });
    expect(est.profit).toBeLessThan(0);
  });

  it('planner estimates for common starts', () => {
    const s = newGame();
    const tests: [string, string, string, number, number][] = [
      ['CPH', 'LHR', 'A20N', 12, 21], ['CPH', 'AGP', 'A20N', 12, 7], ['CPH', 'JFK', 'B789', 30, 7], ['CPH', 'BKK', 'A359', 36, 4],
      ['CPH', 'HAM', 'AT76', 0, 14], ['CPH', 'ARN', 'BCS3', 12, 14], ['CPH', 'DXB', 'A339', 30, 7], ['CPH', 'KEF', 'A20N', 12, 7],
      ['CPH', 'PMI', 'B738', 0, 7], ['CPH', 'MLE', 'A339', 30, 2], ['CPH', 'LAX', 'A388', 76, 7], ['CPH', 'LAX', 'B789', 30, 7],
    ];
    for (const [from, to, typeId, biz, weekly] of tests) {
      const f = suggestedFares(from, to);
      const w = Math.min(weekly, maxWeekly(acType(typeId), distance(from, to)));
      const e = estimateRoute(s, from, to, planFor(typeId, biz, w), f.y, f.j);
      console.log(`${from}-${to} ${typeId} ${w}/wk`.padEnd(22), 'demand/day', String(Math.round(e.demandY + e.demandJ)).padStart(5), ' lf', e.lf.toFixed(2), ' profit/day', String(Math.round(e.profit)).padStart(8), ' rivals', e.competitors.map((c) => `${c.airline}:${Math.round(c.weeklyFlights)}/wk`).join(' '));
    }
  });
});
