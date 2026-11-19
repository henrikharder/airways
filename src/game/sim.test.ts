import { describe, expect, it } from 'vitest';
import { demoGame } from './demo';
import { acceptOffer, held } from './flights';
import { accessTile, bulldozeAt, checkPlace, drivable, paintRect, place, walkable } from './grid';
import { gateName } from './terminals';
import { scenarioProgress, SCENARIOS, startScenario } from './scenarios';
import { createGame } from './newgame';
import { aircraftPath, distanceTo, nextStep, UNREACHABLE } from './paths';
import { securityReport } from './security';
import { advance } from './sim';
import { inNight, setCurfew } from './night';
import { needed, openServers, staffToNeed } from './staff';
import { isRemote } from './buses';
import { crossesBorder, isBorder } from './border';
import { expandedGame } from './expanded';
import { transferShare } from './hub';
import { serviceStats } from './passengers';
import type { Flight } from './types';

describe('building rules', () => {
  it('only allows indoor modules on terminal floor with a free front', () => {
    const s = createGame({ name: 'T', code: 'TST', city: 'CPH' });
    s.buildings = [];
    expect(checkPlace(s, 'checkin', 40, 40, 0).ok).toBe(false);
    paintRect(s, 'floor', 38, 38, 46, 46);
    expect(place(s, 'checkin', 40, 40, 0).ok).toBe(true);
    expect(checkPlace(s, 'gate', 40, 42, 0).ok).toBe(false); // would block the check-in queue tile
  });

  it('routes aircraft over taxiways only', () => {
    const s = demoGame();
    expect(aircraftPath(s, 50, 12, 35, 41)).not.toBeNull();
    expect(aircraftPath(s, 50, 12, 10, 60)).toBeNull();
  });
});

describe('taxiing', () => {
  it('holds short behind an aircraft ahead, but not one behind or beside', () => {
    const s = demoGame();
    const make = (x: number, y: number, phase: 'taxi_out' | 'taxi_in') => ({ ...s.flights[0], id: Math.random(), x, y, alt: 0, phase, path: [[50.5, 20.5]] as [number, number][], pathI: 0 });
    const me = make(50.5, 30.5, 'taxi_out');
    s.flights = [me, make(50.5, 25, 'taxi_in')];
    expect(held(s, me, 100)).toBe(true);
    expect(held(s, me, 106)).toBe(false); // gives up after a standoff
    s.flights = [me, make(50.5, 36, 'taxi_in')];
    expect(held(s, me, 200)).toBe(false);
    s.flights = [me, make(56, 25, 'taxi_in')];
    expect(held(s, me, 300)).toBe(false);
  });
});

describe('airport simulation', () => {
  it('lands, turns around and departs flights with boarded passengers', () => {
    const s = demoGame();
    expect(s.buildings.filter((b) => b.kind === 'stand_m').every((b) => b.link)).toBe(true);
    let peak = 0, lost = 0;
    const leaving = new Set<number>(); // arriving passengers heading out after baggage claim
    const done = new Map<number, Flight>();
    for (let i = 0; i < 48 * 60; i += 10) {
      advance(s, 10);
      peak = Math.max(peak, s.pax.length);
      lost = Math.max(lost, s.pax.filter((p) => p.state === 'lost').length);
      for (const p of s.pax) if (p.state === 'toExit' && p.y > 63) leaving.add(p.id);
      for (const f of s.flights) if (f.phase === 'departed') done.set(f.id, f); // old flights get pruned
    }
    const departures = s.history.reduce((n, d) => n + d.departures, 0) + s.today.departures;
    const boarded = [...done.values()].reduce((n, f) => n + f.boarded, 0);
    const missed = [...done.values()].reduce((n, f) => n + f.missed, 0);
    expect(s.flights.filter((f) => f.phase === 'cancelled')).toHaveLength(0);
    const bagsLeft = [...done.values()].reduce((n, f) => n + f.bagsLeft, 0);
    const late = [...done.values()].filter((f) => f.delayed > 15).length;
    console.log({ departures, boarded, missed, peak, lost, leaving: leaving.size, bagsLeft, late, cash: Math.round(s.cash), rating: s.rating.toFixed(1) });
    expect(departures).toBeGreaterThanOrEqual(7);
    expect(boarded).toBeGreaterThan(missed * 4);
    expect(lost).toBe(0);
    expect(leaving.size).toBeGreaterThan(200); // arrivals got through the exit to the landside
  });
});

