// Side-view aircraft profiles built from published dimensions (metres).
// Every type shares one coordinate system, so drawings are to scale and
// each family gets its own nose, tail, wing, wingtip, engine and gear.

import type { Livery } from '../engine/types';
import { esc } from './format';

type Nose = 'airbus' | 'b737' | 'b787' | 'a350' | 'b777' | 'a380' | 'atr' | 'dash8' | 'ejet' | 'a220';
type Tip = 'sharklet' | 'scimitar' | 'blended' | 'raked' | 'a350' | 'fence' | 'winglet' | 'none';

interface Spec {
  L: number; // length
  D: number; // fuselage height
  H: number; // overall height (to fin tip)
  gc: number; // ground to fuselage bottom
  nose: Nose;
  wingX: number; // root leading edge, fraction of L
  chord: number; // root chord
  sweep: number; // how far aft the tip sits in side view
  rise: number; // dihedral rise of the tip in side view
  tipChord: number;
  tip: Tip;
  highWing?: boolean;
  eng: { d: number; len: number; clear: number; outer?: boolean; chevrons?: boolean };
  prop?: number; // propeller diameter
  fin: { chord: number; tip: number; sweep: number; tTail?: boolean };
  tail: number; // tail-cone length in fuselage diameters
  gear: { nose: number; main: number; wheels: number; r: number };
  doors: number[]; // main-deck door positions, fraction of L
  overwing?: number[];
  upperDoors?: number[];
  window: { w: number; h: number; pitch: number };
}

const NARROW_WIN = { w: 0.24, h: 0.34, pitch: 0.53 };
const WIDE_WIN = { w: 0.27, h: 0.4, pitch: 0.53 };

const A320: Spec = {
  L: 37.6, D: 3.95, H: 11.8, gc: 1.9, nose: 'airbus', wingX: 0.355, chord: 6.1, sweep: 7.9, rise: 1.4, tipChord: 1.5, tip: 'sharklet',
  eng: { d: 2.35, len: 4.6, clear: 0.55 }, fin: { chord: 5.9, tip: 0.45, sweep: 38 }, tail: 2.6,
  gear: { nose: 0.13, main: 0.495, wheels: 1, r: 0.57 }, doors: [0.105, 0.865], overwing: [0.43, 0.465], window: NARROW_WIN,
};
const A787: Spec = {
  L: 62.8, D: 5.77, H: 17, gc: 2.5, nose: 'b787', wingX: 0.375, chord: 10.6, sweep: 15, rise: 2.6, tipChord: 2.0, tip: 'raked',
  eng: { d: 3.35, len: 5.8, clear: 0.85, chevrons: true }, fin: { chord: 9.2, tip: 0.4, sweep: 43 }, tail: 2.75,
  gear: { nose: 0.1, main: 0.53, wheels: 2, r: 0.64 }, doors: [0.07, 0.29, 0.6, 0.88], window: { w: 0.3, h: 0.5, pitch: 0.6 },
};
const A350: Spec = {
  L: 66.8, D: 5.96, H: 17.1, gc: 2.6, nose: 'a350', wingX: 0.37, chord: 11.5, sweep: 16, rise: 2.2, tipChord: 2.0, tip: 'a350',
  eng: { d: 3.45, len: 6.0, clear: 0.95 }, fin: { chord: 9.6, tip: 0.45, sweep: 38 }, tail: 2.7,
  gear: { nose: 0.09, main: 0.53, wheels: 2, r: 0.66 }, doors: [0.07, 0.29, 0.6, 0.88], window: WIDE_WIN,
};
const A777: Spec = {
  L: 73.9, D: 6.2, H: 18.5, gc: 2.8, nose: 'b777', wingX: 0.37, chord: 12.5, sweep: 17, rise: 2.0, tipChord: 2.2, tip: 'raked',
  eng: { d: 4.1, len: 6.6, clear: 0.95 }, fin: { chord: 10.5, tip: 0.42, sweep: 40 }, tail: 2.6,
  gear: { nose: 0.08, main: 0.55, wheels: 3, r: 0.62 }, doors: [0.06, 0.27, 0.55, 0.75, 0.9], window: WIDE_WIN,
};
const B737: Spec = {
  L: 39.5, D: 3.76, H: 12.3, gc: 1.35, nose: 'b737', wingX: 0.385, chord: 6.4, sweep: 8.5, rise: 1.5, tipChord: 1.3, tip: 'scimitar',
  eng: { d: 2.15, len: 4.7, clear: 0.45 }, fin: { chord: 6.2, tip: 0.38, sweep: 40 }, tail: 2.7,
  gear: { nose: 0.11, main: 0.515, wheels: 1, r: 0.55 }, doors: [0.1, 0.885], overwing: [0.445, 0.48], window: NARROW_WIN,
};
const EJET: Spec = {
  L: 41.5, D: 3.0, H: 10.9, gc: 1.5, nose: 'ejet', wingX: 0.4, chord: 5.0, sweep: 6.5, rise: 1.2, tipChord: 1.1, tip: 'winglet',
  eng: { d: 2.05, len: 4.1, clear: 0.55 }, fin: { chord: 5.4, tip: 0.5, sweep: 40 }, tail: 2.9,
  gear: { nose: 0.11, main: 0.53, wheels: 1, r: 0.5 }, doors: [0.1, 0.88], overwing: [0.46], window: { w: 0.22, h: 0.32, pitch: 0.5 },
};
const ATR: Spec = {
  L: 27.2, D: 2.8, H: 7.65, gc: 0.95, nose: 'atr', wingX: 0.4, chord: 2.6, sweep: 1, rise: 0, tipChord: 1.4, tip: 'none', highWing: true,
  eng: { d: 1.05, len: 4.8, clear: 0 }, prop: 3.93, fin: { chord: 3.8, tip: 0.6, sweep: 32, tTail: true }, tail: 3.3,
  gear: { nose: 0.1, main: 0.47, wheels: 1, r: 0.45 }, doors: [0.09, 0.88], window: { w: 0.24, h: 0.32, pitch: 0.76 },
};

