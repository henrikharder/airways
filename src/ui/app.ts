import { AIRCRAFT } from '../data/aircraft';
import { AIRLINES } from '../data/airlines';
import { AIRPORTS, airport, type Region } from '../data/airports';
import * as act from '../engine/actions';
import { createGame, START_CASH, type NewGameOptions } from '../engine/newgame';
import { hasSave, loadGame, parseSave, saveGame } from '../engine/save';
import { simulateDay } from '../engine/sim';
import { companyValue, player } from '../engine/state';
import { formatDate } from '../engine/time';
import { ACHIEVEMENTS } from '../engine/achievements';
import { objectiveProgress } from '../engine/board';
import { resolveDecision } from '../engine/decisions';
import type { Aircraft, Difficulty, GameState, Livery, LiveryPattern, ServiceLevel } from '../engine/types';
import { liveryOf, seatMap } from './aircraftArt';
import { updateBoards } from './departures';
import { esc, money, signClass } from './format';
import { WorldMap } from './map';
import { boardModal, decisionModal, deliveryCard, flightCard, liveryModal, milestoneModal } from './modals';
import { poster } from './posters';
import { Sound } from './sound';
import { icon, logoMark } from './icons';
import {
  defaultView, estimateBox, isAirport, plannerEstimate, renderView, routeEstimate, tabOf, TABS, type View,
} from './views';

const SPEEDS = [0, 30, 120, 480, 1440]; // game minutes per real second
const SPEED_LABEL = ['', '1×', '2×', '3×', '4×'];
const COLORS = ['#ff4f7b', '#2ec4b6', '#ffb703', '#8e7dff', '#06d6a0', '#ff7f11', '#4cc9f0', '#f72585'];

export class App {
  s!: GameState;
  map!: WorldMap;
  view: View = { kind: 'overview' };
  private stack: View[] = [];
  private speed = 0;
  private last = 0;
  private dirtyRoutes = true;
  private sound = new Sound();
  private resumeSpeed = 0;
  private seenAchievements = 0;
  private liveryDraft: Livery | null = null;
  private lastBoards = 0;
  private lastCard = 0;
  private hoverAc: Aircraft | null = null;
  private hoverXY: [number, number] = [0, 0];
  private animateView = false;
  private counters = new Map<string, number>();

  constructor(private root: HTMLElement) {
    root.innerHTML = `
      <header id="topbar"></header>
      <main><div id="map"></div><aside id="panel"><nav id="tabs"></nav><div id="view"></div></aside></main>
      <footer id="ticker"></footer>
      <div id="toasts"></div><div id="deliveries"></div><div id="overlay" hidden></div>
      <datalist id="airport-list">${AIRPORTS.map((a) => `<option value="${a.iata}">${esc(a.city)} · ${esc(a.name)}</option>`).join('')}</datalist>`;
    this.bindEvents();
    const saved = loadGame();
    this.showStart(!!saved);
  }

  // ---------- lifecycle ----------

  start(s: GameState): void {
    this.s = s;
    this.overlay(null);
    if (!this.map) {
      this.map = new WorldMap(this.$('#map'), {
        onAirport: (code) => this.airportClicked(code),
        onRoute: (id) => this.open({ kind: 'route', id }),
        onHover: (ac, x, y) => { this.hoverAc = ac; this.hoverXY = [x, y]; this.renderHoverCard(); },
        onSelect: () => this.renderPinnedCard(),
        onTakeoff: () => { if (this.speed > 0 && this.speed <= 2) this.sound.whoosh(); },
        onLanding: (_ac, revenue) => { if (revenue > 0 && this.speed > 0) this.sound.cash(); },
      });
      this.$('#map').insertAdjacentHTML('beforeend', '<div id="flight-hover" class="flight-card hover" hidden></div><div id="flight-pin" class="flight-card pinned" hidden></div>');
      requestAnimationFrame((t) => this.frame(t));
    }
    this.seenAchievements = s.achievements.length;
    this.map.select(null);
    this.view = { kind: 'overview' };
    this.stack = [];
    this.speed = 0;
    this.dirtyRoutes = true;
    this.map.focus(player(s).bases[0]);
    this.refresh();
    this.nextModal();
  }

