import { describe, expect, it } from 'vitest';
import { demoGame } from './demo';
import { held } from './flights';
import { accessTile, bulldozeAt, checkPlace, paintRect, place, walkable } from './grid';
import { createGame } from './newgame';
import { aircraftPath, distanceTo, UNREACHABLE } from './paths';
import { securityReport } from './security';
import { advance } from './sim';

describe('building rules', () => {
  it('only allows indoor modules on terminal floor with a free front', () => {
    const s = createGame({ name: 'T', code: 'TST', city: 'CPH' });
    s.buildings = [];
    expect(checkPlace(s, 'checkin', 40, 40, 0).ok).toBe(false);
    paintRect(s, 'floor', 38, 38, 46, 46);
    expect(place(s, 'checkin', 40, 40, 0).ok).toBe(true);
    expect(checkPlace(s, 'gate', 40, 42, 0).ok).toBe(false); // would block the check-in queue tile
  });

  it('routes aircraft over taxiways only', () => {
    const s = demoGame();
    expect(aircraftPath(s, 50, 12, 35, 41)).not.toBeNull();
    expect(aircraftPath(s, 50, 12, 10, 60)).toBeNull();
  });
});

describe('taxiing', () => {
  it('holds short behind an aircraft ahead, but not one behind or beside', () => {
    const s = demoGame();
    const make = (x: number, y: number, phase: 'taxi_out' | 'taxi_in') => ({ ...s.flights[0], id: Math.random(), x, y, alt: 0, phase, path: [[50.5, 20.5]] as [number, number][], pathI: 0 });
    const me = make(50.5, 30.5, 'taxi_out');
    s.flights = [me, make(50.5, 25, 'taxi_in')];
    expect(held(s, me, 100)).toBe(true);
    expect(held(s, me, 106)).toBe(false); // gives up after a standoff
    s.flights = [me, make(50.5, 36, 'taxi_in')];
    expect(held(s, me, 200)).toBe(false);
    s.flights = [me, make(56, 25, 'taxi_in')];
    expect(held(s, me, 300)).toBe(false);
  });
});

describe('airport simulation', () => {
  it('lands, turns around and departs flights with boarded passengers', () => {
    const s = demoGame();
    expect(s.buildings.filter((b) => b.kind === 'stand_m').every((b) => b.link)).toBe(true);
    let peak = 0, lost = 0;
    const leaving = new Set<number>(); // arriving passengers heading out after baggage claim
    const done = new Map<number, { boarded: number; missed: number }>();
    for (let i = 0; i < 48 * 60; i += 10) {
      advance(s, 10);
      peak = Math.max(peak, s.pax.length);
      lost = Math.max(lost, s.pax.filter((p) => p.state === 'lost').length);
      for (const p of s.pax) if (p.state === 'toExit' && p.y > 63) leaving.add(p.id);
      for (const f of s.flights) if (f.phase === 'departed') done.set(f.id, f); // old flights get pruned
    }
    const departures = s.history.reduce((n, d) => n + d.departures, 0) + s.today.departures;
    const boarded = [...done.values()].reduce((n, f) => n + f.boarded, 0);
    const missed = [...done.values()].reduce((n, f) => n + f.missed, 0);
    expect(s.flights.filter((f) => f.phase === 'cancelled')).toHaveLength(0);
    console.log({ departures, boarded, missed, peak, lost, leaving: leaving.size, cash: Math.round(s.cash), rating: s.rating.toFixed(1) });
    expect(departures).toBeGreaterThanOrEqual(7);
    expect(boarded).toBeGreaterThan(missed * 4);
    expect(lost).toBe(0);
    expect(leaving.size).toBeGreaterThan(200); // arrivals got through the exit to the landside
  });
});

describe('security', () => {
  it('reports a breach until the airside is walled off, and needs an arrivals exit', () => {
    const s = demoGame();
    expect(securityReport(s)).toMatchObject({ applies: true, breach: false, trapped: false, badLanes: 0 });
    const exit = s.buildings.find((b) => b.kind === 'exit')!;
    bulldozeAt(s, exit.x, exit.y);
    expect(securityReport(s).breach).toBe(true); // a bulldozed exit leaves a gap in the barrier
    paintRect(s, 'barrier', exit.x, exit.y, exit.x + 1, exit.y);
    expect(securityReport(s)).toMatchObject({ breach: false, trapped: true });
    bulldozeAt(s, 30, 63);
    expect(securityReport(s).breach).toBe(true);
  });

  it('lets arrivals out through the exit but keeps departures out', () => {
    const s = demoGame();
    const exit = s.buildings.find((b) => b.kind === 'exit')!;
    const entrance = s.buildings.find((b) => b.kind === 'entrance')!;
    const gate = s.buildings.find((b) => b.kind === 'gate')!;
    const [gx, gy] = accessTile(gate);
    expect(distanceTo(s, entrance, gx + 0.5, gy + 0.5, true)).toBeLessThan(UNREACHABLE);
    expect(walkable(s, exit.x, exit.y, false)).toBe(false);
    expect(walkable(s, exit.x, exit.y, true)).toBe(true);
  });
});
