// Decision cards: dilemmas that interrupt the day and ask the player to
// choose. Each kind has a spawner (when it can appear) and an outcome.

import { acType, AIRCRAFT } from '../data/aircraft';
import { airport } from '../data/airports';
import { availableNew } from './market';
import { addNews, fleetOf, newId, player, routesOf, usedMinutes } from './state';
import { rivalQuote } from './rivals';
import { WEEK_MINUTES } from './model';
import type { Airline, Decision, GameState, Route } from './types';
import { buyNewAircraft, money } from './actions';

const pick = <T,>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];

function push(s: GameState, d: Omit<Decision, 'id' | 'day'>): void {
  if (s.decisions.some((x) => x.kind === d.kind && x.data.routeId === d.data.routeId)) return;
  s.decisions.push({ ...d, id: newId(s, 'dc'), day: s.day });
}

// ---------- random dilemmas ----------

type Spawner = (s: GameState) => Omit<Decision, 'id' | 'day'> | null;

const SPAWNERS: Spawner[] = [
  (s) => {
    const n = fleetOf(s, s.playerCode).length;
    if (n < 2) return null;
    const cost = 60_000 * n;
    return {
      kind: 'crew_pay', icon: 'crew', title: 'Cabin crew want a pay rise',
      body: `The cabin crew union asks for a 4% raise and threatens a 48-hour strike if refused.`,
      options: [
        { label: `Agree (${money(cost)})`, detail: 'Happy crew, small reputation boost.' },
        { label: 'Refuse', detail: 'Coin flip: they back down, or your whole fleet is grounded for 2 days.' },
      ],
      data: { cost },
    };
  },
  (s) => {
    const spare = fleetOf(s, s.playerCode).filter((ac) => ac.readyDay <= s.day && usedMinutes(ac) / WEEK_MINUTES < 0.85);
    if (!spare.length) return null;
    const ac = pick(spare);
    const t = acType(ac.typeId);
    const fee = Math.round((t.maxSeats * 900 + 150_000) / 10_000) * 10_000;
    const club = pick(['football club', 'national rugby team', 'orchestra', 'Formula 1 team', 'esports team']);
    return {
      kind: 'charter', icon: 'ticket', title: 'Charter request',
      body: `A ${club} wants to charter ${ac.reg} (${t.name}) for a weekend trip and offers ${money(fee)}.`,
      options: [
        { label: `Accept ${money(fee)}`, detail: `${ac.reg} misses its schedule for 2 days.` },
        { label: 'Decline', detail: 'Keep the schedule intact.' },
      ],
      data: { acId: ac.id, fee },
    };
  },
  (s) => {
    const p = player(s);
    const options = AIRCRAFT.filter((t) => availableNew(t, s.day) && t.priceM * 1e6 * 0.88 <= p.cash);
    if (!options.length) return null;
    const t = pick(options);
    const price = t.priceM * 1e6 * 0.88;
    return {
      kind: 'oem_deal', icon: 'factory', title: `${t.maker} has a deal for you`,
      body: `${t.maker}'s sales team has a ${t.name} delivery slot that another airline cancelled. 12% off if you sign today.`,
      options: [
        { label: `Buy for ${money(price)}`, detail: 'Delivered in 45 days, owned outright.' },
        { label: 'Not now', detail: 'They will find another customer.' },
      ],
      data: { typeId: t.id, price },
    };
  },
  (s) => {
    if (s.fuelLock && s.fuelLock.until > s.day) return null;
    const price = Math.round(s.fuelPrice * 0.97 * 1000) / 1000;
    return {
      kind: 'fuel_hedge', icon: 'fuel', title: 'Fuel hedge offer',
      body: `Your bank offers to lock jet fuel at $${Math.round(price * 1000)}/t for 120 days for a $250k fee. Today's price is $${Math.round(s.fuelPrice * 1000)}/t.`,
      options: [
        { label: 'Lock it in', detail: 'Protects you from spikes. Loses out if prices fall.' },
        { label: 'Stay on spot prices', detail: 'Ride the market.' },
      ],
      data: { price },
    };
  },
  (s) => {
    if (!routesOf(s, s.playerCode).length) return null;
    return {
      kind: 'audit', icon: 'audit', title: 'Safety audit',
      body: 'The aviation authority found gaps in your maintenance paperwork. Nothing unsafe, but it looks bad.',
      options: [
        { label: 'Fix it properly ($400k)', detail: 'Hire auditors, small reputation gain.' },
        { label: 'Appeal the findings', detail: '50/50: cleared, or a $1.5M fine and bad headlines.' },
      ],
      data: {},
    };
  },
  (s) => {
    const rs = routesOf(s, s.playerCode).filter((r) => r.last.legs > 0);
    if (!rs.length) return null;
    const r = pick(rs);
    return {
      kind: 'influencer', icon: 'camera', title: 'Influencer on board',
      body: `A travel influencer with 2.3M followers is booked in economy on ${r.from}–${r.to} tomorrow.`,
      options: [
        { label: 'Upgrade them to business', detail: 'Free publicity at every airport you serve.' },
        { label: 'Treat them like anyone else', detail: 'Fair is fair. They might not see it that way.' },
      ],
      data: { routeId: r.id },
    };
  },
  (s) => {
    if (!routesOf(s, s.playerCode).length) return null;
    const p = player(s);
    const cost = Math.max(300_000, Math.round(p.recent.slice(-7).reduce((n, l) => n + l.fuel, 0) / 7 * 90 * 0.1 / 10_000) * 10_000);
    return {
      kind: 'saf', icon: 'leaf', title: 'Sustainable fuel programme',
      body: 'A biofuel supplier offers a 90-day sustainable aviation fuel blend for 10% of your fuel. Climate-conscious travellers would notice.',
      options: [
        { label: `Sign up (${money(cost)})`, detail: 'Reputation +4 and a burst of awareness.' },
        { label: 'Maybe next year', detail: 'No cost, no buzz.' },
      ],
      data: { cost },
    };
  },
];

