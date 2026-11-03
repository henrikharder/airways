import { defineConfig } from 'vitest/config';

// Game creation simulates six weeks of world traffic; allow for slow machines.
export default defineConfig({ test: { testTimeout: 60_000 } });
