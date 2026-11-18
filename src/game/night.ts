// Night operations. Late-night and red-eye rotations pay a premium but cost the
// neighbours' goodwill. A curfew blocks them; low goodwill makes new airside
// construction harder to get approved, and at rock bottom a curfew is imposed.

import { acType } from '../data/aircraft';
import { NIGHT } from './catalog';
import { addNews } from './news';
import type { Curfew, Flight, GameState } from './types';

const DAY = 1440;

export const CURFEWS: Record<Curfew, { label: string; from: number; to: number; recovery: number }> = {
  none: { label: 'No curfew', from: 0, to: 0, recovery: 2 },
  '23-06': { label: 'Curfew 23:00–06:00', from: 23 * 60, to: 6 * 60, recovery: 3 },
  '22-07': { label: 'Curfew 22:00–07:00', from: 22 * 60, to: 7 * 60, recovery: 4 },
};

export function inNight(minute: number): boolean {
  const m = ((minute % DAY) + DAY) % DAY;
  return m >= NIGHT.start || m < NIGHT.end;
}

export function curfewBlocks(s: GameState, minute: number): boolean {
  const c = CURFEWS[s.curfew];
  if (s.curfew === 'none') return false;
  const m = ((minute % DAY) + DAY) % DAY;
  return m >= c.from || m < c.to;
}

/** A night movement (landing or take-off) annoys the neighbours, heavier jets more. */
export function nightMovement(s: GameState, f: Flight): void {
  s.goodwill = Math.max(0, s.goodwill - (0.6 + acType(f.typeId).mtowT / 400));
}

/** Construction cost multiplier for airside expansion while goodwill is low. */
export function planningMultiplier(s: GameState): number {
  return s.goodwill >= 50 ? 1 : 1 + (50 - s.goodwill) / 50;
}

export function setCurfew(s: GameState, c: Curfew): void {
  if (s.curfew === c) return;
  s.curfew = c;
  if (c === 'none') { addNews(s, 'Night flights are allowed again.', 'neutral'); return; }
  const gone = s.contracts.filter((x) => x.night);
  s.contracts = s.contracts.filter((x) => !x.night);
  s.flights = s.flights.filter((f) => !(f.phase === 'scheduled' && f.night));
  addNews(s, `${CURFEWS[c].label} in force${gone.length ? `; ${gone.length} night contract${gone.length > 1 ? 's' : ''} ended` : ''}. The neighbours are pleased.`, 'neutral');
}

/** Daily: goodwill recovers, and an authority curfew if it has collapsed. */
export function nightDaily(s: GameState): void {
  s.goodwill = Math.min(100, s.goodwill + CURFEWS[s.curfew].recovery);
  if (s.goodwill < 15 && s.curfew === 'none') {
    setCurfew(s, '23-06');
    addNews(s, 'After months of noise complaints the council imposes a 23:00–06:00 curfew.', 'bad');
  } else if (s.goodwill < 35) {
    addNews(s, 'Residents complain about night-time aircraft noise. New airside building permits are getting expensive.', 'bad');
  }
}