export function maybeSpawnDecision(s: GameState): void {
  if (s.decisions.length || Math.random() > 0.013) return;
  const d = pick(SPAWNERS)(s);
  if (d) push(s, d);
}

// ---------- rival & world triggered ----------

export function rivalWarDecision(s: GameState, rival: Airline, mine: Route): void {
  const p = player(s);
  const name = `${mine.from}–${mine.to}`;
  const cost = Math.max(500_000, Math.round(mine.last.revenue * 10 / 50_000) * 50_000);
  push(s, {
    kind: 'rival_war', icon: 'swords', title: `${rival.name} starts a fare war`,
    body: `${rival.name} cut fares 15% on ${name} for four weeks to push ${p.name} out.`,
    quote: rivalQuote(rival, 'war', name, p.name),
    options: [
      { label: 'Match their fares', detail: 'Your fares drop 15% for 4 weeks. Keep your passengers, earn less per seat.' },
      { label: `Marketing blitz (${money(cost)})`, detail: 'Big awareness boost at both airports.' },
      { label: 'Hold your nerve', detail: 'Keep fares. You will lose some passengers for a while.' },
    ],
    data: { routeId: mine.id, rival: rival.code, cost },
  });
}

export function rivalEntryDecision(s: GameState, rival: Airline, mine: Route): void {
  const p = player(s);
  const name = `${mine.from}–${mine.to}`;
  const cost = 750_000;
  push(s, {
    kind: 'rival_entry', icon: 'landing', title: `${rival.name} moves in`,
    body: `${rival.name} has launched ${name}, one of your best routes.`,
    quote: rivalQuote(rival, 'entry', name, p.name),
    options: [
      { label: `Loyalty campaign (${money(cost)})`, detail: 'Reputation +3 and awareness on this route.' },
      { label: 'Review the route', detail: 'Open the route to adjust fares and frequency.' },
      { label: 'Ignore them', detail: 'Let the market decide.' },
    ],
    data: { routeId: mine.id, rival: rival.code, cost },
  });
}

export function ashDecision(s: GameState, eventId: string, airports: string[]): void {
  const p = player(s);
  const hit = routesOf(s, p.code).filter((r) => airports.includes(r.from) || airports.includes(r.to));
  if (!hit.length) return;
  const cost = 120_000 * hit.length;
  push(s, {
    kind: 'ash', icon: 'volcano', title: 'Ash cloud over Europe',
    body: `Airspace is closing. ${hit.length} of your routes are affected. Your ops team believes they can fly around the ash on longer routings.`,
    options: [
      { label: `Reroute (${money(cost)})`, detail: 'Keep flying through the closure with extra fuel.' },
      { label: 'Cancel and refund', detail: 'Ground the affected flights. Passengers will remember.' },
    ],
    data: { eventId, cost },
  });
}

// ---------- outcomes ----------

export interface Outcome {
  text: string;
  open?: { kind: 'route'; id: string };
}

