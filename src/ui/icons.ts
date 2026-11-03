// One consistent outline icon set (Lucide), inlined as SVG strings.

import {
  ArrowLeft, Award, BadgeDollarSign, Building2, Camera, ChartLine, CircleAlert, ClipboardCheck, CloudAlert, Factory, Flag,
  Fuel, Gauge, Globe, Landmark, Layers, Leaf, Lock, Map, Menu, Mountain, Pause, Plane, PlaneLanding, PlaneTakeoff, Radar,
  Route, Star, Swords, Target, Ticket, TrendingUp, Trophy, Users, Volume2, VolumeX, X,
} from 'lucide-static';

const ICONS = {
  back: ArrowLeft, award: Award, money: BadgeDollarSign, building: Building2, camera: Camera, chart: ChartLine, alert: CircleAlert,
  audit: ClipboardCheck, weather: CloudAlert, factory: Factory, flag: Flag, fuel: Fuel, gauge: Gauge, globe: Globe, board: Landmark,
  layers: Layers, leaf: Leaf, lock: Lock, map: Map, menu: Menu, volcano: Mountain, pause: Pause, plane: Plane, landing: PlaneLanding,
  takeoff: PlaneTakeoff, radar: Radar, route: Route, star: Star, swords: Swords, target: Target, ticket: Ticket, trend: TrendingUp,
  trophy: Trophy, crew: Users, sound: Volume2, mute: VolumeX, close: X,
} as const;

export type IconName = keyof typeof ICONS;

/** Inline SVG icon that inherits colour and scales with font size. */
export function icon(name: IconName, cls = ''): string {
  return ICONS[name]
    .replace(/width="24"/, 'width="1em"')
    .replace(/height="24"/, 'height="1em"')
    .replace('class="lucide', `aria-hidden="true" class="ico ${cls} lucide`);
}

/** Icon for a decision card kind. */
export function decisionIcon(kind: string): IconName {
  const map: Record<string, IconName> = {
    crew_pay: 'crew', charter: 'ticket', oem_deal: 'factory', fuel_hedge: 'fuel', audit: 'audit', influencer: 'camera',
    saf: 'leaf', rival_war: 'swords', rival_entry: 'landing', ash: 'volcano',
  };
  return map[kind] ?? 'alert';
}

/** Brand mark: a swept tail fin over a horizon line. */
export function logoMark(cls = 'logo-mark'): string {
  return `<svg class="${cls}" viewBox="0 0 32 32" aria-hidden="true"><path d="M7 25 L17 6 L25 6 L19 25 Z" fill="var(--accent)"/><path d="M19 25 L25 6 L27 6 L22 25 Z" fill="var(--accent)" opacity=".55"/><path d="M3 27.5 H29" stroke="var(--data)" stroke-width="2" stroke-linecap="round"/></svg>`;
}
