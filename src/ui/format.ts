export { money } from '../engine/actions';

export function num(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** Exact dollar amount for prices such as fares. */
export function fare(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function signClass(n: number): string {
  return n > 0 ? 'pos' : n < 0 ? 'neg' : '';
}

export function lfClass(lf: number): string {
  return lf >= 0.8 ? 'pos' : lf >= 0.6 ? 'warn' : 'neg';
}
