// World map: countries, night shading, airports and routes in SVG; aircraft,
// contrails and effects on a canvas overlay each frame. Flat (Natural Earth,
// zoom/pan) or globe (orthographic, drag to rotate).

import { geoCircle, geoDistance, geoGraticule10, geoInterpolate, geoNaturalEarth1, geoOrthographic, geoPath, type GeoProjection } from 'd3-geo';
import { select } from 'd3-selection';
import 'd3-transition';
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import type { Feature, LineString, MultiLineString } from 'geojson';
import { feature, mesh } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import countries110 from 'world-atlas/countries-110m.json';
import land110 from 'world-atlas/land-110m.json';
import { acType, type Category } from '../data/aircraft';
import { AIRPORTS, airport } from '../data/airports';
import { distance } from '../engine/geo';
import { currentLeg, legsOnDay, type Leg } from '../engine/schedule';
import { dateOf } from '../engine/time';
import { icon } from './icons';
import type { Aircraft, GameState, Route } from '../engine/types';

const SVG_NS = 'http://www.w3.org/2000/svg';

export type MapMode = 'flat' | 'globe';
export type ColorMode = 'livery' | 'profit' | 'load';

export interface MapHandlers {
  onAirport: (code: string) => void;
  onRoute: (id: string) => void;
  onHover: (ac: Aircraft | null, x: number, y: number) => void;
  onSelect: (ac: Aircraft | null) => void;
  onTakeoff: (ac: Aircraft) => void;
  onLanding: (ac: Aircraft, revenue: number) => void;
}

interface Highlight { airport?: string; routeId?: string; pair?: [string, string]; airline?: string }
interface Effect { kind: 'pulse' | 'money'; lon: number; lat: number; color: string; text?: string; t0: number }
interface Drawn { ac: Aircraft; x: number; y: number }

function loadPref<T extends string>(key: string, fallback: T, allowed: T[]): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
function savePref(key: string, v: string): void {
  try { localStorage.setItem(key, v); } catch { /* ignore */ }
}

/** Subsolar point for a game minute (game clock ≈ UTC). */
export function sunPosition(minute: number): [number, number] {
  const day = Math.floor(minute / 1440);
  const d = dateOf(day);
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  const doy = (d.getTime() - start) / 86_400_000;
  const decl = -23.44 * Math.cos((2 * Math.PI * (doy + 10)) / 365);
  const hours = (minute % 1440) / 60;
  let lon = (12 - hours) * 15;
  if (lon < -180) lon += 360;
  return [lon, decl];
}

export class WorldMap {
  mode: MapMode = loadPref('airways.map.mode', 'flat', ['flat', 'globe']);
  colorMode: ColorMode = loadPref('airways.map.color', 'livery', ['livery', 'profit', 'load']);
  showRivals = loadPref('airways.map.rivals2', 'off', ['on', 'off']) === 'on';
  following: string | null = null;

  private svg: SVGSVGElement;
  private gRoot: SVGGElement;
  private gRoutes: SVGGElement;
  private gAirports: SVGGElement;
  private nightPath: SVGPathElement;
  private twilightPath: SVGPathElement;
  private spherePath: SVGPathElement;
  private gratPath: SVGPathElement;
  private landPath: SVGPathElement;
  private coastPath: SVGPathElement;
  private borderPath: SVGPathElement;
  private land50: Feature | null = null; // detailed coastline, loaded after first paint
  private land110: Feature;
  private borders: MultiLineString;
  private hoverAirport: string | null = null;
  private labelTimer = 0;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private controls: HTMLElement;
  private legend: HTMLElement;
  private flat: GeoProjection;
  private globe: GeoProjection;
  private zoomer: ZoomBehavior<SVGSVGElement, unknown>;
  private transform: ZoomTransform = zoomIdentity;
  private lastT: ZoomTransform = zoomIdentity;
  private rotation: [number, number] = [-10, -35];
  private globeBase = 1;
  private width = 0;
  private height = 0;
  private highlight: Highlight = {};
  private state: GameState | null = null;
  private interp = new Map<string, (t: number) => [number, number]>();
  private legCache = new Map<string, { D: number; legs: Leg[] }>();
  private drawn: Drawn[] = [];
  private airborne = new Map<string, string>(); // player aircraft → leg key
  private effects: Effect[] = [];
  private lastSunMinute = -1e9;
  private lastGlobeRender = 0;
  private globeDirty = false;
  private hoverId: string | null = null;

