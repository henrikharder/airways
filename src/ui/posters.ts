// Poster-style scene art for story moments (decisions, board meetings,
// milestones, the start screen). Flat colour bands in the spirit of jet-age
// travel posters, with the player's real aircraft profile in their livery.

import type { Livery } from '../engine/types';
import { profileSvg } from './profiles';

export type Scene = 'dawn' | 'dusk' | 'night' | 'storm' | 'gold' | 'rival' | 'volcano' | 'green';

const SKY: Record<Scene, string[]> = {
  dawn: ['#14213a', '#2b3f66', '#c8735a', '#f2b544'],
  dusk: ['#1b1838', '#4a2c5a', '#c4564f', '#f29f4c'],
  night: ['#05080f', '#0b1626', '#13233b', '#1f3554'],
  storm: ['#0d1418', '#1d2a30', '#2f3f45', '#4c5d61'],
  gold: ['#2a1d05', '#6b4a10', '#c9902b', '#f2c66d'],
  rival: ['#140f26', '#2c1f4d', '#5b3c8a', '#b79cff'],
  volcano: ['#120a0a', '#3a1712', '#7a2a18', '#d9643a'],
  green: ['#0b1d1a', '#14382f', '#2f6b55', '#9cd8a9'],
};

export function sceneFor(kind: string): Scene {
  const map: Record<string, Scene> = {
    crew_pay: 'dusk', charter: 'dawn', oem_deal: 'dawn', fuel_hedge: 'dusk', audit: 'storm', influencer: 'gold',
    saf: 'green', rival_war: 'rival', rival_entry: 'rival', ash: 'volcano', board_good: 'gold', board_bad: 'storm', milestone: 'gold',
  };
  return map[kind] ?? 'dusk';
}

let uid = 0;

/** A 600×170 poster banner. `rival` adds a second aircraft in the rival's colours. */
export function poster(scene: Scene, typeId: string, livery: Livery, name: string, code: string, rival?: { typeId: string; livery: Livery; name: string; code: string }): string {
  const id = `ps${++uid}`;
  const [c0, c1, c2, c3] = SKY[scene];
  const bands = [c0, c1, c2, c3].map((c, i) => `<rect x="0" y="${i * 30}" width="600" height="${170 - i * 30}" fill="${c}"/>`).join('');
  let ground = '';
  switch (scene) {
    case 'dawn':
    case 'gold':
      ground = `<circle cx="470" cy="128" r="54" fill="${c3}" opacity="0.9"/>${scene === 'gold' ? Array.from({ length: 14 }, (_, i) => `<path d="M470,128 L${470 + Math.cos(i * 0.45 - 3.1) * 400},${128 + Math.sin(i * 0.45 - 3.1) * 400} L${470 + Math.cos(i * 0.45 - 2.95) * 400},${128 + Math.sin(i * 0.45 - 2.95) * 400} Z" fill="#fff" opacity="0.06"/>`).join('') : ''}
        <rect x="0" y="128" width="600" height="42" fill="${c0}"/><path d="M0,140 L600,140" stroke="${c2}" stroke-width="1" opacity="0.6"/>
        ${Array.from({ length: 9 }, (_, i) => `<rect x="${i * 70 + 10}" y="150" width="34" height="3" fill="${c3}" opacity="0.7"/>`).join('')}`;
      break;
    case 'night':
      ground = `${Array.from({ length: 40 }, (_, i) => `<circle cx="${(i * 97) % 600}" cy="${(i * 53) % 90}" r="${i % 3 ? 0.8 : 1.3}" fill="#fff" opacity="${0.3 + (i % 4) * 0.15}"/>`).join('')}
        <path d="M0,170 L0,128 ${Array.from({ length: 22 }, (_, i) => { const x = i * 28; const h = 100 + ((i * 37) % 30); return `L${x},${h} L${x + 22},${h}`; }).join(' ')} L600,128 L600,170 Z" fill="#03050a"/>
        ${Array.from({ length: 60 }, (_, i) => `<rect x="${(i * 41) % 600}" y="${118 + ((i * 13) % 40)}" width="2" height="2" fill="#f2b544" opacity="${0.4 + (i % 3) * 0.2}"/>`).join('')}`;
      break;
    case 'volcano':
      ground = `<path d="M300,170 L380,96 L400,92 L420,98 L520,170 Z" fill="#1a0b08"/><path d="M380,96 Q400,40 360,10 Q420,30 430,0 L600,0 L600,60 Q470,50 420,98 Z" fill="#000" opacity="0.35"/>
        <path d="M393,93 L400,104 L407,93 Z" fill="#ff7a2f"/><rect x="0" y="150" width="600" height="20" fill="#0e0605"/>`;
      break;
    case 'storm':
      ground = `${Array.from({ length: 5 }, (_, i) => `<ellipse cx="${i * 140 + 40}" cy="${30 + (i % 2) * 18}" rx="120" ry="22" fill="#000" opacity="0.25"/>`).join('')}
        <path d="M420,0 L405,48 L420,48 L398,100 L436,40 L420,40 L436,0 Z" fill="#f2e6a8" opacity="0.85"/><rect x="0" y="146" width="600" height="24" fill="#0a1013"/>`;
      break;
    case 'rival':
      ground = `<path d="M-20,150 C150,120 300,60 640,30" stroke="#fff" stroke-opacity="0.25" stroke-width="6" fill="none"/><path d="M-20,30 C200,60 360,110 640,150" stroke="#fff" stroke-opacity="0.15" stroke-width="6" fill="none"/>`;
      break;
    case 'green':
      ground = `<circle cx="120" cy="40" r="26" fill="#e8f6d8" opacity="0.8"/><path d="M0,170 L0,130 Q150,100 300,128 T600,118 L600,170 Z" fill="#0a1c16"/><path d="M0,170 L0,145 Q200,125 400,146 T600,140 L600,170 Z" fill="#06120e"/>`;
      break;
    default:
      ground = `${Array.from({ length: 4 }, (_, i) => `<rect x="${i * 170 - 30}" y="${40 + i * 14}" width="220" height="6" rx="3" fill="#fff" opacity="0.12"/>`).join('')}<rect x="0" y="146" width="600" height="24" fill="${c0}"/>`;
  }
  const plane = (svg: string, x: number, y: number, w: number, rot: number) =>
    `<g transform="rotate(${rot} ${x + w / 2} ${y + w * 0.15})">${svg.replace('<svg ', `<svg x="${x}" y="${y}" width="${w}" height="${(w * 0.4).toFixed(0)}" preserveAspectRatio="xMidYMax meet" `)}</g>`;
  const air = scene !== 'dawn' && scene !== 'gold';
  const mine = profileSvg(typeId, livery, name, code, { cls: 'poster-plane', inFlight: air });
  const rv = rival ? profileSvg(rival.typeId, rival.livery, rival.name, rival.code, { cls: 'poster-plane', inFlight: true }) : '';
  return `<svg viewBox="0 0 600 170" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <defs><clipPath id="${id}"><rect width="600" height="170"/></clipPath></defs>
    <g clip-path="url(#${id})">${bands}${ground}
    ${rival ? plane(rv, 320, -4, 230, 8) : ''}
    ${rival ? plane(mine, 30, 18, 300, -6) : air ? plane(mine, 70, -12, 330, -7) : plane(mine, 50, 146 - 300 * 0.4, 300, 0)}
    </g></svg>`;
}
