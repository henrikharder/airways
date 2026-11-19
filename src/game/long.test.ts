import { expect, it } from 'vitest';
import { standFits } from './catalog';
import { expandedGame } from './expanded';
import { acceptOffer } from './flights';
import { advance } from './sim';
import { staffToNeed } from './staff';
import type { Flight } from './types';
import { profit } from './types';

// Opt-in (LONG=1 npm test): 60 days of the large airport with an active player
// who accepts every offer that fits. A long-game playtest, about two minutes.
it.skipIf(!process.env.LONG)('survives 60 days of greedy growth', () => {
  const s = expandedGame();
  s.cash = 20_000_000;
  const rows: string[] = [];
  let meetings = 0, met = 0;
  for (let d = 0; d < 60 && !s.gameOver; d++) {
    for (const o of [...s.offers]) if (s.buildings.some((b) => standFits(b.kind, o.typeId)) && s.rating >= o.minRating) acceptOffer(s, o.id);
    staffToNeed(s);
    const done = new Map<number, Flight>();
    for (let m = 0; m < 1440; m += 10) {
      advance(s, 10);
      for (const f of s.flights) if (f.phase === 'departed' || f.phase === 'cancelled') done.set(f.id, f);
      if (s.board.meeting) { meetings++; if (s.board.meeting.success) met++; s.board.meeting = null; }
    }
    const fs = [...done.values()];
    const y = s.history[s.history.length - 1];
    if (d % 5 === 4) rows.push(`d${d + 1} cash ${(s.cash / 1e6).toFixed(1)}M profit ${Math.round(profit(y) / 1e3)}k dep ${y.departures} canc ${fs.filter((f) => f.phase === 'cancelled').length} late ${fs.filter((f) => f.delayed > 15).length} missed ${fs.reduce((n, f) => n + f.missed, 0)} rating ${Math.round(s.rating)} conf ${Math.round(s.board.confidence)} contracts ${s.contracts.length} perDay ${s.contracts.reduce((n, c) => n + c.perDay, 0)} met ${met}/${meetings}`);
  }
  console.log(rows.join('\n'));
  console.log(`gameOver ${s.gameOver}; news: ${s.news.slice(0, 6).map((n) => n.text).join(' | ')}`);
  expect(s.gameOver).toBe(false);
}, 600_000);