  constructor(private host: HTMLElement, private handlers: MapHandlers) {
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.classList.add('map-svg');
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'map-canvas';
    this.controls = document.createElement('div');
    this.controls.className = 'map-controls';
    this.legend = document.createElement('div');
    this.legend.className = 'map-legend';
    host.append(this.svg, this.canvas, this.controls, this.legend);
    this.ctx = this.canvas.getContext('2d')!;

    const r = host.getBoundingClientRect();
    this.width = Math.max(600, r.width);
    this.height = Math.max(320, r.height);
    this.svg.setAttribute('viewBox', `0 0 ${this.width} ${this.height}`);
    this.svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    this.flat = geoNaturalEarth1().fitExtent([[8, 8], [this.width - 8, this.height - 8]], { type: 'Sphere' });
    this.globeBase = Math.min(this.width, this.height) / 2.15;
    this.globe = geoOrthographic().clipAngle(90).translate([this.width / 2, this.height / 2]).scale(this.globeBase).rotate(this.rotation);

    this.gRoot = this.el('g', {}) as SVGGElement;
    this.svg.append(this.gRoot);
    this.spherePath = this.el('path', { class: 'sphere' }) as SVGPathElement;
    this.gratPath = this.el('path', { class: 'graticule' }) as SVGPathElement;
    const gLand = this.el('g', { class: 'land' });
    const topo = countries110 as unknown as Topology<{ countries: GeometryCollection }>;
    this.borders = mesh(topo, topo.objects.countries, (a, b) => a !== b) as MultiLineString;
    const t110 = land110 as unknown as Topology<{ land: GeometryCollection }>;
    void import('world-atlas/land-50m.json').then((m) => {
      const t50 = m.default as unknown as Topology<{ land: GeometryCollection }>;
      this.land50 = feature(t50, t50.objects.land) as unknown as Feature;
      if (this.mode === 'flat') this.renderGeo();
    });
    this.land110 = feature(t110, t110.objects.land) as unknown as Feature;
    this.landPath = this.el('path', {}) as SVGPathElement;
    this.borderPath = this.el('path', { class: 'borders', fill: 'none', stroke: '#1d2a3f', 'stroke-width': '0.5', 'vector-effect': 'non-scaling-stroke' }) as SVGPathElement;
    this.coastPath = this.el('path', { class: 'coast' }) as SVGPathElement;
    gLand.append(this.landPath, this.borderPath);
    const defs = this.el('defs', {});
    defs.innerHTML = `<radialGradient id="ocean-grad" cx="50%" cy="45%" r="75%"><stop offset="0" stop-color="#0b1626"/><stop offset="1" stop-color="#05080f"/></radialGradient>
      <filter id="coast-glow" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="1.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
    this.svg.prepend(defs);
    this.twilightPath = this.el('path', { class: 'twilight' }) as SVGPathElement;
    this.nightPath = this.el('path', { class: 'night' }) as SVGPathElement;
    this.gRoutes = this.el('g', { class: 'routes' }) as SVGGElement;
    this.gAirports = this.el('g', { class: 'airports' }) as SVGGElement;
    this.gRoot.append(this.spherePath, this.gratPath, gLand, this.coastPath, this.twilightPath, this.nightPath, this.gRoutes, this.gAirports);
    this.buildAirports();

    this.zoomer = zoom<SVGSVGElement, unknown>()
      .on('start', (e) => {
        const t = e.sourceEvent?.type;
        if (this.following && (t === 'mousedown' || t === 'touchstart')) this.select(null);
      })
      .on('zoom', (e) => this.onZoom(e.transform, e.sourceEvent))
      .on('end', () => this.layoutLabels());
    select(this.svg).call(this.zoomer).on('dblclick.zoom', null);
    this.svg.addEventListener('mousemove', (e) => this.onPointer(e));
    this.svg.addEventListener('mouseleave', () => { this.hoverId = null; this.handlers.onHover(null, 0, 0); });
    this.svg.addEventListener('click', () => {
      if (this.hoverId) {
        const ac = this.state?.aircraft.find((a) => a.id === this.hoverId);
        if (ac) this.select(ac);
      }
    });
    this.applyMode();
    this.renderControls();
    new ResizeObserver(() => this.sizeCanvas()).observe(host);
    this.sizeCanvas();
  }

  private get proj(): GeoProjection {
    return this.mode === 'globe' ? this.globe : this.flat;
  }

  private el(tag: string, attrs: Record<string, string>): SVGElement {
    const e = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  }

  private sizeCanvas(): void {
    const r = this.host.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.canvas.style.width = `${r.width}px`;
    this.canvas.style.height = `${r.height}px`;
  }

  // ---------- controls ----------

  private renderControls(): void {
    const b = (attr: string, v: string, label: string, on: boolean) => `<button data-${attr}="${v}" class="${on ? 'on' : ''}">${label}</button>`;
    this.controls.innerHTML = `
      <div class="mseg">${b('map', 'flat', `${icon('map')} Flat`, this.mode === 'flat')}${b('map', 'globe', `${icon('globe')} Globe`, this.mode === 'globe')}</div>
      <div class="mseg">${b('color', 'livery', 'Livery', this.colorMode === 'livery')}${b('color', 'profit', 'Profit', this.colorMode === 'profit')}${b('color', 'load', 'Load', this.colorMode === 'load')}</div>
      <div class="mseg">${b('rivals', 'x', `${icon('layers')} All rival routes`, this.showRivals)}</div>`;
    this.controls.onclick = (e) => {
      const btn = (e.target as HTMLElement).closest('button');
      if (!btn) return;
      e.stopPropagation();
      if (btn.dataset.map) this.setMode(btn.dataset.map as MapMode);
      if (btn.dataset.color) { this.colorMode = btn.dataset.color as ColorMode; savePref('airways.map.color', this.colorMode); }
      if (btn.dataset.rivals) { this.showRivals = !this.showRivals; savePref('airways.map.rivals2', this.showRivals ? 'on' : 'off'); }
      this.renderControls();
      if (this.state) this.update(this.state);
    };
    const legends: Record<ColorMode, string> = {
      livery: '',
      profit: '<span class="lg" style="--c:#ff5d73"></span>Losing <span class="lg" style="--c:#ffb703"></span>Break-even <span class="lg" style="--c:#3ddc97"></span>Profitable · line width = passengers',
      load: '<span class="lg" style="--c:#ff5d73"></span>&lt;60% <span class="lg" style="--c:#ffb703"></span>60–80% <span class="lg" style="--c:#3ddc97"></span>&gt;80% load · width = passengers',
    };
    this.legend.innerHTML = legends[this.colorMode];
    this.legend.hidden = !legends[this.colorMode];
  }

  setMode(m: MapMode): void {
    this.mode = m;
    savePref('airways.map.mode', m);
    this.applyMode();
  }

  private applyMode(): void {
    const ext: [[number, number], [number, number]] = this.mode === 'flat' ? [[-100, -100], [this.width + 100, this.height + 100]] : [[-1e7, -1e7], [1e7, 1e7]];
    this.zoomer.translateExtent(ext).scaleExtent(this.mode === 'flat' ? [1, 14] : [0.7, 8]);
    this.svg.classList.toggle('globe', this.mode === 'globe');
    select(this.svg).call(this.zoomer.transform as never, zoomIdentity);
    this.renderGeo();
    this.interp.clear();
  }

  private onZoom(t: ZoomTransform, src: Event | null): void {
    if (this.mode === 'flat') {
      this.transform = t;
      this.gRoot.setAttribute('transform', t.toString());
      this.svg.style.setProperty('--k', String(t.k));
      this.svg.classList.toggle('zoomed', t.k >= 2.2);
    } else {
      const drag = src && (src.type === 'mousemove' || src.type === 'touchmove');
      if (drag) {
        const k = 0.25 / t.k;
        this.rotation = [this.rotation[0] + (t.x - this.lastT.x) * k, Math.max(-80, Math.min(80, this.rotation[1] - (t.y - this.lastT.y) * k))];
      }
      this.transform = zoomIdentity;
      this.gRoot.removeAttribute('transform');
      this.svg.style.setProperty('--k', '1');
      this.svg.classList.toggle('zoomed', t.k >= 1.6);
      this.globe.scale(this.globeBase * t.k).rotate(this.rotation);
      this.globeDirty = true;
    }
    this.lastT = t;
  }

  // ---------- geometry ----------

  private buildAirports(): void {
    for (const a of [...AIRPORTS].sort((x, y) => x.size - y.size)) {
      const g = this.el('g', { class: `airport s${a.size}`, 'data-code': a.iata });
      const title = this.el('title', {});
      title.textContent = `${a.iata} · ${a.name}, ${a.city}`;
      const label = this.el('text', { y: '-5' });
      label.textContent = a.iata;
      g.append(title, this.el('circle', { r: String(1.2 + a.size * 0.55) }), label);
      g.addEventListener('click', (e) => { e.stopPropagation(); this.handlers.onAirport(a.iata); });
      g.addEventListener('mouseenter', () => { this.hoverAirport = a.iata; if (this.state) this.drawRoutes(this.state); });
      g.addEventListener('mouseleave', () => { this.hoverAirport = null; if (this.state) this.drawRoutes(this.state); });
      this.gAirports.append(g);
    }
  }

  /** Re-project everything that depends on the projection. */
  private renderGeo(): void {
    const path = geoPath(this.proj);
    this.spherePath.setAttribute('d', path({ type: 'Sphere' }) ?? '');
    this.gratPath.setAttribute('d', path(geoGraticule10()) ?? '');
    const land = path(this.mode === 'globe' || !this.land50 ? this.land110 : this.land50) ?? '';
    this.landPath.setAttribute('d', land);
    this.coastPath.setAttribute('d', land);
    this.borderPath.setAttribute('d', path(this.borders) ?? '');
    this.placeAirports();
    if (this.state) this.drawRoutes(this.state);
    this.lastSunMinute = -1e9;
    clearTimeout(this.labelTimer);
    this.labelTimer = window.setTimeout(() => this.layoutLabels(), 60);
    this.lastGlobeRender = performance.now();
    this.globeDirty = false;
  }

  private visible(lon: number, lat: number): boolean {
    if (this.mode === 'flat') return true;
    return geoDistance([lon, lat], [-this.rotation[0], -this.rotation[1]]) < Math.PI / 2 - 0.02;
  }

  private placeAirports(): void {
    for (const g of this.gAirports.children) {
      const a = airport((g as SVGElement).dataset.code!);
      const p = this.proj([a.lon, a.lat]);
      const vis = !!p && this.visible(a.lon, a.lat);
      (g as SVGElement).style.display = vis ? '' : 'none';
      if (p) g.setAttribute('transform', `translate(${p[0].toFixed(1)},${p[1].toFixed(1)})`);
    }
  }

  private routeColor(r: Route): string {
    if (this.colorMode === 'livery' || r.week.length === 0) return 'var(--player)';
    const w = r.week;
    const seats = w.reduce((n, x) => n + x.seatsY + x.seatsJ, 0);
    const pax = w.reduce((n, x) => n + x.paxY + x.paxJ + x.transfer, 0);
    if (this.colorMode === 'load') {
      const lf = seats ? pax / seats : 0;
      return lf >= 0.8 ? '#3ddc97' : lf >= 0.6 ? '#ffb703' : '#ff5d73';
    }
    const profit = w.reduce((n, x) => n + x.revenue - x.cost, 0) / w.length;
    return profit > 5000 ? '#3ddc97' : profit > -2000 ? '#ffb703' : '#ff5d73';
  }

  /** Player routes on the flat map bow upwards so your network reads as raised arcs. */
  private lifted(r: Route): boolean {
    return this.mode === 'flat' && r.owner === this.state?.playerCode;
  }

  /** Projected point along a route (projection coordinates). */
  private projAt(r: Route, p: number): [number, number] | null {
    const pt = this.proj(this.geoAt(r, p));
    if (!pt || !this.lifted(r)) return pt;
    const A = airport(r.from);
    const B = airport(r.to);
    const a = this.flat([A.lon, A.lat])!;
    const b = this.flat([B.lon, B.lat])!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1 || Math.abs(dx) > this.width / 2) return pt;
    let nx = dy / len, ny = -dx / len;
    if (ny > 0) { nx = -nx; ny = -ny; }
    const h = Math.min(len * 0.14, 60) * Math.sin(Math.PI * p);
    return [pt[0] + nx * h, pt[1] + ny * h];
  }

  private routePath(r: Route, path: ReturnType<typeof geoPath>): string | null {
    const A = airport(r.from);
    const B = airport(r.to);
    if (this.lifted(r)) {
      const pts: [number, number][] = [];
      for (let i = 0; i <= 40; i++) {
        const q = this.projAt(r, i / 40);
        if (!q || (pts.length && Math.abs(q[0] - pts[pts.length - 1][0]) > this.width / 3)) { pts.length = 0; break; }
        pts.push(q);
      }
      if (pts.length) return `M${pts.map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join('L')}`;
    }
    return path({ type: 'LineString', coordinates: [[A.lon, A.lat], [B.lon, B.lat]] } as LineString);
  }

  private rivalVisible(r: Route): boolean {
    const h = this.highlight;
    const touches = (code: string | null | undefined) => !!code && (r.from === code || r.to === code);
    return this.showRivals || this.isHighlighted(r) || h.airline === r.owner || touches(this.hoverAirport) || touches(h.airport);
  }

  private drawRoutes(s: GameState): void {
    const path = geoPath(this.proj);
    const color = new Map(s.airlines.map((a) => [a.code, a.color]));
    this.gRoutes.replaceChildren();
    const sorted = [...s.routes].sort((a, b) => Number(a.owner === s.playerCode) - Number(b.owner === s.playerCode));
    for (const r of sorted) {
      const mine = r.owner === s.playerCode;
      if (!mine && !this.rivalVisible(r)) continue;
      const d = this.routePath(r, path);
      if (!d) continue;
      const hl = this.isHighlighted(r) || (!mine && (this.highlight.airline === r.owner || !!this.hoverAirport || !!this.highlight.airport) && !this.showRivals);
      const attrs: Record<string, string> = { d, class: `route ${mine ? 'mine' : 'rival'}${hl ? ' hl' : ''}`, 'data-id': r.id };
      if (mine) {
        const pax = r.week.length ? r.week.reduce((n, x) => n + x.paxY + x.paxJ + x.transfer, 0) / r.week.length : 0;
        attrs.style = `--rc:${this.routeColor(r)};--rw:${(1.6 + Math.min(4.5, pax / 250)).toFixed(2)}px`;
      } else {
        attrs.stroke = color.get(r.owner) ?? '#888';
      }
      const el = this.el('path', attrs);
      if (mine) el.addEventListener('click', (e) => { e.stopPropagation(); this.handlers.onRoute(r.id); });
      this.gRoutes.append(el);
      if (mine) this.gRoutes.append(this.el('path', { d, class: 'route flow' }));
    }
  }

  /** Show airport codes by priority without overlaps. */
  layoutLabels(): void {
    const m = this.screenMatrix();
    const k = this.mode === 'flat' ? this.transform.k : this.lastT.k;
    const placed: [number, number, number, number][] = [];
    const items = [...this.gAirports.children].map((g) => {
      const a = airport((g as SVGElement).dataset.code!);
      const c = g.classList;
      const pri = (c.contains('hl') ? 300 : 0) + (c.contains('base') ? 200 : 0) + (c.contains('served') ? 100 : 0) + a.size * 10;
      return { g: g as SVGElement, a, pri };
    }).sort((x, y) => y.pri - x.pri);
    const minPri = k < 1.6 ? 50 : k < 3 ? 40 : 0;
    for (const { g, a, pri } of items) {
      const pt = this.proj([a.lon, a.lat]);
      let show = g.style.display !== 'none' && !!pt && pri >= minPri;
      if (show && pt) {
        const x = m.bx + m.a * pt[0];
        const y = m.by + m.a * pt[1];
        const box: [number, number, number, number] = [x - 14, y - 17, x + 14, y - 5];
        show = !placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]);
        if (show) placed.push(box);
      }
      g.classList.toggle('lbl', show);
    }
  }

  /** Redraw routes and airport states. Call when routes, schedules or bases change. */
  update(s: GameState): void {
    this.state = s;
    this.legCache.clear();
    this.drawRoutes(s);
    const p = s.airlines[0];
    const served = new Set(s.routes.filter((r) => r.owner === s.playerCode).flatMap((r) => [r.from, r.to]));
    for (const g of this.gAirports.children) {
      const code = (g as SVGElement).dataset.code!;
      g.classList.toggle('base', p.bases.includes(code));
      g.classList.toggle('served', served.has(code));
      g.classList.toggle('hl', this.highlight.airport === code || !!this.highlight.pair?.includes(code));
    }
    this.svg.style.setProperty('--player', p.color);
    this.layoutLabels();
  }

  private isHighlighted(r: Route): boolean {
    const h = this.highlight;
    if (h.routeId === r.id) return true;
    if (h.pair) return (r.from === h.pair[0] && r.to === h.pair[1]) || (r.from === h.pair[1] && r.to === h.pair[0]);
    return false;
  }

  setHighlight(h: Highlight, s: GameState): void {
    this.highlight = h;
    this.update(s);
  }

  focus(code: string): void {
    const a = airport(code);
    if (this.mode === 'globe') {
      this.rotation = [-a.lon, -a.lat * 0.8];
      this.globe.rotate(this.rotation);
      this.renderGeo();
      return;
    }
    const [x, y] = this.flat([a.lon, a.lat])!;
    const k = Math.max(this.transform.k, 2.5);
    const t = zoomIdentity.translate(this.width / 2 - x * k, this.height / 2 - y * k).scale(k);
    select(this.svg).transition().duration(600).call(this.zoomer.transform as never, t);
  }

  select(ac: Aircraft | null): void {
    this.following = ac?.id ?? null;
    this.handlers.onSelect(ac);
  }

  // ---------- night ----------

  private updateNight(minute: number): void {
    if (Math.abs(minute - this.lastSunMinute) < 6) return;
    this.lastSunMinute = minute;
    const [lon, lat] = sunPosition(minute);
    const anti: [number, number] = [lon + 180 > 180 ? lon - 180 : lon + 180, -lat];
    const path = geoPath(this.proj);
    this.nightPath.setAttribute('d', path(geoCircle().center(anti).radius(90)()) ?? '');
    this.twilightPath.setAttribute('d', path(geoCircle().center(anti).radius(97)()) ?? '');
    for (const g of this.gAirports.children) {
      const a = airport((g as SVGElement).dataset.code!);
      g.classList.toggle('night', geoDistance([a.lon, a.lat], anti) < Math.PI / 2 - 0.05);
    }
  }

  // ---------- frame ----------

  private screenMatrix(): { a: number; bx: number; by: number } {
    const rect = this.svg.getBoundingClientRect();
    const scale = Math.min(rect.width / this.width, rect.height / this.height);
    const ox = (rect.width - this.width * scale) / 2;
    const oy = (rect.height - this.height * scale) / 2;
    const t = this.transform;
    return { a: scale * t.k, bx: ox + scale * t.x, by: oy + scale * t.y };
  }

  private legsFor(ac: Aircraft, routes: Map<string, Route>, minute: number): { leg: Leg; p: number } | null {
    const D = Math.floor((minute + ac.phase * 1440) / 1440);
    let c = this.legCache.get(ac.id);
    if (!c || c.D !== D) {
      c = { D, legs: [...legsOnDay(ac, routes, D - 1), ...legsOnDay(ac, routes, D)] };
      this.legCache.set(ac.id, c);
    }
    for (const leg of c.legs) if (minute >= leg.dep && minute < leg.arr) return { leg, p: (minute - leg.dep) / (leg.arr - leg.dep) };
    return null;
  }

  private geoAt(r: Route, p: number): [number, number] {
    let f = this.interp.get(r.id);
    if (!f) {
      const A = airport(r.from);
      const B = airport(r.to);
      f = geoInterpolate([A.lon, A.lat], [B.lon, B.lat]);
      this.interp.set(r.id, f);
    }
    return f(Math.max(0, Math.min(1, p)));
  }

  /** Screen position (CSS px) of a lon/lat, or null if hidden. */
  private toScreen(ll: [number, number], m: { a: number; bx: number; by: number }): [number, number] | null {
    if (!this.visible(ll[0], ll[1])) return null;
    const pt = this.proj(ll);
    return pt ? [m.bx + m.a * pt[0], m.by + m.a * pt[1]] : null;
  }

  /** Screen position of a point along a route, honouring lifted arcs. */
  private screenAt(r: Route, p: number, m: { a: number; bx: number; by: number }): [number, number] | null {
    const ll = this.geoAt(r, p);
    if (!this.visible(ll[0], ll[1])) return null;
    const pt = this.projAt(r, Math.max(0, Math.min(1, p)));
    return pt ? [m.bx + m.a * pt[0], m.by + m.a * pt[1]] : null;
  }

  screenPosOf(id: string): { x: number; y: number } | null {
    const d = this.drawn.find((x) => x.ac.id === id);
    return d ? { x: d.x, y: d.y } : null;
  }

  /** Called every animation frame. */
  frame(s: GameState): void {
    this.state = s;
    const minute = s.minute;
    const routes = new Map(s.routes.map((r) => [r.id, r]));

    if (this.following) this.track(s, routes, minute);
    if (this.mode === 'globe' && this.globeDirty && performance.now() - this.lastGlobeRender > 33) this.renderGeo();
    this.updateNight(minute);

    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const m = this.screenMatrix();
    const color = new Map(s.airlines.map((a) => [a.code, a.color]));
    this.drawn = [];

    for (const ac of s.aircraft) {
      const mine = ac.owner === s.playerCode;
      const special = ac.id === this.following || ac.id === this.hoverId;
      if (!ac.assignments.length || ac.readyDay > s.day || ac.groundedUntil > s.day) continue;
      const cur = this.legsFor(ac, routes, minute);
      if (mine) this.trackTransitions(ac, cur, s);
      if (!cur) continue;
      const { leg, p } = cur;
      const pp = leg.outbound ? p : 1 - p;
      const a = this.screenAt(leg.route, pp, m);
      if (!a) continue;
      const ahead = this.screenAt(leg.route, pp + (leg.outbound ? 0.01 : -0.01), m);
      if (!ahead || Math.abs(ahead[0] - a[0]) > 60) continue;
      const angle = Math.atan2(ahead[1] - a[1], ahead[0] - a[0]);
      const c = color.get(ac.owner) ?? '#fff';
      if (mine || special) this.contrail(ctx, leg.route, pp, leg.outbound, m);
      if (mine || special) {
        this.glyph(ctx, a[0], a[1], angle, c, special ? 1.5 : 1, ac.id === this.following, acType(ac.typeId).category);
      } else {
        ctx.globalAlpha = this.showRivals ? 0.8 : 0.45;
        ctx.fillStyle = c;
        ctx.fillRect(a[0] - 1.2, a[1] - 1.2, 2.4, 2.4);
        ctx.globalAlpha = 1;
      }
      this.drawn.push({ ac, x: a[0], y: a[1] });
    }
    this.drawEffects(ctx, m);
  }

  private glyph(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, color: string, scale: number, ring: boolean, cat: Category): void {
    if (ring) {
      ctx.beginPath();
      ctx.arc(x, y, 15, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(242,181,68,.9)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const size = cat === 'turboprop' ? 0.8 : cat === 'regional' ? 0.9 : cat === 'narrowbody' ? 1 : cat === 'widebody' ? 1.3 : 1.55;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(scale * size, scale * size);
    ctx.beginPath();
    if (cat === 'turboprop') {
      // Straight high wing, T-tail.
      ctx.moveTo(7, 0); ctx.lineTo(5.5, -1); ctx.lineTo(1.2, -1); ctx.lineTo(1.2, -7.5); ctx.lineTo(-0.6, -7.5); ctx.lineTo(-0.6, -1);
      ctx.lineTo(-5, -0.8); ctx.lineTo(-5.6, -3); ctx.lineTo(-6.8, -3); ctx.lineTo(-6.6, 0); ctx.lineTo(-6.8, 3); ctx.lineTo(-5.6, 3);
      ctx.lineTo(-5, 0.8); ctx.lineTo(-0.6, 1); ctx.lineTo(-0.6, 7.5); ctx.lineTo(1.2, 7.5); ctx.lineTo(1.2, 1); ctx.lineTo(5.5, 1);
    } else {
      // Swept-wing airliner pointing along +x.
      const f = cat === 'superjumbo' ? 1.5 : cat === 'widebody' ? 1.25 : 1.05;
      ctx.moveTo(8.5, 0); ctx.quadraticCurveTo(7.5, -f, 5, -f); ctx.lineTo(2.2, -f); ctx.lineTo(-1.6, -7.8); ctx.lineTo(-3, -7.8); ctx.lineTo(-1.6, -f);
      ctx.lineTo(-5.4, -f * 0.8); ctx.lineTo(-7.2, -3.6); ctx.lineTo(-8.2, -3.6); ctx.lineTo(-7.6, 0); ctx.lineTo(-8.2, 3.6); ctx.lineTo(-7.2, 3.6);
      ctx.lineTo(-5.4, f * 0.8); ctx.lineTo(-1.6, f); ctx.lineTo(-3, 7.8); ctx.lineTo(-1.6, 7.8); ctx.lineTo(2.2, f); ctx.lineTo(5, f); ctx.quadraticCurveTo(7.5, f, 8.5, 0);
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(4,8,14,.9)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    // Engine pods
    ctx.fillStyle = 'rgba(4,8,14,.75)';
    const pods: [number, number][] = cat === 'superjumbo' ? [[0.6, 3], [-0.6, 5.4]] : cat === 'turboprop' ? [[2.2, 3.2]] : [[0.9, 3.3]];
    for (const [px, py] of pods) {
      ctx.fillRect(px - 1.1, py - 0.55, 2.2, 1.1);
      ctx.fillRect(px - 1.1, -py - 0.55, 2.2, 1.1);
    }
    ctx.restore();
  }

  private contrail(ctx: CanvasRenderingContext2D, r: Route, pp: number, outbound: boolean, m: { a: number; bx: number; by: number }): void {
    const d = distance(r.from, r.to);
    const step = Math.min(0.05, 70 / d) * (outbound ? -1 : 1);
    let prev = this.screenAt(r, pp, m);
    for (let i = 1; i <= 9 && prev; i++) {
      const q = pp + step * i;
      if (q < 0 || q > 1) break;
      const next = this.screenAt(r, q, m);
      if (!next || Math.abs(next[0] - prev[0]) > 60) break;
      ctx.strokeStyle = `rgba(230,240,255,${(0.45 * (1 - i / 10)).toFixed(3)})`;
      ctx.lineWidth = 2.2 - i * 0.18;
      ctx.beginPath();
      ctx.moveTo(prev[0], prev[1]);
      ctx.lineTo(next[0], next[1]);
      ctx.stroke();
      prev = next;
    }
  }

  private trackTransitions(ac: Aircraft, cur: { leg: Leg; p: number } | null, s: GameState): void {
    const key = cur ? `${cur.leg.route.id}:${cur.leg.dep}` : '';
    const prev = this.airborne.get(ac.id) ?? '';
    if (key === prev) return;
    const now = performance.now();
    if (prev) {
      const [routeId, dep] = prev.split(':');
      const r = s.routes.find((x) => x.id === routeId);
      const finished = !cur || Number(dep) !== cur.leg.dep;
      if (r && finished && s.minute - Number(dep) < 24 * 60) {
        const outbound = this.legOutbound(ac, routeId, Number(dep));
        const dest = airport(outbound ? r.to : r.from);
        const revenue = r.last.legs ? r.last.revenue / r.last.legs : 0;
        this.effects.push({ kind: 'pulse', lon: dest.lon, lat: dest.lat, color: s.airlines[0].color, t0: now });
        if (revenue > 0) this.effects.push({ kind: 'money', lon: dest.lon, lat: dest.lat, color: '#3ddc97', text: `+$${revenue >= 1e6 ? `${(revenue / 1e6).toFixed(1)}M` : `${Math.round(revenue / 1000)}k`}`, t0: now });
        this.handlers.onLanding(ac, revenue);
      }
    }
    if (cur && cur.p < 0.2) {
      const origin = airport(cur.leg.outbound ? cur.leg.route.from : cur.leg.route.to);
      this.effects.push({ kind: 'pulse', lon: origin.lon, lat: origin.lat, color: '#ffffff', t0: now });
      this.handlers.onTakeoff(ac);
    }
    if (cur) this.airborne.set(ac.id, key);
    else this.airborne.delete(ac.id);
    if (this.effects.length > 80) this.effects.splice(0, this.effects.length - 80);
  }

  private legOutbound(ac: Aircraft, routeId: string, dep: number): boolean {
    const c = this.legCache.get(ac.id);
    return c?.legs.find((l) => l.route.id === routeId && l.dep === dep)?.outbound ?? true;
  }

  private drawEffects(ctx: CanvasRenderingContext2D, m: { a: number; bx: number; by: number }): void {
    const now = performance.now();
    this.effects = this.effects.filter((e) => now - e.t0 < (e.kind === 'money' ? 1800 : 1100));
    for (const e of this.effects) {
      const p = this.toScreen([e.lon, e.lat], m);
      if (!p) continue;
      const t = (now - e.t0) / (e.kind === 'money' ? 1800 : 1100);
      if (e.kind === 'pulse') {
        ctx.beginPath();
        ctx.arc(p[0], p[1], 3 + t * 16, 0, Math.PI * 2);
        ctx.strokeStyle = e.color;
        ctx.globalAlpha = 1 - t;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else {
        ctx.globalAlpha = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
        ctx.font = '700 12px ui-sans-serif, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(5,10,20,.9)';
        ctx.strokeText(e.text!, p[0], p[1] - 10 - t * 22);
        ctx.fillStyle = e.color;
        ctx.fillText(e.text!, p[0], p[1] - 10 - t * 22);
        ctx.globalAlpha = 1;
      }
    }
  }

  /** Keep the followed aircraft centred. */
  private track(s: GameState, routes: Map<string, Route>, minute: number): void {
    const ac = s.aircraft.find((a) => a.id === this.following);
    if (!ac) { this.select(null); return; }
    const cur = this.legsFor(ac, routes, minute) ?? currentLeg(ac, routes, minute);
    if (!cur) return;
    const ll = this.geoAt(cur.leg.route, cur.leg.outbound ? cur.p : 1 - cur.p);
    if (this.mode === 'globe') {
      this.rotation = [-ll[0], -ll[1] * 0.8];
      this.globe.rotate(this.rotation);
      this.globeDirty = true;
      return;
    }
    const pt = this.projAt(cur.leg.route, cur.leg.outbound ? cur.p : 1 - cur.p);
    if (!pt) return;
    const k = Math.max(this.transform.k, 3.5);
    const t = zoomIdentity.translate(this.width / 2 - pt[0] * k, this.height / 2 - pt[1] * k).scale(k);
    select(this.svg).call(this.zoomer.transform as never, t);
  }

  private onPointer(e: MouseEvent): void {
    const r = this.host.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    let best: Drawn | null = null;
    let bd = 100; // 10px squared
    for (const d of this.drawn) {
      const dd = (d.x - x) ** 2 + (d.y - y) ** 2;
      if (dd < bd) { bd = dd; best = d; }
    }
    const id = best?.ac.id ?? null;
    this.hoverId = id;
    this.svg.style.cursor = id ? 'pointer' : '';
    this.handlers.onHover(best?.ac ?? null, x, y);
  }
}