  private frame(t: number): void {
    const dt = Math.min(0.1, (t - (this.last || t)) / 1000);
    this.last = t;
    if (this.s && this.speed > 0 && !this.s.gameOver) {
      this.s.minute += dt * SPEEDS[this.speed];
      let days = 0;
      while (Math.floor(this.s.minute / 1440) > this.s.day && days < 3) {
        simulateDay(this.s);
        days++;
        this.afterDay();
        if (this.s.day % 7 === 0) saveGame(this.s);
      }
      if (Math.floor(this.s.minute / 1440) > this.s.day) this.s.minute = (this.s.day + 1) * 1440 - 1;
      if (days) {
        this.dirtyRoutes = true;
        this.refresh(true);
        if (this.s.gameOver) this.showGameOver();
        else this.nextModal();
      }
    }
    if (this.s) {
      if (this.dirtyRoutes) { this.map.update(this.s); this.dirtyRoutes = false; }
      this.map.frame(this.s);
      this.renderClock();
      if (t - this.lastBoards > 300) {
        this.lastBoards = t;
        const flips = updateBoards(this.$('#view'), this.s);
        if (this.speed > 0) this.sound.flap(flips);
      }
      if (t - this.lastCard > 250) {
        this.lastCard = t;
        this.renderPinnedCard();
        if (this.hoverAc) this.renderHoverCard();
      }
    }
    requestAnimationFrame((n) => this.frame(n));
  }

  // ---------- rendering ----------

  private $(sel: string): HTMLElement {
    return this.root.querySelector(sel) as HTMLElement;
  }

  /** Re-render chrome and the panel. On a tick, skip the panel while the player is typing in it. */
  refresh(tick = false): void {
    this.renderTopbar();
    this.renderTicker();
    const viewEl = this.$('#view');
    const typing = tick && viewEl.contains(document.activeElement) && document.activeElement instanceof HTMLInputElement;
    if (!typing) {
      const scroll = viewEl.scrollTop;
      if (this.view.kind === 'planner' && tick) return; // keep planner stable while time runs
      viewEl.innerHTML = `${this.stack.length ? `<button class="back" data-act="back">${icon('back')} Back</button>` : ''}${renderView(this.s, this.view)}`;
      viewEl.scrollTop = scroll;
      updateBoards(viewEl, this.s);
      this.animateCounters(viewEl, !this.animateView);
      if (this.animateView) {
        this.animateView = false;
        viewEl.classList.remove('enter');
        void viewEl.offsetWidth;
        viewEl.classList.add('enter');
      }
    }
    const tab = tabOf(this.view);
    this.$('#tabs').innerHTML = TABS.map((t) => `<button class="${t.kind === tab ? 'on' : ''}" data-act="tab" data-kind="${t.kind}">${t.label}</button>`).join('');
  }

  private renderTopbar(): void {
    const p = player(this.s);
    this.$('#topbar').innerHTML = `
      <div class="brand">${logoMark()}<span>AIRWAYS</span></div>
      <button class="airline" data-act="livery" title="Livery designer"><span class="chip" style="--c:${p.color}">${esc(p.code)}</span><b>${esc(p.name)}</b></button>
      <div class="stat"><span>Cash</span><b class="${signClass(p.cash)}">${money(p.cash)}</b></div>
      <div class="stat hide-sm"><span>Value</span><b>${money(companyValue(this.s, p))}</b></div>
      <div class="stat hide-sm"><span>Reputation</span><b>${Math.round(p.reputation)}</b></div>
      <div class="stat hide-sm"><span>Fuel</span><b>$${(this.s.fuelPrice * 1000).toFixed(0)}/t${this.s.fuelLock && this.s.fuelLock.until > this.s.day ? ` ${icon('lock')}` : ''}</b></div>
      ${this.objectiveChip()}
      <div class="spacer"></div>
      <div class="clock"><span id="clock-date"></span><span id="clock-time" class="muted"></span></div>
      <div class="speed">${SPEED_LABEL.map((l, i) => `<button class="${this.speed === i ? 'on' : ''}" data-act="speed" data-speed="${i}" title="${i === 0 ? 'Pause (Space)' : `Speed ${i} (${i})`}">${i === 0 ? icon('pause') : l}</button>`).join('')}</div>
      <button class="icon" data-act="sound" title="Sound ${this.sound.enabled ? 'on' : 'off'}">${icon(this.sound.enabled ? 'sound' : 'mute')}</button>
      <button class="icon" data-act="menu" title="Game menu">${icon('menu')}</button>`;
    this.renderClock();
  }

