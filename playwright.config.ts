import { defineConfig } from '@playwright/test';

/**
 * BROWSER TEST CONFIGURATION
 *
 * Scope is deliberately narrow: one spec that drives the real technician dialogs in
 * a real browser. It uses the locally installed Chrome (`channel: 'chrome'`) rather
 * than downloading a Playwright browser, so adding it costs one dev dependency and
 * no ~150 MB binary.
 *
 * `webServer` boots the normal development server (or reuses one already running).
 * The specs intercept `/api/admin/technicians*`, so no account, session or database
 * record is required or created.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    channel: 'chrome',
    headless: true,
    trace: 'off',
    video: 'off',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 240_000,
  },
});
