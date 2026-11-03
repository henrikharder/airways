import { AIRCRAFT, type AircraftType } from '../data/aircraft';
import { marketValue } from './model';
import { newId } from './state';
import { dayOfIso } from './time';
import type { GameState } from './types';

export function availableNew(t: AircraftType, day: number): boolean {
  return t.newBuild && (!t.availableFrom || dayOfIso(t.availableFrom) <= day);
}

/** Second-hand aircraft for sale; refreshed monthly. */
export function refreshUsedMarket(s: GameState): void {
  const pool = AIRCRAFT.filter((t) => !t.availableFrom || dayOfIso(t.availableFrom) <= s.day - 365);
  const n = 10 + Math.floor(Math.random() * 5);
  s.used = Array.from({ length: n }, () => {
    const t = pool[Math.floor(Math.random() * pool.length)];
    const ageYears = 2 + Math.floor(Math.random() * 19);
    return { id: newId(s, 'u'), typeId: t.id, ageYears, price: Math.round(marketValue(t, ageYears) * (0.85 + Math.random() * 0.2)) };
  }).sort((a, b) => a.price - b.price);
}