  /** Count numbers from their previous value to the new one. */
  private animateCounters(root: HTMLElement, fromPrevious: boolean): void {
    const fmt = (v: number, f: string) => (f === 'money' ? money(v) : f === 'pct' ? `${Math.round(v * 100)}%` : Math.round(v).toLocaleString('en-US'));
    root.querySelectorAll<HTMLElement>('[data-count]').forEach((el) => {
      const key = el.dataset.key!;
      const to = Number(el.dataset.count);
      const from = fromPrevious ? this.counters.get(key) ?? to : 0;
      this.counters.set(key, to);
      if (from === to) return;
      const t0 = performance.now();
      const step = (t: number) => {
        const k = Math.min(1, (t - t0) / 550);
        const e = 1 - (1 - k) ** 3;
        el.textContent = fmt(from + (to - from) * e, el.dataset.fmt!);
        if (k < 1 && el.isConnected) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  private objectiveChip(): string {
    const o = this.s.board.objective;
    const prog = objectiveProgress(this.s);
    const conf = this.s.board.confidence;
    return `<button class="objective-chip hide-sm" data-act="tab" data-kind="overview" title="Board objective · confidence ${Math.round(conf)}">
      ${icon('target')}<span>${esc(o.label)}</span><span class="mini-progress"><i style="width:${Math.min(100, prog.value * 100)}%"></i></span>
      <span class="conf-dot ${conf < 30 ? 'low' : conf < 60 ? 'mid' : 'high'}"></span></button>`;
  }

  private renderHoverCard(): void {
    const el = this.$('#flight-hover');
    const ac = this.hoverAc;
    if (!ac || ac.id === this.map.following) { el.hidden = true; return; }
    el.innerHTML = flightCard(this.s, ac, false);
    el.hidden = false;
    const mapRect = this.$('#map').getBoundingClientRect();
    const [x, y] = this.hoverXY;
    el.style.left = `${Math.min(x + 16, mapRect.width - 250)}px`;
    el.style.top = `${Math.min(y + 16, mapRect.height - 220)}px`;
  }

  private renderPinnedCard(): void {
    const el = this.$('#flight-pin');
    const ac = this.map.following ? this.s.aircraft.find((a) => a.id === this.map.following) : null;
    if (!ac) { el.hidden = true; return; }
    el.innerHTML = flightCard(this.s, ac, true);
    el.hidden = false;
  }

  /** Per-day UI side effects: deliveries and milestones. */
  private afterDay(): void {
    const s = this.s;
    for (const ac of s.aircraft) {
      if (ac.owner === s.playerCode && ac.readyDay === s.day) this.showDelivery(ac);
    }
  }

  private showDelivery(ac: Aircraft): void {
    const host = this.$('#deliveries');
    host.insertAdjacentHTML('beforeend', deliveryCard(this.s, ac));
    const card = host.lastElementChild as HTMLElement;
    this.sound.fanfare();
    setTimeout(() => card.classList.add('out'), 5500);
    setTimeout(() => card.remove(), 6200);
  }

  /** Show the next pending board meeting, decision or milestone, pausing the clock. */
  private nextModal(): void {
    const o = this.$('#overlay');
    if (!o.hidden || !this.s || this.s.gameOver) return;
    let html: string | null = null;
    if (this.s.board.meeting) html = boardModal(this.s);
    else if (this.s.decisions.length) html = decisionModal(this.s, this.s.decisions[0]);
    else if (this.s.achievements.length > this.seenAchievements) {
      const a = ACHIEVEMENTS.find((x) => x.id === this.s.achievements[this.seenAchievements])!;
      this.seenAchievements++;
      html = milestoneModal(this.s, a);
      this.sound.fanfare();
    }
    if (!html) {
      if (this.resumeSpeed) { this.setSpeed(this.resumeSpeed); this.resumeSpeed = 0; }
      return;
    }
    if (this.speed) { this.resumeSpeed = this.speed; this.setSpeed(0); }
    if (html.includes('decision')) this.sound.chime();
    this.overlay(html);
  }

  private closeModal(): void {
    this.overlay(null);
    this.refresh();
    this.nextModal();
  }

  private renderClock(): void {
    const d = this.$('#clock-date');
    if (!d) return;
    const m = Math.floor(this.s.minute % 1440);
    d.textContent = formatDate(Math.floor(this.s.minute / 1440));
    this.$('#clock-time').textContent = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }

  private renderTicker(): void {
    const n = this.s.news[0];
    this.$('#ticker').innerHTML = n ? `<span class="tone ${n.tone}"></span><span class="muted">${formatDate(n.day)}</span> ${esc(n.text)} <button class="link" data-act="tab" data-kind="news">More news</button>` : '';
  }

  toast(msg: string, kind: 'ok' | 'err' = 'ok'): void {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = msg;
    this.$('#toasts').append(t);
    setTimeout(() => t.remove(), 3500);
  }

  open(v: View, push = true): void {
    if (push && this.view.kind !== v.kind || push && JSON.stringify(this.view) !== JSON.stringify(v)) this.stack.push(this.view);
    if (this.stack.length > 20) this.stack.shift();
    this.view = v;
    this.animateView = true;
    this.highlightForView();
    this.refresh();
    this.$('#view').scrollTop = 0;
    this.root.classList.add('panel-open');
  }

  private openTab(kind: View['kind']): void {
    this.stack = [];
    this.view = defaultView(kind, this.s);
    this.animateView = true;
    this.highlightForView();
    this.refresh();
    this.$('#view').scrollTop = 0;
  }

  private highlightForView(): void {
    const v = this.view;
    if (v.kind === 'route') this.map.setHighlight({ routeId: v.id, pair: this.pairOf(v.id) }, this.s);
    else if (v.kind === 'planner' && v.to) this.map.setHighlight({ pair: [v.from, v.to] }, this.s);
    else if (v.kind === 'airport') this.map.setHighlight({ airport: v.code }, this.s);
    else if (v.kind === 'rival') this.map.setHighlight({ airline: v.code }, this.s);
    else this.map.setHighlight({}, this.s);
  }

  private pairOf(routeId: string): [string, string] | undefined {
    const r = this.s.routes.find((x) => x.id === routeId);
    return r ? [r.from, r.to] : undefined;
  }

  private airportClicked(code: string): void {
    if (this.view.kind === 'planner' && code !== this.view.from) {
      this.view = { ...this.view, to: code, fareY: undefined, fareJ: undefined };
      this.highlightForView();
      this.refresh();
      return;
    }
    this.open({ kind: 'airport', code });
  }

  /** Run a game action; show its error, or refresh on success. */
  private run(result: string | null | void, ok?: string): boolean {
    if (result) { this.toast(result, 'err'); return false; }
    if (ok) this.toast(ok);
    this.dirtyRoutes = true;
    this.refresh();
    return true;
  }

  // ---------- events ----------

  private bindEvents(): void {
    this.root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!el || (el as HTMLButtonElement).disabled) return;
      this.onAction(el.dataset.act!, el);
    });
    this.root.addEventListener('pointerdown', () => this.sound.unlock(), { capture: true });
    this.root.addEventListener('input', (e) => this.onInput(e.target as HTMLInputElement, false));
    this.root.addEventListener('change', (e) => this.onInput(e.target as HTMLInputElement, true));
    window.addEventListener('keydown', (e) => {
      if (!this.s || (e.target as HTMLElement).closest('input, select, textarea')) return;
      if (!this.$('#overlay').hidden) return;
      if (e.code === 'Space') { e.preventDefault(); this.setSpeed(this.speed ? 0 : 1); }
      else if (/^Digit[0-4]$/.test(e.code)) this.setSpeed(Number(e.code.slice(5)));
      else if (e.key === 'Escape' && this.stack.length) this.back();
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.s) saveGame(this.s); });
  }

