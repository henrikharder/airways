// A large, realistically laid out airport for playtesting and soak tests:
// runway with a parallel taxiway and three exits, a long apron with eight
// stands (S to XL), one long terminal with a security barrier, two baggage
// halls, and a mix of real airlines including night rotations.

import { AIRLINES } from '../data/airlines';
import { acceptOffer } from './flights';
import { invalidate, paintRect, place } from './grid';
import { createGame } from './newgame';
import { staffToNeed } from './staff';
import type { GameState, ModuleKind } from './types';

export function buildExpanded(s: GameState): string[] {
  const errors: string[] = [];
  const put = (kind: ModuleKind, x: number, y: number, rot = 0) => {
    const r = place(s, kind, x, y, rot);
    if (!r.ok) errors.push(`${kind} @${x},${y}: ${r.reason}`);
  };
  s.cash = Math.max(s.cash, 200e6);
  s.buildings = s.buildings.filter((b) => b.kind !== 'tree' || b.y > 86);
  invalidate();

  // airfield
  put('runway', 20, 10);
  put('runway', 20, 2); // parallel runway to the north; its links cross the main runway
  for (const x of [22, 82]) paintRect(s, 'taxiway', x, 7, x + 1, 9);
  put('tower', 92, 22);
  paintRect(s, 'taxiway', 20, 17, 85, 18); // parallel taxiway
  for (const x of [22, 50, 82]) paintRect(s, 'taxiway', x, 15, x + 1, 16); // runway exits
  for (const x of [30, 70, 100]) paintRect(s, 'taxiway', x, 19, x + 1, 30); // links to the apron
  paintRect(s, 'taxiway', 85, 17, 101, 18);
  paintRect(s, 'taxiway', 6, 31, 106, 32); // apron taxi lane
  paintRect(s, 'apron', 6, 33, 106, 41);
  paintRect(s, 'apron', 6, 42, 106, 51); // continuous concrete between and around the stands

  // stands along the terminal, biggest at the west end
  put('stand_xl', 10, 35);
  put('stand_l', 28, 38);
  put('stand_l', 43, 38);
  for (const x of [58, 69, 80]) put('stand_m', x, 42);
  for (const x of [91, 99]) put('stand_s', x, 44);
  put('stand_m', 47, 19); // remote stands between the taxiways, served by bus
  put('stand_m', 58, 19);
  put('bagsort', 40, 27);
  put('bagsort', 80, 27);

  // terminal: airside in the north half, landside in the south
  paintRect(s, 'floor', 8, 52, 105, 79);
  for (const x of [15, 33, 48, 61, 72, 83, 93, 101]) put('gate', x, 52);
  put('busgate', 24, 52);
  put('egates', 8, 55); put('egates', 89, 56);
  // west gates for non-Schengen flights (UK, Ireland, Gulf, Turkey), east gates Schengen
  for (const b of s.buildings) {
    if (b.kind !== 'gate') continue;
    b.zone = b.x <= 61 ? 'border' : 'schengen';
  }
  put('transfer', 8, 58); put('toilets', 12, 57); put('passport', 19, 57); put('food', 24, 57); put('toilets', 29, 57); put('passport', 33, 57); put('shop', 38, 57);
  put('seats', 43, 58); put('seats', 46, 58); put('shop', 52, 57); put('passport', 57, 57); put('food', 62, 57);
  put('toilets', 67, 57); put('passport', 70, 57); put('shop', 74, 57); put('transfer', 78, 58); put('seats', 84, 58); put('seats', 87, 58); put('food', 94, 57); put('lounge', 98, 57);
  // passport halls split by direction (e-gates serve both)
  for (const pb of s.buildings) if (pb.kind === 'passport') pb.flow = pb.x === 19 || pb.x === 70 ? 'in' : 'out';
  for (const x of [41, 44, 47, 50, 53, 56, 59, 62]) put('security', x, 62);
  paintRect(s, 'barrier', 8, 63, 105, 63);
  put('exit', 20, 63);
  put('exit', 88, 63);
  for (const x of [12, 16, 92, 96]) put('baggage', x, 66);
  for (const x of [30, 36, 42, 62, 68, 74]) put('checkin', x, 70);
  put('food', 84, 70); put('shop', 22, 72); put('toilets', 54, 74); put('seats', 48, 76); put('seats', 58, 76);
  for (const x of [30, 55, 80]) put('entrance', x, 79, 2);
  for (const x of [10, 17, 86, 93, 100]) put('carpark', x, 81);

  // airlines: [carrier, aircraft, destination, per day, night]
  const deals: [string, string, string, number, boolean][] = [
    ['EK', 'A388', 'DXB', 1, false], ['QR', 'A359', 'DOH', 1, false], ['TK', 'B789', 'IST', 1, false],
    ['SK', 'A20N', 'OSL', 3, false], ['BA', 'A20N', 'LHR', 3, false], ['LH', 'A20N', 'FRA', 3, false],
    ['AF', 'A20N', 'CDG', 2, false], ['KL', 'B738', 'AMS', 2, false], ['FR', 'B38M', 'STN', 2, false],
    ['KL', 'E295', 'AMS', 2, false], ['AF', 'BCS3', 'CDG', 2, false],
    ['LH', 'A20N', 'MUC', 3, false], ['SK', 'A20N', 'ARN', 3, false], ['U2', 'A20N', 'LGW', 3, false], ['FR', 'B38M', 'MAN', 3, false],
    ['FR', 'B38M', 'DUB', 1, true], ['U2', 'A20N', 'GVA', 1, true],
  ];
  for (const [airline, typeId, dest, perDay, night] of deals) {
    if (!AIRLINES.some((a) => a.code === airline)) { errors.push(`unknown airline ${airline}`); continue; }
    const id = ++s.nextId;
    s.offers.push({ id, airline, dest, typeId, perDay, load: 0.82, expires: 99, minRating: 0, night });
    const err = acceptOffer(s, id);
    if (err) errors.push(`${airline} ${typeId}: ${err}`);
  }
  s.rating = Math.max(s.rating, 65);
  staffToNeed(s);
  return errors;
}

export function expandedGame(): GameState {
  const s = createGame({ name: 'Copenhagen North', code: 'CPN', city: 'CPH' });
  const errors = buildExpanded(s);
  if (errors.length) throw new Error(errors.join('; '));
  return s;
}
