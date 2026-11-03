import { createBoard } from './board';
import type { GameState } from './types';

const KEY = 'airways.save.v1';
export const SAVE_VERSION = 2;

export function saveGame(s: GameState): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

export function loadGame(): GameState | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? parseSave(raw) : null;
  } catch {
    return null;
  }
}

export function hasSave(): boolean {
  try {
    return !!localStorage.getItem(KEY);
  } catch {
    return false;
  }
}

/** Bring older saves up to the current shape. */
function migrate(s: GameState): GameState {
  if (s.version < 2) {
    s.decisions = [];
    s.reviews = [];
    const p = s.airlines[0];
    p.livery = { pattern: 'classic', primary: p.color, secondary: '#0b1220' };
    createBoard(s);
    s.version = 2;
  }
  return s;
}

export function parseSave(text: string): GameState {
  const s = JSON.parse(text) as GameState;
  if (typeof s.version !== 'number' || s.version > SAVE_VERSION || !Array.isArray(s.airlines) || !Array.isArray(s.routes)) {
    throw new Error('Not an Airways save file.');
  }
  return migrate(s);
}
