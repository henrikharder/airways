// Milestones: long-term goals for any game, unlocked once each. Checked after
// every departure and every morning.

import { acType } from '../data/aircraft';
import { addNews } from './news';
import { terminals } from './terminals';
import type { Flight, GameState } from './types';

export interface Milestone { id: string; title: string; desc: string; done: (s: GameState, f?: Flight) => boolean }

const yesterday = (s: GameState) => s.history[s.history.length - 1];

export const MILESTONES: Milestone[] = [
  { id: 'first', title: 'Wheels up', desc: 'Your first departure.', done: (s) => (s.totals?.departures ?? 0) >= 1 },
  { id: 'widebody', title: 'Going long-haul', desc: 'A widebody departs.', done: (_s, f) => !!f && acType(f.typeId).category === 'widebody' },
  { id: 'a380', title: 'Superjumbo', desc: 'An A380 departs.', done: (_s, f) => f?.typeId === 'A388' },
  { id: 'airlines10', title: 'Ten carriers', desc: '10 airlines fly here at once.', done: (s) => new Set(s.contracts.map((c) => c.airline)).size >= 10 },
  { id: 'pax100k', title: '100,000 passengers', desc: 'Handle 100,000 passengers in total.', done: (s) => (s.totals?.pax ?? 0) >= 100_000 },
  { id: 'pax1m', title: 'A million passengers', desc: 'Handle 1,000,000 passengers in total.', done: (s) => (s.totals?.pax ?? 0) >= 1_000_000 },
  { id: 'perfect', title: 'Perfect day', desc: '20+ departures in a day, none late and almost no one missing a flight.', done: (s) => { const y = yesterday(s); return !!y && y.departures >= 20 && (y.late ?? 0) === 0 && (y.missed ?? 0) <= 5; } },
  { id: 'hub', title: 'A real hub', desc: '1,000 connecting passengers in a day.', done: (s) => (yesterday(s)?.transfers ?? 0) >= 1000 },
  { id: 'runways2', title: 'Parallel runways', desc: 'Operate two runways.', done: (s) => s.buildings.filter((b) => b.kind === 'runway').length >= 2 && (s.totals?.departures ?? 0) > 0 },
  { id: 'terminals3', title: 'Three terminals', desc: 'Run three separate terminals.', done: (s) => terminals(s).list.length >= 3 },
  { id: 'nightowl', title: 'Night owl', desc: '5 night departures in a day.', done: (s) => (yesterday(s)?.nightDeps ?? 0) >= 5 },
  { id: 'rating85', title: 'Five-star airport', desc: 'Reach a rating of 85.', done: (s) => s.rating >= 85 },
  { id: 'rich', title: 'Deep pockets', desc: 'Hold $100M in cash.', done: (s) => s.cash >= 100_000_000 },
];

/** Unlock anything newly achieved (pass the flight that just departed, if any). */
export function checkMilestones(s: GameState, f?: Flight): void {
  const have = (s.milestones ??= []);
  for (const m of MILESTONES) {
    if (have.includes(m.id) || !m.done(s, f)) continue;
    have.push(m.id);
    addNews(s, `Milestone: ${m.title}. ${m.desc}`, 'good');
  }
}
