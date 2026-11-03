// Quarterly board meetings: the board sets an objective each quarter and
// rewards or punishes the result. If confidence hits zero, you're out.

import { airport, type Region } from '../data/airports';
import { addNews, companyValue, fleetOf, player, routesOf } from './state';
import { dateOf } from './time';
import type { Board, GameState, Objective } from './types';
import { emptyLedger, totalCost } from './types';

const REGION_NAME: Record<Region, string> = {
  NA: 'North America', SA: 'South America', EU: 'Europe', ME: 'the Middle East', AF: 'Africa', AS: 'Asia', OC: 'Oceania',
};

export function quarterLabel(day: number): string {
  const d = dateOf(day);
  return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
}

export function isQuarterStart(day: number): boolean {
  const d = dateOf(day);
  return d.getUTCDate() === 1 && d.getUTCMonth() % 3 === 0;
}

function servedRegions(s: GameState): Set<string> {
  return new Set(routesOf(s, s.playerCode).flatMap((r) => [airport(r.from).region, airport(r.to).region]));
}

export function newObjective(s: GameState): Objective {
  const p = player(s);
  const routes = routesOf(s, p.code).length;
  const fleet = fleetOf(s, p.code).length;
  const reward = Math.round(Math.min(25e6, Math.max(5e6, companyValue(s, p) * 0.03)) / 1e6) * 1e6;
  const q = s.board?.quarter;
  const options: Objective[] = [];
  if (routes < 3) {
    return { kind: 'routes', target: 3, label: 'Operate at least 3 routes', reward };
  }
  options.push({ kind: 'routes', target: routes + 2, label: `Operate ${routes + 2} routes`, reward });
  options.push({ kind: 'fleet', target: fleet + 2, label: `Grow the fleet to ${fleet + 2} aircraft`, reward });
  options.push({ kind: 'lf', target: 0.8, label: 'Average 80% load factor this quarter', reward });
  const lastProfit = q ? q.revenue - totalCost(q) : 0;
  const profitTarget = Math.max(2e6, Math.round((lastProfit * 1.15) / 1e6) * 1e6);
  options.push({ kind: 'profit', target: profitTarget, label: `Earn $${profitTarget / 1e6}M profit this quarter`, reward });
  const paxTarget = Math.max(50_000, Math.round(((q?.pax ?? 0) * 1.2) / 10_000) * 10_000);
  options.push({ kind: 'pax', target: paxTarget, label: `Carry ${paxTarget.toLocaleString('en-US')} passengers this quarter`, reward });
  const missing = (Object.keys(REGION_NAME) as Region[]).filter((r) => !servedRegions(s).has(r));
  if (missing.length) {
    const r = missing[Math.floor(Math.random() * missing.length)];
    options.push({ kind: 'region', target: 1, region: r, label: `Launch a route to ${REGION_NAME[r]}`, reward });
  }
  return options[Math.floor(Math.random() * options.length)];
}

/** Progress towards the objective, 0..1+ */
export function objectiveProgress(s: GameState): { value: number; text: string } {
  const o = s.board.objective;
  const q = s.board.quarter;
  switch (o.kind) {
    case 'routes': { const n = routesOf(s, s.playerCode).length; return { value: n / o.target, text: `${n}/${o.target} routes` }; }
    case 'fleet': { const n = fleetOf(s, s.playerCode).length; return { value: n / o.target, text: `${n}/${o.target} aircraft` }; }
    case 'lf': { const lf = q.ask ? q.rpk / q.ask : 0; return { value: lf / o.target, text: `${Math.round(lf * 100)}% / ${Math.round(o.target * 100)}%` }; }
    case 'profit': { const pr = q.revenue - totalCost(q); return { value: pr / o.target, text: `$${(pr / 1e6).toFixed(1)}M / $${o.target / 1e6}M` }; }
    case 'pax': return { value: q.pax / o.target, text: `${Math.round(q.pax).toLocaleString('en-US')} / ${o.target.toLocaleString('en-US')}` };
    case 'region': { const ok = servedRegions(s).has(o.region!); return { value: ok ? 1 : 0, text: ok ? 'Done' : 'Not yet' }; }
  }
}

export function createBoard(s: GameState): Board {
  const b: Board = { confidence: 70, objective: { kind: 'routes', target: 3, label: 'Operate at least 3 routes', reward: 5e6 }, quarter: emptyLedger(), meeting: null };
  s.board = b;
  b.objective = newObjective(s);
  return b;
}

/** Run at the start of each day, after the previous quarter's results are in. */
export function boardTick(s: GameState): void {
  if (!isQuarterStart(s.day) || s.day === 0) return;
  const p = player(s);
  const b = s.board;
  const { value } = objectiveProgress(s);
  const success = value >= 1;
  const done = b.objective;
  if (success) {
    p.cash += done.reward;
    p.reputation = Math.min(100, p.reputation + 2);
    b.confidence = Math.min(100, b.confidence + 12);
  } else {
    p.reputation = Math.max(0, p.reputation - 2);
    b.confidence = Math.max(0, b.confidence - 18);
  }
  const prevQuarter = quarterLabel(s.day - 1);
  const next = newObjective(s);
  b.meeting = {
    title: `${prevQuarter} board meeting`,
    success,
    summary: success
      ? `Objective met: “${done.label}”. The board releases a $${done.reward / 1e6}M growth bonus.`
      : `Objective missed: “${done.label}”. The chair reminds you that patience is not infinite.`,
    next: next.label,
  };
  b.objective = next;
  b.quarter = emptyLedger();
  addNews(s, `${prevQuarter} board meeting: ${success ? 'objective met, bonus released' : 'objective missed, board unimpressed'}.`, success ? 'good' : 'bad');
  if (b.confidence <= 0) {
    s.gameOver = true;
    s.gameOverReason = 'fired';
    addNews(s, `The board has lost confidence and replaces the CEO of ${p.name}.`, 'bad');
  }
}
