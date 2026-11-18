// Airport tycoon game state. Grid units: 1 tile = 5 m. Time: game minutes.

export const T = { Grass: 0, Apron: 1, Taxiway: 2, Runway: 3, Floor: 4, Road: 5, Parking: 6, Barrier: 7 } as const;
export type TileType = (typeof T)[keyof typeof T];

export type ModuleKind =
  | 'runway' | 'tower' | 'stand_s' | 'stand_m' | 'stand_l' | 'stand_xl'
  | 'entrance' | 'exit' | 'checkin' | 'security' | 'gate' | 'food' | 'shop' | 'toilets' | 'seats' | 'baggage'
  | 'carpark' | 'tree' | 'bagsort' | 'busgate' | 'passport' | 'transfer' | 'lounge' | 'egates';

export type PaintKind = 'taxiway' | 'floor' | 'apron' | 'barrier' | 'skywalk';

export interface Building {
  id: number;
  kind: ModuleKind;
  x: number; // footprint origin (min corner) after rotation
  y: number;
  w: number; // footprint size after rotation
  h: number;
  rot: 0 | 1 | 2 | 3;
  link?: number; // gate ↔ stand
  zone?: 'swing' | 'schengen' | 'border'; // gates: which flights may use it (default swing)
  flow?: 'both' | 'out' | 'in'; // passport control: departures, arrivals or both (default both)
}

export type Phase = 'scheduled' | 'approach' | 'landing' | 'taxi_in' | 'parking' | 'parked' | 'pushback' | 'taxi_out' | 'lineup' | 'takeoff' | 'departed' | 'cancelled';

export interface Flight {
  id: number;
  contract: number;
  airline: string;
  number: string;
  dest: string; // IATA
  typeId: string;
  arr: number; // scheduled on-stand time (absolute game minute)
  dep: number; // scheduled off-block time
  stand: number | null; // building id
  phase: Phase;
  paxOut: number; // departing passengers booked
  paxIn: number; // arriving passengers on board
  boarded: number;
  deplaned: number;
  spawned: number; // departing passengers created so far
  missed: number;
  delayed: number; // minutes late at pushback
  // baggage: outbound checked → sorted → loaded; inbound unloaded → delivered to the carousels
  bagsChecked: number;
  bagsSorted: number;
  bagsLoaded: number;
  bagsIn: number;
  bagsUnloaded: number;
  bagsDelivered: number;
  bagsLeft: number; // left behind when the aircraft could not wait any longer
  night: boolean; // operates in the night window (22:00–06:00)
  // aircraft motion
  path: [number, number][];
  pathI: number;
  x: number;
  y: number;
  alt: number; // tiles above ground (approach / climb)
  facing: 0 | 1 | 2 | 3;
  speed: number; // tiles per game minute
  waitUntil: number; // earliest pushback (no-show passengers' bags being offloaded)
  onStand?: number; // minute the aircraft parked
  rwy?: number; // runway (building id) for the current landing or take-off
}

export interface Contract {
  id: number;
  airline: string;
  dest: string;
  typeId: string;
  perDay: number;
  load: number; // expected load factor
  since: number; // day
  happiness: number; // 0..100
  night?: boolean; // late-night / red-eye rotation, paid at a premium
}

export interface Offer extends Omit<Contract, 'id' | 'since' | 'happiness'> {
  id: number;
  expires: number; // day
  minRating: number;
}

export type PaxState =
  | 'toCheckin' | 'queue' | 'service' | 'toSecurity' | 'toPassport' | 'toTransfer' | 'toNeed' | 'atNeed' | 'toGate' | 'atGate' | 'boarding'
  | 'deplaning' | 'toBaggage' | 'atBaggage' | 'toExit' | 'lost';

export interface Pax {
  id: number;
  flight: number;
  dep: boolean;
  state: PaxState;
  stage: 'checkin' | 'security' | 'passport' | 'transfer' | 'need' | 'gate' | 'baggage' | 'exit';
  target: number; // building id (flow field key)
  x: number;
  y: number;
  tx: number; // current waypoint
  ty: number;
  ox: number; // personal offset for crowd spread
  oy: number;
  timer: number;
  needs: number; // bitmask: 1 food, 2 shop, 4 toilet
  color: number;
  facing: 0 | 1 | 2 | 3;
  mood: number; // 0..100
  waited: number; // minutes queuing
  bags: number; // checked bags (departing) or bags to collect (arriving)
  bagAt: number; // arriving: the flight's delivered-bag count at which this passenger's last bag is on the belt
  cleared?: boolean; // through passport control (border flights only)
  transfer?: boolean; // connecting from an arriving flight
  premium?: boolean; // uses lounges
  egate?: boolean; // eligible for automated passport gates
}

export interface Ledger {
  landing: number;
  paxFees: number;
  food: number;
  retail: number;
  parking: number;
  upkeep: number;
  construction: number;
  wages: number;
  transfers?: number; // connecting passengers
  lounge?: number; // lounge visits
  departures: number;
  passengers: number;
}

export interface DayRecord extends Ledger { day: number }

export type ObjectiveKind = 'flights' | 'pax' | 'rating' | 'airlines' | 'profit';

export interface Objective {
  kind: ObjectiveKind;
  target: number;
  label: string;
  reward: number;
}

export interface Board {
  confidence: number;
  objective: Objective;
  week: Ledger;
  meeting: { title: string; success: boolean; summary: string; next: string } | null;
}

export type Role = 'checkin' | 'security' | 'ground';
export type Curfew = 'none' | '23-06' | '22-07';

export interface NewsItem { min: number; text: string; tone: 'good' | 'bad' | 'neutral' }

export interface GameState {
  version: number;
  name: string;
  code: string; // our airport's IATA-style code
  city: string; // real airport code of the nearby city (demand source)
  minute: number;
  cash: number;
  rating: number; // 0..100
  W: number;
  H: number;
  tiles: number[]; // T per tile
  buildings: Building[];
  contracts: Contract[];
  offers: Offer[];
  flights: Flight[];
  pax: Pax[];
  today: Ledger;
  history: DayRecord[];
  board: Board;
  news: NewsItem[];
  nextId: number;
  gameOver: boolean;
  scheduledDay: number; // last day flights were generated for
  staff: Record<Role, number>; // people hired per role
  curfew: Curfew;
  goodwill: number; // 0..100, how the neighbours feel about the airport (night noise)
  tutorial?: { on: boolean; step: number; seen: string[] }; // guided tutorial and one-time introductions
  scenario?: { id: string; result?: 'won' | 'lost'; shown?: boolean };
  skywalks?: number[]; // tile indices of elevated walkways linking terminals (aircraft taxi underneath)
}

/**
 * When the flight can actually leave: its scheduled time, or 25 minutes after a
 * late aircraft reaches the stand. Boarding, gate close and the longest wait all
 * count from here, so passengers aren't blamed for a late aircraft.
 */
export function readyAt(f: Flight): number {
  return f.onStand === undefined ? f.dep : Math.max(f.dep, f.onStand + 25);
}

export function emptyLedger(): Ledger {
  return { landing: 0, paxFees: 0, food: 0, retail: 0, parking: 0, upkeep: 0, construction: 0, wages: 0, departures: 0, passengers: 0 };
}

export function income(l: Ledger): number {
  return l.landing + l.paxFees + l.food + l.retail + l.parking;
}

export function profit(l: Ledger): number {
  return income(l) - l.upkeep - l.wages - l.construction;
}
