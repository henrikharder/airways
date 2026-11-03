// Modal and card markup: decisions, board meetings, celebrations, livery
// designer and flight cards.

import { acType } from '../data/aircraft';
import { airport } from '../data/airports';
import type { Achievement } from '../engine/achievements';
import { repaintCost } from '../engine/actions';
import { distance } from '../engine/geo';
import { currentLeg, flightNumber } from '../engine/schedule';
import { player } from '../engine/state';
import type { Aircraft, Decision, GameState, Livery, LiveryPattern } from '../engine/types';
import { liveryOf, sideView } from './aircraftArt';
import { esc, money } from './format';
import { poster, sceneFor, type Scene } from './posters';
import { decisionIcon, icon } from './icons';

/** The aircraft type an airline flies most, for artwork. */
export function mainType(s: GameState, code: string): string {
  const counts = new Map<string, number>();
  for (const ac of s.aircraft) if (ac.owner === code) counts.set(ac.typeId, (counts.get(ac.typeId) ?? 0) + 1);
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return best?.[0] ?? s.airlines.find((a) => a.code === code)?.fleetTypes[0] ?? 'A20N';
}

function posterFor(s: GameState, scene: Scene, rivalCode?: string): string {
  const p = player(s);
  const rv = rivalCode ? s.airlines.find((a) => a.code === rivalCode) : undefined;
  return poster(scene, mainType(s, p.code), liveryOf(p), p.name, p.code,
    rv ? { typeId: mainType(s, rv.code), livery: liveryOf(rv), name: rv.name, code: rv.code } : undefined);
}

export function decisionModal(s: GameState, d: Decision): string {
  return `<div class="modal decision has-poster">
    <div class="poster">${posterFor(s, sceneFor(d.kind), typeof d.data.rival === 'string' ? d.data.rival : undefined)}<div class="poster-badge">${icon(decisionIcon(d.kind))}</div></div>
    <h2>${esc(d.title)}</h2>
    <p>${esc(d.body)}</p>
    ${d.quote ? `<blockquote>“${esc(d.quote.text)}”<cite>— ${esc(d.quote.by)}</cite></blockquote>` : ''}
    <div class="dc-options">${d.options.map((o, i) => `<button class="dc-opt" data-act="decide" data-id="${d.id}" data-choice="${i}"><b>${esc(o.label)}</b><span>${esc(o.detail)}</span></button>`).join('')}</div>
  </div>`;
}

const CHAIR_GOOD = ['Excellent quarter. Keep this up and we will talk about a bigger office.', 'The shareholders are delighted. Do not let it go to your head.'];
const CHAIR_BAD = ['We expected more. Do not make us have this conversation again.', 'The board is concerned. Very concerned. Fix it.'];

export function boardModal(s: GameState): string {
  const m = s.board.meeting!;
  const conf = s.board.confidence;
  const quote = (m.success ? CHAIR_GOOD : CHAIR_BAD)[s.day % 2];
  return `<div class="modal decision has-poster">
    <div class="poster">${posterFor(s, m.success ? 'gold' : 'night')}<div class="poster-badge">${icon('board')}</div></div>
    <h2>${esc(m.title)}</h2>
    <div class="banner ${m.success ? 'good' : 'bad'}">${esc(m.summary)}</div>
    <blockquote>“${quote}”<cite>— Chair of the board</cite></blockquote>
    <div class="conf"><span>Board confidence</span><div class="meter ${conf < 30 ? 'low' : conf < 60 ? 'mid' : 'high'}"><i style="width:${conf}%"></i></div><b>${Math.round(conf)}</b></div>
    ${conf < 30 ? '<p class="neg small">If confidence reaches zero, the board will replace you.</p>' : ''}
    <p>Objective for next quarter: <b>${esc(m.next)}</b></p>
    <div class="actions"><button class="btn primary" data-act="board-ok">Back to work</button></div>
  </div>`;
}

export function milestoneModal(s: GameState, a: Achievement): string {
  const confetti = Array.from({ length: 36 }, (_, i) => `<i style="--x:${(i * 37) % 100}%;--d:${(i % 7) * 0.12}s;--c:${['#ffb703', '#4cc9f0', '#ff4f7b', '#3ddc97', '#8e7dff'][i % 5]}"></i>`).join('');
  return `<div class="modal small celebrate has-poster"><div class="poster">${posterFor(s, 'gold')}<div class="poster-badge">${icon('trophy')}</div></div><div class="confetti">${confetti}</div><h2>${esc(a.name)}</h2><p class="muted">${esc(a.desc)}</p>
    <div class="actions center"><button class="btn primary" data-act="close-modal">Brilliant</button></div></div>`;
}

export function deliveryCard(s: GameState, ac: Aircraft): string {
  const p = player(s);
  return `<div class="delivery"><div class="dl-art">${sideView(ac.typeId, liveryOf(p), p.name, p.code)}</div>
    <div><b>Delivery day!</b><div class="muted small">${ac.reg} · ${acType(ac.typeId).name} joins the ${esc(p.name)} fleet.</div></div></div>`;
}

