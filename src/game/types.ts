// Airport tycoon game state. Grid units: 1 tile = 5 m. Time: game minutes.

export const T = { Grass: 0, Apron: 1, Taxiway: 2, Runway: 3, Floor: 4, Road: 5, Parking: 6, Barrier: 7 } as const;
export type TileType = (typeof T)[keyof typeof T];

export type ModuleKind =
  | 'runway' | 'tower' | 'stand_s' | 'stand_m' | 'stand_l' | 'stand_xl'
  | 'entrance' | 'exit' | 'checkin' | 'security' | 'gate' | 'food' | 'shop' | 'toilets' | 'seats' | 'baggage'
  | 'carpark' | 'tree';

export type PaintKind = 'taxiway' | 'floor' | 'apron' | 'barrier';

export interface Building {
  id: number;
  kind: ModuleKind;
  x: number; // footprint origin (min corner) after rotation
  y: number;
  w: number; // footprint size after rotation
  h: number;
  rot: 0 | 1 | 2 | 3;
  link?: number; // gate ↔ stand
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
  // aircraft motion
  path: [number, number][];
  pathI: number;
  x: number;
  y: number;
  alt: number; // tiles above ground (approach / climb)
  facing: 0 | 1 | 2 | 3;
  speed: number; // tiles per game minute
  waitUntil: number;
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
}

export interface Offer extends Omit<Contract, 'id' | 'since' | 'happiness'> {
  id: number;
  expires: number; // day
  minRating: number;
}

export type PaxState =
  | 'toCheckin' | 'queue' | 'service' | 'toSecurity' | 'toNeed' | 'atNeed' | 'toGate' | 'atGate' | 'boarding'
  | 'deplaning' | 'toBaggage' | 'atBaggage' | 'toExit' | 'lost';

export interface Pax {
  id: number;
  flight: number;
  dep: boolean;
  state: PaxState;
  stage: 'checkin' | 'security' | 'need' | 'gate' | 'baggage' | 'exit';
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
}

export interface Ledger {
  landing: number;
  paxFees: number;
  food: number;
  retail: number;
  parking: number;
  upkeep: number;
  construction: number;
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
}

export function emptyLedger(): Ledger {
  return { landing: 0, paxFees: 0, food: 0, retail: 0, parking: 0, upkeep: 0, construction: 0, departures: 0, passengers: 0 };
}

export function income(l: Ledger): number {
  return l.landing + l.paxFees + l.food + l.retail + l.parking;
}

export function profit(l: Ledger): number {
  return income(l) - l.upkeep - l.construction;
}
