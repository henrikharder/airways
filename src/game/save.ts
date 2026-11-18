import { invalidate, linkGates } from './grid';
import { SAVE_VERSION } from './newgame';
import { resetServices } from './passengers';
import { staffToNeed } from './staff';
import type { GameState } from './types';

// Slot 0 is the autosave (the key predates slots, so old saves keep working); 1–3 are manual.
export const SLOTS = [0, 1, 2, 3] as const;
const keyOf = (slot: number) => (slot === 0 ? 'airways.airport.v1' : `airways.airport.slot${slot}`);

export interface SlotInfo { slot: number; name: string; code: string; day: number; cash: number; savedAt: number }

export function saveGame(s: GameState, slot = 0): boolean {
  try {
    localStorage.setItem(keyOf(slot), JSON.stringify(s));
    const meta: SlotInfo = { slot, name: s.name, code: s.code, day: Math.floor(s.minute / 1440) + 1, cash: s.cash, savedAt: Date.now() };
    localStorage.setItem(`${keyOf(slot)}.meta`, JSON.stringify(meta));
    return true;
  } catch {
    return false;
  }
}

export function hasSave(slot = 0): boolean {
  try {
    return !!localStorage.getItem(keyOf(slot));
  } catch {
    return false;
  }
}

/** What is in each slot, without loading whole games. */
export function slotInfo(slot: number): SlotInfo | null {
  try {
    const meta = localStorage.getItem(`${keyOf(slot)}.meta`);
    if (meta) return JSON.parse(meta) as SlotInfo;
    const raw = localStorage.getItem(keyOf(slot)); // autosaves from before slots had no meta
    if (!raw) return null;
    const s = JSON.parse(raw) as GameState;
    return { slot, name: s.name, code: s.code, day: Math.floor(s.minute / 1440) + 1, cash: s.cash, savedAt: 0 };
  } catch {
    return null;
  }
}

export function loadGame(slot = 0): GameState | null {
  try {
    const raw = localStorage.getItem(keyOf(slot));
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
