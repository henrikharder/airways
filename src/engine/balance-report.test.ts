import { it } from 'vitest';
import { acType, econSeatsFor } from '../data/aircraft';
import { AIRPORTS } from '../data/airports';
import { suggestedFares } from './actions';
import { distance } from './geo';
import { leaseRate, maxWeekly } from './model';
import { createGame } from './newgame';
import { estimateRoute } from './planner';

// Balance report, not a pass/fail test: BALANCE=1 npx vitest run src/engine/scan.test.ts --disableConsoleIntercept
it.skipIf(!process.env.BALANCE)('opportunity scan per hub', () => {
  for (const hub of ['CPH', 'LHR', 'JFK', 'SIN', 'DEN', 'NBO']) {
    const s = createGame({ name: 'T', code: 'ZZ', color: '#fff', hub, difficulty: 'normal' });
    const rows: string[] = [];
    const res: { to: string; type: string; w: number; p: number; lf: number; rivals: number }[] = [];
    for (const ap of AIRPORTS) {
      if (ap.iata === hub) continue;
      const d = distance(hub, ap.iata);
      let best: (typeof res)[number] | null = null;
      for (const typeId of ['AT76', 'E295', 'A20N', 'A21N', 'B789', 'A359']) {
        const t = acType(typeId);
        if (t.rangeKm < d) continue;
        const biz = typeId === 'AT76' ? 0 : t.defaultBiz;
        for (const w of [3, 7, 14, 21]) {
          const ww = Math.min(w, maxWeekly(t, d));
          const f = suggestedFares(hub, ap.iata);
          const e = estimateRoute(s, hub, ap.iata, [{ ac: { typeId, biz, econ: econSeatsFor(t, biz), ageDays: 0, ownership: 'leased', leaseMonthly: leaseRate(t) }, weekly: ww }], f.y, f.j);
          if (!best || e.profit > best.p) best = { to: ap.iata, type: typeId, w: ww, p: e.profit, lf: e.lf, rivals: e.competitors.length };
        }
      }
      if (best) res.push(best);
    }
    res.sort((a, b) => b.p - a.p);
    const positive = res.filter((r) => r.p > 0).length;
    for (const r of res.slice(0, 6)) rows.push(`  ${r.to} ${r.type} ${r.w}/wk lf ${r.lf.toFixed(2)} ${Math.round(r.p / 1000)}k/day rivals ${r.rivals}`);
    console.log(`${hub}: ${positive} profitable destinations of ${res.length}\n${rows.join('\n')}`);
  }
}, 120000);
