// What-if estimates for the route planner: run one city pair's market with a
// hypothetical offer so the player sees demand, competition and profit
// before committing.

import { acType } from '../data/aircraft';
import { distance, pairKey } from './geo';
import { baseDemand, cateringPerPax, cycleMinutes, flightCosts, HQ_PER_AIRCRAFT, OVERHEAD_SHARE, paxCharges, WEEK_MINUTES } from './model';
import { allocate, buildContext, buildOffer, demandMult, withOthers, type Offer } from './sim';
import { airlineByCode, flyingByRoute, player, type Flying } from './state';
import type { Aircraft, GameState, Route, ServiceLevel } from './types';
import { emptyStats } from './types';

export interface Competitor {
  airline: string;
  name: string;
  color: string;
  weeklyFlights: number;
  fareY: number;
  fareJ: number;
  types: string[];
  share: number;
}

export interface Estimate {
  distance: number;
  demandY: number; // per day, both directions, at reference fares
  demandJ: number;
  paxY: number;
  paxJ: number;
  seats: number;
  lf: number;
  weeklyFlights: number;
  revenue: number; // per day
  directCosts: number; // fuel, crew, maintenance, airport, catering
  contribution: number; // revenue − direct costs (same measure as route stats)
  profit: number; // after overhead and a pro-rata share of lease + HQ
  transferPax: number;
  competitors: Competitor[];
}

export type PlanAircraft = Pick<Aircraft, 'typeId' | 'biz' | 'econ' | 'ageDays' | 'ownership' | 'leaseMonthly'>;

/**
 * @param plan aircraft (possibly hypothetical) and weekly round trips each would fly
 * @param excludeRouteId the player's own existing route to replace in the market
 */
export function estimateRoute(
  s: GameState, from: string, to: string, plan: { ac: PlanAircraft; weekly: number }[], fareY: number, fareJ: number,
  excludeRouteId?: string, transfer?: { pax: number; revenue: number },
): Estimate {
  const ctx = buildContext(s);
  const p = player(s);
  const d = distance(from, to);
  const key = pairKey(from, to);
  const flyingBy = flyingByRoute(s, s.day + 1);

  const others: Offer[] = [];
  for (const r of s.routes) {
    if (r.id === excludeRouteId || pairKey(r.from, r.to) !== key) continue;
    const fl = flyingBy.get(r.id);
    if (fl?.length) others.push(buildOffer(r, airlineByCode(s, r.owner)!, fl, ctx));
  }
  const fake: Route = { id: '_est', owner: p.code, from, to, fareY, fareJ, openedDay: s.day, warUntil: 0, last: emptyStats(), week: [] };
  const live = plan.filter((x) => x.weekly > 0);
  const mine = live.length ? buildOffer(fake, p, live as Flying[], ctx) : null;
  const rivals = withOthers(others, from, to, ctx);
  const all = mine ? [...rivals, mine] : rivals;

  const base = baseDemand(from, to);
  const mult = demandMult(ctx, from, to);
  allocate(all, base.y * mult, 'y');
  allocate(all, base.j * mult, 'j');

  let revenue = 0, direct = 0, fixed = 0, paxY = 0, paxJ = 0, seats = 0, weekly = 0, tPax = 0;
  if (mine) {
    paxY = mine.pax.y * 2;
    paxJ = mine.pax.j * 2;
    seats = (mine.seats.y + mine.seats.j) * 2;
    weekly = mine.freq * 7;
    revenue = paxY * fareY + paxJ * fareJ;
    if (transfer && transfer.pax > 0) {
      tPax = Math.min(transfer.pax, Math.max(0, seats - paxY - paxJ));
      revenue += (transfer.revenue * tPax) / transfer.pax;
    }
    for (const { ac, weekly } of live) {
      const t = acType(ac.typeId);
      const c = flightCosts(t, d, (2 * weekly) / 7, ac.biz + ac.econ, ac.ageDays / 365, ctx.fuelPrice, from, to);
      direct += c.fuel + c.crew + c.maintenance + c.landing;
      // Ownership and HQ costs are charged in proportion to the aircraft time this route uses.
      const share = (weekly * cycleMinutes(t, d)) / WEEK_MINUTES;
      fixed += share * (HQ_PER_AIRCRAFT + (ac.ownership === 'leased' ? ac.leaseMonthly / 30 : 0));
    }
    const svc = p.service as ServiceLevel;
    direct += paxCharges(from, to, paxY + paxJ + tPax) + (paxY + tPax) * cateringPerPax(svc, d, false) + paxJ * cateringPerPax(svc, d, true);
    fixed += revenue * OVERHEAD_SHARE;
  }

  const totalPax = all.reduce((n, o) => n + o.pax.y + o.pax.j, 0) || 1;
  const competitors: Competitor[] = rivals.map((o) => {
    const a = o.airline;
    const types = [...new Set((flyingBy.get(o.route.id) ?? []).map((f) => acType(f.ac.typeId).name))];
    return {
      airline: a.code, name: a.name, color: a.color, weeklyFlights: o.freq * 7,
      fareY: o.fare.y, fareJ: o.fare.j, types, share: (o.pax.y + o.pax.j) / totalPax,
    };
  });

  return {
    distance: d, demandY: base.y * mult * 2, demandJ: base.j * mult * 2,
    paxY, paxJ, seats, lf: seats ? (paxY + paxJ + tPax) / seats : 0, weeklyFlights: weekly,
    revenue, directCosts: direct, contribution: revenue - direct, profit: revenue - direct - fixed, transferPax: tPax, competitors,
  };
}
