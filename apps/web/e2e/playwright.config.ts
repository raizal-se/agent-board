import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end: the built page, served by the real CLI (`agent-board watch`) on a temp folder.
 * Run from apps/web: `../../node_modules/.bin/playwright test -c e2e/playwright.config.ts`.
 * Chromium does not start inside the agent sandbox; run it outside.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '*.e2e.ts',
  globalSetup: './global-setup.ts',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
  use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
});
