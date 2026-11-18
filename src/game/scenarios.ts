// Scenarios: ways to start a game. Sandbox is the empty field; the others hand
// you a working airport and a goal with a deadline. Goals are checked daily;
// win or lose, you can keep playing.

import { buildDemo } from './demo';
import { acceptOffer } from './flights';
import { place } from './grid';
import { addNews } from './news';
import { staffToNeed } from './staff';
import type { GameState } from './types';

export type GoalKind = 'paxWeek' | 'transfersDay';

export interface ScenarioDef {
  id: string;
  title: string;
  blurb: string;
  goal?: { kind: GoalKind; target: number; label: string; byDay: number };
  setup(s: GameState): void;
}

export const SCENARIOS: ScenarioDef[] = [
  { id: 'sandbox', title: 'Sandbox', blurb: 'An empty field and $9M. Build whatever you like.', setup: () => {} },
  {
    id: 'regional', title: 'Regional airport', blurb: 'A small working airport with two airlines and $4M. Grow it into a busy regional airport.',
    goal: { kind: 'paxWeek', target: 20_000, label: 'Handle 20,000 passengers in a week', byDay: 21 },
    setup: (s) => { buildDemo(s); s.cash = 4_000_000; s.today.construction = 0; staffToNeed(s); },
  },
  {
    id: 'hub', title: 'Hub challenge', blurb: 'A mid-size airport with a transfer desk, a lounge and $15M. Turn it into a connecting hub.',
    goal: { kind: 'transfersDay', target: 1_200, label: 'Connect 1,200 transfer passengers in one day', byDay: 30 },
    setup: (s) => {
      buildDemo(s);
      place(s, 'transfer', 56, 57, 0);
      place(s, 'lounge', 30, 56, 0);
      // a few network routes so connections start flowing; growing them is the challenge
      for (const [airline, dest, typeId] of [['SK', 'OSL', 'A20N'], ['LH', 'FRA', 'A20N'], ['KL', 'AMS', 'B738']] as const) {
        const id = ++s.nextId;
        s.offers.push({ id, airline, dest, typeId, perDay: 2, load: 0.8, expires: 99, minRating: 0 });
        acceptOffer(s, id);
      }
      s.cash = 15_000_000;
      s.today.construction = 0;
      staffToNeed(s);
    },
  },
];

export function scenarioDef(s: GameState): ScenarioDef | undefined {
  return SCENARIOS.find((x) => x.id === s.scenario?.id);
}

export function startScenario(s: GameState, id: string): void {
  const def = SCENARIOS.find((x) => x.id === id) ?? SCENARIOS[0];
  def.setup(s);
  s.scenario = { id: def.id };
  if (def.goal) addNews(s, `Goal: ${def.goal.label} by day ${def.goal.byDay}.`, 'neutral');
}

/** Best result so far towards the goal, and how it reads. */
export function scenarioProgress(s: GameState): { value: number; text: string } | null {
  const g = scenarioDef(s)?.goal;
  if (!g) return null;
  const days = [...s.history, { ...s.today, day: Math.floor(s.minute / 1440) }];
  let best = 0;
  if (g.kind === 'paxWeek') for (let i = 0; i < days.length; i++) best = Math.max(best, days.slice(Math.max(0, i - 6), i + 1).reduce((n, d) => n + d.passengers, 0));
  else best = Math.max(0, ...days.map((d) => d.transfers ?? 0));
  return { value: best / g.target, text: `${Math.round(best).toLocaleString('en-US')} / ${g.target.toLocaleString('en-US')}` };
}

/** Daily: won, or out of time? */
export function checkScenario(s: GameState): void {
  const g = scenarioDef(s)?.goal;
  if (!g || s.scenario?.result) return;
  const p = scenarioProgress(s)!;
  const day = Math.floor(s.minute / 1440) + 1;
  if (p.value >= 1) {
    s.scenario!.result = 'won';
    addNews(s, `Goal reached on day ${day}: ${g.label}!`, 'good');
  } else if (day > g.byDay) {
    s.scenario!.result = 'lost';
    addNews(s, `Day ${g.byDay} has passed without reaching the goal. You can keep building.`, 'bad');
  }
}
