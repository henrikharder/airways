import { airport } from '../data/airports';
import { createBoard } from './board';
import { START_CASH } from './catalog';
import { generateOffers } from './flights';
import { invalidate } from './grid';
import { addNews } from './news';
import { resetServices } from './passengers';
import type { GameState } from './types';
import { emptyLedger, T } from './types';

export const SAVE_VERSION = 2;

export interface NewGameOptions { name: string; code: string; city: string }

export function createGame(o: NewGameOptions): GameState {
  const W = 110, H = 90;
  const tiles = new Array(W * H).fill(T.Grass);
  // landside road along the south-west edge, with a spur into the site
  for (let x = 0; x < W; x++) for (const y of [H - 3, H - 2]) tiles[y * W + x] = T.Road;
  const s: GameState = {
    version: SAVE_VERSION, name: o.name, code: o.code, city: o.city, minute: 6 * 60, cash: START_CASH, rating: 55,
    W, H, tiles, buildings: [], contracts: [], offers: [], flights: [], pax: [], today: emptyLedger(), history: [],
    board: null as unknown as GameState['board'], news: [], nextId: 0, gameOver: false, scheduledDay: 0,
    staff: { checkin: 0, security: 0, ground: 0 }, curfew: 'none', goodwill: 75,
  };
  // scatter trees, leaving the middle clear for building
  for (let i = 0; i < 70; i++) {
    const x = Math.floor(Math.random() * W);
    const y = Math.floor(Math.random() * (H - 5));
    const edge = x < 8 || x > W - 9 || y < 8 || y > H - 14;
    if (!edge || s.buildings.some((b) => b.x === x && b.y === y)) continue;
    s.buildings.push({ id: ++s.nextId, kind: 'tree', x, y, w: 1, h: 1, rot: 0 });
  }
  invalidate();
  resetServices(s);
  createBoard(s);
  generateOffers(s);
  generateOffers(s);
  const c = airport(o.city);
  addNews(s, `Welcome to ${o.name}! Build a runway and control tower, then a terminal, to welcome your first airline to ${c.city}.`, 'good');
  return s;
}
