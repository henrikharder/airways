// Guided tutorial and one-time introductions. The guided part walks a new
// player through their first working airport; afterwards short introductions
// appear the first time each deeper system matters (baggage, borders, remote
// stands, night flights, queues, transfers). Progress is saved with the game.

import { hasPassportControl, crossesBorder } from '../game/border';
import { coverage } from '../game/staff';
import { reachableStands } from '../game/flights';
import { securityReport } from '../game/security';
import { queueLength } from '../game/passengers';
import type { GameState, ModuleKind, PaintKind } from '../game/types';
import { T } from '../game/types';

export type Show = { build: ModuleKind } | { paint: PaintKind } | { tab: 'airport' | 'airlines' | 'flights' | 'ops' | 'money' } | { act: 'heat' | 'speed' };

export interface Coach {
  key: string;
  title: string;
  body: string;
  target?: string; // CSS selector to highlight
  show?: Show;
  step?: [number, number];
  intro?: boolean;
}

interface Step { title: string; body: string; done: (s: GameState) => boolean; target?: string; show?: Show }

const has = (s: GameState, k: ModuleKind) => s.buildings.some((b) => b.kind === k);
const floorTiles = (s: GameState) => s.tiles.filter((t) => t === T.Floor || t === T.Barrier).length;

const STEPS: Step[] = [
  { title: 'Welcome to your airport', body: 'You run a brand-new airport on an empty field. Build a runway and a terminal, sign airlines, and keep every passenger moving. Drag to pan, scroll or pinch to zoom, Q and E to turn the view.', done: () => false },
  { title: 'Build a runway', body: 'Pick the runway and place it across the top of the site. Press R to rotate it.', target: '[data-build="runway"]', show: { build: 'runway' }, done: (s) => has(s, 'runway') },
  { title: 'Add a control tower', body: 'No flights without air traffic control. Put the tower on grass anywhere.', target: '[data-build="tower"]', show: { build: 'tower' }, done: (s) => has(s, 'tower') },
  { title: 'Paint the terminal floor', body: 'Drag out a terminal building near the road at the bottom, about 20 by 15 tiles. Everything indoors goes on top of it.', target: '[data-paint="floor"]', show: { paint: 'floor' }, done: (s) => floorTiles(s) >= 60 },
  { title: 'Place an entrance', body: 'On the road side of the terminal. Passengers arrive and leave here.', target: '[data-build="entrance"]', show: { build: 'entrance' }, done: (s) => has(s, 'entrance') },
  { title: 'Check-in desks', body: 'Passengers with bags drop them here. The queue forms in front, so keep that side open.', target: '[data-build="checkin"]', show: { build: 'checkin' }, done: (s) => has(s, 'checkin') },
  { title: 'A security lane', body: 'Everyone flying passes security. Place it between the landside and the airside half of the terminal.', target: '[data-build="security"]', show: { build: 'security' }, done: (s) => has(s, 'security') },
  { title: 'A gate', body: 'Gates go on the airside edge of the terminal, facing the apron. Aircraft park in front of them.', target: '[data-build="gate"]', show: { build: 'gate' }, done: (s) => has(s, 'gate') },
  { title: 'Seal the airside', body: 'Paint a glass barrier across the terminal so the only way to the gates is through security, and put an arrivals exit in it so arriving passengers can get out.', target: '[data-paint="barrier"]', show: { paint: 'barrier' }, done: (s) => { const r = securityReport(s); return r.applies && !r.breach && !r.trapped; } },
  { title: 'A stand for the aircraft', body: 'Place a Stand M on the apron side, right next to the gate. The yellow mark is where aircraft drive in.', target: '[data-build="stand_m"]', show: { build: 'stand_m' }, done: (s) => s.buildings.some((b) => b.kind.startsWith('stand_') && b.link) },
  { title: 'Connect it with taxiways', body: 'Paint taxiways from the runway to the front of the stand so aircraft can taxi in and out.', target: '[data-paint="taxiway"]', show: { paint: 'taxiway' }, done: (s) => reachableStands(s).size > 0 },
  { title: 'Hire staff', body: 'Desks and lanes only open with people on shift. Open the Ops tab and press “Match needs”.', target: '[data-tab="ops"]', show: { tab: 'ops' }, done: (s) => coverage(s, 'checkin') >= 1 && coverage(s, 'security') >= 1 },
  { title: 'Sign your first airline', body: 'The Airlines tab has offers. Accept one your stands can handle (narrowbodies fit Stand M).', target: '[data-tab="airlines"]', show: { tab: 'airlines' }, done: (s) => s.contracts.length > 0 },
  { title: 'Let it run', body: 'Press play (or 1–4 for speed) and watch your first flight land, turn around and depart. Queues show up as badges over the desks.', target: '.speed', show: { act: 'speed' }, done: (s) => s.history.some((d) => d.departures > 0) || s.today.departures > 0 },
  { title: 'You run an airport', body: 'That’s the core loop. Sign more airlines, add stands and desks as queues grow, and meet the board’s weekly objective. New systems are explained as they come up.', done: () => false },
];

