// Pause menu, settings and save slots. Settings are a per-browser preference.

import { SLOTS, slotInfo } from '../game/save';
import { esc, money } from './format';
import type { SoundSettings } from './sound';

export interface Settings extends SoundSettings { tips: boolean }

const KEY = 'airways.settings';
const DEFAULTS: Settings = { volume: 0.6, ambience: true, effects: true, tips: true };

export function loadSettings(): Settings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private window: keep in memory */ }
}

const when = (t: number) => (t ? new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

function slots(mode: 'save' | 'load'): string {
  return SLOTS.filter((n) => mode === 'load' || n > 0).map((n) => {
    const info = slotInfo(n);
    const label = n === 0 ? 'Autosave' : `Slot ${n}`;
    const desc = info ? `<b>${esc(info.name)}</b> (${esc(info.code)}) · day ${info.day} · ${money(info.cash)}<div class="small muted">${when(info.savedAt)}</div>` : '<span class="muted">Empty</span>';
    const btn = mode === 'save'
      ? `<button class="btn sm ${info ? '' : 'primary'}" data-act="save-slot" data-slot="${n}">${info ? 'Overwrite' : 'Save'}</button>`
      : `<button class="btn sm primary" data-act="load-slot" data-slot="${n}" ${info ? '' : 'disabled'}>Load</button>`;
    return `<div class="slot"><span class="slot-n">${label}</span><div class="slot-d">${desc}</div>${btn}</div>`;
  }).join('');
}

export function pauseMenu(page: 'main' | 'save' | 'load' | 'settings', settings: Settings): string {
  const back = '<button class="back" data-act="menu" data-page="main">← Back</button>';
  if (page === 'save') return `<div class="modal small menu">${back}<h2>Save game</h2>${slots('save')}</div>`;
  if (page === 'load') return `<div class="modal small menu">${back}<h2>Load game</h2>${slots('load')}</div>`;
  if (page === 'settings') {
    const tog = (k: keyof Settings, label: string) => `<label class="toggle"><input type="checkbox" data-setting="${k}" ${settings[k] ? 'checked' : ''}> ${label}</label>`;
    return `<div class="modal small menu">${back}<h2>Settings</h2>
      <label>Volume<input type="range" min="0" max="1" step="0.05" value="${settings.volume}" data-setting="volume"></label>
      ${tog('ambience', 'Ambient sound (terminal and aircraft)')}
      ${tog('effects', 'Sound effects and chimes')}
      ${tog('tips', 'Introduce new systems as they come up')}
      <button class="btn sm" data-act="restart-tutorial">Restart the guided tutorial</button>
    </div>`;
  }
  return `<div class="modal small menu"><h2>Paused</h2>
    <div class="menu-list">
      <button class="btn primary big" data-act="menu-close">Resume</button>
      <button class="btn" data-act="menu" data-page="save">Save game</button>
      <button class="btn" data-act="menu" data-page="load">Load game</button>
      <button class="btn" data-act="menu" data-page="settings">Settings</button>
      <button class="btn danger" data-act="new">New airport</button>
      <a class="btn" href="https://github.com/henrikharder/airways/issues/new?template=feedback.md" target="_blank" rel="noopener">Send feedback</a>
    </div>
    <p class="small muted">Esc opens and closes this menu. The game autosaves every day.</p></div>`;
}
