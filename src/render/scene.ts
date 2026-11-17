// Isometric renderer (PixiJS). Ground is painted with vector graphics; every
// building, aircraft and passenger is a Blender-rendered sprite, depth sorted.

import { Application, Assets, Container, Graphics, Sprite, Texture } from 'pixi.js';
import manifest from '../generated/sprites.json';
import { MODULES, spriteType } from '../game/catalog';
import { airlineColor, runway } from '../game/flights';
import { footprint, getLayout, idx, localPoint, standPoints } from '../game/grid';
import type { Building, GameState, ModuleKind } from '../game/types';
import { T } from '../game/types';

export const TW = 32; // tile diamond width at zoom 1
export const TH = 16;
const ZPX = 20.2; // screen px per tile of height at zoom 1
const SRC_TILE = 64; // tile width in rendered sprites (manifest scale 1)

type Frame = { w: number; h: number; ax: number; ay: number; scale: number };
const FRAMES = manifest as Record<string, Frame>;

export const isoX = (x: number, y: number) => ((x - y) * TW) / 2;
export const isoY = (x: number, y: number) => ((x + y) * TH) / 2;

export function screenToGrid(sx: number, sy: number): [number, number] {
  const a = sy / (TH / 2);
  const b = sx / (TW / 2);
  return [(a + b) / 2, (a - b) / 2];
}

const COLORS = {
  grass: [0x7cc96a, 0x76c464, 0x82cf70],
  apron: 0xc7cbd3,
  taxiway: 0x8e949f,
  runway: 0x51565f,
  floor: 0xefe9de,
  floorAlt: 0xe8e1d4,
  road: 0x5b616b,
  parking: 0x6a707a,
};

export interface Ghost {
  kind?: ModuleKind;
  x: number;
  y: number;
  rot: number;
  ok: boolean;
  rect?: [number, number, number, number]; // paint/bulldoze rectangle
}