  /** Dev helper: simulate days instantly (rAF is throttled in background tabs). */
  advance(days: number): void {
    for (let i = 0; i < days && !this.s.gameOver; i++) {
      this.s.minute = (this.s.day + 1) * 1440;
      simulateDay(this.s);
    }
    saveGame(this.s);
    this.dirtyRoutes = true;
    this.refresh(true);
  }

  private setSpeed(n: number): void {
    this.speed = n;
    this.sound.setAmbience(n > 0);
    this.renderTopbar();
  }

  private back(): void {
    this.view = this.stack.pop() ?? { kind: 'overview' };
    this.animateView = true;
    this.highlightForView();
    this.refresh();
  }

  private onAction(a: string, el: HTMLElement): void {
    const d = el.dataset;
    const s = this.s;
    switch (a) {
      case 'speed': return this.setSpeed(Number(d.speed));
      case 'tab': return this.openTab(d.kind as View['kind']);
      case 'back': return this.back();
      case 'route': return this.open({ kind: 'route', id: d.id! });
      case 'aircraft': return this.open({ kind: 'aircraft', id: d.id! });
      case 'new-route': return this.open(defaultView('planner', s));
      case 'plan': return this.open({ kind: 'planner', from: d.from!, to: d.to, plan: {}, whatIf: { typeId: 'A20N', weekly: 7 } });
      case 'dismiss-tutorial': s.tutorialDone = true; return this.refresh();
      case 'sound': this.sound.toggle(); this.sound.unlock(); this.sound.setAmbience(this.speed > 0); return this.renderTopbar();
      case 'rival': return this.open({ kind: 'rival', code: d.code! });
      case 'unfollow': this.map.select(null); return;
      case 'decide': {
        const out = resolveDecision(s, d.id!, Number(d.choice));
        if (out.text) this.toast(out.text);
        this.dirtyRoutes = true;
        this.closeModal();
        if (out.open) this.open(out.open);
        return;
      }
      case 'board-ok': s.board.meeting = null; return this.closeModal();
      case 'close-modal': this.liveryDraft = null; return this.closeModal();
      case 'livery': {
        this.liveryDraft = { ...liveryOf(player(s)) };
        return this.overlay(liveryModal(s, this.liveryDraft));
      }
      case 'lv-pattern': if (this.liveryDraft) { this.liveryDraft.pattern = d.pattern as LiveryPattern; this.overlay(liveryModal(s, this.liveryDraft)); } return;
      case 'lv-color': if (this.liveryDraft) { this.liveryDraft[d.key as 'primary' | 'secondary'] = d.color!; this.overlay(liveryModal(s, this.liveryDraft)); } return;
      case 'lv-save': {
        if (!this.liveryDraft) return;
        const err = act.repaint(s, this.liveryDraft);
        if (err) return this.toast(err, 'err');
        this.liveryDraft = null;
        this.dirtyRoutes = true;
        this.toast('New livery applied.');
        return this.closeModal();
      }
      case 'menu': return this.showMenu();
      case 'mk-tab': if (this.view.kind === 'market') { this.view.tab = d.tab as 'new' | 'used'; this.refresh(); } return;
      case 'lease': case 'buy': {
        const biz = this.view.kind === 'market' ? this.view.biz[d.type!] : undefined;
        const t = d.type!;
        const err = a === 'lease' ? act.leaseAircraft(s, t, biz ?? defaultBiz(t)) : act.buyNewAircraft(s, t, biz ?? defaultBiz(t));
        this.run(err, a === 'lease' ? 'Aircraft leased — it arrives in 3 days.' : 'Aircraft ordered — delivery in 45 days.');
        return;
      }
      case 'buy-used': {
        const u = s.used.find((x) => x.id === d.id);
        this.run(act.buyUsedAircraft(s, d.id!, u ? defaultBiz(u.typeId) : 0), 'Used aircraft bought.');
        return;
      }
      case 'launch-route': {
        if (this.view.kind !== 'planner' || !this.view.to) return;
        const v = this.view;
        const plan = Object.entries(v.plan).filter(([, w]) => w > 0).map(([acId, weekly]) => ({ acId, weekly }));
        const r = act.openRoute(s, v.from, v.to!, plan, v.fareY, v.fareJ);
        if (typeof r === 'string') return void this.toast(r, 'err');
        this.dirtyRoutes = true;
        this.stack = [{ kind: 'routes' }];
        this.view = { kind: 'route', id: r.id };
        this.highlightForView();
        this.toast(`Route ${r.from}–${r.to} launched!`);
        this.refresh();
        this.$('#view').scrollTop = 0;
        return;
      }
      case 'fare': {
        if (this.view.kind !== 'route') return;
        const r = s.routes.find((x) => x.id === (this.view as { id: string }).id)!;
        const k = d.cls === 'y' ? 'fareY' : 'fareJ';
        const cur = this.view[k] ?? (d.cls === 'y' ? r.fareY : r.fareJ);
        this.view[k] = Math.max(10, Math.round(cur * (1 + Number(d.d))));
        this.refresh();
        return;
      }
      case 'apply-fares': {
        if (this.view.kind !== 'route') return;
        const r = s.routes.find((x) => x.id === (this.view as { id: string }).id)!;
        this.run(act.setFares(s, r.id, this.view.fareY ?? r.fareY, this.view.fareJ ?? r.fareJ), 'Fares updated.');
        this.view.fareY = this.view.fareJ = undefined;
        this.refresh();
        return;
      }
      case 'weekly': {
        if (this.view.kind !== 'route') return;
        const ac = s.aircraft.find((x) => x.id === d.ac)!;
        const cur = ac.assignments.find((x) => x.routeId === (this.view as { id: string }).id)?.weekly ?? 0;
        this.run(act.assignAircraft(s, ac.id, this.view.id, cur + Number(d.d)));
        return;
      }
      case 'close-route': {
        if (this.view.kind !== 'route' || !confirm('Close this route? Its aircraft become free for other routes.')) return;
        if (this.run(act.closeRoute(s, this.view.id), 'Route closed.')) this.openTab('routes');
        return;
      }
      case 'refit': {
        if (this.view.kind !== 'aircraft') return;
        const input = this.$('[data-input="ac-biz"]') as HTMLInputElement;
        this.run(act.reconfigure(s, this.view.id, Number(input.value)), 'Cabin refit booked.');
        return;
      }
      case 'sell': {
        if (this.view.kind !== 'aircraft' || !confirm('Are you sure?')) return;
        if (this.run(act.sellAircraft(s, this.view.id))) this.openTab('fleet');
        return;
      }
      case 'loan': return void this.run(act.takeLoan(s, Number(d.amount)), `Borrowed ${money(Number(d.amount))}.`);
      case 'repay': return void this.run(act.repayLoan(s, d.id!, Number(d.amount)), 'Loan repaid.');
      case 'service': act.setService(s, Number(d.level) as ServiceLevel); return this.refresh();
      case 'open-base': return void this.run(act.openBase(s, d.code!), `New base at ${d.code}!`);
      case 'new-game': return this.showStart(hasSave());
      case 'save': return void this.toast(saveGame(s) ? 'Game saved.' : 'Could not save (browser storage full or blocked).', saveGame(s) ? 'ok' : 'err');
      case 'export': return this.exportSave();
      case 'import': return this.importSave();
      case 'continue': { const g = loadGame(); if (g) this.start(g); return; }
      case 'close-overlay': return this.overlay(null);
      case 'start': return this.startFromForm();
      case 'pick-color': {
        this.root.querySelectorAll('.swatch').forEach((x) => x.classList.toggle('on', x === el));
        (this.$('#ng-color') as HTMLInputElement).value = d.color!;
        return;
      }
    }
  }

