import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4187';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.pw.ts',
  testIgnore: [
    ...(process.env.VOICEGIS_PUBLIC_SMOKE === 'true' ? [] : ['**/offline*.pw.ts']),
    // Only meaningful against a build served under a sub-path; see scripts/runBrowserSmoke.js.
    ...((process.env.VOICEGIS_SMOKE_BASE ?? '/') === '/' ? ['**/subpath*.pw.ts'] : []),
  ],
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: process.env.CI ? 1 : 2,
  timeout: 30_000,
  // Both device projects run serially in CI. Sensor-driven walks use real
  // elapsed time; the visitor subset alone now exceeds eight minutes.
  // Keep per-test limits intact, but allow the complete suite to finish.
  globalTimeout: process.env.CI ? 15 * 60_000 : undefined,
  expect: {
    timeout: 15_000,
  },
  outputDir: 'test-results',
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: 'mobile-chromium',
      use: {
        ...devices['Pixel 5'],
        viewport: { width: 375, height: 812 },
      },
    },
  ],
});
