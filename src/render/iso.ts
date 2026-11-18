// Isometric projection shared by the renderer's layers.

export const TW = 32; // tile diamond width at zoom 1
export const TH = 16;
export const ZPX = 20.2; // screen px per tile of height at zoom 1

export const isoX = (x: number, y: number) => ((x - y) * TW) / 2;
export const isoY = (x: number, y: number) => ((x + y) * TH) / 2;

export function screenToGrid(sx: number, sy: number): [number, number] {
  const a = sy / (TH / 2);
  const b = sx / (TW / 2);
  return [(a + b) / 2, (a - b) / 2];
}

/** Aircraft length, span and fuselage diameter in tiles (mirrors AIRCRAFT in art/build.py). */
export const AC_SIZE: Record<string, [number, number, number]> = {
  AT76: [5.44, 5.42, 0.56], E295: [8.3, 7.02, 0.6], A20N: [7.52, 7.16, 0.79], B38M: [7.9, 7.18, 0.75],
  B789: [12.56, 12.02, 1.15], A359: [13.36, 12.96, 1.19], A388: [14.54, 15.96, 1.42],
};

/** Unit grid vector for a facing (0 = +x, 1 = +y, 2 = -x, 3 = -y). */
export const FACING: [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1]];