interface Intro { key: string; title: string; body: string; when: (s: GameState) => boolean; target?: string; show?: Show }

const INTROS: Intro[] = [
  { key: 'bags', title: 'Baggage is piling up', body: 'Checked bags are sorted and driven to the aircraft. Without a baggage hall a small team handles about 3 bags a minute; aircraft wait for bags, then leave without them. Build a baggage hall on grass next to the apron.', target: '[data-build="bagsort"]', show: { build: 'bagsort' },
    when: (s) => !has(s, 'bagsort') && s.flights.some((f) => f.bagsLeft > 0 || (f.phase === 'parked' && s.minute > f.dep && f.bagsLoaded < f.bagsChecked - 1)) },
  { key: 'border', title: 'International flights need passport control', body: 'Routes outside Schengen (from here: the UK, Ireland, the Gulf and beyond) need passport control airside. Departing passengers pass it after security, arriving ones before their bags. Gates can be zoned Schengen or non-Schengen in their inspector.', target: '[data-build="passport"]', show: { build: 'passport' },
    when: (s) => !hasPassportControl(s) && (s.contracts.some((c) => crossesBorder(s.city, c.dest)) || s.offers.some((o) => crossesBorder(s.city, o.dest))) },
  { key: 'remote', title: 'A remote stand', body: 'This stand has no gate within reach, so its passengers go by apron bus. A bus gate on the airside edge of the terminal runs two buses.', target: '[data-build="busgate"]', show: { build: 'busgate' },
    when: (s) => !has(s, 'busgate') && s.buildings.some((b) => b.kind.startsWith('stand_') && !b.link) },
  { key: 'night', title: 'A night flight on offer', body: 'Red-eye contracts pay more but need round-the-clock staff and annoy the neighbours. Goodwill and the curfew policy are in the Ops tab.', target: '[data-tab="ops"]', show: { tab: 'ops' },
    when: (s) => s.offers.some((o) => o.night) },
  { key: 'queues', title: 'Queues are growing', body: 'Long queues make passengers miss flights. Add desks or lanes, hire staff, and use the Crowding view (H) to see where people pile up.', target: '[data-act="heat"]', show: { act: 'heat' },
    when: (s) => s.buildings.some((b) => (b.kind === 'checkin' || b.kind === 'security' || b.kind === 'passport') && queueLength(b.id) > 25) },
  { key: 'transfer', title: 'Become a hub', body: 'With several routes, connecting passengers start to appear: they fly in and out without leaving the airside. A transfer desk lets them through (they shop a lot), and a lounge earns money from premium travellers.', target: '[data-build="transfer"]', show: { build: 'transfer' },
    when: (s) => !has(s, 'transfer') && new Set(s.contracts.map((c) => c.dest)).size >= 4 },
];

export function newTutorial(on: boolean): NonNullable<GameState['tutorial']> {
  return { on, step: 0, seen: [] };
}

/** The coach card to show now, if any. Advances finished steps as a side effect. */
export function currentCoach(s: GameState, tips: boolean): Coach | null {
  const t = s.tutorial;
  if (!t) return null;
  if (t.on && t.step < STEPS.length) {
    while (t.step < STEPS.length && t.step > 0 && STEPS[t.step].done(s)) t.step++;
    if (t.step < STEPS.length) {
      const st = STEPS[t.step];
      return { key: `step${t.step}`, title: st.title, body: st.body, target: st.target, show: st.show, step: [t.step + 1, STEPS.length] };
    }
  }
  if (!tips) return null;
  const intro = INTROS.find((i) => !t.seen.includes(i.key) && i.when(s));
  return intro ? { key: intro.key, title: intro.title, body: intro.body, target: intro.target, show: intro.show, intro: true } : null;
}

/** "Next" / "Got it": dismiss the current card. */
export function dismiss(s: GameState, c: Coach): void {
  const t = s.tutorial!;
  if (c.intro) t.seen.push(c.key);
  else if (t.step === 0 || t.step >= STEPS.length - 1) t.step++;
}

export function skipTutorial(s: GameState): void {
  if (s.tutorial) s.tutorial.on = false;
}
