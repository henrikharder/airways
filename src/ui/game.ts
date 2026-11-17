import { acType } from '../data/aircraft';
import { AIRPORTS, airport } from '../data/airports';
import { progress, weekLabel } from '../game/board';
import { MODULES, PAINTS, standClassFor, standFits, type Category } from '../game/catalog';
import { acceptOffer, airlineColor, airlineName, declineOffer, gateOf, reachableStands, runway, hasTower } from '../game/flights';
import { accessTile, bulldozeAt, checkPlace, footprint, getLayout, idx, layoutStamp, paintCheck, paintRect, place, walkable } from '../game/grid';
import { buildDemo } from '../game/demo';
import { createGame } from '../game/newgame';
import { distanceTo, UNREACHABLE } from '../game/paths';
import { queueLength, usersOf } from '../game/passengers';
import { hasSave, loadGame, saveGame } from '../game/save';
import { advance, upkeepPerDay } from '../game/sim';
import type { Building, GameState, ModuleKind, PaintKind } from '../game/types';
import { income, profit } from '../game/types';
import { Scene, type Ghost } from '../render/scene';
import { boardShell, gateLabel, statusOf, updateBoards } from './departures';
import { clock, esc, money, num } from './format';
import { icon, logoMark, type IconName } from './icons';

type Tool = { t: 'select' } | { t: 'build'; kind: ModuleKind } | { t: 'paint'; paint: PaintKind } | { t: 'bulldoze' };
type Tab = 'airport' | 'airlines' | 'flights' | 'money';

const SPEEDS = [0, 1, 3, 8, 20]; // game minutes per real second
const SPEED_LABEL = ['', '1×', '2×', '3×', '4×'];

const PALETTE: { cat: Category | 'tools'; label: string; items: ({ build: ModuleKind } | { paint: PaintKind })[] }[] = [
  { cat: 'airside', label: 'Airside', items: [{ build: 'runway' }, { build: 'tower' }, { paint: 'taxiway' }, { paint: 'apron' }, { build: 'stand_s' }, { build: 'stand_m' }, { build: 'stand_l' }, { build: 'stand_xl' }] },
  { cat: 'terminal', label: 'Terminal', items: [{ paint: 'floor' }, { build: 'entrance' }, { build: 'checkin' }, { build: 'security' }, { build: 'gate' }, { build: 'baggage' }] },
  { cat: 'comfort', label: 'Comforts', items: [{ build: 'food' }, { build: 'shop' }, { build: 'toilets' }, { build: 'seats' }] },
  { cat: 'landside', label: 'Landside', items: [{ build: 'carpark' }, { build: 'tree' }] },
];

const ITEM_ICON: Partial<Record<ModuleKind | PaintKind, IconName>> = {
  runway: 'runway', tower: 'tower', taxiway: 'taxiway', apron: 'floor', stand_s: 'stand', stand_m: 'stand', stand_l: 'stand', stand_xl: 'stand',
  floor: 'terminal', entrance: 'entrance', checkin: 'checkin', security: 'security', gate: 'gate', baggage: 'baggage', food: 'food', shop: 'shop',
  toilets: 'toilets', seats: 'seats', carpark: 'car', tree: 'tree',
};

export class Game {
  s!: GameState;
  scene = new Scene();
  private tool: Tool = { t: 'select' };
  private rot = 0;
  private speed = 1;
  private last = 0;
  private hover: [number, number] | null = null;
  private drag: { x: number; y: number; tile: [number, number]; button: number; moved: boolean } | null = null;
  private selected: Building | null = null;
  private tab: Tab = 'airport';
  private lastPanel = 0;
  private lastSavedDay = -1;
  private warnings: string[] = [];
  private warnStamp = -1;
  private keys = new Set<string>();

  constructor(private root: HTMLElement) {
    root.innerHTML = `
      <header id="topbar"></header>
      <main>
        <div id="stage"></div>
        <nav id="palette"></nav>
        <div id="warnings"></div>
        <aside id="panel"><nav id="tabs"></nav><div id="view"></div></aside>
        <div id="tip" hidden></div>
      </main>
      <footer id="ticker"></footer>
      <div id="toasts"></div><div id="overlay" hidden></div>`;
    this.root.addEventListener('click', (e) => this.onClick(e));
    void this.boot();
  }

  private $(sel: string): HTMLElement {
    return this.root.querySelector(sel) as HTMLElement;
  }