export function resolveDecision(s: GameState, id: string, choice: number): Outcome {
  const d = s.decisions.find((x) => x.id === id);
  if (!d) return { text: '' };
  s.decisions = s.decisions.filter((x) => x.id !== id);
  const p = player(s);
  const route = typeof d.data.routeId === 'string' ? s.routes.find((r) => r.id === d.data.routeId) : undefined;
  const note = (text: string, tone: 'good' | 'bad' | 'neutral' = 'neutral'): Outcome => {
    addNews(s, text, tone);
    return { text };
  };
  switch (d.kind) {
    case 'crew_pay':
      if (choice === 0) { p.cash -= Number(d.data.cost); p.reputation = Math.min(100, p.reputation + 1); return note('Pay deal signed. The crew room is all smiles.', 'good'); }
      if (Math.random() < 0.5) return note('The union blinked. No strike, no raise.', 'good');
      for (const ac of fleetOf(s, p.code)) ac.groundedUntil = Math.max(ac.groundedUntil, s.day + 2);
      p.reputation = Math.max(0, p.reputation - 4);
      return note(`Cabin crew walk out! The whole ${p.name} fleet is grounded for 2 days.`, 'bad');
    case 'charter': {
      if (choice !== 0) return { text: 'Charter declined.' };
      const ac = s.aircraft.find((a) => a.id === d.data.acId);
      if (!ac) return { text: 'That aircraft is no longer in your fleet.' };
      ac.groundedUntil = Math.max(ac.groundedUntil, s.day + 2);
      p.cash += Number(d.data.fee);
      return note(`${ac.reg} flies a weekend charter. ${money(Number(d.data.fee))} in the bank.`, 'good');
    }
    case 'oem_deal': {
      if (choice !== 0) return { text: 'Maybe next time.' };
      const t = acType(String(d.data.typeId));
      const discount = t.priceM * 1e6 - Number(d.data.price);
      p.cash += discount; // buyNewAircraft charges list price
      const err = buyNewAircraft(s, t.id, t.defaultBiz);
      if (err) { p.cash -= discount; return { text: err }; }
      return { text: `${t.name} ordered at 12% off.` };
    }
    case 'fuel_hedge':
      if (choice !== 0) return { text: 'Staying on spot fuel prices.' };
      p.cash -= 250_000;
      s.fuelLock = { price: Number(d.data.price), until: s.day + 120 };
      return note(`Fuel hedged at $${Math.round(Number(d.data.price) * 1000)}/t for 120 days.`, 'neutral');
    case 'audit':
      if (choice === 0) { p.cash -= 400_000; p.reputation = Math.min(100, p.reputation + 1); return note('Paperwork fixed. The regulator is impressed.', 'good'); }
      if (Math.random() < 0.5) return note('Appeal upheld. The regulator withdraws its findings.', 'good');
      p.cash -= 1_500_000;
      p.reputation = Math.max(0, p.reputation - 4);
      return note(`Appeal rejected: ${p.name} fined $1.5M. "Paperwork Airline" trends online.`, 'bad');
    case 'influencer':
      if (choice === 0) {
        for (const k of Object.keys(p.awareness)) if (p.awareness[k] > 0.1) p.awareness[k] = Math.min(1, p.awareness[k] + 0.04);
        p.reputation = Math.min(100, p.reputation + 1);
        return note(`"Best business class I have flown!" — the influencer's post about ${p.name} goes viral.`, 'good');
      }
      if (Math.random() < 0.4) {
        p.reputation = Math.max(0, p.reputation - 2);
        return note(`An influencer posts a 14-part story about ${p.name}'s legroom. It does numbers.`, 'bad');
      }
      return { text: 'The influencer enjoyed a perfectly normal flight.' };
    case 'saf':
      if (choice !== 0) return { text: 'Sustainable fuel can wait.' };
      p.cash -= Number(d.data.cost);
      p.reputation = Math.min(100, p.reputation + 4);
      for (const k of Object.keys(p.awareness)) if (p.awareness[k] > 0.1) p.awareness[k] = Math.min(1, p.awareness[k] + 0.03);
      return note(`${p.name} starts flying on sustainable fuel blends. Green credentials earned.`, 'good');
    case 'rival_war':
      if (!route) return { text: 'That route is closed.' };
      if (choice === 0) { route.warUntil = s.day + 28; return note(`${p.name} matches the fare cuts on ${route.from}–${route.to}. Game on.`, 'neutral'); }
      if (choice === 1) {
        p.cash -= Number(d.data.cost);
        for (const c of [route.from, route.to]) p.awareness[c] = Math.min(1, (p.awareness[c] ?? 0) + 0.15);
        return note(`${p.name} plasters ${airport(route.to).city} with billboards. Awareness soars.`, 'good');
      }
      return { text: 'Holding fares steady.' };
    case 'rival_entry':
      if (!route) return { text: 'That route is closed.' };
      if (choice === 0) {
        p.cash -= Number(d.data.cost);
        p.reputation = Math.min(100, p.reputation + 3);
        for (const c of [route.from, route.to]) p.awareness[c] = Math.min(1, (p.awareness[c] ?? 0) + 0.1);
        return note(`${p.name} launches a loyalty campaign on ${route.from}–${route.to}.`, 'good');
      }
      if (choice === 1) return { text: 'Opening the route…', open: { kind: 'route', id: route.id } };
      return { text: 'Ignoring the newcomer.' };
    case 'ash': {
      const e = s.events.find((x) => x.id === d.data.eventId);
      if (choice === 0) {
        p.cash -= Number(d.data.cost);
        if (e) e.exempt = [...(e.exempt ?? []), p.code];
        return note(`${p.name} reroutes around the ash and keeps flying while rivals sit on the ground.`, 'good');
      }
      p.reputation = Math.max(0, p.reputation - 2);
      return note(`${p.name} cancels flights until the ash clears.`, 'bad');
    }
  }
  return { text: '' };
}
