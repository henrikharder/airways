// Weekly board meetings: an objective each week with a cash bonus; miss too
// many and the board replaces you.

import { addNews } from './news';
import type { Board, GameState, Objective } from './types';
import { emptyLedger, profit } from './types';

const money = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1000)}k`);

export function weekLabel(s: GameState): string {
  return `Week ${Math.floor(s.minute / 1440 / 7) + 1}`;
}

export function newObjective(s: GameState): Objective {
  const w = s.board?.week;
  const airlines = new Set(s.contracts.map((c) => c.airline)).size;
  const reward = Math.min(4_000_000, 600_000 + Math.round((s.history.slice(-7).reduce((n, d) => n + profit(d), 0) * 0.2) / 50_000) * 50_000);
  if (airlines < 2) return { kind: 'airlines', target: 2, label: 'Sign contracts with 2 airlines', reward: Math.max(reward, 800_000) };
  const opts: Objective[] = [
    { kind: 'airlines', target: airlines + 1, label: `Sign a contract with ${airlines + 1} airlines`, reward },
    { kind: 'flights', target: Math.max(6, Math.round(((w?.departures ?? 0) / 7) * 1.3)), label: '', reward },
    { kind: 'pax', target: Math.max(4000, Math.round(((w?.passengers ?? 0) * 1.25) / 500) * 500), label: '', reward },
    { kind: 'rating', target: Math.min(90, Math.max(60, Math.round(s.rating) + 5)), label: '', reward },
    { kind: 'profit', target: Math.max(300_000, Math.round(((w ? profit(w) : 0) * 1.2) / 100_000) * 100_000), label: '', reward },
  ];
  const o = opts[Math.floor(Math.random() * opts.length)];
  if (o.kind === 'flights') o.label = `Average ${o.target} departures a day this week`;
  if (o.kind === 'pax') o.label = `Handle ${o.target.toLocaleString('en-US')} passengers this week`;
  if (o.kind === 'rating') o.label = `Reach an airport rating of ${o.target}`;
  if (o.kind === 'profit') o.label = `Make ${money(o.target)} profit this week`;
  return o;
}

export function progress(s: GameState): { value: number; text: string } {
  const o = s.board.objective;
  const w = s.board.week;
  switch (o.kind) {
    case 'airlines': { const n = new Set(s.contracts.map((c) => c.airline)).size; return { value: n / o.target, text: `${n}/${o.target} airlines` }; }
    case 'flights': { const days = Math.max(1, (s.minute / 1440) % 7); const v = w.departures / days; return { value: v / o.target, text: `${v.toFixed(1)}/${o.target} a day` }; }
    case 'pax': return { value: w.passengers / o.target, text: `${Math.round(w.passengers).toLocaleString('en-US')}/${o.target.toLocaleString('en-US')}` };
    case 'rating': return { value: s.rating / o.target, text: `${Math.round(s.rating)}/${o.target}` };
    case 'profit': { const p = profit(w); return { value: p / o.target, text: `${money(p)}/${money(o.target)}` }; }
  }
}

export function createBoard(s: GameState): Board {
  s.board = { confidence: 70, objective: { kind: 'airlines', target: 2, label: '', reward: 800_000 }, week: emptyLedger(), meeting: null };
  s.board.objective = newObjective(s);
  return s.board;
}

export function weeklyMeeting(s: GameState): void {
  const b = s.board;
  const done = b.objective;
  const success = progress(s).value >= 1;
  if (success) {
    s.cash += done.reward;
    b.confidence = Math.min(100, b.confidence + 12);
  } else {
    b.confidence = Math.max(0, b.confidence - 18);
  }
  const next = newObjective(s);
  b.meeting = {
    title: `${weekLabel(s)} board meeting`,
    success,
    summary: success ? `Objective met: “${done.label}”. The board releases a ${money(done.reward)} bonus.` : `Objective missed: “${done.label}”. The board expected more.`,
    next: next.label,
  };
  b.objective = next;
  b.week = emptyLedger();
  addNews(s, `Board meeting: ${success ? 'objective met, bonus paid' : 'objective missed'}.`, success ? 'good' : 'bad');
  if (b.confidence <= 0) {
    s.gameOver = true;
    addNews(s, 'The board has lost confidence and replaced you as airport director.', 'bad');
  }
}
