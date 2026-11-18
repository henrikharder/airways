import { invalidate, linkGates } from './grid';
import { SAVE_VERSION } from './newgame';
import { resetServices } from './passengers';
import { staffToNeed } from './staff';
import type { GameState } from './types';

const KEY = 'airways.airport.v1';

export function saveGame(s: GameState): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

export function hasSave(): boolean {
  try {
    return !!localStorage.getItem(KEY);
  } catch {
    return false;
  }
}

export function loadGame(): GameState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as GameState;
    if (!Array.isArray(s.tiles)) return null;
    if (s.version === 1) migrateV1(s);
    if (s.version !== SAVE_VERSION) return null;
    invalidate();
    linkGates(s);
    resetServices(s);
    return s;
  } catch {
    return null;
  }
}

/** v1 → v2: baggage, staff and night operations. Existing airports start fully staffed. */
function migrateV1(s: GameState): void {
  for (const f of s.flights) Object.assign(f, { bagsChecked: 0, bagsSorted: 0, bagsLoaded: 0, bagsIn: 0, bagsUnloaded: 0, bagsDelivered: 0, bagsLeft: 0, night: false });
  for (const p of s.pax) Object.assign(p, { bags: 0, bagAt: 0 });
  for (const l of [s.today, s.board.week, ...s.history]) l.wages ??= 0;
  s.curfew = 'none';
  s.goodwill = 75;
  s.staff = { checkin: 0, security: 0, ground: 0 };
  invalidate();
  staffToNeed(s);
  s.version = 2;
}
