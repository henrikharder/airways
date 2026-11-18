import '@fontsource-variable/source-sans-3';
import './style.css';
import { Game } from './ui/game';

const game = new Game(document.getElementById('app')!);
// Dev-only handle for poking at the game from the console.
if (import.meta.env.DEV) (window as unknown as { airways: Game }).airways = game;
