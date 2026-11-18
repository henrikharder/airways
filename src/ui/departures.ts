// Split-flap departure board for the airport's flights.

import { isRemote } from '../game/buses';
import { readyAt } from '../game/types';
import { airport } from '../data/airports';
import { gateOf } from '../game/flights';
import type { Flight, GameState } from '../game/types';
import { clock } from './format';
import { icon } from './icons';

const COLS: [key: keyof Row, width: number][] = [['time', 5], ['flight', 7], ['dest', 10], ['gate', 3], ['status', 9]];

interface Row { time: string; flight: string; dest: string; gate: string; status: string }

function strip(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

export function gateLabel(s: GameState, id: number | undefined): string {
  if (!id) return '';
  const gates = s.buildings.filter((b) => b.kind === 'gate').sort((a, b) => a.id - b.id);
  const i = gates.findIndex((g) => g.id === id);
  return i < 0 ? '' : `G${i + 1}`;
}

export function statusOf(s: GameState, f: Flight): string {
  const now = s.minute;
  switch (f.phase) {
    case 'cancelled': return 'CANCELLED';
    case 'departed': case 'takeoff': case 'lineup': case 'taxi_out': case 'pushback': return 'DEPARTED';
    case 'parked': {
      if (now > f.dep + 1) return f.bagsLoaded < f.bagsChecked - 0.5 || f.bagsUnloaded < f.bagsIn - 0.5 ? 'BAGGAGE' : 'DELAYED';
      return now >= readyAt(f) - 35 ? 'BOARDING' : 'GATE OPEN';
    }
    default: return now > f.dep ? 'DELAYED' : f.stand === null && now > f.arr - 60 ? 'NO STAND' : now >= f.dep - 150 ? 'CHECK-IN' : 'ON TIME';
  }
}

function rows(s: GameState, limit: number): Row[] {
  return s.flights
    .filter((f) => f.dep >= s.minute - 20 && f.dep <= s.minute + 16 * 60)
    .sort((a, b) => a.dep - b.dep)
    .slice(0, limit)
    .map((f) => ({ time: clock(f.dep), flight: f.number, dest: strip(airport(f.dest).city), gate: gateLabel(s, gateOf(s, f)?.id) || (isRemote(s, f) ? 'BUS' : ''), status: statusOf(s, f) }));
}

export function boardShell(rowsN: number): string {
  const head = `<div class="fb-head"><span>${icon('takeoff')} Departures</span><span class="fb-clock" data-board-clock></span></div>`;
  const cols = `<div class="fb-row fb-labels">${COLS.map(([k, w]) => `<span class="fb-col" style="--w:${w}">${k.toUpperCase()}</span>`).join('')}</div>`;
  const row = `<div class="fb-row">${COLS.map(([k, w]) => `<span class="fb-col fb-${k}" style="--w:${w}">${'<i> </i>'.repeat(w)}</span>`).join('')}</div>`;
  return `<div class="flap-board" data-board>${head}${cols}${row.repeat(rowsN)}<div class="fb-empty" hidden>No departures scheduled yet.</div></div>`;
}

export function updateBoards(root: HTMLElement, s: GameState): void {
  root.querySelectorAll<HTMLElement>('[data-board]').forEach((board) => {
    const rowsEl = [...board.querySelectorAll<HTMLElement>('.fb-row:not(.fb-labels)')];
    const data = rows(s, rowsEl.length);
    const first = !board.dataset.filled;
    board.dataset.filled = '1';
    const ck = board.querySelector('[data-board-clock]');
    if (ck) ck.textContent = clock(s.minute);
    (board.querySelector('.fb-empty') as HTMLElement).hidden = data.length > 0;
    rowsEl.forEach((rowEl, i) => {
      const row = data[i];
      rowEl.dataset.status = row?.status ?? '';
      rowEl.querySelectorAll<HTMLElement>('.fb-col').forEach((col, ci) => {
        const [key, w] = COLS[ci];
        const text = (row ? row[key] : '').padEnd(w).slice(0, w);
        col.querySelectorAll('i').forEach((cell, k) => {
          if (cell.textContent === text[k]) return;
          cell.textContent = text[k];
          if (first) return;
          cell.classList.remove('flip');
          void (cell as HTMLElement).offsetWidth;
          cell.classList.add('flip');
        });
      });
    });
  });
}
