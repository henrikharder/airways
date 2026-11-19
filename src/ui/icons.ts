// Filled pictograms (Phosphor, MIT) in the spirit of airport wayfinding symbols,
// inlined as SVG strings.

import armchair from '@phosphor-icons/core/assets/fill/armchair-fill.svg?raw';
import buildings from '@phosphor-icons/core/assets/fill/buildings-fill.svg?raw';
import car from '@phosphor-icons/core/assets/fill/car-fill.svg?raw';
import roadHorizon from '@phosphor-icons/core/assets/fill/road-horizon-fill.svg?raw';
import doorOpen from '@phosphor-icons/core/assets/fill/door-open-fill.svg?raw';
import gauge from '@phosphor-icons/core/assets/fill/gauge-fill.svg?raw';
import squaresFour from '@phosphor-icons/core/assets/fill/squares-four-fill.svg?raw';
import info from '@phosphor-icons/core/assets/fill/info-fill.svg?raw';
import bank from '@phosphor-icons/core/assets/fill/bank-fill.svg?raw';
import suitcase from '@phosphor-icons/core/assets/fill/suitcase-rolling-fill.svg?raw';
import mapTrifold from '@phosphor-icons/core/assets/fill/map-trifold-fill.svg?raw';
import list from '@phosphor-icons/core/assets/fill/list-fill.svg?raw';
import cursor from '@phosphor-icons/core/assets/fill/cursor-fill.svg?raw';
import pause from '@phosphor-icons/core/assets/fill/pause-fill.svg?raw';
import airplane from '@phosphor-icons/core/assets/fill/airplane-fill.svg?raw';
import landing from '@phosphor-icons/core/assets/fill/airplane-landing-fill.svg?raw';
import takeoff from '@phosphor-icons/core/assets/fill/airplane-takeoff-fill.svg?raw';
import rotate from '@phosphor-icons/core/assets/fill/arrow-clockwise-fill.svg?raw';
import rotateBack from '@phosphor-icons/core/assets/fill/arrow-counter-clockwise-fill.svg?raw';
import path from '@phosphor-icons/core/assets/fill/path-fill.svg?raw';
import scan from '@phosphor-icons/core/assets/fill/scan-fill.svg?raw';
import shoppingBag from '@phosphor-icons/core/assets/fill/shopping-bag-fill.svg?raw';
import bulldozer from '@phosphor-icons/core/assets/fill/bulldozer-fill.svg?raw';
import airplaneTilt from '@phosphor-icons/core/assets/fill/airplane-tilt-fill.svg?raw';
import target from '@phosphor-icons/core/assets/fill/target-fill.svg?raw';
import ticket from '@phosphor-icons/core/assets/fill/ticket-fill.svg?raw';
import toilet from '@phosphor-icons/core/assets/fill/toilet-fill.svg?raw';
import cellTower from '@phosphor-icons/core/assets/fill/cell-tower-fill.svg?raw';
import tree from '@phosphor-icons/core/assets/fill/tree-evergreen-fill.svg?raw';
import warning from '@phosphor-icons/core/assets/fill/warning-fill.svg?raw';
import trophy from '@phosphor-icons/core/assets/fill/trophy-fill.svg?raw';
import users from '@phosphor-icons/core/assets/fill/users-three-fill.svg?raw';
import forkKnife from '@phosphor-icons/core/assets/fill/fork-knife-fill.svg?raw';
import wallet from '@phosphor-icons/core/assets/fill/wallet-fill.svg?raw';
import x from '@phosphor-icons/core/assets/fill/x-fill.svg?raw';
import wall from '@phosphor-icons/core/assets/fill/wall-fill.svg?raw';
import signOut from '@phosphor-icons/core/assets/fill/sign-out-fill.svg?raw';
import bus from '@phosphor-icons/core/assets/fill/bus-fill.svg?raw';
import idCard from '@phosphor-icons/core/assets/fill/identification-card-fill.svg?raw';
import bridge from '@phosphor-icons/core/assets/fill/bridge-fill.svg?raw';
import train from '@phosphor-icons/core/assets/fill/train-fill.svg?raw';
import medal from '@phosphor-icons/core/assets/fill/medal-fill.svg?raw';

const ICONS = {
  seats: armchair, terminal: buildings, car, runway: roadHorizon, entrance: doorOpen, gauge, floor: squaresFour, info,
  board: bank, baggage: suitcase, map: mapTrifold, menu: list, select: cursor, pause, plane: airplane, landing,
  takeoff, rotate, rotateBack, taxiway: path, security: scan, shop: shoppingBag, bulldoze: bulldozer, stand: airplaneTilt,
  target, checkin: ticket, toilets: toilet, tower: cellTower, tree, alert: warning, trophy,
  gate: users, food: forkKnife, wallet, close: x, barrier: wall, exit: signOut, bus, passport: idCard, bridge, train, medal,
} as const;

export type IconName = keyof typeof ICONS;

/** Inline SVG pictogram that inherits colour and scales with font size. */
export function icon(name: IconName, cls = ''): string {
  return ICONS[name].replace('<svg ', `<svg aria-hidden="true" width="1em" height="1em" class="ico ${cls}" `);
}

/** Brand mark: the airport's own sign plate, a black aircraft pictogram on yellow. */
export function logoMark(cls = 'logo-mark'): string {
  return `<span class="${cls}">${icon('plane')}</span>`;
}
