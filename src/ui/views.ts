// Side-panel views. Each renders to an HTML string; interaction goes through
// `data-act` attributes handled in app.ts.

import { acType, AIRCRAFT, econSeatsFor, maxBizSeats, type AircraftType } from '../data/aircraft';
import { AIRPORTS, airport } from '../data/airports';
import { ACHIEVEMENTS, paxRank } from '../engine/achievements';
import { baseCost, canFly, reconfigureCost, spareWeekly, suggestedFares } from '../engine/actions';
import { eventAffects } from '../engine/events';
import { distance, pairKey } from '../engine/geo';
import { availableNew } from '../engine/market';
import { baseDemand, blockMinutes, leaseRate, maxWeekly } from '../engine/model';
import { estimateRoute, type Estimate, type PlanAircraft } from '../engine/planner';
import {
  companyValue, creditLimit, debt, fleetOf, flyingByRoute, loanRate, player, recentProfit, recentSum, routesOf, usedMinutes,
} from '../engine/state';
import { formatDate } from '../engine/time';
import type { Aircraft, GameState, Route, RouteStats } from '../engine/types';
import { totalCost } from '../engine/types';
import { WEEK_MINUTES } from '../engine/model';
import { objectiveProgress, quarterLabel } from '../engine/board';
import { averageStars } from '../engine/reviews';
import { archetype, threatLabel } from '../engine/rivals';
import type { Review } from '../engine/types';
import { liveryOf, seatMap, sideView } from './aircraftArt';
import { lengthOf } from './profiles';
import { boardShell } from './departures';
import { esc, fare, lfClass, money, num, pct, signClass } from './format';
import { icon } from './icons';

export type View =
  | { kind: 'overview' }
  | { kind: 'routes' }
  | { kind: 'route'; id: string; fareY?: number; fareJ?: number }
  | { kind: 'planner'; from: string; to?: string; fareY?: number; fareJ?: number; plan: Record<string, number>; whatIf: { typeId: string; weekly: number } }
  | { kind: 'fleet' }
  | { kind: 'aircraft'; id: string }
  | { kind: 'market'; tab: 'new' | 'used'; biz: Record<string, number> }
  | { kind: 'finance' }
  | { kind: 'rivals' }
  | { kind: 'airport'; code: string }
  | { kind: 'news' }
  | { kind: 'rival'; code: string };

export const TABS: { kind: View['kind']; label: string }[] = [
  { kind: 'overview', label: 'Overview' },
  { kind: 'routes', label: 'Routes' },
  { kind: 'fleet', label: 'Fleet' },
  { kind: 'market', label: 'Aircraft' },
  { kind: 'finance', label: 'Finance' },
  { kind: 'rivals', label: 'Rivals' },
];

export function defaultView(kind: View['kind'], s: GameState): View {
  switch (kind) {
    case 'market': return { kind, tab: 'new', biz: {} };
    case 'planner': return { kind, from: player(s).bases[0], plan: {}, whatIf: { typeId: 'A20N', weekly: 7 } };
    default: return { kind } as View;
  }
}

// ---------- shared bits ----------

function sumWeek(w: RouteStats[]) {
  const t = { pax: 0, transfer: 0, seats: 0, revenue: 0, cost: 0, legs: 0 };
  for (const x of w) {
    t.pax += x.paxY + x.paxJ + x.transfer;
    t.transfer += x.transfer;
    t.seats += x.seatsY + x.seatsJ;
    t.revenue += x.revenue;
    t.cost += x.cost;
    t.legs += x.legs;
  }
  const n = Math.max(1, w.length);
  return { lf: t.seats ? t.pax / t.seats : 0, paxDay: t.pax / n, transferDay: t.transfer / n, revDay: t.revenue / n, profitDay: (t.revenue - t.cost) / n, days: w.length };
}

function routeName(r: Pick<Route, 'from' | 'to'>): string {
  return `${r.from} ⇄ ${r.to}`;
}

function airportLabel(code: string): string {
  const a = airport(code);
  return `<b>${a.iata}</b> <span class="muted">${esc(a.city)}</span>`;
}

function chip(color: string, text: string): string {
  return `<span class="chip" style="--c:${color}">${esc(text)}</span>`;
}

function kpi(label: string, value: string, cls = '', hint = ''): string {
  return `<div class="kpi" ${hint ? `title="${esc(hint)}"` : ''}><div class="kpi-label">${label}</div><div class="kpi-value ${cls}">${value}</div></div>`;
}

/** KPI whose number counts up/down to its new value (see animateCounters in app.ts). */
function kpiCount(label: string, value: number, fmt: 'money' | 'pct' | 'num', cls = '', hint = ''): string {
  const text = fmt === 'money' ? money(value) : fmt === 'pct' ? pct(value) : num(value);
  return `<div class="kpi" ${hint ? `title="${esc(hint)}"` : ''}><div class="kpi-label">${label}</div><div class="kpi-value ${cls}" data-count="${value}" data-fmt="${fmt}" data-key="${esc(label)}">${text}</div></div>`;
}

function weeklyTotal(s: GameState, routeId: string): number {
  return s.aircraft.reduce((n, ac) => n + (ac.assignments.find((a) => a.routeId === routeId)?.weekly ?? 0), 0);
}

function aircraftStatus(s: GameState, ac: Aircraft): string {
  if (ac.readyDay > s.day) return `<span class="tag">Arrives in ${ac.readyDay - s.day}d</span>`;
  if (ac.groundedUntil > s.day) return `<span class="tag bad">Grounded ${ac.groundedUntil - s.day}d</span>`;
  if (!ac.assignments.length) return '<span class="tag warn">Idle</span>';
  return `<span class="tag good">Flying</span>`;
}

function utilBar(ac: Aircraft): string {
  const u = usedMinutes(ac) / WEEK_MINUTES;
  return `<div class="bar" title="${pct(u)} of weekly flying time scheduled"><i style="width:${Math.min(100, u * 100)}%"></i></div>`;
}

// ---------- Overview ----------

