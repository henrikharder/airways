import { AIRLINES } from '../data/airlines';
import { AIRPORT_BY_CODE, airport } from '../data/airports';
import { createAIRoute } from './ai';
import { distance, pairKey } from './geo';
import { refreshUsedMarket } from './market';
import { baseDemand } from './model';
import { simulateDay } from './sim';
import { addNews } from './state';
import { createBoard } from './board';
import { SAVE_VERSION } from './save';
import type { Airline, Difficulty, GameState, LiveryPattern } from './types';
import { emptyLedger } from './types';

export interface NewGameOptions {
  name: string;
  code: string;
  color: string;
  hub: string;
  difficulty: Difficulty;
  pattern?: LiveryPattern;
}

export const START_CASH: Record<Difficulty, number> = { easy: 200e6, normal: 100e6, hard: 40e6 };
const WARMUP_DAYS = 42;

function blankAirline(partial: Partial<Airline> & Pick<Airline, 'code' | 'name' | 'color' | 'isPlayer' | 'style' | 'bases'>): Airline {
  return {
    cash: 0, reputation: 50, baseReputation: 50, lifetimePax: 0, awareness: {}, service: 1, marketingPerMonth: 0,
    aggression: 0, fleetTypes: [], loans: [], today: emptyLedger(), recent: [], month: emptyLedger(), history: [],
    fareWarUntil: 0, ...partial,
  };
}

export function createGame(o: NewGameOptions): GameState {
  const hub = airport(o.hub);
  const p = blankAirline({
    code: o.code, name: o.name, color: o.color, isPlayer: true, style: 'player', bases: [o.hub],
    cash: START_CASH[o.difficulty], reputation: 55, baseReputation: 55,
    livery: { pattern: o.pattern ?? 'classic', primary: o.color, secondary: '#0b1220' },
  });
  for (const a of Object.values(AIRPORT_BY_CODE)) {
    p.awareness[a.iata] = a.iata === o.hub ? 0.5 : a.country === hub.country ? 0.25 : 0.08;
  }

  const s: GameState = {
    version: SAVE_VERSION, minute: 0, day: 0, playerCode: o.code, difficulty: o.difficulty,
    airlines: [p], aircraft: [], routes: [], used: [], events: [], news: [],
    fuelPrice: 0.85, achievements: [], tutorialDone: false, bankruptDays: 0, gameOver: false, nextId: 0,
    decisions: [], reviews: [], board: null as unknown as GameState['board'],
  };

  const seeds = AIRLINES.filter((a) => a.code !== o.code);
  const carriers = new Map<string, number>();
  const plans: { code: string; from: string; to: string }[] = [];
  for (const seed of seeds) {
    const seen = new Set<string>();
    for (const spec of seed.routes) {
      const [from, to] = spec.split('-');
      const key = pairKey(from, to);
      if (seen.has(key) || !AIRPORT_BY_CODE[from] || !AIRPORT_BY_CODE[to]) continue;
      seen.add(key);
      plans.push({ code: seed.code, from, to });
      carriers.set(key, (carriers.get(key) ?? 0) + 1);
    }
    s.airlines.push(blankAirline({
      code: seed.code, name: seed.name, color: seed.color, isPlayer: false, style: seed.style, bases: seed.hubs,
      reputation: seed.reputation, baseReputation: seed.reputation, aggression: seed.aggression, fleetTypes: seed.fleet,
      service: seed.style === 'lowcost' ? 0 : seed.style === 'premium' ? 2 : 1, cash: 2e9,
    }));
  }

  const spokes = new Map<string, number>();
  for (const pl of plans) spokes.set(`${pl.code}:${pl.from}`, (spokes.get(`${pl.code}:${pl.from}`) ?? 0) + 1);
  for (const pl of plans) {
    const a = s.airlines.find((x) => x.code === pl.code)!;
    const n = carriers.get(pairKey(pl.from, pl.to))!;
    const hubBoost = (spokes.get(`${pl.code}:${pl.from}`) ?? 0) >= 12 && distance(pl.from, pl.to) > 1500 ? 1.6 : 1.1;
    createAIRoute(s, a, pl.from, pl.to, (baseDemand(pl.from, pl.to).total * 0.95 * hubBoost) / n);
  }

  // Let the AI settle its capacity before the player arrives.
  for (let i = 0; i < WARMUP_DAYS; i++) simulateDay(s, { warmup: true });
  s.day = 0;
  s.minute = 0;
  for (const r of s.routes) r.openedDay = -365;
  p.recent = [];
  p.month = emptyLedger();
  p.cash = START_CASH[o.difficulty];
  p.reputation = 55;
  s.news = [];
  refreshUsedMarket(s);
  createBoard(s);
  addNews(s, `Welcome to Airways! ${o.name} is born at ${hub.name}, ${hub.city}. Lease your first aircraft and open a route.`, 'good');
  return s;
}
