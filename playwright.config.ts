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
  // CI gives desktop, mobile and offline checks separate jobs. Sensor walks
  // require real elapsed time, so each invocation retains its own total budget
  // alongside the per-test limits and zero retries.
  globalTimeout: process.env.CI ? 20 * 60_000 : undefined,
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