function onboarding(s: GameState): string {
  const p = player(s);
  const fleet = fleetOf(s, p.code);
  const routes = routesOf(s, p.code);
  const steps: [boolean, string, string][] = [
    [fleet.length > 0, 'Get your first aircraft', 'Open <a data-act="tab" data-kind="market">Aircraft</a> and <b>lease</b> one: it needs only a two-month deposit. An A320neo or A220 is a great starter.'],
    [routes.length > 0, 'Open a route', `Click a destination on the map, or <a data-act="new-route">plan a route</a> from ${p.bases[0]}. The planner estimates demand, rivals and profit before you commit.`],
    [routes.some((r) => r.week.length >= 3), 'Let time fly', 'Use the speed buttons at the top (or press <kbd>Space</kbd> / <kbd>1</kbd>–<kbd>4</kbd>). Your aircraft fly their schedule automatically.'],
    [routes.length > 0 && s.day >= 14, 'Read the numbers', 'Open a route to see load factor and profit. Too empty? Lower the fare or frequency. Always full? Raise the fare.'],
    [routes.length >= 3 && fleet.length >= 3, 'Build a network', 'Routes that share your base feed each other with <b>connecting passengers</b>. Grow a hub!'],
  ];
  const next = steps.findIndex(([done]) => !done);
  return `<section class="card onboarding"><header><h3>Getting started</h3><button class="link" data-act="dismiss-tutorial">Hide</button></header><ol>${steps.map(([done, title, body], i) =>
    `<li class="${done ? 'done' : i === next ? 'next' : ''}"><div><b>${title}</b>${i === next ? `<p>${body}</p>` : ''}</div></li>`).join('')}</ol></section>`;
}

function alerts(s: GameState): string[] {
  const p = player(s);
  const out: string[] = [];
  const idle = fleetOf(s, p.code).filter((ac) => ac.readyDay <= s.day && !ac.assignments.length);
  if (idle.length) out.push(`<span class="dot warn"></span> ${idle.length} idle aircraft are costing you money. <a data-act="tab" data-kind="fleet">Schedule them</a>.`);
  for (const ac of fleetOf(s, p.code)) {
    const u = usedMinutes(ac) / WEEK_MINUTES;
    if (ac.assignments.length && u < 0.5) out.push(`<span class="dot warn"></span> <a data-act="aircraft" data-id="${ac.id}">${ac.reg}</a> is only ${pct(u)} scheduled. Its lease is paid either way, so add frequencies or another route.`);
  }
  for (const r of routesOf(s, p.code)) {
    const w = sumWeek(r.week);
    if (w.days >= 7 && w.profitDay < 0) out.push(`<span class="dot neg"></span> <a data-act="route" data-id="${r.id}">${routeName(r)}</a> is losing ${money(-w.profitDay)}/day (load ${pct(w.lf)}).`);
  }
  const mine = new Set(routesOf(s, p.code).map((r) => pairKey(r.from, r.to)));
  for (const r of s.routes) {
    if (r.owner !== p.code && r.warUntil > s.day && mine.has(pairKey(r.from, r.to))) {
      const a = s.airlines.find((x) => x.code === r.owner)!;
      out.push(`<span class="dot rival"></span> Fare war: ${esc(a.name)} is undercutting you on ${routeName(r)} for ${r.warUntil - s.day} more days.`);
    }
  }
  if (s.bankruptDays > 0) out.push(`<span class="dot neg"></span> <b>Bankruptcy warning:</b> ${30 - s.bankruptDays} days left to get cash above the limit. Take a loan, sell aircraft or cut losses.`);
  return out;
}

function opportunities(s: GameState): string {
  const p = player(s);
  const mine = new Set(routesOf(s, p.code).map((r) => pairKey(r.from, r.to)));
  const carriers = new Map<string, number>();
  for (const r of s.routes) if (r.owner !== p.code) carriers.set(pairKey(r.from, r.to), (carriers.get(pairKey(r.from, r.to)) ?? 0) + 1);
  const rows = p.bases.flatMap((b) => AIRPORTS.filter((a) => a.iata !== b && distance(b, a.iata) >= 300 && !mine.has(pairKey(b, a.iata))).map((a) => {
    const n = carriers.get(pairKey(b, a.iata)) ?? 0;
    return { from: b, to: a.iata, demand: baseDemand(b, a.iata).total * 2, n, score: (baseDemand(b, a.iata).total * 2) / (1 + n * 0.8) };
  })).sort((x, y) => y.score - x.score).slice(0, 6);
  return `<section class="card"><h3>Market research</h3><p class="muted small">Biggest markets from your bases that you don't fly yet. Fewer rivals = easier entry.</p>
  <table class="tbl"><thead><tr><th>Market</th><th class="r">Pax/day</th><th class="r">km</th><th class="r">Rivals</th><th></th></tr></thead><tbody>
  ${rows.map((r) => `<tr><td>${r.from} ⇄ ${airportLabel(r.to)}</td><td class="r">${num(r.demand)}</td><td class="r">${num(distance(r.from, r.to))}</td><td class="r">${r.n}</td><td class="r"><button class="btn sm" data-act="plan" data-from="${r.from}" data-to="${r.to}">Plan</button></td></tr>`).join('')}
  </tbody></table></section>`;
}

function milestones(s: GameState): string {
  return `<section class="card"><h3>${icon('trophy')} Milestones <span class="muted">${s.achievements.length}/${ACHIEVEMENTS.length}</span></h3><div class="badges">${ACHIEVEMENTS.map((a) =>
    `<div class="badge ${s.achievements.includes(a.id) ? 'got' : ''}" title="${esc(a.desc)}">${icon(s.achievements.includes(a.id) ? 'trophy' : 'lock')} ${esc(a.name)}</div>`).join('')}</div></section>`;
}

function briefHead(ic: Parameters<typeof icon>[0], title: string, count?: number): string {
  return `<div class="brief-h">${icon(ic)}${title}${count ? `<span class="count">${count}</span>` : ''}</div>`;
}

