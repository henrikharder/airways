// Passenger agents. Each passenger walks by flow field towards its current
// goal, queues and is served, satisfies needs, and boards or leaves.

import { MODULES, FEES } from './catalog';
import { gateOf } from './flights';
import { accessTile, frontDir, getLayout, localPoint, walkable } from './grid';
import { distanceTo, nextStep, UNREACHABLE } from './paths';
import type { Building, Flight, GameState, Pax } from './types';

export const WALK = 4.2; // tiles per game minute
const NEED_FOOD = 1, NEED_SHOP = 2, NEED_TOILET = 4;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** Transient per-building service state (rebuilt from scratch after loading a save). */
interface Service { queue: number[]; serving: Map<number, number>; users: Set<number> }
const services = new Map<number, Service>();

function svc(id: number): Service {
  let v = services.get(id);
  if (!v) { v = { queue: [], serving: new Map(), users: new Set() }; services.set(id, v); }
  return v;
}

/** After loading a save: queues are transient, so send queued passengers back on their way. */
export function resetServices(s: GameState): void {
  services.clear();
  for (const p of s.pax) {
    if (p.state === 'queue' || p.state === 'service') p.state = p.stage === 'checkin' ? 'toCheckin' : 'toSecurity';
    if (p.state === 'atNeed' || p.state === 'atGate') svc(p.target).users.add(p.id);
    p.tx = p.x;
    p.ty = p.y;
  }
}

export function queueLength(id: number): number {
  return services.get(id)?.queue.length ?? 0;
}

export function usersOf(id: number): number {
  const v = services.get(id);
  return v ? v.users.size + v.serving.size : 0;
}

function ofKind(s: GameState, kind: Building['kind']): Building[] {
  return s.buildings.filter((b) => b.kind === kind);
}

/** Best building of a kind: shortest walk + queue penalty, reachable from (x, y). */
function choose(s: GameState, kind: Building['kind'], x: number, y: number, full?: (b: Building) => boolean): Building | undefined {
  let best: Building | undefined;
  let bs = Infinity;
  for (const b of ofKind(s, kind)) {
    if (full?.(b)) continue;
    const d = distanceTo(s, b, x, y);
    if (d >= UNREACHABLE) continue;
    const score = d + queueLength(b.id) * 3;
    if (score < bs) { bs = score; best = b; }
  }
  return best;
}

function spawnPoint(b: Building, behind = false): [number, number] {
  if (!behind) {
    const [ax, ay] = accessTile(b);
    return [ax + 0.5, ay + 0.5];
  }
  // behind a gate: the airside edge where the jet bridge meets the building
  const m = MODULES[b.kind];
  const p = localPoint(b, m.w / 2, 0.5);
  return p;
}

export function newPax(s: GameState, f: Flight, dep: boolean, x: number, y: number): Pax {
  const p: Pax = {
    id: ++s.nextId, flight: f.id, dep, state: dep ? 'toCheckin' : 'toBaggage', stage: dep ? 'checkin' : 'baggage', target: 0,
    x, y, tx: x, ty: y, ox: rnd(-0.32, 0.32), oy: rnd(-0.32, 0.32), timer: 0,
    needs: (Math.random() < 0.55 ? NEED_FOOD : 0) | (Math.random() < 0.4 ? NEED_SHOP : 0) | (Math.random() < 0.45 ? NEED_TOILET : 0),
    color: Math.floor(Math.random() * 6), facing: 0, mood: 75, waited: 0,
  };
  s.pax.push(p);
  return p;
}

/** Spawn departing passengers at entrances and arriving ones at gates. */
export function spawnPax(s: GameState, f: Flight, dt: number): void {
  const now = s.minute;
  const entrances = ofKind(s, 'entrance');
  if (f.phase !== 'cancelled' && entrances.length) {
    const t0 = f.dep - 150, t1 = f.dep - 55;
    if (now >= t0 && now < t1 + dt) {
      const due = Math.min(f.paxOut, Math.round((f.paxOut * (Math.min(now, t1) - t0)) / (t1 - t0)));
      for (let i = f.spawned; i < due; i++) {
        const e = entrances[Math.floor(Math.random() * entrances.length)];
        const [x, y] = spawnPoint(e);
        newPax(s, f, true, x + rnd(-0.3, 0.3), y + rnd(-0.3, 0.3));
        if (s.buildings.some((b) => b.kind === 'carpark') && Math.random() < 0.35) { s.cash += FEES.parkingPerCar; s.today.parking += FEES.parkingPerCar; }
      }
      f.spawned = Math.max(f.spawned, due);
    }
  }
  if (f.phase === 'parked' && f.deplaned < f.paxIn) {
    const gate = gateOf(s, f) ?? ofKind(s, 'gate')[0];
    if (!gate) { f.deplaned = f.paxIn; return; }
    const n = Math.min(f.paxIn - f.deplaned, Math.ceil(dt * 14));
    for (let i = 0; i < n; i++) {
      const [x, y] = spawnPoint(gate, true);
      const p = newPax(s, f, false, x + rnd(-0.4, 0.4), y + rnd(-0.3, 0.3));
      p.state = 'toBaggage';
    }
    f.deplaned += n;
  }
}

