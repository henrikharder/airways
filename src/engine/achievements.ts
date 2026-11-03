import { airport } from '../data/airports';
import { distance } from './geo';
import { addNews, companyValue, fleetOf, player, recentSum, routesOf } from './state';
import type { GameState } from './types';

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  test: (s: GameState) => boolean;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first_route', name: 'Wheels Up', desc: 'Open your first route', test: (s) => routesOf(s, s.playerCode).length > 0 },
  { id: 'fleet_5', name: 'Small Fleet', desc: 'Operate 5 aircraft', test: (s) => fleetOf(s, s.playerCode).length >= 5 },
  { id: 'fleet_25', name: 'Serious Contender', desc: 'Operate 25 aircraft', test: (s) => fleetOf(s, s.playerCode).length >= 25 },
  { id: 'fleet_100', name: 'Mega Carrier', desc: 'Operate 100 aircraft', test: (s) => fleetOf(s, s.playerCode).length >= 100 },
  { id: 'pax_100k', name: '100k Club', desc: 'Carry 100,000 passengers', test: (s) => player(s).lifetimePax >= 1e5 },
  { id: 'pax_10m', name: 'Ten Million Smiles', desc: 'Carry 10 million passengers', test: (s) => player(s).lifetimePax >= 1e7 },
  { id: 'longhaul', name: 'Over the Horizon', desc: 'Open a route longer than 7,000 km', test: (s) => routesOf(s, s.playerCode).some((r) => distance(r.from, r.to) > 7000) },
  { id: 'continents', name: 'Around the World', desc: 'Serve every continent', test: (s) => new Set(routesOf(s, s.playerCode).flatMap((r) => [airport(r.from).region, airport(r.to).region])).size >= 7 },
  { id: 'hub', name: 'Hub & Spoke', desc: 'Connect 1,000 transfer passengers in a day', test: (s) => player(s).today.transferPax >= 1000 },
  { id: 'profit_month', name: 'In the Black', desc: 'Finish a month with a profit', test: (s) => player(s).history.some((h) => h.profit > 0) },
  { id: 'value_1b', name: 'Unicorn', desc: 'Reach a company value of $1B', test: (s) => companyValue(s, player(s)) >= 1e9 },
  { id: 'top10', name: 'Top Ten', desc: 'Rank in the top 10 airlines by passengers', test: (s) => paxRank(s) <= 10 },
  { id: 'number_one', name: 'King of the Skies', desc: 'Become the #1 airline by passengers', test: (s) => paxRank(s) === 1 },
];

export function paxRank(s: GameState): number {
  const p = player(s);
  const mine = recentSum(p, 'pax');
  if (mine <= 0) return s.airlines.length;
  return 1 + s.airlines.filter((a) => a !== p && recentSum(a, 'pax') > mine).length;
}

export function checkAchievements(s: GameState): void {
  for (const a of ACHIEVEMENTS) {
    if (s.achievements.includes(a.id)) continue;
    if (a.test(s)) {
      s.achievements.push(a.id);
      addNews(s, `Milestone unlocked: ${a.name} — ${a.desc}.`, 'good');
    }
  }
}
