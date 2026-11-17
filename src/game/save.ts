import { invalidate, linkGates } from './grid';
import { SAVE_VERSION } from './newgame';
import { resetServices } from './passengers';
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
    if (s.version !== SAVE_VERSION || !Array.isArray(s.tiles)) return null;
    invalidate();
    linkGates(s);
    resetServices(s);
    return s;
  } catch {
    return null;
  }
}