function setFacing(p: Pax, dx: number, dy: number): void {
  if (Math.abs(dx) + Math.abs(dy) < 1e-4) return;
  p.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 0 : 2) : dy > 0 ? 1 : 3;
}

/** Move straight towards a point; true when there. */
function stepTo(p: Pax, x: number, y: number, dist: number): boolean {
  const dx = x - p.x, dy = y - p.y;
  const d = Math.hypot(dx, dy);
  setFacing(p, dx, dy);
  if (d <= dist) { p.x = x; p.y = y; return true; }
  p.x += (dx / d) * dist;
  p.y += (dy / d) * dist;
  return false;
}

/** Walk along a building's flow field; true on arrival at its access tile. */
function walkTo(s: GameState, p: Pax, b: Building, dt: number): boolean | 'lost' {
  let left = WALK * dt;
  for (let k = 0; k < 4 && left > 0; k++) {
    const atTx = Math.abs(p.x - p.tx) < 0.02 && Math.abs(p.y - p.ty) < 0.02;
    if (atTx) {
      const ns = nextStep(s, b, p.x, p.y);
      if (!ns) {
        if (distanceTo(s, b, p.x, p.y) === 0) return true;
        return 'lost';
      }
      const isGoal = distanceTo(s, b, ns[0], ns[1]) === 0;
      p.tx = ns[0] + 0.5 + (isGoal ? 0 : p.ox);
      p.ty = ns[1] + 0.5 + (isGoal ? 0 : p.oy);
    }
    const before = Math.hypot(p.tx - p.x, p.ty - p.y);
    stepTo(p, p.tx, p.ty, left);
    left -= Math.min(before, left);
  }
  return false;
}

function goTo(p: Pax, b: Building | undefined, state: Pax['state'], stage: Pax['stage']): boolean {
  if (!b) return false;
  p.target = b.id;
  p.state = state;
  p.stage = stage;
  p.tx = p.x;
  p.ty = p.y;
  return true;
}

function nextAfterSecurity(s: GameState, p: Pax, f: Flight | undefined): void {
  const time = f ? f.dep - s.minute : 0;
  if (time > 45) {
    for (const [bit, kind] of [[NEED_TOILET, 'toilets'], [NEED_FOOD, 'food'], [NEED_SHOP, 'shop']] as const) {
      if (!(p.needs & bit)) continue;
      p.needs &= ~bit;
      const b = choose(s, kind, p.x, p.y, (x) => usersOf(x.id) >= (MODULES[x.kind].capacity ?? 99));
      if (goTo(p, b, 'toNeed', 'need')) return;
      p.mood -= 4; // wanted it, couldn't find it
    }
  }
  // stands without their own gate board through the nearest gate by bus
  const gate = f && (gateOf(s, f) ?? (f.stand !== null ? choose(s, 'gate', p.x, p.y) : undefined));
  if (gate && distanceTo(s, gate, p.x, p.y) < UNREACHABLE) { goTo(p, gate, 'toGate', 'gate'); return; }
  // gate not known yet: rest on seating if there is any
  const seat = choose(s, 'seats', p.x, p.y, (x) => usersOf(x.id) >= 4);
  if (seat && goTo(p, seat, 'toNeed', 'need')) return;
  p.state = 'atGate';
  p.target = 0;
  p.timer = s.minute + 10;
}

/** A passenger finished at the airport: record its mood and remove it. */
function finish(_s: GameState, p: Pax, onDone: (p: Pax) => void): void {
  services.get(p.target)?.users.delete(p.id);
  p.state = 'lost';
  p.timer = -1;
  onDone(p);
}