describe('security', () => {
  it('reports a breach until the airside is walled off, and needs an arrivals exit', () => {
    const s = demoGame();
    expect(securityReport(s)).toMatchObject({ applies: true, breach: false, trapped: false, badLanes: 0 });
    const exit = s.buildings.find((b) => b.kind === 'exit')!;
    bulldozeAt(s, exit.x, exit.y);
    expect(securityReport(s).breach).toBe(true); // a bulldozed exit leaves a gap in the barrier
    paintRect(s, 'barrier', exit.x, exit.y, exit.x + 1, exit.y);
    expect(securityReport(s)).toMatchObject({ breach: false, trapped: true });
    bulldozeAt(s, 30, 63);
    expect(securityReport(s).breach).toBe(true);
  });

  it('lets arrivals out through the exit but keeps departures out', () => {
    const s = demoGame();
    const exit = s.buildings.find((b) => b.kind === 'exit')!;
    const entrance = s.buildings.find((b) => b.kind === 'entrance')!;
    const gate = s.buildings.find((b) => b.kind === 'gate')!;
    const [gx, gy] = accessTile(gate);
    expect(distanceTo(s, entrance, gx + 0.5, gy + 0.5, true)).toBeLessThan(UNREACHABLE);
    expect(walkable(s, exit.x, exit.y, false)).toBe(false);
    expect(walkable(s, exit.x, exit.y, true)).toBe(true);
  });
});

describe('baggage', () => {
  it('holds departures for bags, and leaves bags behind when the system cannot keep up', () => {
    const run = (setup: (s: ReturnType<typeof demoGame>) => void) => {
      const s = demoGame();
      setup(s);
      const done = new Map<number, Flight>();
      for (let i = 0; i < 30 * 60; i += 10) {
        advance(s, 10);
        for (const f of s.flights) if (f.phase === 'departed') done.set(f.id, f);
      }
      const fs = [...done.values()];
      return { left: fs.reduce((n, f) => n + f.bagsLeft, 0), late: fs.filter((f) => f.delayed > 10).length, flights: fs };
    };
    const good = run(() => {});
    const bad = run((s) => {
      const hall = s.buildings.find((b) => b.kind === 'bagsort')!;
      bulldozeAt(s, hall.x, hall.y);
      s.staff.ground = 0;
    });
    expect(good.left).toBe(0);
    expect(bad.left + bad.late).toBeGreaterThan(good.left + good.late);
    // not everyone checks a bag, and arriving bags all reach the carousel
    for (const f of good.flights) {
      expect(f.bagsChecked).toBeLessThan(f.boarded * 2 + 1);
      expect(f.bagsIn).toBeLessThan(f.paxIn * 1.5);
    }
  });
});

describe('staff', () => {
  it('only opens desks that have staff on shift', () => {
    const s = demoGame();
    const desks = s.buildings.filter((b) => b.kind === 'checkin');
    expect(openServers(s).get(desks[0].id)).toBe(4);
    const served = () => desks.reduce((n, b) => n + serviceStats(b.id, s.minute).perHour, 0);
    s.staff.checkin = 0;
    let queued = false;
    for (let m = 0; m < 24 * 60 && !queued; m += 10) { advance(s, 10); queued ||= s.pax.some((p) => p.state === 'queue' && p.stage === 'checkin'); }
    advance(s, 20);
    expect(queued).toBe(true);
    expect(served()).toBe(0);
    s.staff.checkin = needed(s).checkin;
    while (s.pax.every((p) => p.state !== 'queue' || p.stage !== 'checkin')) advance(s, 10);
    advance(s, 30);
    expect(served()).toBeGreaterThan(0);
  });
});

describe('night operations', () => {
  it('a curfew ends night contracts and blocks new ones; night flights cost goodwill', () => {
    const s = demoGame();
    s.offers.push({ id: ++s.nextId, airline: 'FR', dest: 'STN', typeId: 'B38M', perDay: 1, load: 0.85, expires: 9, minRating: 0, night: true });
    expect(acceptOffer(s, s.nextId)).toBeNull();
    const night = s.flights.filter((f) => f.night);
    expect(night.length).toBeGreaterThan(0);
    for (const f of night) expect(inNight(f.dep)).toBe(true);
    const before = s.goodwill;
    advance(s, 26 * 60);
    expect(s.history.length + s.today.departures).toBeGreaterThan(0);
    expect(s.goodwill).toBeLessThan(before + 2); // night noise outweighed a day of recovery
    setCurfew(s, '23-06');
    expect(s.contracts.some((c) => c.night)).toBe(false);
    s.offers.push({ id: ++s.nextId, airline: 'FR', dest: 'STN', typeId: 'B38M', perDay: 1, load: 0.85, expires: 9, minRating: 0, night: true });
    expect(acceptOffer(s, s.nextId)).not.toBeNull();
  });
});

