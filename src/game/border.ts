// Border control. Flights that cross a border (anything but domestic or
// Schengen-to-Schengen) need passport control: departing passengers after
// security, arriving passengers before baggage claim. Gates can be zoned so
// border and Schengen passengers don't mix; swing gates take either.

import { airport } from '../data/airports';
import { addNews } from './news';
import type { Building, Flight, GameState } from './types';

/** Schengen area members (2026). */
const SCHENGEN = new Set(['AT', 'BE', 'BG', 'CH', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IS', 'IT', 'LI', 'LT', 'LU', 'LV', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK']);

export type GateZone = 'swing' | 'schengen' | 'border';
export const ZONE_LABEL: Record<GateZone, string> = { swing: 'Swing gate', schengen: 'Schengen only', border: 'Non-Schengen only' };

export function crossesBorder(home: string, dest: string): boolean {
  const a = airport(home).country, b = airport(dest).country;
  if (a === b) return false;
  return !(SCHENGEN.has(a) && SCHENGEN.has(b));
}

export function isBorder(s: GameState, f: Flight): boolean {
  return crossesBorder(s.city, f.dest);
}

export function zoneOf(g: Building | undefined): GateZone {
  return g?.zone ?? 'swing';
}

/** May a flight use this gate (or a remote stand, which is always fine)? */
export function gateAllows(s: GameState, g: Building | undefined, f: Flight): boolean {
  const z = zoneOf(g);
  return z === 'swing' || (z === 'border') === isBorder(s, f);
}

export function hasPassportControl(s: GameState): boolean {
  return s.buildings.some((b) => b.kind === 'passport');
}

export const BORDER_FINE = 30_000;

/** Daily: the border police fine airports that let international passengers through unchecked. */
export function borderDaily(s: GameState): void {
  if (hasPassportControl(s)) return;
  const day0 = Math.floor(s.minute / 1440) * 1440 - 1440;
  const unchecked = s.flights.some((f) => f.phase === 'departed' && f.dep >= day0 && isBorder(s, f));
  if (!unchecked) return;
  s.cash -= BORDER_FINE;
  s.today.upkeep += BORDER_FINE;
  s.board.week.upkeep += BORDER_FINE;
  addNews(s, 'Border police fine: international passengers passed through without passport control. Build passport control.', 'bad');
}
