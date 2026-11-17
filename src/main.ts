import '@fontsource-variable/inter';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import './style.css';
import { Game } from './ui/game';

const game = new Game(document.getElementById('app')!);
// Dev-only handle for poking at the game from the console.
if (import.meta.env.DEV) (window as unknown as { airways: Game }).airways = game;
