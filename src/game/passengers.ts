// Passenger agents. Each passenger walks by flow field towards its current
// goal, queues and is served, satisfies needs, and boards or leaves.

import { MODULES, FEES } from './catalog';
import { acType } from '../data/aircraft';
import { drawBags } from './baggage';
import { busRate, isRemote, runBuses, takeSeat } from './buses';
import { flowAllows, isBorder } from './border';
import { pickConnection, premiumShare, transferShare } from './hub';
import { openServers } from './staff';
import { trainNetwork } from './train';
import { gateOf } from './flights';
import { accessTile, frontDir, getLayout, layoutStamp, localPoint, walkable } from './grid';
import { distanceTo, nextStep, UNREACHABLE } from './paths';
import type { Building, Flight, GameState, Pax } from './types';
import { readyAt } from './types';

export const WALK = 4.2; // tiles per game minute
const NEED_FOOD = 1, NEED_SHOP = 2, NEED_TOILET = 4;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** Transient per-building service state (rebuilt from scratch after loading a save). */
interface Service {
  queue: number[];
  serving: Map<number, number>; // pax id → service end minute
  users: Set<number>;
  joined: Map<number, number>; // pax id → minute joined the queue
  wait: number; // moving average queue wait, minutes
  done: number[]; // minutes at which service finished (last hour)
}
const services = new Map<number, Service>();

function svc(id: number): Service {
  let v = services.get(id);
  if (!v) { v = { queue: [], serving: new Map(), users: new Set(), joined: new Map(), wait: 0, done: [] }; services.set(id, v); }
  return v;
}

export interface ServiceStats { queue: number; wait: number; perHour: number }

export function serviceStats(id: number, now: number): ServiceStats {
  const v = services.get(id);
  if (!v) return { queue: 0, wait: 0, perHour: 0 };
  v.done = v.done.filter((t) => t > now - 60);
  return { queue: v.queue.length, wait: v.wait, perHour: v.done.length };
}

// Queue lanes snake back and forth in front of a module, like airport stanchions.
const LANE = 5;
const lanes = new Map<number, { stamp: number; slots: [number, number][] }>();

export function queueSlots(s: GameState, b: Building): [number, number][] {
  const hit = lanes.get(b.id);
  if (hit && hit.stamp === layoutStamp()) return hit.slots;
  const [ax, ay] = accessTile(b);
  const [dx, dy] = frontDir(b);
  const taken = new Set(s.buildings.filter((o) => o.id !== b.id && MODULES[o.kind].indoor).map((o) => accessTile(o).join(',')));
  const ok = (x: number, y: number) => walkable(s, x, y) && !taken.has(`${x},${y}`);
  let best: [number, number][] = [];
  for (const side of [1, -1]) {
    const px = -dy * side, py = dx * side;
    const tiles: [number, number, number, number][] = [];
    let x = ax, y = ay;
    for (let lane = 0; lane < 6; lane++) {
      const dir = lane % 2 ? -1 : 1;
      let n = 0;
      for (let k = 0; k < LANE; k++) {
        if (!ok(x, y)) break;
        tiles.push([x, y, dx * dir, dy * dir]);
        n++;
        if (k < LANE - 1) { x += dx * dir; y += dy * dir; }
      }
      if (n < LANE) break;
      x += px; y += py;
      if (!ok(x, y)) break;
    }
    const slots: [number, number][] = [];
    for (const [tx, ty, ux, uy] of tiles) for (const f of [-0.22, 0.22]) slots.push([tx + 0.5 + ux * f, ty + 0.5 + uy * f]);
    if (slots.length > best.length) best = slots;
  }
  if (!best.length) best = [[ax + 0.5, ay + 0.5]];
  lanes.set(b.id, { stamp: layoutStamp(), slots: best });
  return best;
}