describe('remote stands', () => {
  it('boards remote stands by apron bus from a bus gate', () => {
    const s = demoGame();
    paintRect(s, 'taxiway', 52, 18, 62, 18);
    expect(place(s, 'stand_m', 52, 19, 0).ok).toBe(true);
    expect(place(s, 'busgate', 38, 52, 0).ok).toBe(true);
    const remote = s.buildings.find((b) => b.kind === 'stand_m' && b.x === 52 && b.y === 19)!;
    expect(remote.link).toBeUndefined();
    // close the contact stands so everything goes remote
    for (const b of s.buildings.filter((x) => x.kind === 'stand_m' && x.id !== remote.id)) bulldozeAt(s, b.x + 1, b.y + 1);
    for (const f of s.flights) if (f.phase === 'scheduled') f.stand = null;
    staffToNeed(s);
    const done = new Map<number, Flight>();
    for (let m = 0; m < 20 * 60; m += 10) {
      advance(s, 10);
      for (const f of s.flights) if (f.phase === 'departed') done.set(f.id, f);
    }
    const fs = [...done.values()].filter((f) => f.stand === remote.id);
    expect(fs.length).toBeGreaterThan(0);
    for (const f of fs) expect(f.boarded).toBeGreaterThan(f.paxOut * 0.8);
    expect(isRemote(s, { ...fs[0], phase: 'parked' })).toBe(true);
  });
});

describe('borders', () => {
  it('knows which routes cross a border', () => {
    expect(crossesBorder('CPH', 'LHR')).toBe(true);
    expect(crossesBorder('CPH', 'DUB')).toBe(true);
    expect(crossesBorder('CPH', 'OSL')).toBe(false);
    expect(crossesBorder('CPH', 'GVA')).toBe(false);
    expect(crossesBorder('LHR', 'MAN')).toBe(false);
  });

  it('sends non-Schengen passengers through passport control, and fines airports without it', () => {
    const s = demoGame();
    const pc = s.buildings.find((b) => b.kind === 'passport')!;
    let served = 0;
    for (let m = 0; m < 14 * 60; m += 10) { advance(s, 10); served = Math.max(served, serviceStats(pc.id, s.minute).perHour); }
    expect(served).toBeGreaterThan(0);
    bulldozeAt(s, pc.x, pc.y);
    advance(s, 36 * 60);
    expect(s.news.some((n) => n.text.startsWith('Border police fine'))).toBe(true);
  });

  it('keeps non-Schengen flights away from Schengen-only gates', () => {
    const s = expandedGame();
    const L = new Map(s.buildings.map((b) => [b.id, b]));
    for (const f of s.flights) {
      if (f.stand === null) continue;
      const st = L.get(f.stand)!;
      const gate = st.link ? L.get(st.link) : undefined;
      if (isBorder(s, f)) expect(gate?.zone).not.toBe('schengen');
      else expect(gate?.zone).not.toBe('border');
    }
  });
});

describe('hub', () => {
  it('routes connecting passengers airside and fills lounges', () => {
    const s = expandedGame();
    expect(transferShare(s, s.flights.find((f) => f.airline === 'SK')!)).toBeGreaterThan(0);
    let boardedTransfers = 0;
    const seen = new Set<number>();
    for (let m = 0; m < 30 * 60; m += 5) {
      advance(s, 5);
      for (const p of s.pax) if (p.transfer && (p.state === 'atGate' || p.state === 'boarding') && !seen.has(p.id)) { seen.add(p.id); boardedTransfers++; } // made it to the gate
    }
    const transfers = s.history.reduce((n, d) => n + (d.transfers ?? 0), 0) + (s.today.transfers ?? 0);
    const lounge = s.history.reduce((n, d) => n + (d.lounge ?? 0), 0) + (s.today.lounge ?? 0);
    expect(transfers).toBeGreaterThan(50);
    expect(boardedTransfers).toBeGreaterThan(transfers * 0.7);
    expect(lounge).toBeGreaterThan(20);
  });
});

describe('two runways', () => {
  it('spreads landings and take-offs over both runways', () => {
    const s = expandedGame();
    expect(s.buildings.filter((b) => b.kind === 'runway')).toHaveLength(2);
    const used = new Map<number, number>();
    for (let m = 0; m < 20 * 60; m += 5) {
      advance(s, 5);
      for (const f of s.flights) if ((f.phase === 'approach' || f.phase === 'takeoff') && f.rwy !== undefined) used.set(f.rwy, (used.get(f.rwy) ?? 0) + 1);
    }
    expect(used.size).toBe(2);
  });
});

