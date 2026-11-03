// Split-flap departure boards built from the live schedule of every airline.

import { airport } from '../data/airports';
import { legsOnDay, flightNumber, gateFor, type Leg } from '../engine/schedule';
import { buildContext, isClosedFor } from '../engine/sim';
import type { GameState, Route } from '../engine/types';
import { icon } from './icons';

const COLS: [key: keyof Row, width: number][] = [['time', 5], ['flight', 7], ['dest', 10], ['gate', 3], ['status', 9]];

interface Row { time: string; flight: string; dest: string; gate: string; status: string; owner: string }

function clock(minute: number): string {
  const m = ((Math.floor(minute) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function strip(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

export function departures(s: GameState, code: string, limit: number): Row[] {
  const minute = s.minute;
  const routes = new Map<string, Route>();
  for (const r of s.routes) if (r.from === code || r.to === code) routes.set(r.id, r);
  if (!routes.size) return [];
  const ctx = buildContext(s, Math.floor(minute / 1440));
  const legs: Leg[] = [];
  for (const ac of s.aircraft) {
    if (ac.readyDay > s.day || !ac.assignments.some((a) => routes.has(a.routeId))) continue;
    const D = Math.floor((minute + ac.phase * 1440) / 1440);
    const all = new Map(s.routes.filter((r) => ac.assignments.some((a) => a.routeId === r.id)).map((r) => [r.id, r]));
    for (const d of [D - 1, D, D + 1]) {
      for (const leg of legsOnDay(ac, all, d)) {
        const from = leg.outbound ? leg.route.from : leg.route.to;
        if (from === code && leg.dep >= minute - 15 && leg.dep <= minute + 10 * 60) legs.push(leg);
      }
    }
  }
  legs.sort((a, b) => a.dep - b.dep);
  return legs.slice(0, limit).map((leg) => {
    const dest = leg.outbound ? leg.route.to : leg.route.from;
    const wait = leg.dep - minute;
    let status = 'ON TIME';
    if (isClosedFor(ctx, code, leg.route.owner) || isClosedFor(ctx, dest, leg.route.owner)) status = 'CANCELLED';
    else if (leg.ac.groundedUntil > s.day) status = 'DELAYED';
    else if (wait <= 0) status = 'DEPARTED';
    else if (wait <= 35) status = 'BOARDING';
    else if (wait <= 60) status = 'GATE OPEN';
    return { time: clock(leg.dep), flight: flightNumber(leg), dest: strip(airport(dest).city), gate: gateFor(leg), status, owner: leg.route.owner };
  });
}

/** Empty board markup; filled in by updateBoards. */
export function boardShell(code: string, rows: number, title = 'Departures'): string {
  const head = `<div class="fb-head"><span>${icon('takeoff')} ${title} · ${code}</span><span class="fb-clock" data-board-clock></span></div>`;
  const cols = `<div class="fb-row fb-labels">${COLS.map(([k, w]) => `<span class="fb-col" style="--w:${w}">${k.toUpperCase()}</span>`).join('')}</div>`;
  const row = `<div class="fb-row">${COLS.map(([k, w]) => `<span class="fb-col fb-${k}" style="--w:${w}">${'<i> </i>'.repeat(w)}</span>`).join('')}</div>`;
  return `<div class="flap-board" data-board="${code}">${head}${cols}${row.repeat(rows)}<div class="fb-empty" hidden>No departures scheduled.</div></div>`;
}

/** Fill every board on the page; returns how many characters flipped (for sound). */
export function updateBoards(root: HTMLElement, s: GameState): number {
  let flips = 0;
  root.querySelectorAll<HTMLElement>('[data-board]').forEach((board) => {
    const rowsEl = [...board.querySelectorAll<HTMLElement>('.fb-row:not(.fb-labels)')];
    const data = departures(s, board.dataset.board!, rowsEl.length);
    const first = !board.dataset.filled;
    board.dataset.filled = '1';
    const clockEl = board.querySelector('[data-board-clock]');
    if (clockEl) clockEl.textContent = clock(s.minute);
    (board.querySelector('.fb-empty') as HTMLElement).hidden = data.length > 0;
    rowsEl.forEach((rowEl, i) => {
      const row = data[i];
      rowEl.classList.toggle('mine', !!row && row.owner === s.playerCode);
      rowEl.dataset.status = row?.status ?? '';
      rowEl.querySelectorAll<HTMLElement>('.fb-col').forEach((col, ci) => {
        const [key, w] = COLS[ci];
        const text = (row ? row[key] : '').padEnd(w).slice(0, w);
        col.querySelectorAll('i').forEach((cell, k) => {
          if (cell.textContent !== text[k]) {
            cell.textContent = text[k];
            if (!first) {
              flips++;
              cell.classList.remove('flip');
              void (cell as HTMLElement).offsetWidth;
              cell.classList.add('flip');
            }
          }
        });
      });
    });
  });
  return flips;
}
