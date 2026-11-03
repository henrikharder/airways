import { airport } from '../data/airports';

const R = 6371;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const distCache = new Map<string, number>();

/** Great-circle distance in km between two IATA codes. */
export function distance(a: string, b: string): number {
  const key = a < b ? a + b : b + a;
  let d = distCache.get(key);
  if (d === undefined) {
    const A = airport(a);
    const B = airport(b);
    d = Math.round(haversine(A.lat, A.lon, B.lat, B.lon));
    distCache.set(key, d);
  }
  return d;
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}