export function updatePax(s: GameState, dt: number, flights: Map<number, Flight>, onDone: (p: Pax) => void): void {
  const now = s.minute;
  const L = getLayout(s);
  for (const p of s.pax) {
    const f = flights.get(p.flight);
    const b = p.target ? L.byId.get(p.target) : undefined;
    if (p.state === 'queue' || p.state === 'service') p.waited += p.state === 'queue' ? dt : 0;
    // missed flight
    if (p.dep && f && (f.phase === 'pushback' || f.phase === 'taxi_out' || f.phase === 'lineup' || f.phase === 'takeoff' || f.phase === 'departed' || f.phase === 'cancelled') && p.state !== 'boarding' && p.state !== 'toExit') {
      if (f.phase !== 'cancelled') f.missed++;
      p.mood -= f.phase === 'cancelled' ? 25 : 40;
      dropFromService(p);
      p.dep = false;
      if (!goTo(p, choose(s, 'entrance', p.x, p.y), 'toExit', 'exit')) { finish(s, p, onDone); continue; }
    }
    switch (p.state) {
      case 'toCheckin': {
        const target = b ?? choose(s, 'checkin', p.x, p.y);
        if (!target) { goTo(p, choose(s, 'security', p.x, p.y), 'toSecurity', 'security') || lose(p, now); break; }
        p.target = target.id;
        const r = walkTo(s, p, target, dt);
        if (r === 'lost') lose(p, now);
        else if (r) joinQueue(p, target);
        break;
      }
      case 'toSecurity': {
        const target = b ?? choose(s, 'security', p.x, p.y);
        if (!target) { nextAfterSecurity(s, p, f); break; }
        p.target = target.id;
        const r = walkTo(s, p, target, dt);
        if (r === 'lost') lose(p, now);
        else if (r) joinQueue(p, target);
        break;
      }
      case 'queue': {
        if (!b) { p.state = p.stage === 'checkin' ? 'toCheckin' : 'toSecurity'; break; }
        const v = svc(b.id);
        const k = v.queue.indexOf(p.id);
        const [ax, ay] = accessTile(b);
        const [dx, dy] = frontDir(b);
        stepTo(p, ax + 0.5 + dx * (0.2 + k * 0.42), ay + 0.5 + dy * (0.2 + k * 0.42), WALK * dt);
        if (p.waited > 12) p.mood -= 0.35 * dt;
        break;
      }
      case 'service': {
        if (!b) break;
        const v = svc(b.id);
        const slot = [...v.serving.keys()].indexOf(p.id);
        const spot = serverSpot(b, slot);
        stepTo(p, spot[0], spot[1], WALK * dt);
        if (now >= (v.serving.get(p.id) ?? 0)) {
          v.serving.delete(p.id);
          if (b.kind === 'checkin') goTo(p, choose(s, 'security', p.x, p.y), 'toSecurity', 'security') || nextAfterSecurity(s, p, f);
          else {
            const m = MODULES[b.kind];
            const [ex, ey] = localPoint(b, m.w / 2, -0.4);
            p.x = ex; p.y = ey; p.tx = ex; p.ty = ey;
            if (!walkable(s, Math.floor(ex), Math.floor(ey))) { const [ax, ay] = accessTile(b); p.x = ax + 0.5; p.y = ay + 0.5; p.tx = p.x; p.ty = p.y; }
            nextAfterSecurity(s, p, f);
          }
        }
        break;
      }
      case 'toNeed':
      case 'toGate':
      case 'toBaggage':
      case 'toExit': {
        let target = b;
        if (!target && p.state === 'toBaggage') { target = choose(s, 'baggage', p.x, p.y); if (!target) { goTo(p, choose(s, 'entrance', p.x, p.y), 'toExit', 'exit') || finish(s, p, onDone); break; } p.target = target.id; }
        if (!target && p.state === 'toExit') { target = choose(s, 'entrance', p.x, p.y); if (!target) { finish(s, p, onDone); break; } p.target = target.id; }
        if (!target) { p.state = 'atGate'; break; }
        const r = walkTo(s, p, target, dt);
        if (r === 'lost') { lose(p, now); break; }
        if (!r) break;
        arrive(s, p, target, f, onDone);
        break;
      }
      case 'atNeed': {
        if (!b) break;
        stepTo(p, p.tx, p.ty, WALK * dt * 0.5);
        if (now >= p.timer) {
          svc(b.id).users.delete(p.id);
          if (b.kind === 'baggage') { goTo(p, choose(s, 'entrance', p.x, p.y), 'toExit', 'exit') || finish(s, p, onDone); break; }
          const [ax, ay] = accessTile(b);
          p.x = ax + 0.5; p.y = ay + 0.5; p.tx = p.x; p.ty = p.y;
          nextAfterSecurity(s, p, f);
        }
        break;
      }
      case 'atGate': {
        stepTo(p, p.tx, p.ty, WALK * dt * 0.5);
        if (!f) { finish(s, p, onDone); break; }
        if (!b) {
          if (now >= p.timer) { p.timer = now + 10; nextAfterSecurity(s, p, f); }
          break;
        }
        if (f.phase === 'parked' && now >= f.dep - 35) {
          svc(b.id).users.delete(p.id);
          const m = MODULES[b.kind];
          const [bx, by] = localPoint(b, m.w * 0.5, 0.3);
          p.tx = bx; p.ty = by;
          p.state = 'boarding';
        }
        break;
      }
      case 'boarding': {
        if (stepTo(p, p.tx, p.ty, WALK * dt)) {
          if (f) f.boarded++;
          finish(s, p, onDone);
        }
        break;
      }
      case 'lost': {
        if (p.timer === -1) break;
        p.mood -= 0.5 * dt;
        if (now >= p.timer) finish(s, p, onDone);
        break;
      }
      default:
    }
    p.mood = Math.max(0, Math.min(100, p.mood));
  }
  s.pax = s.pax.filter((p) => p.timer !== -1);

  // serve queues
  for (const b of s.buildings) {
    const m = MODULES[b.kind];
    if (!m.servers) continue;
    const v = services.get(b.id);
    if (!v) continue;
    while (v.queue.length && v.serving.size < m.servers) {
      const id = v.queue.shift()!;
      v.serving.set(id, now + (m.serviceMin ?? 2) * rnd(0.6, 1.4));
      const p = s.pax.find((x) => x.id === id);
      if (p) p.state = 'service';
    }
  }
}