export const PATTERNS: { id: LiveryPattern; name: string }[] = [
  { id: 'classic', name: 'Classic' }, { id: 'cheatline', name: 'Cheatline' }, { id: 'swoosh', name: 'Swoosh' },
  { id: 'tailfin', name: 'Bold tail' }, { id: 'bold', name: 'Full colour' },
];
export const LIVERY_COLORS = ['#ff4f7b', '#e63946', '#ff7f11', '#ffb703', '#2ec4b6', '#06d6a0', '#4cc9f0', '#3a86ff', '#8e7dff', '#f72585', '#0b1220', '#ffffff'];

export function liveryModal(s: GameState, draft: Livery): string {
  const p = player(s);
  const types = [...new Set(s.aircraft.filter((a) => a.owner === p.code).map((a) => a.typeId))];
  const show = (types.length ? types : ['A20N', 'B789']).slice(0, 2);
  const cost = repaintCost(s);
  const sw = (key: 'primary' | 'secondary') => LIVERY_COLORS.map((c) => `<button class="swatch ${draft[key] === c ? 'on' : ''}" style="--c:${c}" data-act="lv-color" data-key="${key}" data-color="${c}"></button>`).join('')
    + `<input type="color" value="${draft[key]}" data-input="lv-${key}" title="Custom colour">`;
  return `<div class="modal livery">
    <h2>Livery designer</h2>
    <div class="lv-preview">${show.map((t) => sideView(t, draft, p.name, p.code)).join('')}</div>
    <span class="label">Pattern</span>
    <div class="seg">${PATTERNS.map((x) => `<button class="${draft.pattern === x.id ? 'on' : ''}" data-act="lv-pattern" data-pattern="${x.id}">${x.name}</button>`).join('')}</div>
    <span class="label">Main colour</span><div class="swatches">${sw('primary')}</div>
    <span class="label">Accent colour</span><div class="swatches">${sw('secondary')}</div>
    <div class="actions"><button class="btn primary" data-act="lv-save">${cost ? `Repaint fleet (${money(cost)})` : 'Save livery'}</button><button class="btn" data-act="close-modal">Cancel</button></div>
  </div>`;
}

export function flightCard(s: GameState, ac: Aircraft, pinned: boolean): string {
  const routes = new Map(s.routes.map((r) => [r.id, r]));
  const cur = currentLeg(ac, routes, s.minute);
  const owner = s.airlines.find((a) => a.code === ac.owner)!;
  const t = acType(ac.typeId);
  if (!cur) {
    return `<div class="fc-head">${pinned ? '' : ''}<b>${ac.reg}</b> <span class="muted">${esc(t.name)} · on the ground</span>${pinned ? `<button class="link" data-act="unfollow">${icon('close')}</button>` : ''}</div>`;
  }
  const { leg, p } = cur;
  const from = airport(leg.outbound ? leg.route.from : leg.route.to);
  const to = airport(leg.outbound ? leg.route.to : leg.route.from);
  const cruise = t.category === 'turboprop' ? 250 : 370;
  const fl = Math.round((cruise * Math.min(1, p / 0.12, (1 - p) / 0.14)) / 10) * 10;
  const speed = Math.round(t.speedKmh * Math.min(1, 0.45 + Math.min(p, 1 - p) * 6));
  const r = leg.route.last;
  const pax = r.legs ? Math.round((r.paxY + r.paxJ + r.transfer) / r.legs) : 0;
  const hhmm = (m: number) => { const x = ((Math.floor(m) % 1440) + 1440) % 1440; return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };
  const left = Math.round(distance(from.iata, to.iata) * (1 - p));
  return `<div class="fc-head"><span class="chip" style="--c:${owner.color}">${flightNumber(leg)}</span> <b>${from.iata} → ${to.iata}</b>
      ${pinned ? `<span class="spacer"></span><button class="link" data-act="unfollow" title="Stop following">${icon('close')}</button>` : ''}</div>
    ${pinned ? `<div class="fc-art">${sideView(ac.typeId, liveryOf(owner), owner.name, owner.code)}</div>` : ''}
    <div class="fc-cities muted small">${esc(from.city)} → ${esc(to.city)}</div>
    <div class="fc-progress"><i style="width:${(p * 100).toFixed(1)}%"></i></div>
    <div class="fc-grid">
      <span>Aircraft</span><b>${esc(t.name)}</b>
      <span>Tail</span><b>${ac.reg}</b>
      <span>Altitude</span><b>${fl > 0 ? `FL${fl}` : 'Taxi'}</b>
      <span>Speed</span><b>${speed} km/h</b>
      <span>On board</span><b>~${pax} pax</b>
      <span>Remaining</span><b>${left.toLocaleString('en-US')} km</b>
      <span>Departed</span><b>${hhmm(leg.dep)}</b>
      <span>Arrives</span><b>${hhmm(leg.arr)}</b>
    </div>
    ${pinned ? `<div class="actions">${owner.isPlayer ? `<button class="btn sm" data-act="route" data-id="${leg.route.id}">Open route</button>` : `<button class="btn sm" data-act="rival" data-code="${owner.code}">${esc(owner.name)}</button>`}<button class="btn sm" data-act="unfollow">Stop following</button></div>` : '<div class="muted small">Click to follow</div>'}`;
}
