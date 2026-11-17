import { describe, expect, it } from 'vitest';
import { demoGame } from './demo';
import { checkPlace, paintRect, place } from './grid';
import { createGame } from './newgame';
import { aircraftPath } from './paths';
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

describe('airport simulation', () => {
  it('lands, turns around and departs flights with boarded passengers', () => {
    const s = demoGame();
    expect(s.buildings.filter((b) => b.kind === 'stand_m').every((b) => b.link)).toBe(true);
    let peak = 0, lost = 0;
    const done = new Map<number, { boarded: number; missed: number }>();
    for (let i = 0; i < 48 * 60; i += 10) {
      advance(s, 10);
      peak = Math.max(peak, s.pax.length);
      lost = Math.max(lost, s.pax.filter((p) => p.state === 'lost').length);
      for (const f of s.flights) if (f.phase === 'departed') done.set(f.id, f); // old flights get pruned
    }
    const departures = s.history.reduce((n, d) => n + d.departures, 0) + s.today.departures;
    const boarded = [...done.values()].reduce((n, f) => n + f.boarded, 0);
    const missed = [...done.values()].reduce((n, f) => n + f.missed, 0);
    expect(s.flights.filter((f) => f.phase === 'cancelled')).toHaveLength(0);
    console.log({ departures, boarded, missed, peak, lost, cash: Math.round(s.cash), rating: s.rating.toFixed(1) });
    expect(departures).toBeGreaterThanOrEqual(7);
    expect(boarded).toBeGreaterThan(missed * 4);
    expect(lost).toBe(0);
  });
});
