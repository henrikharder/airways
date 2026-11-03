import { describe, expect, it } from 'vitest';
import { leaseAircraft, openRoute } from './actions';
import { boardTick, objectiveProgress } from './board';
import { resolveDecision, rivalWarDecision } from './decisions';
import { createGame } from './newgame';
import { parseSave } from './save';
import { currentLeg, legsOnDay } from './schedule';
import { simulateDay } from './sim';
import { player } from './state';
import { dayOfIso } from './time';
import type { GameState } from './types';

function setup(): { s: GameState; routeId: string; acId: string } {
  const s = createGame({ name: 'Test Air', code: 'ZZ', color: '#fff', hub: 'CPH', difficulty: 'normal' });
  leaseAircraft(s, 'A20N', 12);
  const ac = s.aircraft[s.aircraft.length - 1];
  const r = openRoute(s, 'CPH', 'LHR', [{ acId: ac.id, weekly: 14 }]);
  if (typeof r === 'string') throw new Error(r);
  return { s, routeId: r.id, acId: ac.id };
}

describe('schedule', () => {
  it('flies the weekly frequency over a week, and legs line up with positions', () => {
    const { s, acId } = setup();
    const ac = s.aircraft.find((a) => a.id === acId)!;
    const routes = new Map(s.routes.map((r) => [r.id, r]));
    let outbound = 0;
    for (let d = 10; d < 17; d++) outbound += legsOnDay(ac, routes, d).filter((l) => l.outbound).length;
    expect(outbound).toBe(14);
    const leg = legsOnDay(ac, routes, 12)[0];
    const mid = currentLeg(ac, routes, (leg.dep + leg.arr) / 2);
    expect(mid?.leg.dep).toBe(leg.dep);
    expect(mid?.p).toBeCloseTo(0.5, 2);
  });
});

describe('decisions', () => {
  it('matching a fare war discounts the player route', () => {
    const { s, routeId } = setup();
    const route = s.routes.find((r) => r.id === routeId)!;
    rivalWarDecision(s, s.airlines.find((a) => a.code === 'BA')!, route);
    expect(s.decisions).toHaveLength(1);
    expect(s.decisions[0].quote?.by).toContain('British Airways');
    resolveDecision(s, s.decisions[0].id, 0);
    expect(route.warUntil).toBeGreaterThan(s.day);
    expect(s.decisions).toHaveLength(0);
  });
});

describe('board', () => {
  it('rewards a met objective at the quarter meeting', () => {
    const { s } = setup();
    s.board.objective = { kind: 'routes', target: 1, label: 'Operate 1 route', reward: 5e6 };
    expect(objectiveProgress(s).value).toBeGreaterThanOrEqual(1);
    const cash = player(s).cash;
    s.day = dayOfIso('2027-04-01');
    boardTick(s);
    expect(player(s).cash).toBe(cash + 5e6);
    expect(s.board.meeting?.success).toBe(true);
  });

  it('runs a few weeks with all systems on', () => {
    const { s } = setup();
    for (let i = 0; i < 45; i++) simulateDay(s);
    expect(s.board.quarter.pax).toBeGreaterThan(0);
  });
});

describe('save migration', () => {
  it('upgrades a version 1 save', () => {
    const { s } = setup();
    const old = JSON.parse(JSON.stringify(s));
    old.version = 1;
    delete old.board; delete old.decisions; delete old.reviews; delete old.airlines[0].livery;
    const m = parseSave(JSON.stringify(old));
    expect(m.version).toBe(2);
    expect(m.board.objective.label).toBeTruthy();
    expect(m.airlines[0].livery?.primary).toBe('#fff');
  });
});