function overview(s: GameState): string {
  const p = player(s);
  const routes = routesOf(s, p.code);
  const fleet = fleetOf(s, p.code);
  const last7 = p.recent.slice(-7);
  const profit7 = last7.reduce((n, l) => n + l.revenue - totalCost(l), 0) / Math.max(1, last7.length);
  const rpk = last7.reduce((n, l) => n + l.rpk, 0);
  const ask = last7.reduce((n, l) => n + l.ask, 0);
  const lf = ask ? rpk / ask : 0;
  const al = alerts(s);
  const avg = averageStars(s);
  return `
  ${s.tutorialDone ? '' : onboarding(s)}
  <section class="brief">
    ${briefHead('alert', 'Needs attention', al.length)}
    ${al.length ? `<div class="card"><ul class="alerts">${al.map((a) => `<li>${a}</li>`).join('')}</ul></div>` : '<p class="muted small">All clear. Your operation is running smoothly.</p>'}
  </section>
  <section class="brief">
    ${briefHead('gauge', "How you're doing")}
    <div class="kpis hero">
      ${kpiCount('Profit / day', profit7, 'money', signClass(profit7), 'Average over the last 7 days, after all costs')}
      ${kpiCount('Load factor', lf, 'pct', ask ? lfClass(lf) : '', 'Share of seats filled over the last 7 days')}
      ${kpiCount('Passengers / day', p.today.pax, 'num')}
    </div>
    <div class="kpis compact">
      ${kpi('Fleet', `${fleet.length}`)}
      ${kpi('Routes', `${routes.length}`)}
      ${kpi('Reputation', `${Math.round(p.reputation)}`, '', 'Driven by aircraft comfort, service level and fleet age')}
      ${kpi('World rank', `#${paxRank(s)}`, '', 'By passengers over the last 30 days')}
    </div>
    ${objectiveCard(s)}
    ${routes.length ? boardShell(p.bases[0], 6) : ''}
    ${s.reviews.length ? `<section class="card"><header><h3>Passenger reviews</h3><span class="stars-big">${stars(avg ?? 0)} <span class="muted small">${(avg ?? 0).toFixed(1)} · 60 days</span></span></header>${reviewList(s.reviews.slice(0, 3))}</section>` : ''}
  </section>
  <section class="brief">
    ${briefHead('radar', 'Opportunities')}
    ${s.events.length ? `<div class="card"><h3>World events</h3><ul class="alerts">${s.events.map((e) => `<li>${esc(e.title)} <span class="muted">· ${e.endDay - s.day}d left</span></li>`).join('')}</ul></div>` : ''}
    ${opportunities(s)}
    <div class="card"><header><h3>Latest news</h3><button class="link" data-act="tab" data-kind="news">All news</button></header>${newsList(s, 4)}</div>
  </section>`;
}

function dots(n: number, max: number): string {
  const k = Math.max(1, Math.min(max, n));
  return `<span class="dots">${'<i class="on"></i>'.repeat(k)}${'<i></i>'.repeat(max - k)}</span>`;
}

function stars(n: number): string {
  const full = Math.round(n);
  return `<span class="stars" title="${n.toFixed(1)} / 5">${icon('star', 'on').repeat(full)}${icon('star', 'off').repeat(5 - full)}</span>`;
}

function reviewList(rv: Review[]): string {
  return `<ul class="reviews">${rv.map((r) => `<li><div>${stars(r.stars)} <b>${esc(r.name)}</b> <span class="muted small">${r.cabin} · ${r.from}–${r.to} · ${formatDate(r.day)}</span></div><p>“${esc(r.text)}”</p></li>`).join('')}</ul>`;
}

export function objectiveCard(s: GameState): string {
  const b = s.board;
  const prog = objectiveProgress(s);
  const conf = b.confidence;
  return `<section class="card objective"><header><h3>${icon('target')} Board objective · ${quarterLabel(s.day)}</h3><span class="muted small">Reward ${money(b.objective.reward)}</span></header>
    <p><b>${esc(b.objective.label)}</b></p>
    <div class="progress"><i style="width:${Math.min(100, prog.value * 100)}%"></i></div><div class="muted small">${prog.text}</div>
    <div class="conf"><span>Board confidence</span><div class="meter ${conf < 30 ? 'low' : conf < 60 ? 'mid' : 'high'}"><i style="width:${conf}%"></i></div><b>${Math.round(conf)}</b></div>
  </section>`;
}

function newsList(s: GameState, n: number): string {
  return `<ul class="news">${s.news.slice(0, n).map((x) => `<li class="${x.tone}"><span class="muted">${formatDate(x.day)}</span> ${esc(x.text)}</li>`).join('')}</ul>`;
}

function news(s: GameState): string {
  return `<h2>News</h2>${newsList(s, 150)}`;
}

// ---------- Routes ----------

function routesView(s: GameState): string {
  const p = player(s);
  const rs = routesOf(s, p.code).map((r) => ({ r, w: sumWeek(r.week), weekly: weeklyTotal(s, r.id) })).sort((a, b) => b.w.profitDay - a.w.profitDay);
  return `<header class="row"><h2>Routes</h2><button class="btn primary" data-act="new-route">+ New route</button></header>
  ${rs.length ? `<table class="tbl click"><thead><tr><th>Route</th><th class="r">km</th><th class="r">Flights/wk</th><th class="r">Load</th><th class="r">Pax/day</th><th class="r">Contrib./day</th></tr></thead><tbody>
  ${rs.map(({ r, w, weekly }) => `<tr data-act="route" data-id="${r.id}"><td class="nowrap">${routeName(r)}${r.week.length < 7 ? ' <span class="tag">new</span>' : ''}</td><td class="r">${num(distance(r.from, r.to))}</td><td class="r">${weekly}</td><td class="r ${lfClass(w.lf)}">${w.days ? pct(w.lf) : '—'}</td><td class="r">${num(w.paxDay)}</td><td class="r ${signClass(w.profitDay)}">${w.days ? money(w.profitDay) : '—'}</td></tr>`).join('')}
  </tbody></table><p class="muted small">Contribution is revenue minus fuel, crew, maintenance, airport and catering costs. Leases, HQ and sales overhead are charged airline-wide.</p>`
    : `<div class="empty"><p>No routes yet.</p><p class="muted">Click any airport on the map to see its market, or start the planner.</p></div>`}`;
}

// ---------- Route planner & route detail ----------

function eligibleAircraft(s: GameState, from: string, to: string, routeId?: string): Aircraft[] {
  return fleetOf(s, s.playerCode).filter((ac) => canFly(ac.typeId, from, to) && (spareWeekly(ac, from, to, routeId) > 0 || ac.assignments.some((a) => a.routeId === routeId)));
}

export function plannerEstimate(s: GameState, v: Extract<View, { kind: 'planner' }>): Estimate | null {
  if (!v.to || v.to === v.from) return null;
  const f = suggestedFares(v.from, v.to);
  const plan = Object.entries(v.plan).map(([id, weekly]) => ({ ac: s.aircraft.find((a) => a.id === id)! as PlanAircraft, weekly })).filter((x) => x.ac);
  if (!plan.length && v.whatIf.weekly > 0) {
    const t = acType(v.whatIf.typeId);
    if (t.rangeKm >= distance(v.from, v.to)) {
      plan.push({ ac: { typeId: t.id, biz: t.defaultBiz, econ: econSeatsFor(t, t.defaultBiz), ageDays: 0, ownership: 'leased', leaseMonthly: leaseRate(t) }, weekly: Math.min(v.whatIf.weekly, maxWeekly(t, distance(v.from, v.to))) });
    }
  }
  return estimateRoute(s, v.from, v.to, plan, v.fareY ?? f.y, v.fareJ ?? f.j);
}

export function estimateBox(e: Estimate | null, whatIf: boolean): string {
  if (!e) return '<p class="muted">Pick a destination to see the market.</p>';
  if (!e.seats) return '<p class="muted">Schedule at least one aircraft to see projected results.</p>';
  return `${whatIf ? '<p class="small muted">What-if estimate with a new leased aircraft — lease one to launch for real.</p>' : ''}
  <div class="kpis compact">
    ${kpi('Flights / wk', num(e.weeklyFlights))}
    ${kpi('Seats / day', num(e.seats))}
    ${kpi('Est. load', pct(e.lf), lfClass(e.lf))}
    ${kpi('Revenue / day', money(e.revenue))}
    ${kpi('Contribution / day', money(e.contribution), signClass(e.contribution), 'Revenue minus fuel, crew, maintenance, airport and catering')}
    ${kpi('Profit / day', money(e.profit), signClass(e.profit), 'After sales overhead and this route\'s share of aircraft lease and HQ costs')}
  </div>
  <p class="small muted">Estimate at today's brand awareness. ${e.transferPax ? `Includes ~${num(e.transferPax)} connecting passengers/day at today's level.` : 'Connecting passengers through your hub come on top.'}</p>`;
}