  private onInput(el: HTMLInputElement, committed: boolean): void {
    const key = el.dataset?.input;
    if (!key || !this.s) return;
    const v = this.view;
    const n = Number(el.value);
    if (v.kind === 'planner') {
      if (key === 'pl-from') { v.from = el.value; v.plan = {}; this.highlightForView(); return this.refresh(); }
      if (key === 'pl-to') {
        const code = el.value.toUpperCase();
        if (isAirport(code) && code !== v.from) { v.to = code; v.plan = {}; v.fareY = v.fareJ = undefined; this.highlightForView(); this.refresh(); (this.$('[data-input="pl-to"]') as HTMLInputElement)?.focus(); }
        return;
      }
      if (key === 'pl-weekly') v.plan[el.dataset.id!] = Math.max(0, Math.min(Number(el.max), n || 0));
      if (key === 'pl-whatif-type' && committed) { v.whatIf.typeId = el.value; return this.refresh(); }
      if (key === 'pl-whatif-weekly') v.whatIf.weekly = Math.max(0, n || 0);
      if (key === 'pl-fareY') v.fareY = n || undefined;
      if (key === 'pl-fareJ') v.fareJ = n || undefined;
      if (key === 'pl-weekly' && committed) return this.refresh();
      this.$('#estimate').innerHTML = estimateBox(plannerEstimate(this.s, v), !Object.keys(v.plan).length);
      const launch = this.$('[data-act="launch-route"]') as HTMLButtonElement | null;
      if (launch) launch.disabled = !Object.values(v.plan).some((x) => x > 0);
      return;
    }
    if (v.kind === 'route') {
      if (key === 'rt-fareY') v.fareY = n || undefined;
      if (key === 'rt-fareJ') v.fareJ = n || undefined;
      if (key === 'rt-add' && committed && el.value) {
        const r = this.s.routes.find((x) => x.id === v.id)!;
        const ac = this.s.aircraft.find((x) => x.id === el.value)!;
        return void this.run(act.assignAircraft(this.s, ac.id, r.id, Math.min(7, act.spareWeekly(ac, r.from, r.to))));
      }
      const box = this.$('#estimate');
      if (box) box.innerHTML = estimateBox(routeEstimate(this.s, v), false);
      const apply = this.$('[data-act="apply-fares"]') as HTMLButtonElement | null;
      if (apply) apply.disabled = false;
      return;
    }
    if ((key === 'lv-primary' || key === 'lv-secondary') && this.liveryDraft) {
      this.liveryDraft[key === 'lv-primary' ? 'primary' : 'secondary'] = el.value;
      if (committed) this.overlay(liveryModal(this.s, this.liveryDraft));
      return;
    }
    if (v.kind === 'aircraft' && key === 'ac-biz') {
      const map = this.$('#seatmap');
      if (map) map.innerHTML = seatMap(el.dataset.type!, n, player(this.s).color);
      const out = this.$('#biz-out');
      if (out) out.textContent = String(n);
      return;
    }
    if (v.kind === 'market' && key === 'mk-biz') { v.biz[el.dataset.type!] = n; if (committed) this.refresh(); return; }
    if (v.kind === 'aircraft' && key === 'ac-add' && committed && el.value) {
      const r = this.s.routes.find((x) => x.id === el.value)!;
      const ac = this.s.aircraft.find((x) => x.id === v.id)!;
      return void this.run(act.assignAircraft(this.s, ac.id, r.id, Math.min(7, act.spareWeekly(ac, r.from, r.to))));
    }
    if (key === 'marketing') {
      act.setMarketing(this.s, n);
      const out = this.$('#mkt-out');
      if (out) out.textContent = `${money(n)}/mo`;
      if (committed) this.refresh();
    }
  }

