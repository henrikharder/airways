// Day–night cycle: a dusk/night shade over the world, and additive lights above
// it (terminal glazing, floodlit stands, runway and taxiway lights, street lamps,
// aircraft navigation lights, vehicle headlights).

import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { MODULES, spriteType } from '../game/catalog';
import { runway } from '../game/flights';
import { idx, localPoint } from '../game/grid';
import type { GameState } from '../game/types';
import { T } from '../game/types';
import { AC_SIZE, FACING, isoX, isoY, TH, TW, ZPX } from './iso';

/** 0 by day, 1 at night, ramping through dawn (05–07) and dusk (19–21). */
export function darkness(minute: number): number {
  const h = (minute % 1440) / 60;
  if (h < 5 || h >= 21) return 1;
  if (h < 7) return 1 - (h - 5) / 2;
  if (h >= 19) return (h - 19) / 2;
  return 0;
}

export interface Mover { x: number; y: number; dir: 1 | -1 }

export class Lights {
  /** Screen-space shade, sits between the world and the light layer. */
  shade = new Graphics();
  /** World-space additive lights (the caller keeps its transform in step with the world). */
  layer = new Container();
  private fixed = new Graphics();
  private moving = new Graphics();
  private fixedPools = new Container();
  private movingPools = new Container();
  private used = 0;
  private builtFor = -1;
  private soft: Texture;

  constructor() {
    this.fixed.blendMode = 'add';
    this.moving.blendMode = 'add';
    this.layer.addChild(this.fixedPools, this.movingPools, this.fixed, this.moving);
    // soft round falloff used for every pool of light
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    this.soft = Texture.from(c);
  }

  update(s: GameState, stamp: number, screenW: number, screenH: number, traffic: Mover[]): void {
    const dark = darkness(s.minute);
    const dusk = dark > 0 && dark < 1;
    this.shade.clear();
    if (dark > 0) this.shade.rect(0, 0, screenW, screenH).fill({ color: dusk ? 0x241a46 : 0x07142f, alpha: 0.62 * dark });
    this.layer.visible = dark > 0.05;
    this.layer.alpha = Math.min(1, dark * 1.2);
    if (!this.layer.visible) return;
    if (stamp !== this.builtFor) {
      this.builtFor = stamp;
      this.drawFixed(s);
    }
    this.drawMoving(s, traffic);
  }

  private glow(g: Graphics, sx: number, sy: number, color: number, r: number, core = 0.9): void {
    g.circle(sx, sy, r * 3).fill({ color, alpha: 0.1 });
    g.circle(sx, sy, r * 1.6).fill({ color, alpha: 0.25 });
    g.circle(sx, sy, r * 0.7).fill({ color, alpha: core });
  }

  /** Soft elliptical pool of light on the ground, radius in tiles. */
  private pool(into: Container, x: number, y: number, r: number, color: number, strength = 0.07, reuse = false): void {
    let sp: Sprite;
    if (reuse && this.used < into.children.length) sp = into.children[this.used] as Sprite;
    else {
      sp = new Sprite(this.soft);
      sp.anchor.set(0.5);
      sp.blendMode = 'add';
      into.addChild(sp);
    }
    if (reuse) this.used++;
    sp.visible = true;
    sp.position.set(isoX(x, y), isoY(x, y));
    sp.width = (2 * r * TW) / Math.SQRT2;
    sp.height = (2 * r * TH) / Math.SQRT2;
    sp.tint = color;
    sp.alpha = Math.min(1, strength * 5);
  }