function competitorTable(e: Estimate): string {
  if (!e.competitors.length) return '<p class="muted small">No one else flies this route yet.</p>';
  return `<table class="tbl"><thead><tr><th>Airline</th><th class="r">Flights/wk</th><th class="r">Eco fare</th><th class="r">Biz fare</th><th>Aircraft</th></tr></thead><tbody>
  ${e.competitors.map((c) => `<tr><td>${chip(c.color, c.airline)} ${esc(c.name)}</td><td class="r">${num(c.weeklyFlights)}</td><td class="r">${fare(c.fareY)}</td><td class="r">${fare(c.fareJ)}</td><td class="small">${esc(c.types.join(', ') || 'mixed')}</td></tr>`).join('')}</tbody></table>`;
}

function planner(s: GameState, v: Extract<View, { kind: 'planner' }>): string {
  const p = player(s);
  const e = plannerEstimate(s, v);
  const d = v.to ? distance(v.from, v.to) : 0;
  const f = v.to ? suggestedFares(v.from, v.to) : { y: 0, j: 0 };
  const elig = v.to ? eligibleAircraft(s, v.from, v.to) : [];
  const tooFar = v.to ? fleetOf(s, p.code).filter((ac) => !canFly(ac.typeId, v.from, v.to!)).length : 0;
  const usingWhatIf = !!v.to && !Object.keys(v.plan).length;
  return `<h2>Plan a route</h2>
  <div class="form-row">
    <label>From<select data-input="pl-from">${p.bases.map((b) => `<option value="${b}" ${b === v.from ? 'selected' : ''}>${b} · ${esc(airport(b).city)}</option>`).join('')}</select></label>
    <label>To<input data-input="pl-to" list="airport-list" placeholder="IATA or click map" value="${v.to ?? ''}" maxlength="3" class="upper"></label>
  </div>
  ${v.to ? `
  <div class="route-head"><div>${airportLabel(v.from)} → ${airportLabel(v.to)}</div><div class="muted">${num(d)} km · ${Math.round(blockMinutes(acType('A20N'), d) / 6) / 10} h block (A320)</div></div>
  <section class="card"><h3>Market</h3>
    <div class="kpis compact">${kpi('Economy demand', `${num(e!.demandY)}/day`)}${kpi('Business demand', `${num(e!.demandJ)}/day`)}${kpi('Suggested fares', `${fare(f.y)} / ${fare(f.j)}`)}</div>
    ${competitorTable(e!)}
  </section>
  <section class="card"><h3>Schedule</h3>
    ${elig.length ? `<table class="tbl"><thead><tr><th>Aircraft</th><th>Seats</th><th class="r">Round trips / wk</th></tr></thead><tbody>
      ${elig.map((ac) => {
        const t = acType(ac.typeId);
        const max = spareWeekly(ac, v.from, v.to!);
        return `<tr><td><b>${ac.reg}</b> <span class="muted small">${t.name}</span> ${aircraftStatus(s, ac)}</td><td class="small">${ac.biz}J ${ac.econ}Y</td><td class="r"><input type="number" min="0" max="${max}" value="${v.plan[ac.id] ?? 0}" data-input="pl-weekly" data-id="${ac.id}" class="num"> <span class="muted small">/ ${max}</span></td></tr>`;
      }).join('')}</tbody></table>` : `<p class="muted">You have no aircraft with free time that can fly ${num(d)} km. ${tooFar ? `(${tooFar} lack the range.)` : ''} <a data-act="tab" data-kind="market">Get one</a>, or try a what-if:</p>`}
    ${usingWhatIf ? `<div class="form-row"><label>What-if aircraft<select data-input="pl-whatif-type">${AIRCRAFT.filter((t) => t.rangeKm >= d).map((t) => `<option value="${t.id}" ${t.id === v.whatIf.typeId ? 'selected' : ''}>${t.name} (${t.maxSeats} max)</option>`).join('')}</select></label>
      <label>Trips / wk<input type="number" min="0" value="${v.whatIf.weekly}" data-input="pl-whatif-weekly" class="num"></label></div>` : ''}
  </section>
  <section class="card"><h3>Fares <span class="muted small">one way</span></h3>
    <div class="form-row"><label>Economy<input type="number" min="10" value="${v.fareY ?? f.y}" data-input="pl-fareY" class="num"></label><label>Business<input type="number" min="20" value="${v.fareJ ?? f.j}" data-input="pl-fareJ" class="num"></label></div>
  </section>
  <section class="card" id="estimate">${estimateBox(e, usingWhatIf)}</section>
  <div class="actions"><button class="btn primary" data-act="launch-route" ${Object.values(v.plan).some((x) => x > 0) ? '' : 'disabled'}>Launch route</button></div>`
    : `<p class="muted">Type an IATA code or click an airport on the map.</p>`}`;
}

export function routeEstimate(s: GameState, v: Extract<View, { kind: 'route' }>): Estimate | null {
  const r = s.routes.find((x) => x.id === v.id);
  if (!r) return null;
  const fl = flyingByRoute(s).get(r.id) ?? [];
  // Connecting traffic isn't re-simulated; carry over the recent level and its share of revenue.
  const n = Math.max(1, r.week.length);
  const tPax = r.week.reduce((m, w) => m + w.transfer, 0) / n;
  const local = r.week.reduce((m, w) => m + w.paxY * r.fareY + w.paxJ * r.fareJ, 0) / n;
  const tRev = Math.max(0, r.week.reduce((m, w) => m + w.revenue, 0) / n - local);
  return estimateRoute(s, r.from, r.to, fl, v.fareY ?? r.fareY, v.fareJ ?? r.fareJ, r.id, { pax: tPax, revenue: tRev });
}