  private async boot(): Promise<void> {
    await this.scene.init(this.$('#stage'));
    this.bindInput();
    this.showStart();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---------------------------------------------------------------- lifecycle

  /** Dev helper: build the demo airport into the current game. */
  demo(): string[] {
    const errors = buildDemo(this.s);
    this.scene.centerOn(52, 50);
    return errors;
  }

  private start(s: GameState): void {
    this.s = s;
    this.selected = null;
    this.tool = { t: 'select' };
    this.overlay(null);
    const rw = runway(s);
    this.scene.zoom = 1.6;
    this.scene.centerOn(rw ? rw.x + rw.w / 2 : s.W / 2, rw ? rw.y + 30 : s.H / 2);
    this.lastSavedDay = Math.floor(s.minute / 1440);
    this.renderChrome();
    this.renderPanel();
  }

  private frame(t: number): void {
    const dt = Math.min(0.1, (t - (this.last || t)) / 1000);
    this.last = t;
    if (this.s) {
      if (this.speed && !this.s.gameOver && this.$('#overlay').hidden) advance(this.s, Math.min(6, dt * SPEEDS[this.speed]));
      this.keyPan(dt);
      this.scene.render(this.s, layoutStamp(), dt * (this.speed ? 1 : 0), this.ghost(), this.hover, this.selected);
      if (t - this.lastPanel > 400) {
        this.lastPanel = t;
        this.renderTopbar();
        this.renderTicker();
        this.renderWarnings();
        const typing = document.activeElement instanceof HTMLInputElement && this.$('#view').contains(document.activeElement);
        if (!typing) this.renderPanel();
        updateBoards(this.$('#view'), this.s);
      }
      const day = Math.floor(this.s.minute / 1440);
      if (day !== this.lastSavedDay) { this.lastSavedDay = day; saveGame(this.s); }
      if (this.s.board.meeting && this.$('#overlay').hidden) this.showMeeting();
      if (this.s.gameOver && this.$('#overlay').hidden) this.showGameOver();
    }
    requestAnimationFrame((n) => this.frame(n));
  }

  // ---------------------------------------------------------------- input

  private bindInput(): void {
    const stage = this.$('#stage');
    stage.addEventListener('contextmenu', (e) => e.preventDefault());
    stage.addEventListener('pointerdown', (e) => {
      if (!this.s) return;
      const tile = this.tileAt(e);
      this.drag = { x: e.clientX, y: e.clientY, tile, button: e.button, moved: false };
      stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointermove', (e) => {
      if (!this.s) return;
      this.hover = this.tileAt(e);
      if (this.drag) {
        const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) this.drag.moved = true;
        const panning = this.drag.button === 2 || this.drag.button === 1 || (this.tool.t === 'select' && this.drag.moved);
        if (panning) {
          this.scene.panBy(dx, dy);
          this.drag.x = e.clientX;
          this.drag.y = e.clientY;
        }
      }
      this.updateTip(e);
    });
    stage.addEventListener('pointerup', (e) => {
      if (!this.s || !this.drag) return;
      const d = this.drag;
      this.drag = null;
      if (d.button === 2) { if (!d.moved) this.setTool({ t: 'select' }); return; }
      if (d.button !== 0) return;
      const tile = this.tileAt(e);
      this.applyTool(d.tile, tile, d.moved);
    });
    stage.addEventListener('pointerleave', () => { this.hover = null; this.$('#tip').hidden = true; });
    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      this.scene.zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
      if (!this.s || (e.target as HTMLElement).closest('input, select')) return;
      this.keys.add(e.key.toLowerCase());
      if (e.key === 'r' || e.key === 'R') { this.rot = (this.rot + 1) % 4; }
      else if (e.key === 'Escape') { this.setTool({ t: 'select' }); this.selected = null; this.renderPanel(); }
      else if (e.code === 'Space') { e.preventDefault(); this.setSpeed(this.speed ? 0 : 1); }
      else if (/^Digit[0-4]$/.test(e.code)) this.setSpeed(Number(e.code.slice(5)));
      else if (e.key === 'b') this.setTool({ t: 'bulldoze' });
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.s) saveGame(this.s); });
  }

  private keyPan(dt: number): void {
    const v = 600 * dt;
    if (this.keys.has('w') || this.keys.has('arrowup')) this.scene.panBy(0, v);
    if (this.keys.has('s') || this.keys.has('arrowdown')) this.scene.panBy(0, -v);
    if (this.keys.has('a') || this.keys.has('arrowleft')) this.scene.panBy(v, 0);
    if (this.keys.has('d') || this.keys.has('arrowright')) this.scene.panBy(-v, 0);
  }

  private tileAt(e: PointerEvent): [number, number] {
    const r = this.$('#stage').getBoundingClientRect();
    const [gx, gy] = this.scene.toGrid(e.clientX - r.left, e.clientY - r.top);
    return [Math.floor(gx), Math.floor(gy)];
  }

  private buildOrigin(kind: ModuleKind, tile: [number, number]): [number, number] {
    const { w, h } = footprint(kind, this.rot);
    return [tile[0] - Math.floor(w / 2), tile[1] - Math.floor(h / 2)];
  }

  private ghost(): Ghost | null {
    if (!this.hover) return null;
    const t = this.tool;
    if (t.t === 'build') {
      const [x, y] = this.buildOrigin(t.kind, this.hover);
      return { kind: t.kind, x, y, rot: this.rot, ok: checkPlace(this.s, t.kind, x, y, this.rot).ok };
    }
    if ((t.t === 'paint' || t.t === 'bulldoze') && this.drag && this.drag.button === 0) {
      return { x: 0, y: 0, rot: 0, ok: t.t === 'paint', rect: [this.drag.tile[0], this.drag.tile[1], this.hover[0], this.hover[1]] };
    }
    if (t.t === 'paint' || t.t === 'bulldoze') return { x: 0, y: 0, rot: 0, ok: t.t === 'paint' ? paintCheck(this.s, t.paint, ...this.hover) : true, rect: [...this.hover, ...this.hover] };
    return null;
  }

  private applyTool(a: [number, number], b: [number, number], moved: boolean): void {
    const t = this.tool;
    if (t.t === 'select') {
      if (moved) return;
      const id = getLayout(this.s).occ[idx(this.s, Math.max(0, Math.min(this.s.W - 1, b[0])), Math.max(0, Math.min(this.s.H - 1, b[1])))];
      const rw = runway(this.s);
      const onRunway = rw && b[0] >= rw.x && b[0] < rw.x + rw.w && b[1] >= rw.y && b[1] < rw.y + rw.h;
      this.selected = id ? getLayout(this.s).byId.get(id) ?? null : onRunway ? rw! : null;
      if (this.selected?.kind === 'tree') this.selected = null;
      this.renderPanel();
      return;
    }
    if (t.t === 'build') {
      const [x, y] = this.buildOrigin(t.kind, b);
      const r = place(this.s, t.kind, x, y, this.rot);
      if (!r.ok) this.toast(r.reason ?? 'Cannot build here', 'err');
      else if (t.kind === 'runway' || t.kind === 'tower') this.setTool({ t: 'select' });
      return;
    }
    if (t.t === 'paint') {
      const n = paintRect(this.s, t.paint, a[0], a[1], b[0], b[1]);
      if (!n) this.toast(this.s.cash < PAINTS[t.paint].costPerTile ? 'Not enough cash' : 'Nothing to paint there', 'err');
      return;
    }
    if (t.t === 'bulldoze') {
      let msg: string | null = null;
      for (let y = Math.min(a[1], b[1]); y <= Math.max(a[1], b[1]); y++) for (let x = Math.min(a[0], b[0]); x <= Math.max(a[0], b[0]); x++) msg = bulldozeAt(this.s, x, y) ?? msg;
      if (msg) this.toast(msg);
      this.selected = null;
    }
  }

  private setTool(t: Tool): void {
    this.tool = t;
    if (t.t !== 'select') this.selected = null;
    this.renderPalette();
  }

  private setSpeed(n: number): void {
    this.speed = n;
    this.renderTopbar();
  }

  private updateTip(e: PointerEvent): void {
    const tip = this.$('#tip');
    const t = this.tool;
    if (t.t === 'build' && this.hover) {
      const [x, y] = this.buildOrigin(t.kind, this.hover);
      const c = checkPlace(this.s, t.kind, x, y, this.rot);
      tip.innerHTML = `<b>${MODULES[t.kind].name}</b> ${money(c.cost)}${c.ok ? '' : `<div class="neg">${esc(c.reason ?? '')}</div>`}${MODULES[t.kind].rotatable ? '<div class="muted">R to rotate</div>' : ''}`;
    } else if (t.t === 'paint' && this.drag) {
      const [a, b] = [this.drag.tile, this.hover ?? this.drag.tile];
      const n = (Math.abs(a[0] - b[0]) + 1) * (Math.abs(a[1] - b[1]) + 1);
      tip.innerHTML = `<b>${PAINTS[t.paint].name}</b> up to ${money(n * PAINTS[t.paint].costPerTile)}`;
    } else { tip.hidden = true; return; }
    const r = this.$('#stage').getBoundingClientRect();
    tip.style.left = `${e.clientX - r.left + 16}px`;
    tip.style.top = `${e.clientY - r.top + 16}px`;
    tip.hidden = false;
  }

  // ---------------------------------------------------------------- clicks

  private onClick(e: MouseEvent): void {
    const el = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!el) return;
    const d = el.dataset;
    switch (d.act) {
      case 'tool': {
        if (d.build) this.setTool({ t: 'build', kind: d.build as ModuleKind });
        else if (d.paint) this.setTool({ t: 'paint', paint: d.paint as PaintKind });
        else if (d.tool === 'bulldoze') this.setTool({ t: 'bulldoze' });
        else this.setTool({ t: 'select' });
        return;
      }
      case 'rotate': this.rot = (this.rot + 1) % 4; return;
      case 'speed': return this.setSpeed(Number(d.speed));
      case 'tab': this.tab = d.tab as Tab; this.selected = null; return this.renderPanel();
      case 'accept': { const err = acceptOffer(this.s, Number(d.id)); if (err) this.toast(err, 'err'); else this.toast('Contract signed'); return this.renderPanel(); }
      case 'decline': declineOffer(this.s, Number(d.id)); return this.renderPanel();
      case 'deselect': this.selected = null; return this.renderPanel();
      case 'demolish': {
        if (!this.selected) return;
        const b = this.selected;
        const msg = bulldozeAt(this.s, b.x + Math.floor(b.w / 2), b.y + Math.floor(b.h / 2));
        if (msg) this.toast(msg);
        this.selected = null;
        return this.renderPanel();
      }
      case 'board-ok': this.s.board.meeting = null; return this.overlay(null);
      case 'start': return this.startFromForm();
      case 'continue': { const g = loadGame(); if (g) this.start(g); return; }
      case 'new': return this.showStart();
    }
  }

  // ---------------------------------------------------------------- chrome

  private renderChrome(): void {
    this.renderTopbar();
    this.renderPalette();
    this.renderTicker();
  }

  private renderTopbar(): void {
    const s = this.s;
    const day = Math.floor(s.minute / 1440) + 1;
    const prog = progress(s);
    const net = income(s.today) - s.today.upkeep;
    this.$('#topbar').innerHTML = `
      <div class="brand">${logoMark()}<span>${esc(s.name)}</span><span class="code">${esc(s.code)}</span></div>
      <div class="stat"><span>Cash</span><b class="${s.cash < 0 ? 'neg' : ''}">${money(s.cash)}</b></div>
      <div class="stat hide-sm"><span>Today</span><b class="${net < 0 ? 'neg' : 'pos'}">${net >= 0 ? '+' : ''}${money(net)}</b></div>
      <div class="stat"><span>Rating</span><b>${Math.round(s.rating)}</b></div>
      <div class="stat hide-sm"><span>Passengers</span><b>${num(s.pax.length)}</b></div>
      <button class="objective-chip hide-sm" data-act="tab" data-tab="airport" title="Board objective">${icon('target')}<span>${esc(s.board.objective.label)}</span><span class="mini-progress"><i style="width:${Math.min(100, prog.value * 100)}%"></i></span></button>
      <div class="spacer"></div>
      <div class="clock"><span>Day ${day}</span><b>${clock(s.minute)}</b></div>
      <div class="speed">${SPEED_LABEL.map((l, i) => `<button class="${this.speed === i ? 'on' : ''}" data-act="speed" data-speed="${i}" title="${i ? `Speed ${i}` : 'Pause (Space)'}">${i ? l : icon('pause')}</button>`).join('')}</div>
      <button class="icon" data-act="new" title="New game">${icon('menu')}</button>`;
  }

  private renderPalette(): void {
    const t = this.tool;
    const active = (item: { build: ModuleKind } | { paint: PaintKind }) => ('build' in item ? t.t === 'build' && t.kind === item.build : t.t === 'paint' && t.paint === item.paint);
    const btn = (item: { build: ModuleKind } | { paint: PaintKind }) => {
      const key = 'build' in item ? item.build : item.paint;
      const name = 'build' in item ? MODULES[item.build].name : PAINTS[item.paint].name;
      const cost = 'build' in item ? money(MODULES[item.build].cost) : `${money(PAINTS[item.paint].costPerTile)}/tile`;
      const desc = 'build' in item ? MODULES[item.build].desc : PAINTS[item.paint].desc;
      const thumb = 'build' in item ? Scene.thumb(item.build) : null;
      return `<button class="tool ${active(item) ? 'on' : ''}" data-act="tool" ${'build' in item ? `data-build="${key}"` : `data-paint="${key}"`} title="${esc(`${name} · ${cost}\n${desc}`)}">
        ${thumb ? `<img src="${thumb}" alt="">` : `<span class="tool-ico">${icon(ITEM_ICON[key] ?? 'stand')}</span>`}<span class="tool-name">${esc(name)}</span><span class="tool-cost">${cost}</span></button>`;
    };
    this.$('#palette').innerHTML = `
      <div class="tools-top">
        <button class="tool sq ${t.t === 'select' ? 'on' : ''}" data-act="tool" data-tool="select" title="Select and pan (Esc)">${icon('select')}</button>
        <button class="tool sq ${t.t === 'bulldoze' ? 'on' : ''}" data-act="tool" data-tool="bulldoze" title="Bulldoze (B): drag over things to remove">${icon('bulldoze')}</button>
        <button class="tool sq" data-act="rotate" title="Rotate (R)">${icon('rotate')}</button>
      </div>
      ${PALETTE.map((g) => `<div class="pal-group"><div class="pal-h">${g.label}</div>${g.items.map(btn).join('')}</div>`).join('')}`;
  }

  private renderTicker(): void {
    const n = this.s.news[0];
    this.$('#ticker').innerHTML = n ? `<span class="tone ${n.tone}"></span><span class="muted mono">Day ${Math.floor(n.min / 1440) + 1} ${clock(n.min)}</span> ${esc(n.text)}` : '';
  }

  private computeWarnings(): string[] {
    const s = this.s;
    const w: string[] = [];
    const has = (k: ModuleKind) => s.buildings.some((b) => b.kind === k);
    if (!runway(s)) w.push('No runway: aircraft cannot land.');
    if (!hasTower(s)) w.push('No control tower: flights will be cancelled.');
    if (!has('entrance')) w.push('No terminal entrance: passengers cannot get in.');
    if (has('entrance') && !has('checkin')) w.push('No check-in desks.');
    if (has('entrance') && !has('security')) w.push('No security lane.');
    if (!has('gate')) w.push('No gates for boarding.');
    const stands = s.buildings.filter((b) => b.kind.startsWith('stand_'));
    const reach = reachableStands(s);
    const cut = stands.filter((b) => !reach.has(b.id)).length;
    if (stands.length && runway(s) && cut) w.push(`${cut} stand${cut > 1 ? 's' : ''} not connected to the runway by taxiway.`);
    const noGate = stands.filter((b) => !b.link).length;
    if (noGate) w.push(`${noGate} stand${noGate > 1 ? 's have' : ' has'} no gate within reach (passengers will be bussed).`);
    const entrance = s.buildings.find((b) => b.kind === 'entrance');
    if (entrance) {
      const [ex, ey] = accessTile(entrance);
      if (!walkable(s, ex, ey)) w.push('The entrance must open onto free terminal floor.');
      for (const g of s.buildings.filter((b) => b.kind === 'gate')) {
        if (distanceTo(s, g, ex + 0.5, ey + 0.5) >= UNREACHABLE) w.push(`${gateLabel(s, g.id)} cannot be reached from the entrance.`);
      }
    }
    const types = new Set(s.contracts.map((c) => c.typeId));
    for (const tId of types) if (!stands.some((b) => standFits(b.kind, tId))) w.push(`No stand big enough for the ${acType(tId).name} (needs ${standClassFor(tId).toUpperCase()}).`);
    return w;
  }

  private renderWarnings(): void {
    if (this.warnStamp !== layoutStamp() || Math.random() < 0.2) {
      this.warnStamp = layoutStamp();
      this.warnings = this.computeWarnings();
    }
    this.$('#warnings').innerHTML = this.warnings.slice(0, 5).map((w) => `<div class="warn-item">${icon('alert')}${esc(w)}</div>`).join('');
  }

  // ---------------------------------------------------------------- panel

  private renderPanel(): void {
    if (!this.s) return;
    const tabs: [Tab, string][] = [['airport', 'Airport'], ['airlines', 'Airlines'], ['flights', 'Flights'], ['money', 'Money']];
    this.$('#tabs').innerHTML = tabs.map(([k, l]) => `<button class="${!this.selected && this.tab === k ? 'on' : ''}" data-act="tab" data-tab="${k}">${l}${k === 'airlines' && this.s.offers.length ? `<span class="badge-n">${this.s.offers.length}</span>` : ''}</button>`).join('');
    const view = this.$('#view');
    const scroll = view.scrollTop;
    const wasBoard = view.querySelector('[data-board]');
    let html: string;
    if (this.selected) html = this.inspector(this.selected);
    else if (this.tab === 'airport') html = this.airportView();
    else if (this.tab === 'airlines') html = this.airlinesView();
    else if (this.tab === 'flights') html = this.flightsView();
    else html = this.moneyView();
    if (wasBoard && this.tab === 'flights' && !this.selected) {
      // keep the split-flap board alive so it can animate; refresh the rest
      const rest = view.querySelector('[data-rest]');
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      const nrest = tmp.querySelector('[data-rest]');
      if (rest && nrest) { rest.replaceWith(nrest); return; }
    }
    view.innerHTML = html;
    view.scrollTop = scroll;
    updateBoards(view, this.s);
  }

  private kpi(label: string, value: string, cls = ''): string {
    return `<div class="kpi"><div class="kpi-label">${label}</div><div class="kpi-value ${cls}">${value}</div></div>`;
  }

  private airportView(): string {
    const s = this.s;
    const has = (k: ModuleKind) => s.buildings.some((b) => b.kind === k);
    const steps: [boolean, string, string][] = [
      [has('runway'), 'Build a runway', 'Airside → Runway. It is long: place it across the top of the site. Press R to rotate.'],
      [has('tower'), 'Build a control tower', 'Airside → Control tower, on grass anywhere.'],
      [has('entrance') && has('checkin') && has('security') && has('gate'), 'Build a terminal', 'Paint Terminal floor near the road, then add an Entrance on its road side, Check-in, a Security lane and a Gate near the airside edge.'],
      [s.buildings.some((b) => b.kind.startsWith('stand_') && b.link) && reachableStands(s).size > 0, 'Add a stand and taxiway', 'Place a stand next to the gate (the yellow square shows where aircraft enter) and paint taxiways linking it to the runway.'],
      [s.contracts.length > 0, 'Sign an airline', 'Open the Airlines tab and accept an offer your stands can handle.'],
    ];
    const next = steps.findIndex(([d]) => !d);
    const b = s.board;
    const prog = progress(s);
    const yesterday = s.history[s.history.length - 1];
    return `
      ${next >= 0 ? `<section class="card onboarding"><h3>${icon('info')} Getting started</h3><ol>${steps.map(([d, t, body], i) => `<li class="${d ? 'done' : i === next ? 'next' : ''}"><div><b>${t}</b>${i === next ? `<p>${body}</p>` : ''}</div></li>`).join('')}</ol></section>` : ''}
      <section class="kpis">
        ${this.kpi('Rating', `${Math.round(s.rating)}`)}
        ${this.kpi('In terminal', num(s.pax.length))}
        ${this.kpi('Departures today', num(s.today.departures))}
        ${this.kpi('Airlines', num(new Set(s.contracts.map((c) => c.airline)).size))}
        ${this.kpi('Profit yesterday', yesterday ? money(profit(yesterday)) : '—', yesterday && profit(yesterday) < 0 ? 'neg' : 'pos')}
        ${this.kpi('Upkeep / day', money(upkeepPerDay(s)))}
      </section>
      <section class="card objective"><h3>${icon('target')} Board objective · ${weekLabel(s)}</h3>
        <p><b>${esc(b.objective.label)}</b></p>
        <div class="progress"><i style="width:${Math.min(100, prog.value * 100)}%"></i></div>
        <div class="row small muted"><span>${prog.text}</span><span>Reward ${money(b.objective.reward)}</span></div>
        <div class="conf"><span>Board confidence</span><div class="meter ${b.confidence < 30 ? 'low' : b.confidence < 60 ? 'mid' : 'high'}"><i style="width:${b.confidence}%"></i></div><b>${Math.round(b.confidence)}</b></div>
      </section>
      <section class="card"><h3>Latest news</h3><ul class="news">${s.news.slice(0, 6).map((n) => `<li class="${n.tone}"><span class="muted mono">D${Math.floor(n.min / 1440) + 1} ${clock(n.min)}</span> ${esc(n.text)}</li>`).join('')}</ul></section>`;
  }

  private airlinesView(): string {
    const s = this.s;
    const stands = s.buildings.filter((b) => b.kind.startsWith('stand_'));
    const offer = s.offers.map((o) => {
      const fits = stands.some((b) => standFits(b.kind, o.typeId));
      const locked = s.rating < o.minRating;
      return `<div class="offer">
        <div class="offer-h"><span class="chip" style="--c:${airlineColor(o.airline)}">${o.airline}</span><b>${esc(airlineName(o.airline))}</b><span class="muted small">expires day ${o.expires + 1}</span></div>
        <div class="offer-b">${icon('plane')} ${o.perDay}× daily to <b>${esc(airport(o.dest).city)}</b> (${o.dest}) · ${esc(acType(o.typeId).name)} · needs stand ${standClassFor(o.typeId).toUpperCase()}</div>
        <div class="offer-b muted small">~${num(o.perDay * 2 * Math.round(acType(o.typeId).maxSeats * 0.85 * o.load))} passengers a day${locked ? ` · requires rating ${o.minRating}` : ''}${fits ? '' : ' · you have no stand this size yet'}</div>
        <div class="actions"><button class="btn primary sm" data-act="accept" data-id="${o.id}" ${locked ? 'disabled' : ''}>Accept</button><button class="btn sm" data-act="decline" data-id="${o.id}">Decline</button></div>
      </div>`;
    }).join('');
    const contracts = s.contracts.map((c) => `<tr><td><span class="chip" style="--c:${airlineColor(c.airline)}">${c.airline}</span> ${esc(airport(c.dest).city)}</td><td class="small">${esc(acType(c.typeId).name)}</td><td class="r">${c.perDay}×</td><td class="r"><span class="${c.happiness < 35 ? 'neg' : c.happiness < 60 ? 'warn' : 'pos'}">${Math.round(c.happiness)}%</span></td></tr>`).join('');
    return `<h2>Airline offers</h2>
      ${offer || '<p class="muted">No offers right now. New offers arrive each morning; a better rating attracts bigger airlines.</p>'}
      <h2>Contracts</h2>
      ${contracts ? `<table class="tbl"><thead><tr><th>Route</th><th>Aircraft</th><th class="r">Daily</th><th class="r">Happy</th></tr></thead><tbody>${contracts}</tbody></table>` : '<p class="muted">No airlines yet.</p>'}
      <p class="small muted">Airlines get unhappy with delays, cancellations and passengers missing flights. Below 15% they leave.</p>`;
  }

  private flightsView(): string {
    const s = this.s;
    const list = s.flights.filter((f) => f.dep >= s.minute - 60 && f.dep <= s.minute + 24 * 60).sort((a, b) => a.dep - b.dep).slice(0, 30);
    return `${boardShell(8)}<div data-rest><h2>Today and tomorrow</h2>
      ${list.length ? `<table class="tbl"><thead><tr><th>Dep</th><th>Flight</th><th>To</th><th>Gate</th><th>Status</th><th class="r">Pax</th></tr></thead><tbody>${list.map((f) => `<tr><td class="mono">${clock(f.dep)}</td><td><span class="chip" style="--c:${airlineColor(f.airline)}">${f.number}</span></td><td>${esc(airport(f.dest).city)}</td><td>${gateLabel(s, gateOf(s, f)?.id) || '—'}</td><td class="small">${statusOf(s, f)}</td><td class="r">${f.phase === 'departed' ? `${f.boarded}/${f.paxOut}` : f.paxOut}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No flights scheduled. Sign an airline in the Airlines tab.</p>'}</div>`;
  }

  private moneyView(): string {
    const s = this.s;
    const days = [...s.history.slice(-6), { ...s.today, day: Math.floor(s.minute / 1440) }];
    const max = Math.max(1, ...days.map((d) => Math.max(income(d), d.upkeep + d.construction)));
    const rows: [string, number][] = [['Landing fees', s.today.landing], ['Passenger fees', s.today.paxFees], ['Food', s.today.food], ['Shops', s.today.retail], ['Parking', s.today.parking], ['Upkeep and staff', -s.today.upkeep], ['Construction', -s.today.construction]];
    return `<h2>Money</h2>
      <section class="kpis">${this.kpi('Cash', money(s.cash), s.cash < 0 ? 'neg' : '')}${this.kpi('Upkeep / day', money(upkeepPerDay(s)))}${this.kpi('Income today', money(income(s.today)), 'pos')}</section>
      <section class="card"><h3>Today so far</h3><table class="tbl"><tbody>${rows.map(([k, v]) => `<tr><td>${k}</td><td class="r ${v < 0 ? 'neg' : v > 0 ? 'pos' : ''}">${money(v)}</td></tr>`).join('')}<tr class="total"><td><b>Net</b></td><td class="r"><b>${money(profit(s.today))}</b></td></tr></tbody></table></section>
      <section class="card"><h3>Last 7 days</h3><div class="bars">${days.map((d) => `<div class="bar-col" title="Day ${d.day + 1}: income ${money(income(d))}, costs ${money(d.upkeep + d.construction)}"><i class="inc" style="height:${(income(d) / max) * 100}%"></i><i class="cost" style="height:${((d.upkeep + d.construction) / max) * 100}%"></i><span>D${d.day + 1}</span></div>`).join('')}</div>
      <div class="legend"><span class="inc">Income</span><span class="cost">Costs</span></div></section>`;
  }

  private inspector(b: Building): string {
    const s = this.s;
    const m = MODULES[b.kind];
    const stats: string[] = [];
    if (m.servers) stats.push(this.kpi('Queue', num(queueLength(b.id))), this.kpi('Being served', `${Math.min(m.servers, usersOf(b.id))}/${m.servers}`), this.kpi('Service time', `${m.serviceMin} min`));
    if (m.capacity && !m.servers) stats.push(this.kpi('In use', `${usersOf(b.id)}/${m.capacity}`));
    if (m.spend) stats.push(this.kpi('Avg spend', money(m.spend)));
    let extra = '';
    if (b.kind === 'gate' || b.kind.startsWith('stand_')) {
      const stand = b.kind === 'gate' ? (b.link ? getLayout(s).byId.get(b.link) : undefined) : b;
      const flights = stand ? s.flights.filter((f) => f.stand === stand.id && f.phase !== 'departed' && f.phase !== 'cancelled').sort((a, c) => a.arr - c.arr).slice(0, 5) : [];
      extra = `<section class="card"><h3>${b.kind === 'gate' ? `Gate ${gateLabel(s, b.id)}` : 'Stand'}</h3>
        <p class="small muted">${b.link ? `Linked to ${b.kind === 'gate' ? 'a stand' : `gate ${gateLabel(s, b.link)}`}.` : b.kind === 'gate' ? 'No stand within reach yet.' : 'No gate within reach: passengers walk to another gate and are bussed.'}${b.kind.startsWith('stand_') && !reachableStands(s).has(b.id) ? ' <span class="neg">Not connected to the runway.</span>' : ''}</p>
        ${flights.length ? `<table class="tbl"><tbody>${flights.map((f) => `<tr><td class="mono">${clock(f.arr)}–${clock(f.dep)}</td><td><span class="chip" style="--c:${airlineColor(f.airline)}">${f.number}</span></td><td class="small">${statusOf(s, f)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted small">No flights assigned.</p>'}</section>`;
    }
    if (b.kind === 'runway') extra = `<p class="muted small">${hasTower(s) ? 'Operating.' : '<span class="neg">Needs a control tower to operate.</span>'}</p>`;
    return `<button class="back" data-act="deselect">← Back</button>
      <div class="insp-h">${m.sprite ? `<img src="${Scene.thumb(b.kind)}" alt="">` : `<span class="tool-ico big">${icon(ITEM_ICON[b.kind] ?? 'stand')}</span>`}<div><h2>${esc(m.name)}</h2><p class="muted small">${esc(m.desc)}</p></div></div>
      ${stats.length ? `<section class="kpis">${stats.join('')}</section>` : ''}
      ${extra}
      <p class="small muted">Upkeep ${money(m.upkeep)}/day</p>
      <div class="actions"><button class="btn danger" data-act="demolish">${icon('bulldoze')} Demolish (refund ${money(m.cost * 0.4)})</button></div>`;
  }

  // ---------------------------------------------------------------- overlays

  private overlay(html: string | null): void {
    const o = this.$('#overlay');
    o.hidden = html === null;
    o.innerHTML = html ?? '';
  }

  private toast(msg: string, kind: 'ok' | 'err' = 'ok'): void {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = msg;
    this.$('#toasts').append(t);
    setTimeout(() => t.remove(), 3000);
  }

  private showMeeting(): void {
    const m = this.s.board.meeting!;
    const c = this.s.board.confidence;
    this.overlay(`<div class="modal small"><h2>${icon('board')} ${esc(m.title)}</h2><div class="banner ${m.success ? 'good' : 'bad'}">${esc(m.summary)}</div>
      <div class="conf"><span>Board confidence</span><div class="meter ${c < 30 ? 'low' : c < 60 ? 'mid' : 'high'}"><i style="width:${c}%"></i></div><b>${Math.round(c)}</b></div>
      <p>Next week: <b>${esc(m.next)}</b></p><div class="actions"><button class="btn primary" data-act="board-ok">Back to work</button></div></div>`);
  }

  private showGameOver(): void {
    this.overlay(`<div class="modal small"><h2>Game over</h2><p>${esc(this.s.news[0]?.text ?? '')}</p><div class="actions"><button class="btn primary" data-act="new">New airport</button></div></div>`);
  }

  private showStart(): void {
    const cities = [...AIRPORTS].sort((a, b) => b.pop * b.wealth - a.pop * a.wealth);
    this.overlay(`<div class="modal start">
      <div class="hero"><h1>${logoMark()}AIRWAYS</h1><p>Build an airport from an empty field. Sign real airlines, park real aircraft, and keep every passenger moving.</p></div>
      ${hasSave() ? '<div class="continue"><button class="btn primary big" data-act="continue">Continue saved airport</button><span class="muted">or start a new one</span></div>' : ''}
      <div class="form-grid">
        <label>Airport name<input id="ng-name" value="Copenhagen North" maxlength="30"></label>
        <label>Code<input id="ng-code" value="CPN" maxlength="3" class="upper"></label>
        <label class="wide">Near which city<select id="ng-city">${cities.map((a) => `<option value="${a.iata}" ${a.iata === 'CPH' ? 'selected' : ''}>${esc(a.city)} (${a.country})</option>`).join('')}</select></label>
      </div>
      <div class="actions"><button class="btn primary big" data-act="start">Break ground</button></div>
      <p class="muted small">Drag to pan, scroll to zoom, R to rotate, Space to pause. Bigger and richer cities bring more demand.</p>
    </div>`);
  }

  private startFromForm(): void {
    const name = (this.$('#ng-name') as HTMLInputElement).value.trim() || 'New Airport';
    const code = ((this.$('#ng-code') as HTMLInputElement).value.trim().toUpperCase() || 'NEW').slice(0, 3);
    const city = (this.$('#ng-city') as HTMLSelectElement).value;
    const s = createGame({ name, code, city });
    saveGame(s);
    this.start(s);
  }
}