  private drawFixed(s: GameState): void {
    const g = this.fixed.clear();
    for (const c of this.fixedPools.removeChildren()) c.destroy();
    const P = this.fixedPools;
    const t = (x: number, y: number) => (x < 0 || y < 0 || x >= s.W || y >= s.H ? -1 : s.tiles[idx(s, x, y)]);
    const indoor = (v: number) => v === T.Floor || v === T.Barrier;
    // warm interiors and glowing glass where the terminal meets the outside
    for (let y = 0; y < s.H; y++) for (let x = 0; x < s.W; x++) {
      if (!indoor(t(x, y))) continue;
      const pts = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]].flatMap(([a, b]) => [isoX(a, b), isoY(a, b)]);
      g.poly(pts).fill({ color: 0x5a3c14, alpha: 0.55 });
      const wall = (x0: number, y0: number, x1: number, y1: number) => {
        const h = ZPX * 0.32;
        const ax = isoX(x0, y0), ay = isoY(x0, y0), bx = isoX(x1, y1), by = isoY(x1, y1);
        g.poly([ax, ay, bx, by, bx, by - h, ax, ay - h]).fill({ color: 0xffc46b, alpha: 0.6 });
      };
      if (!indoor(t(x, y - 1))) wall(x, y, x + 1, y);
      if (!indoor(t(x - 1, y))) wall(x, y, x, y + 1);
      if (!indoor(t(x, y + 1))) wall(x, y + 1, x + 1, y + 1);
      if (!indoor(t(x + 1, y))) wall(x + 1, y, x + 1, y + 1);
    }
    for (const b of s.buildings) {
      const m = MODULES[b.kind];
      if (b.kind.startsWith('stand_')) this.pool(P, ...localPoint(b, m.w / 2, m.h / 2), m.w * 0.55, 0xffe6b8, 0.06);
      else if (b.kind === 'carpark') this.pool(P, b.x + b.w / 2, b.y + b.h / 2, 3.5, 0xffd9a0, 0.05);
      else if (b.kind === 'tower') {
        const [x, y] = [b.x + 1.5, b.y + 1.5];
        this.glow(g, isoX(x, y), isoY(x, y) - 6.95 * ZPX, 0x9fe3ff, 9, 0.35);
      } else if (m.indoor) this.pool(P, b.x + b.w / 2, b.y + b.h / 2, Math.max(b.w, b.h) * 0.6, 0xffcf8a, 0.05);
    }
    // runway edge lights (white), threshold green, far end red
    const rw = runway(s);
    if (rw) {
      const along = rw.rot % 2 === 0;
      const len = along ? rw.w : rw.h;
      const cx = along ? rw.y + rw.h / 2 : rw.x + rw.w / 2;
      const P = (a: number, c: number): [number, number] => (along ? [rw.x + a, c] : [c, rw.y + a]);
      for (let a = 1; a < len - 0.5; a += 1.5) for (const side of [-2.4, 2.4]) {
        const [x, y] = P(a, cx + side);
        this.glow(g, isoX(x, y), isoY(x, y), 0xfff4d6, 1.4);
      }
      for (let k = -2; k <= 2; k += 0.5) {
        const [gx, gy] = P(0.4, cx + k);
        this.glow(g, isoX(gx, gy), isoY(gx, gy), 0x4ade80, 1.3);
        const [rx, ry] = P(len - 0.4, cx + k);
        this.glow(g, isoX(rx, ry), isoY(rx, ry), 0xf87171, 1.3);
      }
    }
    // green taxiway centreline studs
    for (let y = 0; y < s.H; y++) for (let x = 0; x < s.W; x++) {
      if (t(x, y) !== T.Taxiway || (x + y) % 2) continue;
      this.glow(g, isoX(x + 0.5, y + 0.5), isoY(x + 0.5, y + 0.5), 0x4ade80, 0.9);
    }
    // street lamps along the road
    for (let x = 2; x < s.W; x += 6) {
      if (t(x, s.H - 3) !== T.Road) continue;
      this.pool(P, x, s.H - 2, 1.6, 0xffcf8a, 0.07);
    }
  }

  private drawMoving(s: GameState, traffic: Mover[]): void {
    const g = this.moving.clear();
    const now = performance.now() / 1000;
    const M = this.movingPools;
    this.used = 0;
    for (const f of s.flights) {
      if (f.phase === 'scheduled' || f.phase === 'departed' || f.phase === 'cancelled') continue;
      const [L, span, D] = AC_SIZE[spriteType(f.typeId)] ?? AC_SIZE.A20N;
      const [fx, fy] = FACING[f.facing];
      const [rx, ry] = [-fy, fx]; // right wing
      const lift = (f.alt + D * 0.9) * ZPX;
      const at = (along: number, side: number, z = 0): [number, number] => {
        const x = f.x + fx * along + rx * side, y = f.y + fy * along + ry * side;
        return [isoX(x, y), isoY(x, y) - lift - z * ZPX];
      };
      // navigation lights: red port, green starboard; white strobes and a red beacon that blink
      this.glow(g, ...at(-L * 0.05, -span / 2), 0xff3b3b, 1.6);
      this.glow(g, ...at(-L * 0.05, span / 2), 0x3bff7a, 1.6);
      if (now % 1.2 < 0.08) for (const side of [-1, 1]) this.glow(g, ...at(-L * 0.05, (side * span) / 2), 0xffffff, 3);
      if (now % 1.0 < 0.5) this.glow(g, ...at(0, 0, D * 0.6), 0xff2a2a, 1.8);
      // landing and taxi lights
      const moving = f.phase !== 'parked' && f.phase !== 'parking';
      if (moving) {
        this.glow(g, ...at(L / 2 + 0.3, 0), 0xfff6dd, 3, 0.8);
        const [gx, gy] = [f.x + fx * (L / 2 + 2.5), f.y + fy * (L / 2 + 2.5)];
        if (f.alt < 0.5) this.pool(M, gx, gy, 2.2, 0xfff3d0, 0.06, true);
      }
    }
    for (const t of traffic) {
      const [hx, hy] = [t.x + t.dir * 0.5, t.y];
      this.glow(g, isoX(hx, hy), isoY(hx, hy) - 0.13 * ZPX, 0xfff3c4, 1.4);
      this.pool(M, t.x + t.dir * 1.6, t.y, 0.9, 0xfff3c4, 0.08, true);
      const [bx, by] = [t.x - t.dir * 0.48, t.y];
      this.glow(g, isoX(bx, by), isoY(bx, by) - 0.13 * ZPX, 0xff3030, 1.0);
    }
    for (let i = this.used; i < M.children.length; i++) M.children[i].visible = false;
  }
}
