// Core economic formulas: demand, fares, block times and operating costs.
// Kept free of game state so they can be unit-tested and reused by the
// route planner's estimates.

import { airport } from '../data/airports';
import { type AircraftType } from '../data/aircraft';
import { distance, pairKey } from './geo';
import type { ServiceLevel } from './types';

/** Share of revenue spent on sales, distribution, IT and admin. */
export const OVERHEAD_SHARE = 0.12;
/** Daily HQ cost per aircraft in the fleet. */
export const HQ_PER_AIRCRAFT = 3000;

/** Demand scale. Tuned so a well-placed narrowbody runs ~75–90% full. */
export const DEMAND_K = 55;

function distanceFactor(d: number): number {
  const short = 1 / (1 + (350 / d) ** 3); // rail/road competition on short hops
  return short * (Math.max(d, 400) / 1000) ** -0.5;
}

const demandCache = new Map<string, { y: number; j: number; total: number }>();

/** Unconstrained daily one-way passengers between two airports at reference fares. */
export function baseDemand(a: string, b: string): { y: number; j: number; total: number } {
  const key = pairKey(a, b);
  const hit = demandCache.get(key);
  if (hit) return hit;
  const A = airport(a);
  const B = airport(b);
  const d = distance(a, b);
  const gen = (x: typeof A) => x.pop ** 0.7 * x.wealth;
  const attr = (x: typeof A) => x.pop ** 0.7 * (0.5 * x.wealth + 0.5 * x.tourism);
  let affinity = 1;
  if (A.country === B.country) affinity = 1.8;
  else if (A.region === B.region) affinity = 1.15;
  const total = d < 150 ? 0 : (DEMAND_K * (gen(A) * attr(B) + gen(B) * attr(A)) / 2) * distanceFactor(d) * affinity;
  const bizShare = Math.min(0.12, Math.max(0.02, 0.03 + 0.06 * Math.min(A.wealth, B.wealth) - 0.02 * ((A.tourism + B.tourism) / 2) + (d > 3000 ? 0.01 : 0)));
  const res = { y: total * (1 - bizShare), j: total * bizShare, total };
  demandCache.set(key, res);
  return res;
}

export function refFareY(d: number): number {
  return 1.05 * (d <= 3000 ? 55 + 0.075 * d : 280 + 0.05 * (d - 3000));
}

export function refFareJ(d: number): number {
  return refFareY(d) * (2 + 1.1 * Math.min(1, d / 6000));
}

export function blockMinutes(t: AircraftType, d: number): number {
  return (d / t.speedKmh) * 60 + 30;
}

/** Minutes an aircraft is busy per round trip (two legs plus two turnarounds). */
export function cycleMinutes(t: AircraftType, d: number): number {
  return 2 * (blockMinutes(t, d) + t.turnMin);
}

/** Schedulable minutes per aircraft per week (18 operating hours a day). */
export const WEEK_MINUTES = 7 * 18 * 60;

export function maxWeekly(t: AircraftType, d: number): number {
  return Math.floor(WEEK_MINUTES / cycleMinutes(t, d));
}

export function feeFactor(code: string): number {
  return 0.6 + 0.15 * airport(code).size;
}

export const CATERING: Record<ServiceLevel, number> = { 0: 2, 1: 5, 2: 11 };

export function cateringPerPax(service: ServiceLevel, d: number, business: boolean): number {
  return CATERING[service] * (1 + d / 4000) * (business ? 3 : 1);
}

export interface FlightCosts {
  fuel: number;
  crew: number;
  maintenance: number;
  landing: number;
}

/** Variable costs for one aircraft flying `legs` legs on a route of `d` km. */
export function flightCosts(t: AircraftType, d: number, legs: number, seats: number, ageYears: number, fuelPrice: number, from: string, to: string): FlightCosts {
  const bh = (legs * blockMinutes(t, d)) / 60;
  return {
    fuel: t.burn * bh * fuelPrice,
    crew: (900 + 9 * seats) * bh, // flight + cabin crew and the ground staff behind them
    maintenance: t.maintPerHour * bh * (1 + ageYears / 18),
    landing: (legs / 2) * t.mtowT * 7 * (feeFactor(from) + feeFactor(to)),
  };
}

export function paxCharges(from: string, to: string, pax: number): number {
  return pax * (6 * (feeFactor(from) + feeFactor(to)) / 2 + 6);
}

/** Monthly lease rate ≈ 0.8% of market value, scaled down for older airframes. */
export function leaseRate(t: AircraftType, ageYears = 0): number {
  return Math.round(t.priceM * 1e6 * 0.008 * 0.95 ** ageYears);
}

export function marketValue(t: AircraftType, ageYears: number): number {
  const out = t.newBuild ? 1 : t.category === 'superjumbo' ? 0.45 : 0.75;
  return t.priceM * 1e6 * 0.93 ** ageYears * out;
}

/** Score multiplier for frequency with diminishing returns; long-haul flyers care less about frequency. */
export function freqFactor(dailyPerDir: number, d: number): number {
  const scale = Math.min(1.5, Math.max(0.5, 1.5 - (d - 1500) / 4500));
  return 1 - Math.exp(-dailyPerDir / scale);
}

export function qualityFactor(comfort: number, service: ServiceLevel): number {
  return (0.55 + 0.07 * comfort + 0.08 * service) / 0.875;
}

export function brandFactor(reputation: number, awareness: number): number {
  return ((0.5 + reputation / 200) / 0.85) * (0.55 + 0.45 * awareness);
}

export const PRICE_SENS = { y: 1.8, j: 0.9 };
export const MARKET_ELASTICITY = { y: 1.1, j: 0.5 };
/** Score of "don't fly / go another way" — keeps monopolies from capturing everything. */
export const OUTSIDE_OPTION = 0.2;
