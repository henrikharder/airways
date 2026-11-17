// What can be built, what it costs and how it behaves.

import { acType } from '../data/aircraft';
import type { ModuleKind, PaintKind } from './types';

export type Category = 'airside' | 'terminal' | 'comfort' | 'landside';
export type StandClass = 's' | 'm' | 'l' | 'xl';

export interface ModuleSpec {
  kind: ModuleKind;
  name: string;
  category: Category;
  w: number;
  h: number;
  cost: number;
  upkeep: number; // per day, includes staff
  sprite: string | null; // sprite base name (rendered per rotation)
  indoor: boolean; // must sit on terminal floor
  rotatable: boolean;
  desc: string;
  servers?: number; // simultaneous passengers served
  serviceMin?: number; // minutes per passenger
  capacity?: number; // passengers using it at once (comforts, gates)
  dwell?: [number, number]; // minutes spent (comforts)
  spend?: number; // average spend per visitor
}

export const MODULES: Record<ModuleKind, ModuleSpec> = {
  runway: { kind: 'runway', name: 'Runway', category: 'airside', w: 64, h: 5, cost: 3_000_000, upkeep: 2500, sprite: null, indoor: false, rotatable: true, desc: 'Aircraft land and take off here. Needs a control tower.' },
  tower: { kind: 'tower', name: 'Control tower', category: 'airside', w: 3, h: 3, cost: 800_000, upkeep: 1800, sprite: 'tower', indoor: false, rotatable: false, desc: 'Air traffic control. No flights without one.' },
  stand_s: { kind: 'stand_s', name: 'Stand S', category: 'airside', w: 8, h: 8, cost: 180_000, upkeep: 600, sprite: null, indoor: false, rotatable: true, desc: 'Turboprops and regional jets (ATR, Embraer).' },
  stand_m: { kind: 'stand_m', name: 'Stand M', category: 'airside', w: 10, h: 10, cost: 260_000, upkeep: 800, sprite: null, indoor: false, rotatable: true, desc: 'Narrowbodies (A320, 737).' },
  stand_l: { kind: 'stand_l', name: 'Stand L', category: 'airside', w: 14, h: 14, cost: 480_000, upkeep: 1400, sprite: null, indoor: false, rotatable: true, desc: 'Widebodies (787, A350).' },
  stand_xl: { kind: 'stand_xl', name: 'Stand XL', category: 'airside', w: 17, h: 17, cost: 750_000, upkeep: 2200, sprite: null, indoor: false, rotatable: true, desc: 'The A380.' },
  entrance: { kind: 'entrance', name: 'Entrance', category: 'terminal', w: 2, h: 1, cost: 40_000, upkeep: 100, sprite: 'entrance', indoor: true, rotatable: true, desc: 'Passengers arrive and leave here. Put it on the terminal edge by the road.' },
  exit: { kind: 'exit', name: 'Arrivals exit', category: 'terminal', w: 2, h: 1, cost: 30_000, upkeep: 80, sprite: 'exit', indoor: true, rotatable: true, desc: 'One-way door in a barrier line: arriving passengers leave the airside through it, departing ones cannot get in.' },
  checkin: { kind: 'checkin', name: 'Check-in desks', category: 'terminal', w: 4, h: 2, cost: 90_000, upkeep: 1200, sprite: 'checkin', indoor: true, rotatable: true, desc: 'Four desks. Queue forms in front.', servers: 4, serviceMin: 2.5 },
  security: { kind: 'security', name: 'Security lane', category: 'terminal', w: 2, h: 4, cost: 160_000, upkeep: 1800, sprite: 'security', indoor: true, rotatable: true, desc: 'Scanner and walk-through arch. Passengers enter from the front.', servers: 2, serviceMin: 1.4 },
  gate: { kind: 'gate', name: 'Gate', category: 'terminal', w: 4, h: 4, cost: 70_000, upkeep: 500, sprite: 'gate', indoor: true, rotatable: true, desc: 'Waiting seats and boarding desk. Links to the nearest stand.', capacity: 24 },
  baggage: { kind: 'baggage', name: 'Baggage claim', category: 'terminal', w: 3, h: 4, cost: 140_000, upkeep: 900, sprite: 'baggage', indoor: true, rotatable: true, desc: 'Arriving passengers collect their bags here.', capacity: 60, dwell: [6, 14] },
  food: { kind: 'food', name: 'Food court', category: 'comfort', w: 4, h: 4, cost: 120_000, upkeep: 700, sprite: 'food', indoor: true, rotatable: true, desc: 'Hungry passengers eat here. Good revenue.', capacity: 20, dwell: [12, 22], spend: 16 },
  shop: { kind: 'shop', name: 'Shop', category: 'comfort', w: 3, h: 3, cost: 90_000, upkeep: 500, sprite: 'shop', indoor: true, rotatable: true, desc: 'Duty free and souvenirs. The best earner per square metre.', capacity: 12, dwell: [8, 15], spend: 28 },
  toilets: { kind: 'toilets', name: 'Toilets', category: 'comfort', w: 2, h: 2, cost: 40_000, upkeep: 300, sprite: 'toilets', indoor: true, rotatable: true, desc: 'Everyone needs them eventually.', capacity: 6, dwell: [3, 6] },
  seats: { kind: 'seats', name: 'Seating', category: 'comfort', w: 2, h: 1, cost: 4_000, upkeep: 20, sprite: 'seats', indoor: true, rotatable: true, desc: 'A place to rest. Lifts mood a little.', capacity: 4, dwell: [10, 20] },
  carpark: { kind: 'carpark', name: 'Car park', category: 'landside', w: 6, h: 6, cost: 120_000, upkeep: 300, sprite: null, indoor: false, rotatable: false, desc: 'Parking income from passengers who drive. Next to the road.' },
  tree: { kind: 'tree', name: 'Tree', category: 'landside', w: 1, h: 1, cost: 500, upkeep: 0, sprite: 'tree', indoor: false, rotatable: false, desc: 'Decoration.' },
};