describe('terminals and skywalks', () => {
  it('names gates by terminal and lets passengers cross a skywalk over a taxiway', () => {
    const s = createGame({ name: 'T', code: 'TST', city: 'CPH' });
    s.cash = 50e6;
    paintRect(s, 'floor', 10, 60, 19, 69);
    paintRect(s, 'floor', 40, 60, 49, 69);
    paintRect(s, 'taxiway', 25, 50, 26, 75); // a taxiway between the two terminals
    expect(place(s, 'gate', 12, 60, 0).ok).toBe(true);
    expect(place(s, 'gate', 42, 60, 0).ok).toBe(true);
    const [g1, g2] = s.buildings.filter((b) => b.kind === 'gate').sort((a, b) => a.x - b.x);
    expect(gateName(s, g1.id)).toBe('A1');
    expect(gateName(s, g2.id)).toBe('B1');
    expect(distanceTo(s, g2, 15.5, 66.5)).toBe(UNREACHABLE);
    expect(paintRect(s, 'skywalk', 20, 66, 39, 66)).toBe(20);
    expect(distanceTo(s, g2, 15.5, 66.5)).toBeLessThan(UNREACHABLE);
    expect(drivable(s, 25, 66)).toBe(true); // aircraft still taxi underneath
  });
});

describe('passport halls', () => {
  it('sends departures and arrivals to the hall for their direction', () => {
    const s = expandedGame();
    const halls = s.buildings.filter((b) => b.kind === 'passport');
    expect(halls.some((b) => b.flow === 'in') && halls.some((b) => b.flow === 'out')).toBe(true);
    const seen = new Map<number, Set<boolean>>();
    for (let m = 0; m < 12 * 60; m += 2) {
      advance(s, 2);
      for (const p of s.pax) {
        if (p.state !== 'queue' && p.state !== 'service') continue;
        const b = s.buildings.find((x) => x.id === p.target);
        if (b?.kind !== 'passport') continue;
        if (!seen.has(b.id)) seen.set(b.id, new Set());
        seen.get(b.id)!.add(p.dep);
      }
    }
    for (const b of halls) for (const dep of seen.get(b.id) ?? []) expect(b.flow === 'both' || (b.flow === 'out') === dep).toBe(true);
    expect([...seen.values()].length).toBeGreaterThan(0);
  });
});

describe('scenarios', () => {
  it('sets up each scenario and tracks the goal', () => {
    for (const sc of SCENARIOS) {
      const s = createGame({ name: 'T', code: 'TST', city: 'CPH' });
      startScenario(s, sc.id);
      expect(s.scenario?.id).toBe(sc.id);
      if (sc.goal) {
        if (s.buildings.some((b) => b.kind === 'runway')) expect(s.contracts.length).toBeGreaterThan(0); // a working airport
        advance(s, 24 * 60);
        expect(scenarioProgress(s)!.value).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('people mover', () => {
  it('lets passengers ride between distant stations when it beats walking', () => {
    const s = createGame({ name: 'T', code: 'TST', city: 'CPH' });
    s.cash = 80e6;
    paintRect(s, 'floor', 5, 60, 14, 69);
    paintRect(s, 'floor', 85, 60, 94, 69);
    paintRect(s, 'skywalk', 15, 64, 84, 64); // a 70-tile walk between the two
    expect(place(s, 'gate', 88, 60, 0).ok).toBe(true);
    const gate = s.buildings.find((b) => b.kind === 'gate')!;
    const walking = distanceTo(s, gate, 7.5, 66.5);
    expect(walking).toBeLessThan(UNREACHABLE);
    expect(place(s, 'station', 6, 62, 0).ok).toBe(true);
    expect(place(s, 'station', 88, 65, 0).ok).toBe(true);
    const riding = distanceTo(s, gate, 7.5, 66.5);
    expect(riding).toBeLessThan(walking * 0.6);
    // a passenger following the field boards the train at the platform door
    const st = s.buildings.find((b) => b.kind === 'station' && b.x === 6)!;
    const [ax, ay] = accessTile(st);
    const next = nextStep(s, gate, ax + 0.5, ay + 0.5);
    expect(next && Math.abs(next[0] - ax) + Math.abs(next[1] - ay)).toBeGreaterThan(1);
  });
});

describe('milestones', () => {
  it('unlocks milestones as the airport grows', () => {
    const s = expandedGame();
    advance(s, 26 * 60);
    expect(s.milestones).toContain('first');
    expect(s.milestones).toContain('widebody');
    expect(s.milestones).toContain('a380');
    expect(s.milestones).toContain('runways2');
    expect(s.totals!.departures).toBeGreaterThan(20);
  });
});