function spec(typeId: string): Spec {
  switch (typeId) {
    case 'AT76': return ATR;
    case 'DH8D': return { ...ATR, L: 32.8, D: 2.7, H: 8.3, gc: 1.25, nose: 'dash8', prop: 4.1, chord: 2.8, fin: { chord: 4.4, tip: 0.55, sweep: 35, tTail: true }, eng: { d: 1.15, len: 5.4, clear: 0 } };
    case 'E175': return { ...EJET, L: 31.7, H: 9.7, gc: 1.3, eng: { d: 1.65, len: 3.5, clear: 0.5 }, fin: { chord: 4.8, tip: 0.5, sweep: 40 } };
    case 'E295': return EJET;
    case 'BCS3': return { ...A320, L: 38.7, D: 3.7, H: 11.5, gc: 1.6, nose: 'a220', wingX: 0.4, chord: 5.6, tip: 'winglet', eng: { d: 2.2, len: 4.4, clear: 0.6 }, fin: { chord: 6.6, tip: 0.5, sweep: 36 }, gear: { nose: 0.12, main: 0.535, wheels: 1, r: 0.55 }, doors: [0.11, 0.87], overwing: [0.465] };
    case 'B738': return { ...B737, tip: 'blended', eng: { d: 1.95, len: 4.5, clear: 0.45 }, H: 12.5 };
    case 'B38M': return B737;
    case 'A20N': return A320;
    case 'A21N': case 'A21X': return { ...A320, L: 44.5, wingX: 0.4, doors: [0.09, 0.34, 0.64, 0.885], overwing: undefined };
    case 'A339': return { ...A350, L: 63.7, D: 5.64, H: 16.8, nose: 'airbus', tip: 'sharklet', chord: 10.6, eng: { d: 3.15, len: 5.6, clear: 0.9 }, fin: { chord: 9.5, tip: 0.42, sweep: 40 }, doors: [0.07, 0.29, 0.62, 0.87] };
    case 'B788': return { ...A787, L: 56.7, doors: [0.08, 0.3, 0.62, 0.87] };
    case 'B789': return A787;
    case 'B78X': return { ...A787, L: 68.3, doors: [0.065, 0.28, 0.58, 0.89] };
    case 'A359': return A350;
    case 'A35K': return { ...A350, L: 73.8, gear: { ...A350.gear, wheels: 3 }, doors: [0.065, 0.27, 0.58, 0.89] };
    case 'B77W': return A777;
    case 'B779': return { ...A777, L: 76.7, H: 19.5, gc: 2.9, nose: 'b787', eng: { d: 4.5, len: 7.0, clear: 1.0, chevrons: false }, window: { w: 0.3, h: 0.5, pitch: 0.6 } };
    case 'A388': return {
      L: 72.7, D: 8.4, H: 24.1, gc: 2.9, nose: 'a380', wingX: 0.37, chord: 17.7, sweep: 22, rise: 2.4, tipChord: 4.0, tip: 'fence',
      eng: { d: 3.1, len: 5.8, clear: 1.6, outer: true }, fin: { chord: 14.5, tip: 0.38, sweep: 38 }, tail: 2.3,
      gear: { nose: 0.08, main: 0.5, wheels: 3, r: 0.7 }, doors: [0.07, 0.25, 0.47, 0.67, 0.88], upperDoors: [0.17, 0.5, 0.82], window: WIDE_WIN,
    };
    default: return A320;
  }
}

