import { defineConfig, devices } from '@playwright/test';

/**
 * LImax Stage 14.3 — Playwright E2E Configuration
 *
 * - Uses system Chrome (no hardcoded user path, no ms-playwright Chromium download needed).
 * - API runs on port 4001, Dashboard on port 3100.
 * - globalSetup/globalTeardown handle server lifecycle and DB isolation.
 * - Screenshot/video/trace retained only on failure.
 * - Playwright-report and test-results are excluded from Git (.gitignore).
 */

const DASHBOARD_PORT = parseInt(process.env.E2E_DASHBOARD_PORT ?? '3100', 10);

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  outputDir: 'test-results/',

  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',

  use: {
    baseURL: `http://127.0.0.1:${DASHBOARD_PORT}`,
    // HTTP credentials from runtime env — never hardcoded.
    httpCredentials: {
      username: process.env.E2E_DASHBOARD_USER ?? '',
      password: process.env.E2E_DASHBOARD_PASSWORD ?? '',
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    extraHTTPHeaders: {},
  },

  projects: [
    {
      name: 'chromium-desktop',
      use: {
        ...devices['Desktop Chrome'],
        // Use installed system Chrome — works without ms-playwright download.
        channel: 'chrome',
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'mobile-chrome',
      use: {
        ...devices['Pixel 5'],
        channel: 'chrome',
        viewport: { width: 390, height: 844 },
      },
    },
  ],
});
