import type { GameState, NewsItem } from './types';

export function addNews(s: GameState, text: string, tone: NewsItem['tone'] = 'neutral'): void {
  s.news.unshift({ min: s.minute, text, tone });
  if (s.news.length > 80) s.news.length = 80;
}
