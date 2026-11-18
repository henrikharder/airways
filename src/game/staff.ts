// Pooled staff. You hire people per role; each position needs enough hires to
// cover the operating day (two shifts, three with night flights). Desks and lanes
// only open when someone is on shift, and short-handed ground crews are slower.

import { MODULES, ROLES, SHIFTS_DAY, SHIFTS_NIGHT } from './catalog';
import type { Building, GameState, Role } from './types';

export function shifts(s: GameState): number {
  return s.contracts.some((c) => c.night) ? SHIFTS_NIGHT : SHIFTS_DAY;
}

/** Positions to fill at any one time, per role. */
export function positions(s: GameState): Record<Role, number> {
  let checkin = 0, security = 0, stands = 0, halls = 0;
  for (const b of s.buildings) {
    if (b.kind === 'checkin') checkin += MODULES.checkin.servers!;
    else if (b.kind === 'security') security += MODULES.security.servers!;
    else if (b.kind.startsWith('stand_')) stands++;
    else if (b.kind === 'bagsort') halls++;
  }
  return { checkin, security, ground: stands * 6 + halls * 4 };
}

/** Hires needed per role to keep every position covered all day. */
export function needed(s: GameState): Record<Role, number> {
  const p = positions(s), k = shifts(s);
  return { checkin: p.checkin * k, security: p.security * k, ground: p.ground * k };
}

/** Share of positions covered, 0..1 (1 when nothing needs staffing). */
export function coverage(s: GameState, role: Role): number {
  const n = needed(s)[role];
  return n === 0 ? 1 : Math.min(1, s.staff[role] / n);
}

/** Ground crews always manage something; full crews work at full speed. */
export function groundFactor(s: GameState): number {
  return Math.max(0.2, coverage(s, 'ground'));
}

/** Open servers per desk/lane building: on-shift staff fill desks in building order. */
export function openServers(s: GameState): Map<number, number> {
  const open = new Map<number, number>();
  const k = shifts(s);
  const pool: Record<'checkin' | 'security', number> = {
    checkin: Math.floor(s.staff.checkin / k),
    security: Math.floor(s.staff.security / k),
  };
  for (const b of [...s.buildings].sort((a, c) => a.id - c.id)) {
    if (b.kind !== 'checkin' && b.kind !== 'security') continue;
    const n = Math.min(MODULES[b.kind].servers!, pool[b.kind]);
    pool[b.kind] -= n;
    open.set(b.id, n);
  }
  return open;
}

export function wagesPerDay(s: GameState): number {
  return (Object.keys(ROLES) as Role[]).reduce((n, r) => n + s.staff[r] * ROLES[r].wage, 0);
}

/** Hire (or let go) to exactly match what the current airport needs. */
export function staffToNeed(s: GameState): void {
  s.staff = { ...needed(s) };
}

export function isStaffed(s: GameState, b: Building): boolean {
  return b.kind !== 'checkin' && b.kind !== 'security' ? true : (openServers(s).get(b.id) ?? 0) > 0;
}
