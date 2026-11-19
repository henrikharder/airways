import { defineConfig } from '@playwright/test';

// Browser smoke test of the production build, using the installed Chrome
// (GitHub's Ubuntu runners have it), so no browser download is needed.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:4173', channel: 'chrome', viewport: { width: 1440, height: 900 } },
  webServer: { command: 'npx vite preview --port 4173 --strictPort', port: 4173, reuseExistingServer: !process.env.CI },
});