function serverSpot(b: Building, slot: number): [number, number] {
  const m = MODULES[b.kind];
  const n = m.servers ?? 1;
  const i = Math.max(0, slot);
  return localPoint(b, ((i + 0.5) * m.w) / n, m.h + 0.25);
}

function joinQueue(p: Pax, b: Building): void {
  svc(b.id).queue.push(p.id);
  p.state = 'queue';
}

function dropFromService(p: Pax): void {
  const v = services.get(p.target);
  if (!v) return;
  v.queue = v.queue.filter((id) => id !== p.id);
  v.serving.delete(p.id);
  v.users.delete(p.id);
}

function lose(p: Pax, now: number): void {
  p.state = 'lost';
  p.timer = now + 20;
  p.mood -= 30;
}

function arrive(s: GameState, p: Pax, b: Building, f: Flight | undefined, onDone: (p: Pax) => void): void {
  const m = MODULES[b.kind];
  if (p.state === 'toExit') { finish(s, p, onDone); return; }
  if (p.state === 'toGate') {
    const v = svc(b.id);
    const seated = v.users.size < (m.capacity ?? 24);
    v.users.add(p.id);
    // find a spot inside the seating area (or stand around the front)
    const [sx, sy] = seated ? localPoint(b, rnd(0.6, m.w - 0.6), rnd(1.0, m.h - 0.4)) : [p.x + rnd(-0.5, 0.5), p.y + rnd(-0.5, 0.5)];
    p.tx = sx; p.ty = sy;
    if (!seated) p.mood -= 5;
    p.state = 'atGate';
    return;
  }
  // comforts and baggage claim
  const v = svc(b.id);
  if (v.users.size >= (m.capacity ?? 99)) { p.mood -= 3; if (b.kind === 'baggage') v.users.add(p.id); else { nextAfterSecurity(s, p, f); return; } }
  v.users.add(p.id);
  const [dw0, dw1] = m.dwell ?? [5, 10];
  p.timer = s.minute + rnd(dw0, dw1);
  const [ix, iy] = localPoint(b, rnd(0.5, m.w - 0.5), rnd(0.6, m.h - 0.3));
  p.tx = ix; p.ty = iy;
  p.state = 'atNeed';
  if (m.spend) {
    const spent = m.spend * rnd(0.6, 1.5);
    s.cash += spent;
    if (b.kind === 'food') s.today.food += spent; else s.today.retail += spent;
  }
  p.mood += b.kind === 'seats' ? 3 : 6;
}