/** After loading a save: queues are transient, so send queued passengers back on their way. */
export function resetServices(s: GameState): void {
  services.clear();
  for (const p of s.pax) {
    if (p.state === 'queue' || p.state === 'service') p.state = p.stage === 'checkin' ? 'toCheckin' : p.stage === 'passport' ? 'toPassport' : p.stage === 'transfer' ? 'toTransfer' : 'toSecurity';
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

/** Best building of a kind for this passenger: shortest walk (in its direction of travel) plus a queue penalty. */
function choose(s: GameState, kind: Building['kind'], p: Pax, full?: (b: Building) => boolean): Building | undefined {
  // still inside a building (e.g. walking out of a gate): measure from the tile being walked to
  const inBuilding = !walkable(s, Math.floor(p.x), Math.floor(p.y), !p.dep);
  const x = inBuilding ? p.tx : p.x, y = inBuilding ? p.ty : p.y;
  let best: Building | undefined;
  let bs = Infinity;
  for (const b of ofKind(s, kind)) {
    if (full?.(b)) continue;
    const d = distanceTo(s, b, x, y, !p.dep);
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
    color: Math.floor(Math.random() * 6), facing: 0, mood: 75, waited: 0, bags: 0, bagAt: 0,
  };
  s.pax.push(p);
  return p;
}

const busCarry = new Map<number, number>(); // fractional arrivals carried over between steps

/** Spawn departing passengers at entrances and arriving ones at gates. */
export function spawnPax(s: GameState, f: Flight, dt: number): void {
  const now = s.minute;
  const entrances = ofKind(s, 'entrance');
  if (f.phase !== 'cancelled' && entrances.length) {
    // long-haul passengers turn up earlier, as airlines ask them to
    const long = acType(f.typeId).category === 'widebody' || acType(f.typeId).category === 'superjumbo';
    const t0 = f.dep - (long ? 190 : 150), t1 = f.dep - (long ? 80 : 55);
    if (now >= t0 && now < t1 + dt) {
      const due = Math.min(f.paxOut, Math.round((f.paxOut * (Math.min(now, t1) - t0)) / (t1 - t0)));
      for (let i = f.spawned; i < due; i++) {
        const e = entrances[Math.floor(Math.random() * entrances.length)];
        const [x, y] = spawnPoint(e);
        const p = newPax(s, f, true, x + rnd(-0.3, 0.3), y + rnd(-0.3, 0.3));
        p.bags = drawBags();
        p.premium = Math.random() < premiumShare(f.airline);
        p.egate = Math.random() < 0.55;
        if (!p.bags) { p.state = 'toSecurity'; p.stage = 'security'; } // checked in online, hand luggage only
        if (s.buildings.some((b) => b.kind === 'carpark') && Math.random() < 0.35) { s.cash += FEES.parkingPerCar; s.today.parking += FEES.parkingPerCar; }
      }
      f.spawned = Math.max(f.spawned, due);
    }
  }
  if (f.phase === 'parked' && f.deplaned < f.paxIn) {
    const remote = isRemote(s, f);
    const gate = gateOf(s, f) ?? (remote ? ofKind(s, 'busgate')[0] : undefined) ?? ofKind(s, 'gate')[0];
    if (!gate) { f.deplaned = f.paxIn; return; }
    // jet bridges let people off quickly; buses bring them in loads
    const rate = remote ? busRate(s, f) : 14;
    busCarry.set(f.id, (busCarry.get(f.id) ?? 0) + rate * dt);
    const n = Math.min(f.paxIn - f.deplaned, Math.floor(busCarry.get(f.id)!));
    busCarry.set(f.id, busCarry.get(f.id)! - n);
    for (let i = 0; i < n; i++) {
      const [x, y] = spawnPoint(gate, true);
      const p = newPax(s, f, false, x + rnd(-0.4, 0.4), y + rnd(-0.3, 0.3));
      p.bags = drawBags();
      p.egate = Math.random() < 0.55;
      f.bagsIn += p.bags;
      p.bagAt = f.bagsIn;
      const onward = Math.random() < transferShare(s, f) ? pickConnection(s, f) : undefined;
      if (onward) {
        // a connecting passenger: stays airside, bags are transferred to the next flight
        p.dep = true; p.transfer = true; p.flight = onward.id; p.premium = Math.random() < premiumShare(onward.airline);
        onward.paxOut++; onward.spawned++;
        onward.bagsChecked += p.bags;
        f.bagsIn -= p.bags; p.bagAt = 0;
        p.state = 'toTransfer'; p.stage = 'transfer';
        s.today.transfers = (s.today.transfers ?? 0) + 1;
      }
      else if (isBorder(s, f)) { p.state = 'toPassport'; p.stage = 'passport'; }
      else if (p.bags) p.state = 'toBaggage';
      else { p.state = 'toExit'; p.stage = 'exit'; }
      // walk out through the gate lounge before following the flow field
      const [ax, ay] = accessTile(gate);
      p.tx = ax + 0.5 + p.ox; p.ty = ay + 0.5 + p.oy;
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
  if (p.ride) {
    // on the people mover: step off at the next platform when it arrives
    if (s.minute < p.ride.until) return false;
    p.x = p.ride.x; p.y = p.ride.y; p.tx = p.x; p.ty = p.y;
    p.ride = undefined;
  }
  let left = WALK * dt;
  for (let k = 0; k < 4 && left > 0; k++) {
    const atTx = Math.abs(p.x - p.tx) < 0.02 && Math.abs(p.y - p.ty) < 0.02;
    if (atTx) {
      const ns = nextStep(s, b, p.x, p.y, !p.dep);
      if (!ns) {
        if (distanceTo(s, b, p.x, p.y, !p.dep) === 0) return true;
        // standing off the floor plan (pushed out of a crowd): step back onto the nearest walkable tile
        const back = nearestWalkable(s, p, b);
        if (!back) return 'lost';
        p.tx = back[0] + 0.5; p.ty = back[1] + 0.5;
        continue;
      }
      if (Math.abs(ns[0] - Math.floor(p.x)) + Math.abs(ns[1] - Math.floor(p.y)) > 1) {
        // the next move is a train ride from this platform door
        const here = Math.floor(p.y) * s.W + Math.floor(p.x);
        const ride = trainNetwork(s).links.get(here)?.find((r) => r.to === ns[1] * s.W + ns[0]);
        p.ride = { until: s.minute + (ride?.minutes ?? 2), x: ns[0] + 0.5, y: ns[1] + 0.5 };
        return false;
      }
      const isGoal = distanceTo(s, b, ns[0], ns[1], !p.dep) === 0;
      p.tx = ns[0] + 0.5 + (isGoal ? 0 : p.ox);
      p.ty = ns[1] + 0.5 + (isGoal ? 0 : p.oy);
    }
    const before = Math.hypot(p.tx - p.x, p.ty - p.y);
    stepTo(p, p.tx, p.ty, left);
    left -= Math.min(before, left);
  }
  return false;
}

/** The closest walkable tile (within 3) from which the target can be reached. */
function nearestWalkable(s: GameState, p: Pax, b: Building): [number, number] | null {
  const cx = Math.floor(p.x), cy = Math.floor(p.y);
  if (walkable(s, cx, cy, !p.dep) && distanceTo(s, b, cx + 0.5, cy + 0.5, !p.dep) < UNREACHABLE) return null; // on the floor already
  let best: [number, number] | null = null, bd = Infinity;
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    const x = cx + dx, y = cy + dy;
    if (!walkable(s, x, y, !p.dep) || distanceTo(s, b, x + 0.5, y + 0.5, !p.dep) >= UNREACHABLE) continue;
    const d = Math.hypot(dx, dy);
    if (d < bd) { bd = d; best = [x, y]; }
  }
  return best;
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
  if (f && p.dep && !p.cleared && isBorder(s, f)) {
    const pc = choosePassport(s, p);
    if (pc && goTo(p, pc, 'toPassport', 'passport')) return;
    p.cleared = true; // no passport control to be found: they wander through (the border police will fine you)
  }
  const time = f ? f.dep - s.minute : 0;
  if (p.premium && time > 60) {
    p.premium = false; // one lounge visit
    const l = choose(s, 'lounge', p, (x) => usersOf(x.id) >= (MODULES.lounge.capacity ?? 30));
    if (goTo(p, l, 'toNeed', 'need')) return;
  }
  if (time > 45) {
    for (const [bit, kind] of [[NEED_TOILET, 'toilets'], [NEED_FOOD, 'food'], [NEED_SHOP, 'shop']] as const) {
      if (!(p.needs & bit)) continue;
      p.needs &= ~bit;
      const b = choose(s, kind, p, (x) => usersOf(x.id) >= (MODULES[x.kind].capacity ?? 99));
      if (goTo(p, b, 'toNeed', 'need')) return;
      p.mood -= 4; // wanted it, couldn't find it
    }
  }
  // remote stands board by apron bus from a bus gate (or, failing that, any gate)
  const gate = f && (gateOf(s, f) ?? (f.stand !== null ? choose(s, 'busgate', p) ?? choose(s, 'gate', p) : undefined));
  if (gate && distanceTo(s, gate, p.x, p.y) < UNREACHABLE) { goTo(p, gate, 'toGate', 'gate'); return; }
  // gate not known yet: rest on seating if there is any
  const seat = choose(s, 'seats', p, (x) => usersOf(x.id) >= 4);
  if (seat && goTo(p, seat, 'toNeed', 'need')) return;
  p.state = 'atGate';
  p.target = 0;
  p.timer = s.minute + 10;
}

/** Nearest passport point for this passenger's direction: booths, or e-gates if eligible. */
function choosePassport(s: GameState, p: Pax): Building | undefined {
  const wrongWay = (b: Building) => !flowAllows(b, p.dep);
  const booth = choose(s, 'passport', p, wrongWay);
  const gate = p.egate ? choose(s, 'egates', p, wrongWay) : undefined;
  if (!gate) return booth;
  if (!booth) return gate;
  // e-gates are faster, so eligible travellers prefer them unless they are much further
  const score = (b: Building) => distanceTo(s, b, p.x, p.y, !p.dep) + queueLength(b.id) * (b.kind === 'egates' ? 1.2 : 3);
  return score(gate) <= score(booth) + 4 ? gate : booth;
}

/** Through passport control: departing passengers carry on to the gate, arriving ones to their bags or out. */
function afterPassport(s: GameState, p: Pax, f: Flight | undefined, onDone: (p: Pax) => void): void {
  if (p.dep) { nextAfterSecurity(s, p, f); return; }
  // still walking out of a gate lounge: keep heading for its door before following the floor plan
  const [tx, ty] = [p.tx, p.ty];
  const inside = !walkable(s, Math.floor(p.x), Math.floor(p.y), true);
  const ok = (p.bags && goTo(p, choose(s, 'baggage', p), 'toBaggage', 'baggage')) || goTo(p, choose(s, 'entrance', p), 'toExit', 'exit');
  if (!ok) { finish(s, p, onDone); return; }
  if (inside) { p.tx = tx; p.ty = ty; }
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
    // missed flight: the gate closes 10 minutes before departure
    const closed = f && ((f.phase === 'parked' && now >= readyAt(f) - 10) || f.phase === 'pushback' || f.phase === 'taxi_out' || f.phase === 'lineup' || f.phase === 'takeoff' || f.phase === 'departed' || f.phase === 'cancelled');
    const safe = p.state === 'boarding' || p.state === 'toExit' || (p.state === 'atGate' && f?.phase === 'parked' && !!b && (b.kind === 'gate' || b.kind === 'busgate'));
    if (p.dep && f && closed && !safe) {
      if (f.phase !== 'cancelled') f.missed++;
      // a no-show who checked bags: their bags must come off the aircraft before it can leave
      if (f.phase === 'parked' && p.bags && p.stage !== 'checkin') f.waitUntil = Math.min(readyAt(f) + 15, Math.max(f.waitUntil, readyAt(f) + 3) + 0.4 * p.bags);
      p.mood -= f.phase === 'cancelled' ? 30 : 60; // stranded passengers are furious
      dropFromService(p);
      p.dep = false;
      if (!goTo(p, choose(s, 'entrance', p), 'toExit', 'exit')) { finish(s, p, onDone); continue; }
    }
    switch (p.state) {
      case 'toCheckin': {
        const target = b ?? choose(s, 'checkin', p);
        if (!target) { goTo(p, choose(s, 'security', p), 'toSecurity', 'security') || lose(p, now); break; }
        p.target = target.id;
        const r = walkTo(s, p, target, dt);
        if (r === 'lost') lose(p, now);
        else if (r) joinQueue(p, target, now);
        break;
      }
      case 'toSecurity': {
        const target = b ?? choose(s, 'security', p);
        if (!target) { nextAfterSecurity(s, p, f); break; }
        p.target = target.id;
        const r = walkTo(s, p, target, dt);
        if (r === 'lost') lose(p, now);
        else if (r) joinQueue(p, target, now);
        break;
      }
      case 'toTransfer': {
        const target = b ?? choose(s, 'transfer', p);
        if (!target) { nextAfterSecurity(s, p, f); break; }
        p.target = target.id;
        const r = walkTo(s, p, target, dt);
        if (r === 'lost') lose(p, now);
        else if (r) joinQueue(p, target, now);
        break;
      }
      case 'toPassport': {
        const target = b ?? choosePassport(s, p);
        if (!target) { p.cleared = true; afterPassport(s, p, f, onDone); break; }
        p.target = target.id;
        const r = walkTo(s, p, target, dt);
        if (r === 'lost') lose(p, now);
        else if (r) joinQueue(p, target, now);
        break;
      }
      case 'queue': {
        if (!b) { p.state = p.stage === 'checkin' ? 'toCheckin' : p.stage === 'passport' ? 'toPassport' : p.stage === 'transfer' ? 'toTransfer' : 'toSecurity'; break; }
        const v = svc(b.id);
        const k = v.queue.indexOf(p.id);
        const slots = queueSlots(s, b);
        const [qx, qy] = slots[Math.min(k, slots.length - 1)];
        const over = k >= slots.length ? Math.min(1.2, (k - slots.length + 1) * 0.04) : 0; // overflow bunches up at the tail, not into walls
        stepTo(p, qx + p.ox * over, qy + p.oy * over, WALK * dt);
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
          v.done.push(now);
          if (b.kind === 'transfer') {
            nextAfterSecurity(s, p, f);
          } else if (b.kind === 'passport' || b.kind === 'egates') {
            p.cleared = true;
            afterPassport(s, p, f, onDone);
          } else if (b.kind === 'checkin') {
            if (f) f.bagsChecked += p.bags;
            goTo(p, choose(s, 'security', p), 'toSecurity', 'security') || nextAfterSecurity(s, p, f);
          }
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
        if (!target && p.state === 'toBaggage') { target = choose(s, 'baggage', p); if (!target) { goTo(p, choose(s, 'entrance', p), 'toExit', 'exit') || finish(s, p, onDone); break; } p.target = target.id; }
        if (!target && p.state === 'toExit') { target = choose(s, 'entrance', p); if (!target) { finish(s, p, onDone); break; } p.target = target.id; }
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
        if (b.kind === 'baggage' && f && f.bagsDelivered < p.bagAt - 0.5) {
          // still waiting for the last bag to come round
          p.waited += dt;
          if (p.waited > 15) p.mood -= 0.3 * dt;
          break;
        }
        if (now >= p.timer) {
          svc(b.id).users.delete(p.id);
          const [ax, ay] = accessTile(b);
          p.x = ax + 0.5; p.y = ay + 0.5; p.tx = p.x; p.ty = p.y;
          if (b.kind === 'baggage') { goTo(p, choose(s, 'entrance', p), 'toExit', 'exit') || finish(s, p, onDone); break; }
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
        if (f.phase === 'parked' && now >= readyAt(f) - 35) {
          if (isRemote(s, f) && !takeSeat(f)) break; // waiting for the next bus
          if (isRemote(s, f)) p.mood -= 4; // nobody likes the bus
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

  runBuses(s, dt);
  // serve queues at desks and lanes that have staff on shift
  const open = openServers(s);
  for (const b of s.buildings) {
    const m = MODULES[b.kind];
    if (!m.servers) continue;
    const v = services.get(b.id);
    if (!v) continue;
    while (v.queue.length && v.serving.size < (open.get(b.id) ?? m.servers)) {
      const id = v.queue.shift()!;
      v.serving.set(id, now + (m.serviceMin ?? 2) * rnd(0.6, 1.4));
      v.wait += (now - (v.joined.get(id) ?? now) - v.wait) * 0.1;
      v.joined.delete(id);
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

function joinQueue(p: Pax, b: Building, now: number): void {
  const v = svc(b.id);
  v.queue.push(p.id);
  v.joined.set(p.id, now);
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
  // departing passengers leave in time to make boarding (lounges call their guests)
  if (p.dep && f) p.timer = Math.max(s.minute + 2, Math.min(p.timer, readyAt(f) - 40));
  const [ix, iy] = localPoint(b, rnd(0.5, m.w - 0.5), rnd(0.6, m.h - 0.3));
  p.tx = ix; p.ty = iy;
  p.state = 'atNeed';
  if (m.spend) {
    const spent = m.spend * rnd(0.6, 1.5);
    s.cash += spent;
    if (b.kind === 'food') s.today.food += spent; else s.today.retail += spent;
  }
  if (b.kind === 'lounge') s.today.lounge = (s.today.lounge ?? 0) + 1;
  p.mood += b.kind === 'seats' ? 3 : b.kind === 'lounge' ? 12 : 6;
}