  // ---------- overlays ----------

  private overlay(html: string | null): void {
    const o = this.$('#overlay');
    o.hidden = html === null;
    o.innerHTML = html ?? '';
  }

  private showMenu(): void {
    this.setSpeed(0);
    this.overlay(`<div class="modal small"><h2>Menu</h2><div class="menu">
      <button class="btn" data-act="save">Save game</button>
      <button class="btn" data-act="export">Export save file</button>
      <button class="btn" data-act="import">Import save file</button>
      <button class="btn danger" data-act="new-game">New game</button>
      <button class="btn primary" data-act="close-overlay">Resume</button></div></div>`);
  }

  private showGameOver(): void {
    const p = player(this.s);
    this.speed = 0;
    const fired = this.s.gameOverReason === 'fired';
    this.overlay(`<div class="modal small"><h2>${fired ? 'Replaced by the board' : 'Bankrupt'}</h2><p>${fired ? `The board of ${esc(p.name)} lost confidence and replaced you on ${formatDate(this.s.day)}.` : `${esc(p.name)} ran out of money on ${formatDate(this.s.day)}.`}</p>
      <p class="muted">You flew ${Math.round(p.lifetimePax).toLocaleString()} passengers. Not bad for a startup.</p>
      <div class="menu"><button class="btn primary" data-act="new-game">Try again</button></div></div>`);
  }

