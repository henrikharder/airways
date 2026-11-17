// One consistent outline icon set (Lucide), inlined as SVG strings.

import {
  Armchair, Building2, Car, Construction, DoorOpen, Fence, LogOut, Gauge, Grid3x3, Info, Landmark, Luggage, Map, Menu, MousePointer2,
  Pause, Plane, PlaneLanding, PlaneTakeoff, RotateCw, Route, ScanLine, ShoppingBag, Shovel, Square, Target, Ticket, Toilet,
  TowerControl, TreePine, TriangleAlert, Trophy, Users, Utensils, Wallet, X,
} from 'lucide-static';

const ICONS = {
  seats: Armchair, terminal: Building2, car: Car, runway: Construction, entrance: DoorOpen, gauge: Gauge, floor: Grid3x3, info: Info,
  board: Landmark, baggage: Luggage, map: Map, menu: Menu, select: MousePointer2, pause: Pause, plane: Plane, landing: PlaneLanding,
  takeoff: PlaneTakeoff, rotate: RotateCw, taxiway: Route, security: ScanLine, shop: ShoppingBag, bulldoze: Shovel, stand: Square,
  target: Target, checkin: Ticket, toilets: Toilet, tower: TowerControl, tree: TreePine, alert: TriangleAlert, trophy: Trophy,
  gate: Users, food: Utensils, wallet: Wallet, close: X, barrier: Fence, exit: LogOut,
} as const;

export type IconName = keyof typeof ICONS;

/** Inline SVG icon that inherits colour and scales with font size. */
export function icon(name: IconName, cls = ''): string {
  return ICONS[name]
    .replace(/width="24"/, 'width="1em"')
    .replace(/height="24"/, 'height="1em"')
    .replace('class="lucide', `aria-hidden="true" class="ico ${cls} lucide`);
}

/** Brand mark: a swept tail fin over a horizon line. */
export function logoMark(cls = 'logo-mark'): string {
  return `<svg class="${cls}" viewBox="0 0 32 32" aria-hidden="true"><path d="M7 25 L17 6 L25 6 L19 25 Z" fill="var(--accent)"/><path d="M19 25 L25 6 L27 6 L22 25 Z" fill="var(--accent)" opacity=".55"/><path d="M3 27.5 H29" stroke="var(--data)" stroke-width="2" stroke-linecap="round"/></svg>`;
}
