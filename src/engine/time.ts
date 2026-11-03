export const START_DATE = Date.UTC(2027, 0, 1);
const DAY_MS = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function dateOf(day: number): Date {
  return new Date(START_DATE + day * DAY_MS);
}

export function dayOfIso(iso: string): number {
  return Math.round((Date.parse(iso) - START_DATE) / DAY_MS);
}

export function formatDate(day: number): string {
  const d = dateOf(day);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function monthLabel(day: number): string {
  const d = dateOf(day);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function isFirstOfMonth(day: number): boolean {
  return dateOf(day).getUTCDate() === 1;
}