function routeDetail(s: GameState, v: Extract<View, { kind: 'route' }>): string {
  const r = s.routes.find((x) => x.id === v.id);
  if (!r) return '<p>Route closed.</p>';
  const w = sumWeek(r.week);
  const e = routeEstimate(s, v)!;
  const fl = flyingByRoute(s).get(r.id) ?? [];
  const addable = eligibleAircraft(s, r.from, r.to, r.id).filter((ac) => !fl.some((f) => f.ac.id === ac.id));
  const f = suggestedFares(r.from, r.to);
  const war = s.routes.filter((x) => x.owner !== r.owner && pairKey(x.from, x.to) === pairKey(r.from, r.to) && x.warUntil > s.day);
  return `<div class="route-head"><h2>${airportLabel(r.from)} ⇄ ${airportLabel(r.to)}</h2><div class="muted">${num(distance(r.from, r.to))} km · opened ${formatDate(r.openedDay)}</div></div>
  ${war.length ? `<div class="banner rival">Fare war! ${war.map((x) => esc(s.airlines.find((a) => a.code === x.owner)!.name)).join(', ')} cut fares 15% here.</div>` : ''}
  <section class="kpis">
    ${kpi('Load (7d)', w.days ? pct(w.lf) : '—', lfClass(w.lf))}
    ${kpi('Pax / day', num(w.paxDay))}
    ${kpi('Connecting / day', num(w.transferDay), '', 'Passengers flying on to another of your routes via your base')}
    ${kpi('Revenue / day', money(w.revDay))}
    ${kpi('Contribution / day', money(w.profitDay), signClass(w.profitDay), 'Revenue minus direct operating costs')}
  </section>
  <section class="card"><h3>Fares</h3>
    <div class="form-row"><label>Economy<span class="stepper"><button data-act="fare" data-cls="y" data-d="-0.05">−</button><input type="number" value="${v.fareY ?? r.fareY}" data-input="rt-fareY" class="num"><button data-act="fare" data-cls="y" data-d="0.05">+</button></span></label>
    <label>Business<span class="stepper"><button data-act="fare" data-cls="j" data-d="-0.05">−</button><input type="number" value="${v.fareJ ?? r.fareJ}" data-input="rt-fareJ" class="num"><button data-act="fare" data-cls="j" data-d="0.05">+</button></span></label></div>
    <p class="small muted">Reference fares: ${fare(f.y)} / ${fare(f.j)}. Cheaper wins market share; dearer earns more per seat.</p>
    <div id="estimate">${estimateBox(e, false)}</div>
    <div class="actions"><button class="btn primary" data-act="apply-fares" ${v.fareY === undefined && v.fareJ === undefined ? 'disabled' : ''}>Apply fares</button></div>
  </section>
  <section class="card"><h3>Schedule</h3>
    <table class="tbl"><thead><tr><th>Aircraft</th><th>Seats</th><th class="r">Round trips / wk</th></tr></thead><tbody>
    ${fl.map(({ ac, weekly }) => `<tr><td><a data-act="aircraft" data-id="${ac.id}"><b>${ac.reg}</b></a> <span class="muted small">${acType(ac.typeId).name}</span></td><td class="small">${ac.biz}J ${ac.econ}Y</td>
      <td class="r"><span class="stepper"><button data-act="weekly" data-ac="${ac.id}" data-d="-1">−</button><b class="num-out">${weekly}</b><button data-act="weekly" data-ac="${ac.id}" data-d="1" ${spareWeekly(ac, r.from, r.to, r.id) <= weekly ? 'disabled' : ''}>+</button></span></td></tr>`).join('')}
    </tbody></table>
    ${addable.length ? `<div class="form-row"><label>Add aircraft<select data-input="rt-add"><option value="">Choose…</option>${addable.map((ac) => `<option value="${ac.id}">${ac.reg} · ${acType(ac.typeId).name} (${spareWeekly(ac, r.from, r.to)} trips free)</option>`).join('')}</select></label></div>` : '<p class="small muted">No other aircraft with free time can fly this route.</p>'}
  </section>
  <section class="card"><h3>Competition</h3>${competitorTable(e)}</section>
  ${(() => { const rv = s.reviews.filter((x) => x.routeId === r.id).slice(0, 3); return rv.length ? `<section class="card"><h3>What passengers say</h3>${reviewList(rv)}</section>` : ''; })()}
  <div class="actions"><button class="btn danger" data-act="close-route">Close route</button></div>`;
}

// ---------- Fleet & aircraft ----------

function fleetView(s: GameState): string {
  const fleet = fleetOf(s, s.playerCode);
  const routes = new Map(s.routes.map((r) => [r.id, r]));
  return `<header class="row"><h2>Fleet</h2><button class="btn primary" data-act="tab" data-kind="market">+ Get aircraft</button></header>
  ${fleet.length ? `<table class="tbl click"><thead><tr><th>Aircraft</th><th>Status</th><th>Flying</th><th>Use</th></tr></thead><tbody>
  ${fleet.map((ac) => `<tr data-act="aircraft" data-id="${ac.id}"><td>${sideView(ac.typeId, liveryOf(player(s)), player(s).name, player(s).code, 'ac-art mini')}<b>${ac.reg}</b><div class="muted small">${acType(ac.typeId).name} · ${(ac.ageDays / 365).toFixed(1)}y · ${ac.ownership}</div></td><td>${aircraftStatus(s, ac)}</td>
    <td class="small">${ac.assignments.map((a) => { const r = routes.get(a.routeId); return r ? `<span class="nowrap">${routeName(r)} ×${a.weekly}</span>` : ''; }).join('<br>') || '—'}</td><td>${utilBar(ac)}</td></tr>`).join('')}
  </tbody></table>` : '<div class="empty"><p>Your hangar is empty.</p><p class="muted">Lease your first aircraft in the Aircraft market.</p></div>'}`;
}

