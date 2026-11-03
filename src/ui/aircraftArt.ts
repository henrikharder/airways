// Procedural aircraft art: side views painted in an airline's livery, and
// top-down seat maps. Shapes vary by category and size so an ATR, an A321
// and an A380 are recognisably different.

import { acType, bizSeatFactor, econSeatsFor } from '../data/aircraft';
import type { Airline, Livery } from '../engine/types';
import { profileSvg } from './profiles';


export function liveryOf(a: Airline): Livery {
  return a.livery ?? { pattern: 'classic', primary: a.color, secondary: '#ffffff' };
}

/** Side view of an aircraft type in a livery. Returns an SVG string. */
export function sideView(typeId: string, livery: Livery, name: string, code: string, cls = 'ac-art', toScale = false): string {
  return profileSvg(typeId, livery, name, code, { cls, toScale, title: acType(typeId).name });
}

interface Layout { j: number[]; y: number[] } // seats per side-group, aisles between groups

function layoutOf(typeId: string): Layout {
  switch (acType(typeId).category) {
    case 'turboprop': case 'regional': return { j: [1, 2], y: [2, 2] };
    case 'narrowbody': return { j: [2, 2], y: [3, 3] };
    case 'widebody': return { j: [1, 2, 1], y: [3, 3, 3] };
    case 'superjumbo': return { j: [1, 2, 1], y: [3, 4, 3] };
  }
}

/** Top-down cabin map for a business/economy split. Returns an SVG string. */
export function seatMap(typeId: string, biz: number, color: string): string {
  const t = acType(typeId);
  const econ = econSeatsFor(t, biz);
  const lay = layoutOf(typeId);
  const jPer = lay.j.reduce((a, b) => a + b, 0);
  const yPer = lay.y.reduce((a, b) => a + b, 0);
  const jRows = Math.ceil(biz / jPer);
  const yRows = Math.ceil(econ / yPer);
  const ys = 4.2, js = 7, aisle = 3.5;
  const width = (groups: number[], s: number) => groups.reduce((a, b) => a + b * s, 0) + (groups.length - 1) * aisle;
  const cabinW = Math.max(width(lay.y, ys), width(lay.j, js * 0.85));
  const yStep = 5, jStep = bizSeatFactor(t) >= 4 ? 10 : 8;
  const len = 18 + jRows * jStep + (jRows ? 5 : 0) + yRows * yStep + 14;
  const H = cabinW + 10;
  const cy = H / 2;
  let seats = '';
  const drawRows = (rows: number, total: number, groups: number[], step: number, size: number, x0: number, fill: string, per: number) => {
    let left = total;
    const w = width(groups, size);
    for (let r = 0; r < rows; r++) {
      let y = cy - w / 2;
      const inRow = Math.min(per, left);
      let drawn = 0;
      groups.forEach((g, gi) => {
        for (let k = 0; k < g; k++) {
          if (drawn < inRow) seats += `<rect x="${(x0 + r * step).toFixed(1)}" y="${(y + k * size).toFixed(1)}" width="${(step - 1.4).toFixed(1)}" height="${(size - 0.9).toFixed(1)}" rx="1" fill="${fill}"/>`;
          drawn++;
        }
        y += g * size + (gi < groups.length - 1 ? aisle : 0);
      });
      left -= inRow;
    }
  };
  const jx = 18;
  drawRows(jRows, biz, lay.j, jStep, (cabinW - (lay.j.length - 1) * aisle) / jPer, jx, color, jPer);
  const yx = jx + jRows * jStep + (jRows ? 5 : 0);
  drawRows(yRows, econ, lay.y, yStep, ys, yx, '#8696b0', yPer);
  const hull = `M14,2 L${len - 8},2 Q${len},${cy} ${len - 8},${H - 2} L14,${H - 2} Q0,${H - 2} 0,${cy} Q0,2 14,2 Z`;
  return `<svg class="seat-map" viewBox="-2 0 ${len + 4} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${biz} business and ${econ} economy seats">
    <path d="${hull}" fill="#121b2c" stroke="#33445f" stroke-width="1"/>${seats}</svg>
    <div class="seat-legend"><span style="--c:${color}">Business ${biz}</span><span style="--c:#8696b0">Economy ${econ}</span><span class="muted">${biz + econ} seats</span></div>`;
}
