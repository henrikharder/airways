import { describe, expect, it } from 'vitest';
import { expandedGame } from './expanded';
import { serviceStats } from './passengers';
import { advance } from './sim';
import type { Flight } from './types';

// Soak test of a big airport: three days of traffic, with a daily report.
describe('expanded airport', () => {
  it('runs three busy days without gridlock', () => {
    const s = expandedGame();
    const done = new Map<number, Flight>();
    let peak = 0, lost = 0, maxCheckinWait = 0, maxSecurityWait = 0, maxPassportWait = 0, maxHeld = 0;
    for (let m = 0; m < 3 * 24 * 60; m += 10) {
      advance(s, 10);
      peak = Math.max(peak, s.pax.length);
      lost = Math.max(lost, s.pax.filter((p) => p.state === 'lost').length);
      for (const b of s.buildings) {
        if (b.kind === 'checkin') maxCheckinWait = Math.max(maxCheckinWait, serviceStats(b.id, s.minute).wait);
        if (b.kind === 'security') maxSecurityWait = Math.max(maxSecurityWait, serviceStats(b.id, s.minute).wait);
        if (b.kind === 'passport') maxPassportWait = Math.max(maxPassportWait, serviceStats(b.id, s.minute).wait);
      }
      maxHeld = Math.max(maxHeld, s.flights.filter((f) => f.phase === 'parked' && s.minute > f.dep + 1).length);
      for (const f of s.flights) if (f.phase === 'departed' || f.phase === 'cancelled') done.set(f.id, f);
    }
    const fs = [...done.values()];
    const remoteIds = new Set(s.buildings.filter((b) => b.kind.startsWith('stand_') && !b.link).map((b) => b.id));
    const dep = fs.filter((f) => f.phase === 'departed');
    const report = {
      departures: dep.length,
      cancelled: fs.filter((f) => f.phase === 'cancelled').length,
      late15: dep.filter((f) => f.delayed > 15).length,
      avgDelay: +(dep.reduce((n, f) => n + f.delayed, 0) / Math.max(1, dep.length)).toFixed(1),
      boarded: dep.reduce((n, f) => n + f.boarded, 0),
      missed: dep.reduce((n, f) => n + f.missed, 0),
      bagsLeft: dep.reduce((n, f) => n + f.bagsLeft, 0),
      night: dep.filter((f) => f.night).length,
      remote: dep.filter((f) => remoteIds.has(f.stand ?? -1)).length,
      remoteBoarded: dep.filter((f) => remoteIds.has(f.stand ?? -1)).reduce((n, f) => n + f.boarded, 0),
      peak, lost, maxCheckinWait: Math.round(maxCheckinWait), maxSecurityWait: Math.round(maxSecurityWait), maxPassportWait: Math.round(maxPassportWait), maxHeld,
      rating: Math.round(s.rating), goodwill: Math.round(s.goodwill), cash: Math.round(s.cash),
      days: s.history.map((d) => ({ day: d.day + 1, dep: d.departures, pax: d.passengers, profit: Math.round(d.landing + d.paxFees + d.food + d.retail + d.parking - d.upkeep - d.wages) })),
    };
    console.log(JSON.stringify(report, null, 1));
    expect(report.departures).toBeGreaterThan(60);
    expect(report.lost).toBe(0);
  });
});