function aircraftDetail(s: GameState, v: Extract<View, { kind: 'aircraft' }>): string {
  const ac = s.aircraft.find((a) => a.id === v.id && a.owner === s.playerCode);
  if (!ac) return '<p>Aircraft no longer in your fleet.</p>';
  const t = acType(ac.typeId);
  const routes = new Map(s.routes.map((r) => [r.id, r]));
  const mine = routesOf(s, s.playerCode).filter((r) => canFly(ac.typeId, r.from, r.to) && !ac.assignments.some((a) => a.routeId === r.id) && spareWeekly(ac, r.from, r.to) > 0);
  const p = player(s);
  return `<h2>${ac.reg} <span class="muted">${t.name}</span></h2>
  <div class="hero-art">${sideView(t.id, liveryOf(p), p.name, p.code)}</div>
  <section class="kpis">
    ${kpi('Status', aircraftStatus(s, ac))}
    ${kpi('Age', `${(ac.ageDays / 365).toFixed(1)} yrs`)}
    ${kpi('Range', `${num(t.rangeKm)} km`)}
    ${kpi('Cabin', `${ac.biz}J · ${ac.econ}Y`)}
    ${kpi(ac.ownership === 'leased' ? 'Lease / month' : 'Book value', money(ac.ownership === 'leased' ? ac.leaseMonthly : ac.bookValue))}
    ${kpi('Weekly time used', pct(usedMinutes(ac) / WEEK_MINUTES))}
  </section>
  <section class="card"><h3>Schedule</h3>
    ${ac.assignments.length ? `<ul class="plain">${ac.assignments.map((a) => { const r = routes.get(a.routeId); return r ? `<li><a data-act="route" data-id="${r.id}">${routeName(r)}</a> · ${a.weekly} round trips/wk</li>` : ''; }).join('')}</ul>` : '<p class="muted">Not scheduled.</p>'}
    ${mine.length ? `<div class="form-row"><label>Add to route<select data-input="ac-add"><option value="">Choose…</option>${mine.map((r) => `<option value="${r.id}">${routeName(r)} (up to ${spareWeekly(ac, r.from, r.to)}/wk)</option>`).join('')}</select></label></div>` : ''}
    <button class="btn" data-act="new-route">Plan a new route</button>
  </section>
  <section class="card"><h3>Cabin layout</h3>
    <div id="seatmap">${seatMap(t.id, ac.biz, p.color)}</div>
    <div class="form-row"><label class="grow">Business seats: <b id="biz-out">${ac.biz}</b><input type="range" min="0" max="${maxBizSeats(t)}" value="${ac.biz}" data-input="ac-biz" data-type="${t.id}"></label></div>
    <div class="muted small">Each business seat replaces ${t.category === 'widebody' || t.category === 'superjumbo' ? 4 : 2.5} economy seats. Refit: ${money(reconfigureCost(t.id))}, 3 days out of service.</div>
    <div class="actions"><button class="btn" data-act="refit">Refit cabin</button></div>
  </section>
  <div class="actions">${ac.ownership === 'owned' ? `<button class="btn danger" data-act="sell">Sell for ~${money(ac.readyDay > s.day ? t.priceM * 0.9e6 : ac.bookValue * 0.92)}</button>` : `<button class="btn danger" data-act="sell">Return to lessor (fee ${money(ac.leaseMonthly * 2)})</button>`}</div>`;
}

// ---------- Aircraft market ----------

function typeCard(s: GameState, t: AircraftType, biz: number): string {
  const canNew = availableNew(t, s.day);
  const seats = biz + econSeatsFor(t, biz);
  const p = player(s);
  return `<div class="ac-card">
    ${sideView(t.id, liveryOf(p), p.name, p.code, 'ac-art', true)}
    <div class="ac-head"><b>${t.name}</b><span class="tag">${t.category} · ${lengthOf(t.id)} m</span></div>
    <div class="ac-stats">
      <span title="Maximum all-economy seats">${t.maxSeats} max seats</span><span>${num(t.rangeKm)} km range</span>
      <span>${t.speedKmh} km/h</span><span title="Fuel per seat-hour at this config">${(t.burn / seats).toFixed(1)} kg/seat·h</span>
      <span title="Passenger appeal" class="stars">Comfort ${icon('star', 'on').repeat(Math.round(t.comfort))}${icon('star', 'off').repeat(5 - Math.round(t.comfort))}</span>
    </div>
    ${canNew ? `<div class="ac-config"><label>Business seats <input type="number" min="0" max="${maxBizSeats(t)}" value="${biz}" data-input="mk-biz" data-type="${t.id}" class="num"></label><span class="muted small">→ ${biz}J + ${econSeatsFor(t, biz)}Y</span></div>
    <div class="ac-buy">
      <button class="btn primary" data-act="lease" data-type="${t.id}">Lease ${money(leaseRate(t))}/mo</button>
      <button class="btn" data-act="buy" data-type="${t.id}">Buy ${money(t.priceM * 1e6)}</button>
    </div>
    <div class="muted small">Lease: ${money(leaseRate(t) * 2)} deposit, ready in 3 days. Buy: delivered in 45 days.</div>`
    : `<div class="muted small">${t.newBuild ? `Available from ${t.availableFrom}` : 'Out of production — check the used market.'}</div>`}
  </div>`;
}

function market(s: GameState, v: Extract<View, { kind: 'market' }>): string {
  const tabs = `<div class="subtabs"><button class="${v.tab === 'new' ? 'on' : ''}" data-act="mk-tab" data-tab="new">New & lease</button><button class="${v.tab === 'used' ? 'on' : ''}" data-act="mk-tab" data-tab="used">Used market (${s.used.length})</button></div>`;
  if (v.tab === 'new') {
    return `<h2>Aircraft market</h2>${tabs}<p class="muted small">Cash: <b>${money(player(s).cash)}</b>. Every aircraft is drawn to the same scale. Match the aircraft to the route: small planes for thin routes, big ones only where demand is huge.</p>
    <div class="ac-grid">${AIRCRAFT.map((t) => typeCard(s, t, v.biz[t.id] ?? t.defaultBiz)).join('')}</div>`;
  }
  return `<h2>Aircraft market</h2>${tabs}<p class="muted small">Second-hand aircraft: cheaper, but older airframes cost more to maintain and hurt reputation. New listings every month.</p>
  <table class="tbl"><thead><tr><th>Aircraft</th><th class="r">Age</th><th class="r">Price</th><th></th></tr></thead><tbody>
  ${s.used.map((u) => { const t = acType(u.typeId); return `<tr><td><b>${t.name}</b><div class="muted small">${t.maxSeats} seats · ${num(t.rangeKm)} km</div></td><td class="r">${u.ageYears}y</td><td class="r">${money(u.price)}</td><td class="r"><button class="btn sm" data-act="buy-used" data-id="${u.id}">Buy</button></td></tr>`; }).join('')}
  </tbody></table>`;
}

// ---------- Finance ----------

