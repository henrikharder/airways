// Rival personalities. Quotes are attributed to a generic spokesperson, never
// a real, named executive.

import type { Airline } from './types';

export function archetype(a: Airline): string {
  if (a.style === 'lowcost') return a.aggression >= 0.8 ? 'Ultra low-cost brawler' : 'Low-cost challenger';
  if (a.style === 'premium') return 'Premium full-service';
  return a.aggression >= 0.6 ? 'Combative network carrier' : 'Network carrier';
}

export function threatLabel(a: Airline): string {
  return a.aggression >= 0.8 ? 'Very high' : a.aggression >= 0.6 ? 'High' : a.aggression >= 0.45 ? 'Moderate' : 'Low';
}

const QUOTES: Record<'war' | 'entry', Record<'lowcost' | 'premium' | 'legacy', string[]>> = {
  war: {
    lowcost: [
      'Our fares on {route} are now cheaper than a sandwich at the gate. Good luck, {player}.',
      'We have never lost a price war and we are not starting with {player}.',
    ],
    premium: [
      'Our guests on {route} expect more than a seat. We will gladly show {player}\'s passengers the difference.',
      'Luxury now comes with a discount on {route}. Temporarily.',
    ],
    legacy: [
      '{route} has been part of our network for decades. We welcome the competition — briefly.',
      'Our loyal flyers on {route} deserve our best fares. Coincidence? Of course.',
    ],
  },
  entry: {
    lowcost: ['If {player} can make money on {route}, imagine what we can do with 30% lower costs.'],
    premium: ['{route} deserves a proper premium product. We are delighted to provide one.'],
    legacy: ['Our customers asked for {route}. We listened. {player} may want to listen too.'],
  },
};

export function rivalQuote(a: Airline, kind: 'war' | 'entry', route: string, playerName: string): { text: string; by: string } {
  const style = a.style === 'player' ? 'legacy' : a.style;
  const list = QUOTES[kind][style];
  const text = list[Math.floor(Math.random() * list.length)].replace('{route}', route).replace('{player}', playerName);
  return { text, by: `${a.name} spokesperson` };
}