  private showStart(canContinue: boolean): void {
    const regions: Record<Region, string> = { EU: 'Europe', NA: 'North America', SA: 'South America', ME: 'Middle East', AF: 'Africa', AS: 'Asia', OC: 'Oceania' };
    const hubs = Object.entries(regions).map(([r, name]) => `<optgroup label="${name}">${AIRPORTS.filter((a) => a.region === r).sort((a, b) => b.size - a.size || a.city.localeCompare(b.city)).map((a) =>
      `<option value="${a.iata}" ${a.iata === 'CPH' ? 'selected' : ''}>${a.iata} · ${esc(a.city)} — ${hubDifficulty(a.iata)}</option>`).join('')}</optgroup>`).join('');
    this.overlay(`<div class="modal start has-poster">
      <div class="poster">${poster('dawn', 'A20N', { pattern: 'swoosh', primary: COLORS[0], secondary: '#0b1220' }, 'Your Airline', 'NEW')}</div>
      <div class="hero"><h1>${logoMark()}AIRWAYS</h1><p>Build an airline from a single plane to a global network, against the world's real airlines.</p></div>
      ${canContinue ? `<div class="continue"><button class="btn primary big" data-act="continue">Continue saved game</button><span class="muted">or start fresh below</span></div>` : ''}
      <div class="form-grid">
        <label>Airline name<input id="ng-name" value="Nordic Sky" maxlength="28"></label>
        <label>Code <span class="muted small">2 letters</span><input id="ng-code" value="NS" maxlength="2" class="upper"></label>
        <label class="wide">Home hub<select id="ng-hub">${hubs}</select></label>
        <div class="wide"><span class="label">Livery colour</span><div class="swatches">${COLORS.map((c, i) => `<button class="swatch ${i === 0 ? 'on' : ''}" style="--c:${c}" data-act="pick-color" data-color="${c}"></button>`).join('')}<input type="hidden" id="ng-color" value="${COLORS[0]}"></div></div>
        <div class="wide"><span class="label">Difficulty</span><div class="seg" id="ng-diff">${(['easy', 'normal', 'hard'] as Difficulty[]).map((d) =>
          `<label><input type="radio" name="diff" value="${d}" ${d === 'normal' ? 'checked' : ''}><span>${d[0].toUpperCase() + d.slice(1)}<small>${money(START_CASH[d])}</small></span></label>`).join('')}</div></div>
      </div>
      <div class="actions"><button class="btn primary big" data-act="start">Found airline</button>${canContinue ? '' : '<button class="btn" data-act="import">Import save</button>'}</div>
      <p class="muted small tips">Tips: pause anytime (Space). Your aircraft fly their schedules automatically. Thin routes need small planes, and an A380 only pays where demand is huge.</p>
    </div>`);
  }