// Nose geometry per family: tip height (fraction of D from bottom), nose length (×D), bluntness.
const NOSE: Record<Nose, { tip: number; len: number; blunt: number; drop: number }> = {
  airbus: { tip: 0.42, len: 1.85, blunt: 0.44, drop: 0.32 },
  a220: { tip: 0.42, len: 2.0, blunt: 0.36, drop: 0.3 },
  b737: { tip: 0.38, len: 2.05, blunt: 0.34, drop: 0.3 },
  b787: { tip: 0.36, len: 2.45, blunt: 0.24, drop: 0.28 },
  a350: { tip: 0.4, len: 2.2, blunt: 0.32, drop: 0.3 },
  b777: { tip: 0.42, len: 1.9, blunt: 0.46, drop: 0.34 },
  a380: { tip: 0.26, len: 1.45, blunt: 0.62, drop: 0.25 },
  atr: { tip: 0.4, len: 2.0, blunt: 0.36, drop: 0.3 },
  dash8: { tip: 0.38, len: 2.3, blunt: 0.28, drop: 0.28 },
  ejet: { tip: 0.42, len: 2.0, blunt: 0.4, drop: 0.3 },
};

let uid = 0;
const f = (n: number) => n.toFixed(2);

function cubic(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

export interface ProfileOptions {
  toScale?: boolean; // shared 80 m frame so different types compare truthfully
  cls?: string;
  title?: string;
  inFlight?: boolean; // gear up, no ground shadow
}

/** Side view of an aircraft type painted in a livery. Returns an SVG string. */
export function profileSvg(typeId: string, livery: Livery, name: string, code: string, opts: ProfileOptions = {}): string {
  const s = spec(typeId);
  const { L, D, H, gc } = s;
  const id = `pf${++uid}`;
  const vbW = opts.toScale ? 80 : L + 2.5;
  const vbH = opts.toScale ? 26 : H + 2;
  const ox = opts.toScale ? (80 - L) / 2 : 1;
  const base = vbH - 0.5; // ground line in SVG y
  const X = (x: number) => f(ox + x);
  const Y = (y: number) => f(base - y);
  const P = (x: number, y: number) => `${X(x)},${Y(y)}`;

  const yb = gc;
  const yt = gc + D;
  const n = NOSE[s.nose];
  const tipY = yb + n.tip * D;
  const nl = n.len * D;
  const tl = s.tail * D;
  const endTop = yt - n.drop * D * 0.85;
  const endBot = endTop - 0.14 * D; // APU exhaust

  // Fuselage outline: nose top, crown, tail cone, belly, chin.
  const top = [0, tipY, 0, tipY + n.blunt * D, nl * 0.32, yt, nl, yt];
  const body = [
    `M${P(0, tipY)}`,
    `C${P(top[2], top[3])} ${P(top[4], top[5])} ${P(top[6], top[7])}`,
    `L${P(L - tl * 0.6, yt)}`,
    `C${P(L - tl * 0.25, yt)} ${P(L - 0.4, endTop + 0.05 * D)} ${P(L, endTop)}`,
    `L${P(L - 0.05, endBot)}`,
    `C${P(L - tl * 0.3, endBot - 0.12 * D)} ${P(L - tl * 0.62, yb)} ${P(L - tl, yb)}`,
    `L${P(nl * 1.05, yb)}`,
    `C${P(nl * 0.4, yb)} ${P(0, tipY - 0.38 * D)} ${P(0, tipY)} Z`,
  ].join(' ');
  const topAt = (x: number): number => {
    let best = yt;
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const cx = cubic(top[0], top[2], top[4], top[6], t);
      if (cx >= x) { best = cubic(top[1], top[3], top[5], top[7], t); break; }
    }
    return best;
  };

  const { pattern, primary, secondary } = livery;
  const bodyFill = pattern === 'bold' ? primary : '#f4f6f9';
  const finFill = pattern === 'bold' ? secondary : primary;
  const engineFill = pattern === 'classic' ? primary : pattern === 'bold' ? secondary : '#dfe4eb';
  const grey = '#59626f';

  // Fin
  const fh = H - yt;
  const rootTE = L - 0.35;
  const rootLE = rootTE - s.fin.chord;
  // Anchor the fin by its gently swept trailing edge (as on the real aircraft); the
  // leading-edge sweep then follows from the chords.
  const tipC = s.fin.chord * s.fin.tip;
  const tipTE = Math.min(L + 0.5, rootTE + fh * Math.tan((Math.max(4, s.fin.sweep - 26) * Math.PI) / 180));
  const tipLE = tipTE - tipC;
  const finRootY = yt - 0.12 * D;
  const fin = `M${P(rootLE - 1.6, yt)} Q${P(rootLE, yt)} ${P(rootLE + 0.5, yt + 0.5)} L${P(tipLE, H)} L${P(tipLE + tipC, H)} L${P(rootTE, finRootY)} Z`;
  const rudder = `M${P(tipLE + tipC * 0.62, H - 0.05)} L${P(rootTE - s.fin.chord * 0.3, finRootY + 0.2)}`;
  const finCx = (rootLE + rootTE + tipLE + tipLE + tipC) / 4 + 0.2;
  const finCy = yt + fh * 0.45;
  const finCode = pattern === 'tailfin' || pattern === 'bold'
    ? `<text x="${X(finCx)}" y="${Y(finCy)}" font-size="${f(Math.min(fh * 0.34, s.fin.chord * 0.42))}" font-weight="700" fill="${pattern === 'bold' ? primary : secondary}" text-anchor="middle" dominant-baseline="central" font-family="Barlow Condensed, system-ui, sans-serif" font-style="italic">${esc(code)}</text>`
    : '';

  // Horizontal stabiliser
  const hs = s.fin.tTail
    ? `M${P(tipLE - 0.6, H - 0.1)} L${P(tipLE + tipC + 1.4, H + 0.05)} L${P(tipLE + tipC + 1.3, H - 0.35)} L${P(tipLE - 0.4, H - 0.3)} Z`
    : `M${P(L - tl * 0.72, yt - 0.42 * D)} L${P(L - 0.5, yt - 0.3 * D)} L${P(L - 0.7, yt - 0.42 * D)} L${P(L - tl * 0.6, yt - 0.5 * D)} Z`;

  // Wing (near side, seen edge-on: swept back and rising with dihedral)
  const xw = s.wingX * L;
  let wing = '';
  let tipShape = '';
  if (s.highWing) {
    wing = `M${P(xw - 0.4, yt - 0.05)} Q${P(xw, yt + 0.5)} ${P(xw + s.chord * 0.5, yt + 0.55)} L${P(xw + s.chord + 0.6, yt + 0.35)} L${P(xw + s.chord + 0.8, yt - 0.05)} Z`;
  } else {
    const ry = yb + 0.2 * D;
    const tx = xw + s.sweep;
    const ty = ry + s.rise;
    wing = `M${P(xw, ry)} L${P(tx, ty)} L${P(tx + s.tipChord, ty + 0.05)} L${P(xw + s.chord, ry + 0.15)} Z`;
    const w = tx + s.tipChord * 0.25;
    switch (s.tip) {
      case 'sharklet': tipShape = `M${P(w, ty)} Q${P(w + 0.3, ty + 0.4)} ${P(w + 1.0, ty + 2.4)} L${P(w + 1.6, ty + 2.4)} L${P(tx + s.tipChord, ty + 0.05)} Z`; break;
      case 'winglet': tipShape = `M${P(w, ty)} L${P(w + 0.9, ty + 1.5)} L${P(w + 1.3, ty + 1.5)} L${P(tx + s.tipChord, ty)} Z`; break;
      case 'blended': tipShape = `M${P(w, ty)} Q${P(w + 0.2, ty + 1.2)} ${P(w + 0.8, ty + 2.4)} L${P(w + 1.3, ty + 2.4)} Q${P(tx + s.tipChord, ty + 0.6)} ${P(tx + s.tipChord, ty)} Z`; break;
      case 'scimitar': tipShape = `M${P(w, ty)} L${P(w + 1.0, ty + 2.0)} L${P(w + 1.45, ty + 2.0)} L${P(tx + s.tipChord, ty)} L${P(w + 1.0, ty - 0.75)} L${P(w + 0.6, ty - 0.7)} Z`; break;
      case 'a350': tipShape = `M${P(w - 0.6, ty)} Q${P(w + 1.2, ty + 0.1)} ${P(w + 2.0, ty + 1.3)} L${P(w + 2.3, ty + 1.2)} Q${P(w + 1.8, ty)} ${P(tx + s.tipChord, ty)} Z`; break;
      case 'fence': tipShape = `M${P(w + 0.3, ty)} L${P(w + 0.9, ty + 1.2)} L${P(w + 1.5, ty + 1.2)} L${P(w + 1.6, ty - 0.8)} L${P(w + 1.0, ty - 0.8)} Z`; break;
      default: tipShape = '';
    }
  }

  // Belly fairing where the wing meets the fuselage
  const fairing = s.highWing
    ? `M${P(xw + s.chord * 0.1 - 1.4, yb + 0.15)} Q${P(L * s.gear.main, yb - 0.55)} ${P(xw + s.chord + 1.2, yb + 0.15)} Z`
    : `M${P(xw - 2.2, yb + 0.25)} Q${P(xw + s.chord * 0.5, yb - 0.2 * D * 0.6)} ${P(xw + s.chord + 2.6, yb + 0.25)} Z`;

  // Engines: nacelle ahead of and below the wing on a pylon
  const engine = (ex: number, cy: number, d: number, len: number, shade: string): string => {
    const r = d / 2;
    const plug = `M${P(ex + len * 0.98, cy + r * 0.3)} L${P(ex + len * 0.98 + d * 0.32, cy)} L${P(ex + len * 0.98, cy - r * 0.3)} Z`;
    const chev = s.eng.chevrons
      ? Array.from({ length: 7 }, (_, i) => `L${P(ex + len * 0.86 + (i % 2 ? 0.22 : 0), cy + r * 0.7 - (i + 1) * (r * 1.4) / 8)}`).join(' ')
      : '';
    const x1 = ex + len * 0.86;
    const nacelle = `M${P(ex + 0.12, cy + r * 0.95)} C${P(ex + len * 0.25, cy + r * 1.06)} ${P(ex + len * 0.6, cy + r * 1.0)} ${P(x1, cy + r * 0.7)} ${chev} L${P(x1, cy - r * 0.7)} C${P(ex + len * 0.6, cy - r * 1.0)} ${P(ex + len * 0.25, cy - r * 1.06)} ${P(ex + 0.12, cy - r * 0.95)} Q${P(ex - 0.1, cy)} ${P(ex + 0.12, cy + r * 0.95)} Z`;
    const core = `M${P(x1 - 0.05, cy + r * 0.5)} L${P(x1 + len * 0.12, cy + r * 0.38)} L${P(x1 + len * 0.12, cy - r * 0.38)} L${P(x1 - 0.05, cy - r * 0.5)} Z`;
    return `<path d="${core}" fill="#8e98a5"/><path d="${plug}" fill="#6f7884"/><path d="${nacelle}" fill="${shade}" stroke="#7d8794" stroke-width="0.05"/>
      <ellipse cx="${X(ex + 0.06)}" cy="${Y(cy)}" rx="0.17" ry="${f(r * 0.9)}" fill="#252c36" stroke="#c8ced6" stroke-width="0.08"/>
      <path d="M${P(ex + 0.4, cy + r * 0.86)} C${P(ex + len * 0.3, cy + r * 0.95)} ${P(ex + len * 0.6, cy + r * 0.88)} ${P(x1 - 0.2, cy + r * 0.62)}" stroke="#ffffff" stroke-opacity="0.45" stroke-width="0.09" fill="none"/>`;
  };
  let engines = '';
  let pylons = '';
  if (s.prop) {
    const ex = xw - 1.7;
    const cy = yt - 0.12 * D;
    const r = s.eng.d / 2;
    engines = `<path d="M${P(ex, cy + r * 0.8)} Q${P(ex + 1.2, cy + r * 1.3)} ${P(xw + s.chord, yt + 0.45)} L${P(ex + s.eng.len, cy - r * 0.4)} Q${P(ex + 1.8, cy - r * 1.25)} ${P(ex, cy - r * 0.8)} Q${P(ex - 0.5, cy)} ${P(ex, cy + r * 0.8)} Z" fill="${engineFill}" stroke="#7d8794" stroke-width="0.05"/>
      <path d="M${P(ex - 0.85, cy)} Q${P(ex - 0.5, cy + r * 0.75)} ${P(ex, cy + r * 0.7)} L${P(ex, cy - r * 0.7)} Q${P(ex - 0.5, cy - r * 0.75)} ${P(ex - 0.85, cy)} Z" fill="#c9ced6"/>
      <ellipse cx="${X(ex - 0.15)}" cy="${Y(cy)}" rx="0.22" ry="${f(s.prop / 2)}" fill="#c6cfdc" opacity="0.35"/>
      <ellipse cx="${X(ex - 0.15)}" cy="${Y(cy)}" rx="0.08" ry="${f(s.prop / 2)}" fill="#8a96a8" opacity="0.4"/>`;
  } else {
    const ex = xw - s.eng.len * 0.42;
    const cy = s.eng.clear + s.eng.d / 2;
    const ry = yb + 0.2 * D;
    const pylon = (x0: number, c: number, d: number) => `<path d="M${P(x0 + s.eng.len * 0.3, c + d / 2 - 0.05)} L${P(x0 + s.eng.len * 0.95, c + d / 2 - 0.05)} L${P(xw + s.chord * 0.42, ry + 0.1)} L${P(xw - 0.3, ry + 0.05)} Z" fill="#c7cdd5"/>`;
    if (s.eng.outer) {
      const ox2 = ex + s.sweep * 0.42;
      const cy2 = cy + s.rise * 0.42 + 0.3;
      pylons += pylon(ox2, cy2, s.eng.d * 0.92);
      engines += engine(ox2, cy2, s.eng.d * 0.92, s.eng.len * 0.95, pattern === 'classic' ? primary : '#cfd5dd');
    }
    pylons += pylon(ex, cy, s.eng.d);
    engines += engine(ex, cy, s.eng.d, s.eng.len, engineFill);
  }

  // Landing gear
  const gearOne = (x: number, wheels: number, r: number, from: number): string => {
    let g = `<path d="M${P(x - 0.12, from)} L${P(x - 0.12, r)} L${P(x + 0.12, r)} L${P(x + 0.12, from)} Z" fill="#7a838f"/>`;
    for (let i = 0; i < wheels; i++) {
      const wx = x + (i - (wheels - 1) / 2) * r * 2.25;
      g += `<circle cx="${X(wx)}" cy="${Y(r)}" r="${f(r)}" fill="#1c2129"/><circle cx="${X(wx)}" cy="${Y(r)}" r="${f(r * 0.42)}" fill="#8d96a2"/>`;
    }
    return g;
  };
  const gear = opts.inFlight ? '' : gearOne(L * s.gear.nose, s.prop ? 1 : wheelsFor(s, true), s.gear.r * 0.7, yb + 0.1) + gearOne(L * s.gear.main, s.gear.wheels, s.gear.r, yb + 0.1);

  // Windows, doors and cockpit
  const decks = s.upperDoors ? 2 : 1;
  const winRows = decks === 2 ? [yb + 0.31 * D, yb + 0.72 * D] : [yb + 0.6 * D];
  const doorRows = decks === 2 ? [s.doors, s.upperDoors!] : [s.doors];
  let windows = '';
  let doors = '';
  winRows.forEach((wy, row) => {
    const doorXs = doorRows[row].map((p) => p * L);
    const owXs = row === 0 ? (s.overwing ?? []).map((p) => p * L) : [];
    const start = row === 1 ? nl * 0.85 : nl * 0.95;
    for (let x = start; x < L - tl * 0.72; x += s.window.pitch) {
      if (doorXs.some((d) => Math.abs(d - x) < 0.75) || owXs.some((d) => Math.abs(d - x) < 0.35)) continue;
      if (row === 1 && x > L - tl * 0.95) continue;
      windows += `<rect x="${X(x - s.window.w / 2)}" y="${Y(wy + s.window.h / 2)}" width="${f(s.window.w)}" height="${f(s.window.h)}" rx="${f(s.window.w / 2.2)}"/>`;
    }
    for (const dx of doorXs) {
      const dw = D > 5 ? 1.07 : 0.82;
      const dh = Math.min(1.9, D * 0.48);
      doors += `<rect x="${X(dx - dw / 2)}" y="${Y(wy + s.window.h / 2 + 0.25)}" width="${f(dw)}" height="${f(dh)}" rx="0.18" fill="none" stroke="#9aa4b1" stroke-width="0.06"/>
        <rect x="${X(dx - 0.13)}" y="${Y(wy + 0.12)}" width="0.26" height="${f(s.window.h * 0.9)}" rx="0.1"/>`;
    }
    for (const ox3 of owXs) doors += `<rect x="${X(ox3 - 0.26)}" y="${Y(wy + 0.55)}" width="0.52" height="0.95" rx="0.15" fill="none" stroke="#a4adb9" stroke-width="0.05"/>`;
  });
  // Windscreen: a slim slanted band just under the nose curve, with pane dividers.
  const W = s.nose === 'a380' ? [0.2, 0.44] : s.nose === 'b787' ? [0.3, 0.6] : s.nose === 'dash8' || s.nose === 'atr' ? [0.3, 0.55] : [0.27, 0.5];
  const w0 = W[0] * nl, w1 = W[1] * nl;
  const sh = s.nose === 'a380' ? -0.18 * D : 0; // A380 cockpit sits on the lower deck level
  const wa: [number, number] = [w0, topAt(w0) - 0.09 * D + sh];
  const wb: [number, number] = [w1, topAt(w1) - 0.06 * D + sh];
  const wc: [number, number] = [w1 - 0.08 * D * 0.5, wb[1] - 0.12 * D];
  const wd: [number, number] = [w0 + 0.12 * D, wa[1] - 0.15 * D];
  const pane = (t: number) => `M${P(wa[0] + (wb[0] - wa[0]) * t, wa[1] + (wb[1] - wa[1]) * t)} L${P(wd[0] + (wc[0] - wd[0]) * t, wd[1] + (wc[1] - wd[1]) * t)}`;
  let cockpit = `<path d="M${P(...wa)} L${P(...wb)} L${P(...wc)} L${P(...wd)} Z" fill="#18202b"/><path d="${pane(0.36)} ${pane(0.68)}" stroke="#4b5666" stroke-width="0.07"/>`;
  if (s.nose === 'a350') {
    cockpit = `<path d="M${P(wa[0] - 0.25, wa[1] + 0.02)} L${P(wb[0] + 0.5, wb[1] + 0.01)} L${P(wb[0] + 0.7, wc[1] - 0.15)} L${P(wd[0] - 0.1, wd[1] - 0.1)} Z" fill="#0e1218"/>` + cockpit;
  }

  // Livery paint (clipped to the fuselage)
  const winY = winRows[0];
  let paint = '';
  if (pattern === 'cheatline') {
    paint = `<rect x="${X(0)}" y="${Y(winY - s.window.h / 2 - 0.12)}" width="${f(L)}" height="${f(D * 0.12)}" fill="${primary}"/><rect x="${X(0)}" y="${Y(winY - s.window.h / 2 - 0.16 - D * 0.12)}" width="${f(L)}" height="${f(D * 0.04)}" fill="${secondary}"/>`;
  } else if (pattern === 'swoosh') {
    paint = `<path d="M${P(L * 0.42, yb - 0.5)} C${P(L * 0.66, yb + 0.1)} ${P(L * 0.78, yt - 0.1)} ${P(L + 1, yt + 0.6)} L${P(L + 1, yb - 1)} Z" fill="${primary}"/><path d="M${P(L * 0.5, yb - 0.5)} C${P(L * 0.7, yb + 0.25)} ${P(L * 0.8, yt + 0.15)} ${P(L + 1, yt + 1.1)}" stroke="${secondary}" stroke-width="${f(D * 0.05)}" fill="none"/>`;
  } else if (pattern === 'tailfin') {
    paint = `<rect x="${X(0)}" y="${Y(yb + 0.3 * D)}" width="${f(L)}" height="${f(D * 0.35)}" fill="${secondary}" opacity="0.9"/>`;
  } else if (pattern === 'bold') {
    paint = `<rect x="${X(0)}" y="${Y(yb + 0.24 * D)}" width="${f(L)}" height="${f(D * 0.3)}" fill="#000" opacity="0.18"/>`;
  }
  const titleText = name.length > 20 ? code : name;
  const titleSize = Math.min(D * (decks === 2 ? 0.12 : 0.2), (L * 0.36) / Math.max(5, titleText.length * 0.55));
  const titleY = decks === 2 ? yb + 0.86 * D : winY + s.window.h / 2 + titleSize * 0.85;
  const titleFill = pattern === 'bold' ? '#ffffff' : primary;

  return `<svg class="${opts.cls ?? 'ac-art'}" viewBox="0 0 ${f(vbW)} ${f(vbH)}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(opts.title ?? typeId)}">
  <defs>
    <clipPath id="${id}c"><path d="${body}"/></clipPath>
    <linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.35"/><stop offset="0.35" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="0.7" stop-color="#000000" stop-opacity="0.04"/><stop offset="1" stop-color="#000000" stop-opacity="0.26"/>
    </linearGradient>
  </defs>
  ${opts.inFlight ? '' : `<ellipse cx="${X(L * 0.5)}" cy="${Y(0)}" rx="${f(L * 0.46)}" ry="${f(0.35)}" fill="#000" opacity="0.28"/>`}
  <path d="${fin}" fill="${finFill}"/>
  <path d="${rudder}" stroke="#000" stroke-opacity="0.18" stroke-width="0.06" fill="none"/>
  ${finCode}
  ${s.highWing ? '' : `<path d="${wing}" fill="${grey}"/>`}
  ${pylons}
  ${gear}
  <path d="${body}" fill="${bodyFill}"/>
  <g clip-path="url(#${id}c)">${paint}<path d="${fairing}" fill="#e6e9ee"/><rect x="${X(0)}" y="${Y(yt)}" width="${f(L)}" height="${f(D)}" fill="url(#${id}s)"/></g>
  <path d="${body}" fill="none" stroke="#8a94a2" stroke-width="0.05"/>
  <path d="${hs}" fill="${s.fin.tTail ? finFill : '#c9d0d8'}"/>
  <g fill="#27313e">${windows}</g>${doors}${cockpit}
  <text x="${X(L * (s.highWing ? 0.56 : 0.33))}" y="${Y(titleY)}" font-size="${f(titleSize)}" font-weight="700" fill="${titleFill}" font-family="Barlow Condensed, system-ui, sans-serif" letter-spacing="0.04">${esc(titleText)}</text>
  ${s.highWing ? `<path d="${wing}" fill="#d5dae1" stroke="#8a94a2" stroke-width="0.05"/>` : `<path d="${wing}" fill="${grey}" opacity="0.92"/>${tipShape ? `<path d="${tipShape}" fill="${primary}"/>` : ''}`}
  ${engines}
</svg>`;
}

function wheelsFor(s: Spec, nose: boolean): number {
  return nose ? (s.D > 5 ? 2 : 1) : s.gear.wheels;
}

/** Real overall length in metres, for captions. */
export function lengthOf(typeId: string): number {
  return spec(typeId).L;
}