export class Scene {
  app = new Application();
  world = new Container();
  private ground = new Graphics();
  private overlay = new Graphics();
  private objects = new Container();
  private textures = new Map<string, Texture>();
  private buildingSprites = new Map<number, Container>();
  private aircraftSprites = new Map<number, Container>();
  private paxSprites = new Map<number, Sprite>();
  private ghostSprite: Sprite | null = null;
  private groundStamp = -1;
  zoom = 1.6;
  private walkClock = 0;

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({ resizeTo: host, background: 0x6fbd60, antialias: true, autoDensity: true, resolution: window.devicePixelRatio || 1 });
    host.appendChild(this.app.canvas);
    this.objects.sortableChildren = true;
    this.world.addChild(this.ground, this.objects, this.overlay);
    this.app.stage.addChild(this.world);
    const base = import.meta.env.BASE_URL;
    const names = Object.keys(FRAMES);
    const loaded = await Assets.load(names.map((n) => ({ alias: n, src: `${base}sprites/${n}.png` })));
    for (const n of names) this.textures.set(n, loaded[n] as Texture);
  }

  frameScale(name: string): number {
    return (TW / SRC_TILE) * (FRAMES[name]?.scale ?? 1);
  }

  private makeSprite(name: string): Sprite {
    const tex = this.textures.get(name) ?? Texture.WHITE;
    const sp = new Sprite(tex);
    const fr = FRAMES[name];
    if (fr) sp.anchor.set(fr.ax / fr.w, fr.ay / fr.h);
    sp.scale.set(this.frameScale(name));
    return sp;
  }

  centerOn(gx: number, gy: number): void {
    const w = this.app.screen.width, h = this.app.screen.height;
    this.world.scale.set(this.zoom);
    this.world.position.set(w / 2 - isoX(gx, gy) * this.zoom, h / 2 - isoY(gx, gy) * this.zoom);
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    const z = Math.max(0.5, Math.min(5, this.zoom * factor));
    const wx = (sx - this.world.x) / this.zoom;
    const wy = (sy - this.world.y) / this.zoom;
    this.zoom = z;
    this.world.scale.set(z);
    this.world.position.set(sx - wx * z, sy - wy * z);
  }

  panBy(dx: number, dy: number): void {
    this.world.position.set(this.world.x + dx, this.world.y + dy);
  }

  toGrid(sx: number, sy: number): [number, number] {
    return screenToGrid((sx - this.world.x) / this.zoom, (sy - this.world.y) / this.zoom);
  }

  // ---------------------------------------------------------------- ground

  private diamond(g: Graphics, x: number, y: number, color: number, alpha = 1): void {
    const cx = isoX(x, y), cy = isoY(x, y);
    g.poly([cx, cy, cx + TW / 2, cy + TH / 2, cx, cy + TH, cx - TW / 2, cy + TH / 2]).fill({ color, alpha });
  }

  private line(g: Graphics, x0: number, y0: number, x1: number, y1: number, color: number, width: number, alpha = 1): void {
    g.moveTo(isoX(x0, y0), isoY(x0, y0)).lineTo(isoX(x1, y1), isoY(x1, y1)).stroke({ color, width, alpha });
  }

  private drawGround(s: GameState): void {
    const g = this.ground;
    g.clear();
    const t = (x: number, y: number) => (x < 0 || y < 0 || x >= s.W || y >= s.H ? -1 : s.tiles[idx(s, x, y)]);
    for (let y = 0; y < s.H; y++) {
      for (let x = 0; x < s.W; x++) {
        const v = s.tiles[idx(s, x, y)];
        let c: number;
        switch (v) {
          case T.Apron: c = COLORS.apron; break;
          case T.Taxiway: c = COLORS.taxiway; break;
          case T.Runway: c = COLORS.runway; break;
          case T.Floor: c = (x + y) % 2 ? COLORS.floor : COLORS.floorAlt; break;
          case T.Road: c = COLORS.road; break;
          case T.Parking: c = COLORS.parking; break;
          default: c = COLORS.grass[(x * 7 + y * 13) % 3];
        }
        this.diamond(g, x, y, c);
      }
    }
    // taxiway centre lines
    for (let y = 0; y < s.H; y++) for (let x = 0; x < s.W; x++) {
      if (t(x, y) !== T.Taxiway) continue;
      if (t(x + 1, y) === T.Taxiway) this.line(g, x + 0.5, y + 0.5, x + 1.5, y + 0.5, 0xf5c518, 1.1);
      if (t(x, y + 1) === T.Taxiway) this.line(g, x + 0.5, y + 0.5, x + 0.5, y + 1.5, 0xf5c518, 1.1);
    }
    // road dashes
    for (let x = 0; x < s.W; x += 2) if (t(x, s.H - 2) === T.Road) this.line(g, x + 0.2, s.H - 2, x + 1.0, s.H - 2, 0xf3f4f6, 0.8, 0.8);
    // runway markings
    const rw = runway(s);
    if (rw) {
      const along = rw.rot % 2 === 0;
      const len = along ? rw.w : rw.h;
      const cx = along ? rw.y + rw.h / 2 : rw.x + rw.w / 2;
      const P = (a: number, c: number): [number, number] => (along ? [rw.x + a, c] : [c, rw.y + a]);
      for (let a = 6; a < len - 6; a += 3) this.line(g, ...P(a, cx), ...P(a + 1.6, cx), 0xffffff, 1.2);
      for (const a0 of [1, len - 3]) for (let k = -1.6; k <= 1.6; k += 0.55) this.line(g, ...P(a0, cx + k), ...P(a0 + 2, cx + k), 0xffffff, 1.4);
      for (const side of [-2.3, 2.3]) this.line(g, ...P(0.5, cx + side), ...P(len - 0.5, cx + side), 0xffffff, 0.8, 0.85);
    }
    // stand markings: lead-in line and stop bar
    for (const b of s.buildings) {
      if (!b.kind.startsWith('stand_')) continue;
      const m = MODULES[b.kind];
      const a = localPoint(b, m.w / 2, 0);
      const c = localPoint(b, m.w / 2, m.h * 0.82);
      this.line(g, a[0], a[1], c[0], c[1], 0xf5c518, 1.4);
      const l = localPoint(b, m.w / 2 - 1, m.h * 0.82);
      const r = localPoint(b, m.w / 2 + 1, m.h * 0.82);
      this.line(g, l[0], l[1], r[0], r[1], 0xf5c518, 1.8);
      const corners = [localPoint(b, 0, 0), localPoint(b, m.w, 0), localPoint(b, m.w, m.h), localPoint(b, 0, m.h)];
      for (let i = 0; i < 4; i++) this.line(g, ...corners[i], ...corners[(i + 1) % 4], 0xffffff, 0.7, 0.6);
    }
    // parking bays
    for (const b of s.buildings) {
      if (b.kind !== 'carpark') continue;
      for (let k = 1; k < b.w; k++) this.line(g, b.x + k, b.y + 0.4, b.x + k, b.y + b.h - 0.4, 0xffffff, 0.6, 0.7);
    }
    // terminal walls: low glass edges where floor meets the outside
    for (let y = 0; y < s.H; y++) for (let x = 0; x < s.W; x++) {
      if (t(x, y) !== T.Floor) continue;
      const h = ZPX * 0.32;
      const wall = (x0: number, y0: number, x1: number, y1: number, shade: number) => {
        const ax = isoX(x0, y0), ay = isoY(x0, y0), bx = isoX(x1, y1), by = isoY(x1, y1);
        g.poly([ax, ay, bx, by, bx, by - h, ax, ay - h]).fill({ color: shade, alpha: 0.55 });
        g.moveTo(ax, ay - h).lineTo(bx, by - h).stroke({ color: 0xffffff, width: 0.8, alpha: 0.9 });
      };
      if (t(x, y - 1) !== T.Floor) wall(x, y, x + 1, y, 0x9fd3f5);
      if (t(x - 1, y) !== T.Floor) wall(x, y, x, y + 1, 0x86c3ec);
    }
  }

  // ---------------------------------------------------------------- objects

  private spriteFor(b: Building): Container | null {
    const m = MODULES[b.kind];
    const c = new Container();
    if (m.sprite) {
      const name = `${m.sprite}_${m.rotatable ? b.rot : 0}`;
      const sp = this.makeSprite(name);
      sp.position.set(isoX(b.x, b.y), isoY(b.x, b.y));
      c.addChild(sp);
    }
    let z = b.x + b.y + b.w + b.h;
    if (b.kind.startsWith('stand_')) {
      if (!b.link) return null;
      // jet bridge from the terminal edge towards the aircraft door
      const mm = MODULES[b.kind];
      const pts = [localPoint(b, mm.w / 2 + 1, mm.h), localPoint(b, mm.w / 2 + 2, mm.h), localPoint(b, mm.w / 2 + 1, mm.h - 3), localPoint(b, mm.w / 2 + 2, mm.h - 3)];
      const ox = Math.min(...pts.map((p) => p[0]));
      const oy = Math.min(...pts.map((p) => p[1]));
      const sp = this.makeSprite(`jetbridge_${(b.rot + 3) % 4}`);
      sp.position.set(isoX(ox, oy), isoY(ox, oy));
      c.addChild(sp);
      z = ox + oy + 4;
    }
    if (!c.children.length) return null;
    c.zIndex = z;
    return c;
  }

  private syncBuildings(s: GameState): void {
    const live = new Set<number>();
    for (const b of s.buildings) {
      const key = b.id;
      live.add(key);
      const tag = `${b.kind}:${b.x}:${b.y}:${b.rot}:${b.link ?? 0}`;
      const cur = this.buildingSprites.get(key);
      if (cur && cur.label === tag) continue;
      if (cur) { cur.destroy({ children: true }); this.buildingSprites.delete(key); }
      const c = this.spriteFor(b);
      if (!c) continue;
      c.label = tag;
      this.objects.addChild(c);
      this.buildingSprites.set(key, c);
    }
    for (const [id, c] of this.buildingSprites) if (!live.has(id)) { c.destroy({ children: true }); this.buildingSprites.delete(id); }
  }

  private syncAircraft(s: GameState): void {
    const live = new Set<number>();
    for (const f of s.flights) {
      if (f.phase === 'scheduled' || f.phase === 'departed' || f.phase === 'cancelled') continue;
      live.add(f.id);
      let c = this.aircraftSprites.get(f.id);
      const type = spriteType(f.typeId);
      const key = `ac_${type}_${f.facing}`;
      if (!c || c.label !== key) {
        c?.destroy({ children: true });
        c = new Container();
        c.label = key;
        const shadow = new Graphics();
        const fr = FRAMES[key];
        const r = fr ? (fr.w * this.frameScale(key)) / 4.2 : 20;
        shadow.ellipse(0, 0, r, r / 2).fill({ color: 0x1b2a1b, alpha: 0.16 });
        shadow.label = 'shadow';
        const base = this.makeSprite(key);
        const mask = this.makeSprite(`${key}_mask`);
        mask.tint = parseInt(airlineColor(f.airline).slice(1), 16);
        base.label = 'body';
        mask.label = 'livery';
        c.addChild(shadow, base, mask);
        this.objects.addChild(c);
        this.aircraftSprites.set(f.id, c);
      }
      const px = isoX(f.x, f.y), py = isoY(f.x, f.y);
      c.position.set(px, py);
      const lift = f.alt * ZPX;
      for (const ch of c.children) {
        if (ch.label === 'shadow') ch.position.set(0, 0);
        else ch.position.set(0, -lift);
      }
      c.alpha = f.phase === 'approach' ? Math.min(1, 1.4 - f.alt / 9) : f.phase === 'takeoff' ? Math.max(0, 1 - f.alt / 10) : 1;
      c.zIndex = f.x + f.y + (f.alt > 0.5 ? 400 : 1.5);
    }
    for (const [id, c] of this.aircraftSprites) if (!live.has(id)) { c.destroy({ children: true }); this.aircraftSprites.delete(id); }
  }

  private syncPax(s: GameState, dtReal: number): void {
    this.walkClock += dtReal;
    const step = Math.floor(this.walkClock * 6) % 2;
    const live = new Set<number>();
    for (const p of s.pax) {
      live.add(p.id);
      const moving = p.state.startsWith('to') || p.state === 'boarding' || p.state === 'queue';
      const key = `pax_${p.color}_${p.facing}_${moving ? (step + (p.id % 2)) % 2 : 0}`;
      let sp = this.paxSprites.get(p.id);
      if (!sp) {
        sp = this.makeSprite(key);
        this.objects.addChild(sp);
        this.paxSprites.set(p.id, sp);
      }
      const tex = this.textures.get(key);
      if (tex && sp.texture !== tex) sp.texture = tex;
      sp.position.set(isoX(p.x, p.y), isoY(p.x, p.y));
      sp.zIndex = p.x + p.y + 0.6;
      sp.tint = p.state === 'lost' ? 0xff8080 : 0xffffff;
    }
    for (const [id, sp] of this.paxSprites) if (!live.has(id)) { sp.destroy(); this.paxSprites.delete(id); }
  }

  // ---------------------------------------------------------------- overlay

  private drawOverlay(s: GameState, ghost: Ghost | null, hover: [number, number] | null, selected: Building | null): void {
    const g = this.overlay;
    g.clear();
    if (this.ghostSprite) { this.ghostSprite.destroy(); this.ghostSprite = null; }
    if (selected) {
      for (let y = selected.y; y < selected.y + selected.h; y++) for (let x = selected.x; x < selected.x + selected.w; x++) this.diamond(g, x, y, 0xf2b544, 0.28);
      if (selected.link) {
        const other = getLayout(s).byId.get(selected.link);
        if (other) for (let y = other.y; y < other.y + other.h; y++) for (let x = other.x; x < other.x + other.w; x++) this.diamond(g, x, y, 0x5cc8ff, 0.18);
      }
    }
    if (ghost?.rect) {
      const [x0, y0, x1, y1] = ghost.rect;
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
        if (x >= 0 && y >= 0 && x < s.W && y < s.H) this.diamond(g, x, y, ghost.ok ? 0x5cc8ff : 0xf2637a, 0.35);
      }
    } else if (ghost?.kind) {
      const { w, h } = footprint(ghost.kind, ghost.rot);
      for (let y = ghost.y; y < ghost.y + h; y++) for (let x = ghost.x; x < ghost.x + w; x++) this.diamond(g, x, y, ghost.ok ? 0x4ade9b : 0xf2637a, 0.38);
      const m = MODULES[ghost.kind];
      if (m.sprite) {
        const sp = this.makeSprite(`${m.sprite}_${m.rotatable ? ghost.rot : 0}`);
        sp.position.set(isoX(ghost.x, ghost.y), isoY(ghost.x, ghost.y));
        sp.alpha = 0.7;
        if (!ghost.ok) sp.tint = 0xff9090;
        this.overlay.addChild(sp);
        this.ghostSprite = sp;
      }
      if (ghost.kind.startsWith('stand_')) {
        const fake = { id: 0, kind: ghost.kind, x: ghost.x, y: ghost.y, w, h, rot: ghost.rot as Building['rot'] };
        const { entry } = standPoints(fake);
        this.diamond(g, entry[0], entry[1], 0xf5c518, 0.6);
      }
    } else if (hover) {
      this.diamond(g, Math.floor(hover[0]), Math.floor(hover[1]), 0xffffff, 0.25);
    }
  }

  // ---------------------------------------------------------------- frame

  render(s: GameState, groundStamp: number, dtReal: number, ghost: Ghost | null, hover: [number, number] | null, selected: Building | null): void {
    if (groundStamp !== this.groundStamp) {
      this.groundStamp = groundStamp;
      this.drawGround(s);
    }
    this.syncBuildings(s);
    this.syncAircraft(s);
    this.syncPax(s, dtReal);
    this.drawOverlay(s, ghost, hover, selected);
  }

  /** Thumbnail URL of a module's sprite for the build menu. */
  static thumb(kind: ModuleKind): string | null {
    const m = MODULES[kind];
    return m.sprite ? `${import.meta.env.BASE_URL}sprites/${m.sprite}_0.png` : null;
  }
}
