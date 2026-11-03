// World events and the witty news that announces them.

import { acType } from '../data/aircraft';
import { AIRPORTS, airport, type Region } from '../data/airports';
import { ashDecision } from './decisions';
import { addNews, newId, player } from './state';
import { dayOfIso } from './time';
import type { ActiveEvent, GameState } from './types';

const REGION_NAME: Record<Region, string> = {
  NA: 'North America', SA: 'South America', EU: 'Europe', ME: 'the Middle East', AF: 'Africa', AS: 'Asia', OC: 'Oceania',
};

const pick = <T,>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];
const between = (a: number, b: number) => a + Math.random() * (b - a);

interface Template {
  weight: number;
  run: (s: GameState) => void;
}

function start(s: GameState, e: Omit<ActiveEvent, 'id'>, news: string, tone: 'good' | 'bad' | 'neutral' | 'rival'): void {
  s.events.push({ ...e, id: newId(s, 'ev') });
  addNews(s, news, tone);
}

const WORLD: Template[] = [
  { weight: 3, run: (s) => { const m = between(1.25, 1.45); start(s, { kind: 'fuel', title: 'Oil price spike', endDay: s.day + Math.round(between(40, 90)), fuelMult: m }, `Brent crude surges after a surprise supply cut. Jet fuel up ${Math.round((m - 1) * 100)}%.`, 'bad'); } },
  { weight: 3, run: (s) => { const m = between(0.75, 0.88); start(s, { kind: 'fuel', title: 'Oil glut', endDay: s.day + Math.round(between(40, 90)), fuelMult: m }, `Oil glut! Jet fuel drops ${Math.round((1 - m) * 100)}%. CFOs everywhere crack a smile.`, 'good'); } },
  { weight: 2, run: (s) => start(s, { kind: 'closure', title: 'French ATC strike', endDay: s.day + 2, closed: true, airports: ['CDG', 'ORY', 'NCE'] }, 'French air traffic controllers walk out. Again. CDG, ORY and NCE closed for 2 days.', 'bad') },
  { weight: 1, run: (s) => {
    const airports = ['KEF', 'DUB', 'EDI', 'MAN', 'LHR', 'LGW', 'STN', 'AMS', 'CPH', 'OSL', 'ARN', 'HEL'];
    start(s, { kind: 'closure', title: 'Volcanic ash cloud', endDay: s.day + 3, closed: true, airports }, 'An Icelandic volcano nobody can pronounce erupts. Ash closes northern European airspace for 3 days.', 'bad');
    ashDecision(s, s.events[s.events.length - 1].id, airports);
  } },
  { weight: 2, run: (s) => start(s, { kind: 'closure', title: 'Typhoon', endDay: s.day + 2, closed: true, airports: pick([['HKG', 'SZX', 'CAN'], ['TPE'], ['MNL'], ['HND', 'NRT']]) }, 'Super typhoon makes landfall. Airports in its path shut for 2 days.', 'bad') },
  { weight: 2, run: (s) => start(s, { kind: 'closure', title: 'Blizzard', endDay: s.day + 2, closed: true, airports: pick([['JFK', 'EWR', 'BOS', 'PHL'], ['ORD', 'MSP', 'DTW'], ['YYZ', 'YUL']]) }, 'Snowmageddon! A blizzard buries the region and grounds everything for 2 days.', 'bad') },
  { weight: 1, run: (s) => start(s, { kind: 'closure', title: 'Hurricane', endDay: s.day + 3, closed: true, airports: ['MIA', 'MCO', 'SJU', 'CUN'] }, 'Hurricane warning across the Caribbean and Florida. Airports closed for 3 days.', 'bad') },
  { weight: 2, run: (s) => { const r = pick(Object.keys(REGION_NAME) as Region[]); start(s, { kind: 'economy', title: `Recession in ${REGION_NAME[r]}`, endDay: s.day + Math.round(between(90, 150)), demandMult: 0.85, region: r }, `Recession hits ${REGION_NAME[r]}. Travellers tighten their belts — demand down 15%.`, 'bad'); } },
  { weight: 2, run: (s) => { const r = pick(Object.keys(REGION_NAME) as Region[]); start(s, { kind: 'economy', title: `Boom in ${REGION_NAME[r]}`, endDay: s.day + Math.round(between(90, 150)), demandMult: 1.12, region: r }, `Economic boom in ${REGION_NAME[r]}! Business travel is back with a vengeance.`, 'good'); } },
  { weight: 3, run: (s) => { const a = pick(AIRPORTS.filter((x) => x.tourism >= 1.4)); start(s, { kind: 'tourism', title: `${a.city} goes viral`, endDay: s.day + 60, demandMult: 1.35, airports: [a.iata] }, `${a.city} goes viral on social media. Everyone suddenly "needs" to go. Demand to ${a.iata} up 35%.`, 'good'); } },
  { weight: 2, run: (s) => { const a = pick(AIRPORTS.filter((x) => x.size === 5)); start(s, { kind: 'tourism', title: `Mega concert in ${a.city}`, endDay: s.day + 14, demandMult: 1.25, airports: [a.iata] }, `A global pop superstar announces a five-night residency in ${a.city}. Fans scramble for flights to ${a.iata}.`, 'good'); } },
  { weight: 2, run: (s) => { const ai = pick(s.airlines.filter((a) => !a.isPlayer)); start(s, { kind: 'sale', title: `${ai.name} fare sale`, endDay: s.day + 14, airline: ai.code }, `${ai.name} launches a two-week flash sale: 15% off its entire network.`, 'rival'); } },
  { weight: 1, run: (s) => addNews(s, pick([
    'Study finds 87% of passengers would pay extra to never hear "we are now beginning our descent" at 6am again.',
    'Airport lounge introduces "silent disco" boarding. Gate agents report mixed feelings.',
    'A seagull at LIS is caught stealing a pastel de nata from a pilot. Investigation ongoing.',
    'Aviation geek spots all 23 major airline liveries in one afternoon at LHR. Declares it "the best day of my life".',
    'Survey: middle-seat passengers demand both armrests. Window-seat lobby "strongly opposed".',
  ]), 'neutral') },
];