  private startFromForm(): void {
    const name = (this.$('#ng-name') as HTMLInputElement).value.trim() || 'Nordic Sky';
    const code = (this.$('#ng-code') as HTMLInputElement).value.trim().toUpperCase();
    const hub = (this.$('#ng-hub') as HTMLSelectElement).value;
    const color = (this.$('#ng-color') as HTMLInputElement).value;
    const difficulty = ((this.root.querySelector('input[name="diff"]:checked') as HTMLInputElement)?.value ?? 'normal') as Difficulty;
    if (!/^[A-Z0-9]{2}$/.test(code)) return this.toast('Airline code must be 2 letters or digits.', 'err');
    const clash = AIRLINES.find((a) => a.code === code);
    if (clash) return this.toast(`${code} belongs to ${clash.name}. Pick another code.`, 'err');
    const opts: NewGameOptions = { name, code, color, hub, difficulty };
    this.overlay('<div class="modal small"><h2>Preparing the skies…</h2><p class="muted">Scheduling 23 real airlines and nearly 2,000 aircraft.</p></div>');
    setTimeout(() => {
      const s = createGame(opts);
      saveGame(s);
      this.start(s);
    }, 30);
  }

  private exportSave(): void {
    const blob = new Blob([JSON.stringify(this.s)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `airways-${player(this.s).code}-day${this.s.day}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  private importSave(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const s = parseSave(await f.text());
        saveGame(s);
        this.start(s);
        this.toast('Save imported.');
      } catch (e) {
        this.toast((e as Error).message, 'err');
      }
    };
    input.click();
  }
}

function defaultBiz(typeId: string): number {
  return AIRCRAFT_DEFAULT_BIZ[typeId] ?? 0;
}

const AIRCRAFT_DEFAULT_BIZ: Record<string, number> = Object.fromEntries(AIRCRAFT.map((t) => [t.id, t.defaultBiz]));

/** Rough starting difficulty of a hub from its size and wealth. */
function hubDifficulty(code: string): string {
  const a = airport(code);
  const score = a.size + a.wealth * 2 + Math.min(1, a.pop / 10);
  return score >= 8 ? 'easy start' : score >= 6.4 ? 'medium' : 'hard';
}
