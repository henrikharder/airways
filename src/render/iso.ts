// Isometric projection shared by the renderer's layers, with a rotatable view.
// Grid coordinates are turned into view coordinates by the current quarter
// turn (`view.k`), then projected. A building rotated r, seen from view k, is
// drawn with its rotation (r + k) % 4 sprite, because the sprites were
// rendered in four rotations from one fixed camera.

export const TW = 32; // tile diamond width at zoom 1
export const TH = 16;
export const ZPX = 20.2; // screen px per tile of height at zoom 1

/** The current view: quarter turns k and the site size it rotates within. */
export const view = { k: 0 as 0 | 1 | 2 | 3, W: 110, H: 90 };

/** Grid position → view position (same turn direction as building rotations). */
export function toView(x: number, y: number): [number, number] {
  const { k, W, H } = view;
  return k === 0 ? [x, y] : k === 1 ? [H - y, x] : k === 2 ? [W - x, H - y] : [y, W - x];
}

/** View position → grid position. */
export function fromView(vx: number, vy: number): [number, number] {
  const { k, W, H } = view;
  return k === 0 ? [vx, vy] : k === 1 ? [vy, H - vx] : k === 2 ? [W - vx, H - vy] : [W - vy, vx];
}

/** A grid direction (no translation) in view space. */
export function dirToView(dx: number, dy: number): [number, number] {
  const k = view.k;
  return k === 0 ? [dx, dy] : k === 1 ? [-dy, dx] : k === 2 ? [-dx, -dy] : [dy, -dx];
}

/** A grid facing or rotation as seen in the current view. */
export const vface = (f: number) => ((f + view.k) % 4) as 0 | 1 | 2 | 3;

/** Projection of view coordinates. */
export const vX = (vx: number, vy: number) => ((vx - vy) * TW) / 2;
export const vY = (vx: number, vy: number) => ((vx + vy) * TH) / 2;

/** Projection of grid coordinates (through the view). */
export const isoX = (x: number, y: number) => { const [a, b] = toView(x, y); return vX(a, b); };
export const isoY = (x: number, y: number) => { const [a, b] = toView(x, y); return vY(a, b); };

/** Screen position (relative to the world origin) → grid position. */
export function screenToGrid(sx: number, sy: number): [number, number] {
  const a = sy / (TH / 2);
  const b = sx / (TW / 2);
  return fromView((a + b) / 2, (a - b) / 2);
}

/** Painter's depth of a ground position (larger = nearer the camera). */
export const depth = (x: number, y: number) => { const [a, b] = toView(x, y); return a + b; };

/** How much a grid direction points towards the camera. */
export const towardsCamera = (dx: number, dy: number) => { const [a, b] = dirToView(dx, dy); return a + b; };

/**
 * A footprint's on-screen origin: the grid corner that is the minimum corner in
 * view space (where its sprite is anchored), and the depth of its far corner.
 */
export function footprintView(x: number, y: number, w: number, h: number): { ox: number; oy: number; far: number } {
  const corners: [number, number][] = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]];
  let best = corners[0], bv = Infinity, far = -Infinity;
  for (const c of corners) {
    const [a, b] = toView(...c);
    if (a + b < bv) { bv = a + b; best = c; }
    far = Math.max(far, a + b);
  }
  return { ox: best[0], oy: best[1], far };
}

/** Aircraft length, span and fuselage diameter in tiles (mirrors AIRCRAFT in art/build.py). */
export const AC_SIZE: Record<string, [number, number, number]> = {
  AT76: [5.44, 5.42, 0.56], E295: [8.3, 7.02, 0.6], A20N: [7.52, 7.16, 0.79], B38M: [7.9, 7.18, 0.75],
  B789: [12.56, 12.02, 1.15], A359: [13.36, 12.96, 1.19], A388: [14.54, 15.96, 1.42],
};

/** Unit grid vector for a facing (0 = +x, 1 = +y, 2 = -x, 3 = -y). */
export const FACING: [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1]];