const PLAYER: Template[] = [
  {
    weight: 3, run: (s) => {
      const p = player(s);
      const fleet = s.aircraft.filter((a) => a.owner === p.code && a.assignments.length && a.readyDay <= s.day && a.groundedUntil <= s.day);
      if (!fleet.length) return;
      const ac = pick(fleet);
      ac.groundedUntil = s.day + 4;
      p.cash -= 250_000;
      addNews(s, `Bird strike! ${ac.reg} (${acType(ac.typeId).name}) grounded 4 days for an engine inspection. Bill: $250k.`, 'bad');
    },
  },
  {
    weight: 2, run: (s) => {
      const p = player(s);
      if (p.service === 2 || !s.routes.some((r) => r.owner === p.code)) return;
      p.reputation = Math.max(0, p.reputation - 6);
      addNews(s, `Dodgy chicken: a batch of ${p.name} in-flight meals makes passengers ill. Reputation takes a hit.`, 'bad');
    },
  },
  {
    weight: 2, run: (s) => {
      const p = player(s);
      if (p.reputation < 70) return;
      p.reputation = Math.min(100, p.reputation + 4);
      addNews(s, `World Airline Awards name ${p.name} "Best Up-and-Coming Airline". The CEO has framed it twice.`, 'good');
    },
  },
  {
    weight: 2, run: (s) => {
      const p = player(s);
      if (!s.routes.some((r) => r.owner === p.code)) return;
      for (const k of Object.keys(p.awareness)) p.awareness[k] = Math.min(1, p.awareness[k] + 0.05);
      addNews(s, `A ${p.name} flight attendant's rapped safety demo hits 40M views. Brand awareness soars.`, 'good');
    },
  },
  {
    weight: 2, run: (s) => {
      const p = player(s);
      const fleet = s.aircraft.filter((a) => a.owner === p.code && a.assignments.length);
      if (!fleet.length) return;
      p.cash -= 80_000;
      addNews(s, `Passenger on ${pick(fleet).reg} tries to open the emergency exit "for some fresh air". Diversion bill: $80k.`, 'bad');
    },
  },
];

interface Scheduled { date: string; run: (s: GameState) => void }

const SCHEDULED: Scheduled[] = [
  { date: '2027-06-01', run: (s) => addNews(s, 'Boeing hands over the first 777-9 after years of delays. It is now on sale in the aircraft market.', 'neutral') },
  { date: '2028-07-07', run: (s) => start(s, { kind: 'tourism', title: 'LA28 Olympics', endDay: s.day + 28, demandMult: 1.4, airports: ['LAX'] }, 'The LA28 Olympic Games are about to begin! Demand to LAX up 40%.', 'good') },
  { date: '2030-01-30', run: (s) => start(s, { kind: 'tourism', title: 'Winter Olympics 2030', endDay: s.day + 25, demandMult: 1.3, airports: ['GVA', 'NCE'] }, 'Winter Olympics in the French Alps. Skiers and fans pack flights to GVA and NCE.', 'good') },
  { date: '2030-06-01', run: (s) => start(s, { kind: 'tourism', title: 'FIFA World Cup 2030', endDay: s.day + 50, demandMult: 1.3, airports: ['MAD', 'BCN', 'LIS', 'CMN', 'RAK'] }, 'The 2030 World Cup kicks off across Spain, Portugal and Morocco. Football fans take to the skies.', 'good') },
  { date: '2030-10-01', run: (s) => start(s, { kind: 'tourism', title: 'Expo 2030 Riyadh', endDay: s.day + 180, demandMult: 1.3, airports: ['RUH'] }, 'Expo 2030 opens in Riyadh. Six months of elevated demand to RUH.', 'good') },
];

function weighted(list: Template[]): Template {
  const total = list.reduce((n, t) => n + t.weight, 0);
  let x = Math.random() * total;
  for (const t of list) { x -= t.weight; if (x <= 0) return t; }
  return list[list.length - 1];
}

export function tickEvents(s: GameState): void {
  for (const e of s.events) {
    if (e.endDay <= s.day && e.closed) addNews(s, `${e.title} is over. ${e.airports!.join(', ')} back open.`, 'neutral');
  }
  s.events = s.events.filter((e) => e.endDay > s.day);

  // Fuel price random walk with mean reversion around $0.85/kg.
  s.fuelPrice = Math.max(0.45, Math.min(1.6, s.fuelPrice + (0.85 - s.fuelPrice) * 0.01 + (Math.random() - 0.5) * 0.012));

  for (const sc of SCHEDULED) if (dayOfIso(sc.date) === s.day) sc.run(s);
  if (Math.random() < 0.035) weighted(WORLD).run(s);
  if (Math.random() < 0.012) weighted(PLAYER).run(s);
}

export function eventAffects(e: ActiveEvent, code: string): boolean {
  return !!e.airports?.includes(code) || (!!e.region && airport(code).region === e.region);
}
