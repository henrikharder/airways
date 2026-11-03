// Passenger reviews: short reactions to the product the player sells, so
// fares, aircraft and service choices get a human voice.

import { acType } from '../data/aircraft';
import { airport } from '../data/airports';
import { distance } from './geo';
import { refFareY } from './model';
import { flyingByRoute, player, routesOf } from './state';
import type { GameState, Review, Route } from './types';

const NAMES = ['Anna K.', 'Mateo R.', 'Priya S.', 'Liam O.', 'Yuki T.', 'Fatima A.', 'Lars J.', 'Chen W.', 'Amara N.', 'Sofia M.',
  'Noah B.', 'Aisha D.', 'Jonas H.', 'Mei L.', 'Carlos G.', 'Ingrid P.', 'Kwame E.', 'Hana Y.', 'Diego F.', 'Elif Ö.'];

const pick = <T,>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];

function write(s: GameState, r: Route): Review {
  const p = player(s);
  const flying = flyingByRoute(s).get(r.id) ?? [];
  const comfort = flying.length ? flying.reduce((n, f) => n + acType(f.ac.typeId).comfort, 0) / flying.length : 3;
  const typeName = flying.length ? acType(flying[0].ac.typeId).name : 'aircraft';
  const d = distance(r.from, r.to);
  const value = refFareY(d) / Math.max(1, r.fareY);
  const w = r.last;
  const lf = w.seatsY + w.seatsJ ? (w.paxY + w.paxJ + w.transfer) / (w.seatsY + w.seatsJ) : 0.7;
  const business = Math.random() < (w.paxJ / Math.max(1, w.paxY + w.paxJ)) * 1.5;
  const hours = Math.max(1, Math.round(d / 800));
  const dest = airport(Math.random() < 0.5 ? r.to : r.from).city;

  const score = 0.9 + 0.45 * comfort + 0.55 * p.service + 1.4 * (value - 1) - (lf > 0.95 ? 0.4 : 0) + (business ? 0.4 : 0) + (Math.random() - 0.5) * 1.4;
  const stars = Math.max(1, Math.min(5, Math.round(score)));

  const factors: [number, string][] = [
    [(value - 1) * 3, value > 1.05 ? pick([`Only $${r.fareY} to ${dest}? I'd fly this again tomorrow.`, `Cheapest way to ${dest} I found, and it was fine!`]) : pick([`$${r.fareY} felt steep for what we got.`, `Paid a lot, expected more.`])],
    [(comfort - 3.5) * 1.5, comfort >= 4 ? pick([`The ${typeName} is so quiet, and the seats were lovely.`, `Big windows, quiet cabin. The ${typeName} is a treat.`]) : pick([`Knees against the seat in front for ${hours} hours.`, `The ${typeName} cabin has seen better days.`])],
    [(p.service - 1) * 1.6, p.service === 2 ? pick(['The food was genuinely restaurant-level. Who knew?', 'Warm towels, real cutlery, a proper meal. Impressed.']) : p.service === 0 ? pick(['Paid $9 for a sad sandwich.', 'Not even a free glass of water.']) : pick(['Friendly crew and a decent meal.', 'Solid service, nothing fancy.'])],
    [lf > 0.95 ? 1 : 0, 'Not a single empty seat, and boarding took forever.'],
    [business ? 1.2 : 0, pick(['Lie-flat bed and I slept the whole way.', 'Business class was worth every cent.'])],
  ];
  factors.sort((a, b) => Math.abs(b[0]) - Math.abs(a[0]));
  const text = Math.abs(factors[0][0]) >= 0.3 ? factors[0][1]
    : stars >= 4 ? pick(['Smooth flight, on time, no complaints.', `Easy trip to ${dest}. Would book again.`])
    : stars === 3 ? pick(['Fine. Nothing memorable, nothing terrible.', 'It got me there. That is all I ask.'])
    : pick(['Long wait at the gate and a grumpy crew.', 'Not my best flight.']);
  return { day: s.day, routeId: r.id, from: r.from, to: r.to, name: pick(NAMES), stars, text, cabin: business ? 'Business' : 'Economy' };
}

export function maybeWriteReviews(s: GameState): void {
  const rs = routesOf(s, s.playerCode).filter((r) => r.last.legs > 0);
  if (!rs.length) return;
  const pax = rs.reduce((n, r) => n + r.last.paxY + r.last.paxJ, 0);
  if (Math.random() > Math.min(0.9, pax / 600)) return;
  let x = Math.random() * pax;
  const r = rs.find((rt) => (x -= rt.last.paxY + rt.last.paxJ) <= 0) ?? rs[0];
  s.reviews.unshift(write(s, r));
  if (s.reviews.length > 60) s.reviews.length = 60;
}

export function averageStars(s: GameState, days = 60): number | null {
  const rs = s.reviews.filter((r) => s.day - r.day <= days);
  return rs.length ? rs.reduce((n, r) => n + r.stars, 0) / rs.length : null;
}
