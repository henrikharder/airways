export type Difficulty = 'easy' | 'normal' | 'hard';
export type ServiceLevel = 0 | 1 | 2; // basic, standard, premium
export type AirlineStyle = 'player' | 'legacy' | 'premium' | 'lowcost';

export interface Loan {
  id: string;
  principal: number;
  balance: number;
  rate: number; // annual
  takenDay: number;
}

/** One day's financial result. */
export interface Ledger {
  revenue: number;
  fuel: number;
  crew: number;
  maintenance: number;
  airport: number; // landing + passenger + handling
  service: number; // catering etc
  leases: number;
  overhead: number; // bases, HQ, distribution
  marketing: number;
  interest: number;
  pax: number;
  transferPax: number;
  seats: number;
  rpk: number;
  ask: number;
}

export interface MonthRecord {
  label: string; // "Jan 2027"
  revenue: number;
  costs: number;
  profit: number;
  pax: number;
  cash: number;
}

export type LiveryPattern = 'classic' | 'cheatline' | 'swoosh' | 'tailfin' | 'bold';

export interface Livery {
  pattern: LiveryPattern;
  primary: string;
  secondary: string;
}

export interface Airline {
  code: string;
  name: string;
  color: string;
  isPlayer: boolean;
  style: AirlineStyle;
  bases: string[];
  cash: number;
  reputation: number;
  baseReputation: number; // AI reputation drifts back towards this
  lifetimePax: number;
  awareness: Record<string, number>; // per airport 0..1 (player only; AI uses brand strength)
  service: ServiceLevel;
  marketingPerMonth: number;
  aggression: number;
  fleetTypes: string[];
  loans: Loan[];
  today: Ledger;
  recent: Ledger[]; // last 30 days, newest last
  month: Ledger; // month to date
  history: MonthRecord[];
  fareWarUntil: number; // day index; AI fare-war discount active until
  livery?: Livery;
}

export type Ownership = 'owned' | 'leased';

/** An aircraft flying `weekly` round trips on a route. `cycle` = minutes per round trip. */
export interface Assignment {
  routeId: string;
  weekly: number;
  cycle: number;
}

export interface Aircraft {
  id: string;
  reg: string;
  typeId: string;
  owner: string;
  ownership: Ownership;
  ageDays: number;
  biz: number;
  econ: number;
  assignments: Assignment[];
  readyDay: number; // delivery / available from this day
  groundedUntil: number;
  leaseMonthly: number;
  bookValue: number; // owned only
  phase: number; // 0..1 offset in rotation (for animation)
}

export interface RouteStats {
  paxY: number;
  paxJ: number;
  transfer: number;
  seatsY: number;
  seatsJ: number;
  revenue: number;
  cost: number;
  legs: number;
}

export interface Route {
  id: string;
  owner: string;
  from: string;
  to: string;
  fareY: number;
  fareJ: number;
  openedDay: number;
  warUntil: number; // AI fare war active until this day
  last: RouteStats; // most recent day
  week: RouteStats[]; // last 7 days
}

export interface UsedListing {
  id: string;
  typeId: string;
  ageYears: number;
  price: number;
}

export interface ActiveEvent {
  id: string;
  kind: string;
  title: string;
  endDay: number;
  fuelMult?: number;
  demandMult?: number;
  airports?: string[]; // demand modifier / closure scope
  region?: string;
  closed?: boolean;
  airline?: string; // fare sale
  exempt?: string[]; // airlines that keep flying through a closure (e.g. rerouted)
}

/** A choice put to the player; resolved in decisions.ts by `kind`. */
export interface Decision {
  id: string;
  kind: string;
  day: number;
  icon: string;
  title: string;
  body: string;
  options: { label: string; detail: string }[];
  data: Record<string, string | number>;
  quote?: { text: string; by: string };
}

export type ObjectiveKind = 'routes' | 'fleet' | 'lf' | 'profit' | 'pax' | 'region';

export interface Objective {
  kind: ObjectiveKind;
  target: number;
  region?: string;
  label: string;
  reward: number;
}

export interface Board {
  confidence: number; // 0..100; at 0 the board replaces you
  objective: Objective;
  quarter: Ledger; // quarter-to-date results
  meeting: { title: string; success: boolean; summary: string; next: string } | null; // pending meeting to show
}

export interface Review {
  day: number;
  routeId: string;
  from: string;
  to: string;
  name: string;
  stars: number;
  text: string;
  cabin: 'Economy' | 'Business';
}

export interface NewsItem {
  day: number;
  text: string;
  tone: 'good' | 'bad' | 'neutral' | 'rival';
}

export interface GameState {
  version: number;
  minute: number; // game minutes since start date
  day: number; // last simulated day index
  playerCode: string;
  difficulty: Difficulty;
  airlines: Airline[];
  aircraft: Aircraft[];
  routes: Route[];
  used: UsedListing[];
  events: ActiveEvent[];
  news: NewsItem[];
  fuelPrice: number; // USD per kg
  achievements: string[];
  tutorialDone: boolean;
  bankruptDays: number;
  gameOver: boolean;
  gameOverReason?: string;
  nextId: number;
  decisions: Decision[];
  board: Board;
  reviews: Review[];
  fuelLock?: { price: number; until: number };
}

export function emptyLedger(): Ledger {
  return {
    revenue: 0, fuel: 0, crew: 0, maintenance: 0, airport: 0, service: 0, leases: 0, overhead: 0,
    marketing: 0, interest: 0, pax: 0, transferPax: 0, seats: 0, rpk: 0, ask: 0,
  };
}

export function emptyStats(): RouteStats {
  return { paxY: 0, paxJ: 0, transfer: 0, seatsY: 0, seatsJ: 0, revenue: 0, cost: 0, legs: 0 };
}

export function totalCost(l: Ledger): number {
  return l.fuel + l.crew + l.maintenance + l.airport + l.service + l.leases + l.overhead + l.marketing + l.interest;
}
