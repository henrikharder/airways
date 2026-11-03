// Real aircraft types. Figures are rounded, publicly reported values:
// `maxSeats` is a dense all-economy layout, `priceM` an indicative market
// price (not list price) in USD millions, `burn` average block fuel kg/hour.

export type Category = 'turboprop' | 'regional' | 'narrowbody' | 'widebody' | 'superjumbo';

export interface AircraftType {
  id: string;
  name: string;
  maker: 'Airbus' | 'Boeing' | 'Embraer' | 'ATR' | 'De Havilland';
  category: Category;
  maxSeats: number;
  rangeKm: number;
  speedKmh: number;
  burn: number;
  priceM: number;
  mtowT: number;
  comfort: number; // 1–5 passenger appeal
  turnMin: number; // minimum turnaround
  maintPerHour: number; // USD per block hour when new
  newBuild: boolean; // false = out of production, only on the used market
  availableFrom?: string; // ISO date of first delivery if not yet in service
  defaultBiz: number;
}

export const AIRCRAFT: AircraftType[] = [
  { id: 'AT76', name: 'ATR 72-600', maker: 'ATR', category: 'turboprop', maxSeats: 78, rangeKm: 1500, speedKmh: 510, burn: 650, priceM: 26, mtowT: 23, comfort: 2.5, turnMin: 25, maintPerHour: 380, newBuild: true, defaultBiz: 0 },
  { id: 'DH8D', name: 'Dash 8-400', maker: 'De Havilland', category: 'turboprop', maxSeats: 90, rangeKm: 2000, speedKmh: 660, burn: 1000, priceM: 32, mtowT: 30, comfort: 2.5, turnMin: 25, maintPerHour: 450, newBuild: false, defaultBiz: 0 },
  { id: 'E175', name: 'Embraer E175', maker: 'Embraer', category: 'regional', maxSeats: 88, rangeKm: 3700, speedKmh: 830, burn: 1500, priceM: 30, mtowT: 40, comfort: 3.5, turnMin: 30, maintPerHour: 560, newBuild: true, defaultBiz: 12 },
  { id: 'E295', name: 'Embraer E195-E2', maker: 'Embraer', category: 'regional', maxSeats: 146, rangeKm: 4800, speedKmh: 830, burn: 1750, priceM: 60, mtowT: 62, comfort: 4, turnMin: 35, maintPerHour: 650, newBuild: true, defaultBiz: 12 },
  { id: 'BCS3', name: 'Airbus A220-300', maker: 'Airbus', category: 'narrowbody', maxSeats: 160, rangeKm: 6200, speedKmh: 830, burn: 1900, priceM: 48, mtowT: 70, comfort: 4.5, turnMin: 35, maintPerHour: 720, newBuild: true, defaultBiz: 12 },
  { id: 'B738', name: 'Boeing 737-800', maker: 'Boeing', category: 'narrowbody', maxSeats: 189, rangeKm: 5400, speedKmh: 840, burn: 2600, priceM: 48, mtowT: 79, comfort: 3, turnMin: 35, maintPerHour: 900, newBuild: false, defaultBiz: 12 },
  { id: 'B38M', name: 'Boeing 737 MAX 8', maker: 'Boeing', category: 'narrowbody', maxSeats: 197, rangeKm: 6500, speedKmh: 840, burn: 2300, priceM: 55, mtowT: 82, comfort: 3.5, turnMin: 35, maintPerHour: 860, newBuild: true, defaultBiz: 12 },
  { id: 'A20N', name: 'Airbus A320neo', maker: 'Airbus', category: 'narrowbody', maxSeats: 194, rangeKm: 6300, speedKmh: 830, burn: 2400, priceM: 55, mtowT: 79, comfort: 3.5, turnMin: 35, maintPerHour: 860, newBuild: true, defaultBiz: 12 },
  { id: 'A21N', name: 'Airbus A321neo', maker: 'Airbus', category: 'narrowbody', maxSeats: 240, rangeKm: 7400, speedKmh: 830, burn: 2800, priceM: 65, mtowT: 97, comfort: 3.5, turnMin: 40, maintPerHour: 950, newBuild: true, defaultBiz: 16 },
  { id: 'A21X', name: 'Airbus A321XLR', maker: 'Airbus', category: 'narrowbody', maxSeats: 220, rangeKm: 8700, speedKmh: 830, burn: 2900, priceM: 72, mtowT: 101, comfort: 3.5, turnMin: 45, maintPerHour: 1000, newBuild: true, defaultBiz: 20 },
  { id: 'A339', name: 'Airbus A330-900', maker: 'Airbus', category: 'widebody', maxSeats: 400, rangeKm: 13300, speedKmh: 870, burn: 5700, priceM: 115, mtowT: 251, comfort: 4, turnMin: 75, maintPerHour: 1600, newBuild: true, defaultBiz: 30 },
  { id: 'B788', name: 'Boeing 787-8', maker: 'Boeing', category: 'widebody', maxSeats: 330, rangeKm: 13600, speedKmh: 900, burn: 4900, priceM: 125, mtowT: 228, comfort: 4.5, turnMin: 75, maintPerHour: 1500, newBuild: true, defaultBiz: 24 },
  { id: 'B789', name: 'Boeing 787-9', maker: 'Boeing', category: 'widebody', maxSeats: 380, rangeKm: 14000, speedKmh: 900, burn: 5400, priceM: 145, mtowT: 254, comfort: 4.5, turnMin: 80, maintPerHour: 1700, newBuild: true, defaultBiz: 30 },
  { id: 'B78X', name: 'Boeing 787-10', maker: 'Boeing', category: 'widebody', maxSeats: 430, rangeKm: 11700, speedKmh: 900, burn: 5900, priceM: 160, mtowT: 254, comfort: 4.5, turnMin: 85, maintPerHour: 1800, newBuild: true, defaultBiz: 36 },
  { id: 'A359', name: 'Airbus A350-900', maker: 'Airbus', category: 'widebody', maxSeats: 400, rangeKm: 15000, speedKmh: 900, burn: 5800, priceM: 155, mtowT: 283, comfort: 5, turnMin: 85, maintPerHour: 1800, newBuild: true, defaultBiz: 36 },
  { id: 'A35K', name: 'Airbus A350-1000', maker: 'Airbus', category: 'widebody', maxSeats: 440, rangeKm: 16100, speedKmh: 900, burn: 6700, priceM: 180, mtowT: 319, comfort: 5, turnMin: 90, maintPerHour: 2000, newBuild: true, defaultBiz: 44 },
  { id: 'B77W', name: 'Boeing 777-300ER', maker: 'Boeing', category: 'widebody', maxSeats: 480, rangeKm: 13600, speedKmh: 890, burn: 7500, priceM: 160, mtowT: 351, comfort: 4, turnMin: 90, maintPerHour: 2200, newBuild: false, defaultBiz: 42 },
  { id: 'B779', name: 'Boeing 777-9', maker: 'Boeing', category: 'widebody', maxSeats: 500, rangeKm: 13500, speedKmh: 890, burn: 7300, priceM: 210, mtowT: 352, comfort: 5, turnMin: 95, maintPerHour: 2300, newBuild: true, availableFrom: '2027-06-01', defaultBiz: 48 },
  { id: 'A388', name: 'Airbus A380-800', maker: 'Airbus', category: 'superjumbo', maxSeats: 800, rangeKm: 15000, speedKmh: 900, burn: 11500, priceM: 220, mtowT: 575, comfort: 5, turnMin: 120, maintPerHour: 4200, newBuild: false, defaultBiz: 76 },
];

export const AIRCRAFT_BY_ID: Record<string, AircraftType> = Object.fromEntries(AIRCRAFT.map((t) => [t.id, t]));

export function acType(id: string): AircraftType {
  const t = AIRCRAFT_BY_ID[id];
  if (!t) throw new Error(`Unknown aircraft type ${id}`);
  return t;
}

/** How many economy seats one business seat displaces. */
export function bizSeatFactor(t: AircraftType): number {
  return t.category === 'widebody' || t.category === 'superjumbo' ? 4 : 2.5;
}

export function econSeatsFor(t: AircraftType, biz: number): number {
  return Math.max(0, Math.floor(t.maxSeats - biz * bizSeatFactor(t)));
}

export function maxBizSeats(t: AircraftType): number {
  return Math.floor((t.maxSeats * 0.5) / bizSeatFactor(t));
}
