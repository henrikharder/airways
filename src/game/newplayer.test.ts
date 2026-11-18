import { describe, expect, it } from 'vitest';
import { standFits } from './catalog';
import { crossesBorder } from './border';
import { acceptOffer } from './flights';
import { bulldozeAt, paintRect, place } from './grid';
import { createGame } from './newgame';
import { advance } from './sim';
import { serviceStats } from './passengers';
import type { Flight } from './types';
import { staffToNeed } from './staff';
import type { GameState, ModuleKind } from './types';
import { income, profit } from './types';

/**
 * A scripted new player: starts from an empty field with the normal budget,
 * builds a modest starter airport, signs airlines that fit, and expands when
 * it can afford to. Two weeks, with a daily report: does a sensible player
 * survive and grow, and is the early game tight but fair?
 */
function starter(s: GameState): string[] {
  const errors: string[] = [];
  const put = (kind: ModuleKind, x: number, y: number, rot = 0) => { const r = place(s, kind, x, y, rot); if (!r.ok) errors.push(`${kind}@${x},${y}: ${r.reason}`); };
  put('runway', 20, 10);
  put('tower', 90, 30);
  paintRect(s, 'taxiway', 50, 15, 51, 39);
  paintRect(s, 'taxiway', 38, 40, 64, 41);
  put('stand_m', 41, 42);
  put('stand_m', 52, 42);
  paintRect(s, 'floor', 40, 52, 62, 68);
  put('gate', 44, 52); put('gate', 55, 52);
  put('toilets', 42, 57); put('food', 58, 56);
  put('security', 50, 60);
  paintRect(s, 'barrier', 40, 61, 62, 61);
  put('exit', 58, 61);
  put('baggage', 42, 63); put('checkin', 46, 65);
  put('entrance', 50, 68, 2);
  put('carpark', 64, 81);
  staffToNeed(s);
  return errors;
}

describe('new player', () => {
  it('can build a starter airport and grow it over two weeks', () => {
    const s = createGame({ name: 'Test', code: 'TST', city: 'CPH' });
    const errors = starter(s);
    expect(errors).toEqual([]);
    const built = 9_000_000 - s.cash;
    const days: Record<string, number | string>[] = [];
    let expansions = 0;
    for (let d = 0; d < 14; d++) {
      // the player's morning routine: sign offers that fit, if there is room
      const stands = s.buildings.filter((b) => b.kind.startsWith('stand_'));
      for (const o of [...s.offers]) {
        const perStand = s.contracts.reduce((n, c) => n + c.perDay, 0) / stands.length;
        if (perStand < 6 && stands.some((b) => standFits(b.kind, o.typeId)) && s.rating >= o.minRating) acceptOffer(s, o.id);
      }
      // expand when busy and affordable: another stand + gate, then a baggage hall
      const perStand = s.contracts.reduce((n, c) => n + c.perDay, 0) / stands.length;
      if (perStand >= 5 && s.cash > 1_500_000 && expansions < 2) {
        const x = 30 - expansions * 11;
        paintRect(s, 'taxiway', x - 2, 40, 38, 41);
        const a = place(s, 'stand_m', x, 42, 0);
        paintRect(s, 'floor', x + 2, 52, 39, 60);
        const g = place(s, 'gate', x + 3, 52, 0);
        if (a.ok && g.ok) { expansions++; staffToNeed(s); }
      }
      if (!s.buildings.some((b) => b.kind === 'bagsort') && s.contracts.length >= 4 && s.cash > 1_200_000) {
        if (place(s, 'bagsort', 65, 36, 0).ok) staffToNeed(s);
      }
      // the warning says non-Schengen routes need passport control: build it
      if (!s.buildings.some((b) => b.kind === 'passport') && s.contracts.some((c) => crossesBorder(s.city, c.dest))) place(s, 'passport', 47, 56, 0);
      const start = s.cash;
      const seen = new Map<number, Flight>();
      let maxSec = 0, maxChk = 0;
      for (let m = 0; m < 24 * 60; m += 10) {
        advance(s, 10);
        for (const f of s.flights) if (f.phase === 'departed' || f.phase === 'cancelled') seen.set(f.id, f);
        for (const b of s.buildings) {
          if (b.kind === 'security') maxSec = Math.max(maxSec, serviceStats(b.id, s.minute).wait);
          if (b.kind === 'checkin') maxChk = Math.max(maxChk, serviceStats(b.id, s.minute).wait);
        }
      }
      const fl = [...seen.values()].filter((f) => f.dep >= s.minute - 26 * 60);
      // like a real player, add desks and lanes when the queues get long
      if (maxChk > 20) {
        const spots: [number, number][] = [[52, 65], [56, 65]];
        const have = s.buildings.filter((b) => b.kind === 'checkin').length - 1;
        if (spots[have] && place(s, 'checkin', ...spots[have], 0).ok) staffToNeed(s);
      }
      if (maxSec > 15) {
        const lanes = [53, 47];
        const have = s.buildings.filter((b) => b.kind === 'security').length - 1;
        const x = lanes[have];
        if (x !== undefined) {
          bulldozeAt(s, x, 61); bulldozeAt(s, x + 1, 61); // open the barrier where the lane goes
          if (place(s, 'security', x, 60, 0).ok) staffToNeed(s);
        }
      }
      const y = s.history[s.history.length - 1];
      days.push({
        day: d + 1, cash: Math.round(s.cash / 1000), dCash: Math.round((s.cash - start) / 1000), income: Math.round(income(y) / 1000),
        upkeep: Math.round(y.upkeep / 1000), wages: Math.round(y.wages / 1000), profit: Math.round(profit(y) / 1000),
        dep: y.departures, contracts: s.contracts.length, stands: s.buildings.filter((b) => b.kind.startsWith('stand_')).length,
        rating: Math.round(s.rating), conf: Math.round(s.board.confidence),
        late: fl.filter((f) => f.delayed > 15).length, canc: fl.filter((f) => f.phase === 'cancelled').length,
        missed: fl.reduce((n, f) => n + f.missed, 0), bagsLeft: fl.reduce((n, f) => n + f.bagsLeft, 0),
        chkWait: Math.round(maxChk), secWait: Math.round(maxSec), hall: s.buildings.some((b) => b.kind === 'bagsort') ? 1 : 0,
      });
    }
    console.log(`built for $${Math.round(built / 1000)}k`);
    console.table(days);
    console.log(s.news.slice(0, 12).map((n) => n.text).join('\n'));
    expect(s.gameOver).toBe(false);
  });
});