export const PAINTS: Record<PaintKind, { name: string; costPerTile: number; desc: string }> = {
  floor: { name: 'Terminal floor', costPerTile: 1_200, desc: 'Paint the terminal building. Indoor modules go on top.' },
  taxiway: { name: 'Taxiway', costPerTile: 900, desc: 'Paint routes for aircraft between runway and stands.' },
  apron: { name: 'Apron', costPerTile: 600, desc: 'Open tarmac aircraft can drive over.' },
  barrier: { name: 'Glass barrier', costPerTile: 300, desc: 'Paint on terminal floor to wall off the airside. Security lanes and arrivals exits are the only ways through.' },
};

export const BULLDOZE_REFUND = 0.4;

/** Stand class needed for an aircraft type, by wingspan. */
export function standClassFor(typeId: string): StandClass {
  const t = acType(typeId);
  if (t.category === 'superjumbo') return 'xl';
  if (t.category === 'widebody') return 'l';
  if (t.maxSeats <= 150) return 's';
  return 'm';
}

const CLASS_ORDER: StandClass[] = ['s', 'm', 'l', 'xl'];

export function standFits(stand: ModuleKind, typeId: string): boolean {
  if (!stand.startsWith('stand_')) return false;
  return CLASS_ORDER.indexOf(stand.slice(6) as StandClass) >= CLASS_ORDER.indexOf(standClassFor(typeId));
}

/** Aircraft we have sprites for; other types borrow the closest look. */
const SPRITE_TYPE: Record<string, string> = {
  AT76: 'AT76', DH8D: 'AT76', E175: 'E295', E295: 'E295', BCS3: 'A20N', A20N: 'A20N', A21N: 'A20N', A21X: 'A20N',
  B738: 'B38M', B38M: 'B38M', A339: 'B789', B788: 'B789', B789: 'B789', B78X: 'B789', A359: 'A359', A35K: 'A359',
  B77W: 'A359', B779: 'A359', A388: 'A388',
};

export function spriteType(typeId: string): string {
  return SPRITE_TYPE[typeId] ?? 'A20N';
}

/** Minutes on stand between arrival and departure. */
export function turnaroundMin(typeId: string): number {
  return { s: 35, m: 45, l: 80, xl: 105 }[standClassFor(typeId)];
}

export const FEES = { landingPerTonne: 24, perDepartingPax: 42, parkingPerCar: 18 };
export const START_CASH = 9_000_000;