function historyChart(s: GameState): string {
  const h = player(s).history.slice(-12);
  if (!h.length) return '<p class="muted small">Monthly results appear after your first month.</p>';
  const max = Math.max(1, ...h.flatMap((m) => [m.revenue, m.costs]));
  const W = 360, H = 120, bw = W / h.length;
  const bars = h.map((m, i) => {
    const x = i * bw;
    const rh = (m.revenue / max) * (H - 20);
    const ch = (m.costs / max) * (H - 20);
    return `<g><title>${m.label}: revenue ${money(m.revenue)}, costs ${money(m.costs)}, profit ${money(m.profit)}</title>
      <rect x="${x + 3}" y="${H - 14 - rh}" width="${bw / 2 - 4}" height="${rh}" class="rev"/><rect x="${x + bw / 2}" y="${H - 14 - ch}" width="${bw / 2 - 4}" height="${ch}" class="cost"/>
      <text x="${x + bw / 2}" y="${H - 2}" text-anchor="middle">${m.label.slice(0, 3)}</text></g>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart">${bars}</svg><div class="legend"><span class="rev">Revenue</span><span class="cost">Costs</span></div>`;
}

function finance(s: GameState): string {
  const p = player(s);
  const L = p.recent;
  const sum = (k: keyof (typeof L)[number]) => L.reduce((n, l) => n + l[k], 0);
  const rows: [string, number][] = [
    ['Fuel', sum('fuel')], ['Crew & staff', sum('crew')], ['Maintenance', sum('maintenance')], ['Airport & handling', sum('airport')],
    ['Catering & service', sum('service')], ['Leases', sum('leases')], ['Overhead & sales', sum('overhead')], ['Marketing', sum('marketing')], ['Interest', sum('interest')],
  ];
  const rev = sum('revenue');
  const cost = rows.reduce((n, [, v]) => n + v, 0);
  const room = Math.max(0, creditLimit(s, p) - debt(p));
  const svc = ['Basic', 'Standard', 'Premium'];
  const svcText = ['Buy-on-board snacks. Cheapest, but hurts reputation.', 'Free drinks and a meal on longer flights.', 'Restaurant-grade catering and amenity kits. Boosts reputation.'];
  return `<h2>Finance</h2>
  <section class="kpis">
    ${kpi('Cash', money(p.cash), signClass(p.cash))}
    ${kpi('Company value', money(companyValue(s, p)), '', 'Cash + owned aircraft − debt + 4× annualised profit')}
    ${kpi('Debt', money(debt(p)))}
    ${kpi('30-day profit', money(recentProfit(p)), signClass(recentProfit(p)))}
  </section>
  <section class="card"><h3>Last ${L.length} days</h3>
    <table class="tbl"><tbody><tr><td><b>Revenue</b></td><td class="r pos">${money(rev)}</td></tr>
    ${rows.map(([k, v]) => `<tr><td>${k}</td><td class="r">${money(-v)}</td></tr>`).join('')}
    <tr class="total"><td><b>Net</b></td><td class="r ${signClass(rev - cost)}"><b>${money(rev - cost)}</b></td></tr></tbody></table>
  </section>
  <section class="card"><h3>Monthly results</h3>${historyChart(s)}</section>
  <section class="card"><h3>Loans</h3>
    <p class="small muted">Credit available: <b>${money(room)}</b> at about ${(loanRate(s, p, Math.min(room, 25e6)) * 100).toFixed(1)}% a year. Owned aircraft and profits raise your limit.</p>
    <div class="btn-row">${[10e6, 25e6, 50e6, 100e6].map((a) => `<button class="btn" data-act="loan" data-amount="${a}" ${a > room ? 'disabled' : ''}>Borrow ${money(a)}</button>`).join('')}</div>
    ${p.loans.length ? `<table class="tbl"><thead><tr><th>Loan</th><th class="r">Rate</th><th class="r">Balance</th><th></th></tr></thead><tbody>${p.loans.map((l) =>
      `<tr><td>${formatDate(l.takenDay)}</td><td class="r">${(l.rate * 100).toFixed(1)}%</td><td class="r">${money(l.balance)}</td><td class="r"><button class="btn sm" data-act="repay" data-id="${l.id}" data-amount="${Math.min(l.balance, 10e6)}">Repay ${money(Math.min(l.balance, 10e6))}</button> <button class="btn sm" data-act="repay" data-id="${l.id}" data-amount="${l.balance}">All</button></td></tr>`).join('')}</tbody></table>` : ''}
  </section>
  <section class="card"><h3>Service level</h3>
    <div class="seg">${svc.map((name, i) => `<button class="${p.service === i ? 'on' : ''}" data-act="service" data-level="${i}">${name}</button>`).join('')}</div>
    <p class="small muted">${svcText[p.service]}</p>
  </section>
  <section class="card"><h3>Marketing</h3>
    <div class="form-row"><label>Monthly budget<input type="range" min="0" max="10000000" step="250000" value="${p.marketingPerMonth}" data-input="marketing"></label><b id="mkt-out">${money(p.marketingPerMonth)}/mo</b></div>
    <p class="small muted">Raises brand awareness at every airport you serve, so more travellers pick you over rivals.</p>
  </section>
  <section class="card"><h3>Bases</h3>
    <ul class="plain">${p.bases.map((b) => `<li>${airportLabel(b)} <span class="muted small">· ${money(baseCost(b).monthly)}/mo</span></li>`).join('')}</ul>
    <p class="small muted">Open more bases from an airport's page. Every route must start at a base, and bases connect passengers between your routes.</p>
  </section>`;
}

// ---------- Rivals ----------

function rivals(s: GameState): string {
  const rows = s.airlines.map((a) => ({
    a, pax: recentSum(a, 'pax'), rev: recentSum(a, 'revenue'), fleet: fleetOf(s, a.code).length, routes: routesOf(s, a.code).length,
  })).sort((x, y) => y.pax - x.pax);
  return `<h2>Leaderboard</h2><p class="muted small">Last 30 days. Real airlines, simulated markets.</p>
  <table class="tbl click"><thead><tr><th>#</th><th>Airline</th><th class="r">Passengers</th><th class="r">Revenue</th><th class="r">Fleet</th><th class="r">Routes</th></tr></thead><tbody>
  ${rows.map((r, i) => `<tr class="${r.a.isPlayer ? 'me' : ''}" ${r.a.isPlayer ? '' : `data-act="rival" data-code="${r.a.code}"`}><td>${i + 1}</td><td>${chip(r.a.color, r.a.code)} ${esc(r.a.name)}<div class="muted small">${r.a.bases.join(' · ')}</div></td><td class="r">${num(r.pax)}</td><td class="r">${money(r.rev)}</td><td class="r">${r.fleet}</td><td class="r">${r.routes}</td></tr>`).join('')}
  </tbody></table>
  ${milestones(s)}`;
}

function rivalView(s: GameState, v: Extract<View, { kind: 'rival' }>): string {
  const a = s.airlines.find((x) => x.code === v.code);
  if (!a) return '<p>Unknown airline.</p>';
  const fleet = fleetOf(s, a.code);
  const counts = new Map<string, number>();
  for (const ac of fleet) counts.set(ac.typeId, (counts.get(ac.typeId) ?? 0) + 1);
  const types = [...counts.entries()].sort((x, y) => y[1] - x[1]);
  const mine = new Set(routesOf(s, s.playerCode).map((r) => pairKey(r.from, r.to)));
  const clash = routesOf(s, a.code).filter((r) => mine.has(pairKey(r.from, r.to)));
  const moves = s.news.filter((n) => n.text.includes(a.name)).slice(0, 5);
  const threat = threatLabel(a);
  return `<div class="rival-head">${chip(a.color, a.code)}<h2>${esc(a.name)}</h2></div>
  <p class="muted">${archetype(a)} · hubs ${a.bases.join(', ')}</p>
  ${types.length ? `<div class="hero-art">${sideView(types[0][0], liveryOf(a), a.name, a.code)}</div>` : ''}
  <section class="kpis">
    ${kpi('Passengers (30d)', num(recentSum(a, 'pax')))}
    ${kpi('Revenue (30d)', money(recentSum(a, 'revenue')))}
    ${kpi('Fleet', `${fleet.length}`)}
    ${kpi('Routes', `${routesOf(s, a.code).length}`)}
    ${kpi('Reputation', `${Math.round(a.reputation)}`)}
    ${kpi('Threat level', threat, a.aggression >= 0.6 ? 'neg' : a.aggression >= 0.45 ? 'warn' : 'pos', 'How hard they fight newcomers with fare wars and copycat routes')}
  </section>
  <section class="card"><h3>Fleet</h3><table class="tbl"><tbody>${types.map(([id, n]) => `<tr><td>${acType(id).name}</td><td class="r">${n}</td></tr>`).join('')}</tbody></table></section>
  <section class="card"><h3>Where you clash</h3>${clash.length ? `<ul class="plain">${clash.map((r) => `<li>${routeName(r)}${r.warUntil > s.day ? ' <span class="tag bad">fare war</span>' : ''}</li>`).join('')}</ul>` : '<p class="muted">You don\'t share any routes yet.</p>'}</section>
  <section class="card"><h3>Recent moves</h3>${moves.length ? `<ul class="news">${moves.map((n) => `<li class="${n.tone}"><span class="muted">${formatDate(n.day)}</span> ${esc(n.text)}</li>`).join('')}</ul>` : '<p class="muted">Quiet so far.</p>'}</section>`;
}

// ---------- Airport ----------

function airportView(s: GameState, v: Extract<View, { kind: 'airport' }>): string {
  const a = airport(v.code);
  const p = player(s);
  const isBase = p.bases.includes(a.iata);
  const routesHere = s.routes.filter((r) => r.from === a.iata || r.to === a.iata);
  const byAirline = new Map<string, number>();
  for (const r of routesHere) byAirline.set(r.owner, (byAirline.get(r.owner) ?? 0) + 1);
  const airlines = [...byAirline.entries()].map(([code, n]) => ({ al: s.airlines.find((x) => x.code === code)!, n })).sort((x, y) => y.n - x.n);
  const events = s.events.filter((e) => eventAffects(e, a.iata));
  const mineHere = routesHere.filter((r) => r.owner === p.code);
  const { setup, monthly } = baseCost(a.iata);
  const top = AIRPORTS.filter((x) => x.iata !== a.iata && distance(a.iata, x.iata) >= 300).map((x) => ({ x, d: baseDemand(a.iata, x.iata).total * 2 })).sort((m, n) => n.d - m.d).slice(0, 5);
  return `<h2>${a.iata} <span class="muted">${esc(a.name)}</span></h2>
  <p class="muted">${esc(a.city)}, ${a.country} ${isBase ? '<span class="tag good">Your base</span>' : ''}</p>
  <section class="kpis">
    ${kpi('Catchment', `${a.pop}M`)}${kpi('Wealth', dots(Math.round(a.wealth * 3), 5))}${kpi('Tourism', dots(Math.round(a.tourism * 2.5), 5))}
    ${kpi('Airport size', dots(a.size, 5), '', 'Bigger airports charge higher fees')}${kpi('Your awareness', pct(p.awareness[a.iata] ?? 0), '', 'How many travellers here know your brand')}
  </section>
  ${events.length ? `<div class="banner">${events.map((e) => esc(e.title)).join(' · ')}</div>` : ''}
  ${routesHere.length ? boardShell(a.iata, 8) : ''}
  <div class="actions">
    ${!isBase ? p.bases.map((b) => distance(b, a.iata) >= 150 && !mineHere.some((r) => pairKey(r.from, r.to) === pairKey(b, a.iata)) ? `<button class="btn primary" data-act="plan" data-from="${b}" data-to="${a.iata}">Plan ${b} → ${a.iata}</button>` : '').join('') : '<button class="btn primary" data-act="new-route">Plan a route from here</button>'}
    ${!isBase ? `<button class="btn" data-act="open-base" data-code="${a.iata}" title="${money(monthly)}/month">Open base (${money(setup)})</button>` : ''}
  </div>
  ${mineHere.length ? `<section class="card"><h3>Your routes here</h3><ul class="plain">${mineHere.map((r) => `<li><a data-act="route" data-id="${r.id}">${routeName(r)}</a></li>`).join('')}</ul></section>` : ''}
  <section class="card"><h3>Airlines here</h3>${airlines.length ? `<ul class="plain">${airlines.map(({ al, n }) => `<li>${chip(al.color, al.code)} ${esc(al.name)} <span class="muted small">· ${n} route${n === 1 ? '' : 's'}</span></li>`).join('')}</ul>` : '<p class="muted">No modelled airline serves this airport yet.</p>'}</section>
  <section class="card"><h3>Biggest markets from ${a.iata}</h3><table class="tbl"><tbody>${top.map(({ x, d }) => `<tr><td>${airportLabel(x.iata)}</td><td class="r">${num(d)} pax/day</td></tr>`).join('')}</tbody></table></section>`;
}

export function renderView(s: GameState, v: View): string {
  switch (v.kind) {
    case 'overview': return overview(s);
    case 'routes': return routesView(s);
    case 'route': return routeDetail(s, v);
    case 'planner': return planner(s, v);
    case 'fleet': return fleetView(s);
    case 'aircraft': return aircraftDetail(s, v);
    case 'market': return market(s, v);
    case 'finance': return finance(s);
    case 'rivals': return rivals(s);
    case 'airport': return airportView(s, v);
    case 'news': return news(s);
    case 'rival': return rivalView(s, v);
  }
}

export function tabOf(v: View): View['kind'] {
  switch (v.kind) {
    case 'route': case 'planner': return 'routes';
    case 'aircraft': return 'fleet';
    case 'airport': case 'news': return 'overview';
    case 'rival': return 'rivals';
    default: return v.kind;
  }
}

export function isAirport(code: string): boolean {
  return AIRPORTS.some((a) => a.iata === code);
}
