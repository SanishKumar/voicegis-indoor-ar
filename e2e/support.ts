import { expect, test as base, type Locator, type Page } from '@playwright/test';

type SmokeFixtures = {
  browserErrors: string[];
  allowedBrowserErrors: RegExp[];
  /**
   * Declares a browser error this test expects to cause.
   *
   * Needed by the tests that drive failure paths: intercepting a request with
   * 503 or pointing at a missing package makes the browser log a console error
   * by definition, so without this the only way to test recovery would be to
   * stop failing on console errors everywhere. Allowances are per test and must
   * be stated up front, so an error nobody predicted still fails the run.
   */
  allowBrowserError: (pattern: RegExp) => void;
};

/**
 * Product smoke tests treat uncaught exceptions and console errors as failures.
 * Warnings remain visible in the trace without failing the run; Three currently
 * emits deprecation warnings that are useful but are not visitor failures.
 */
export const test = base.extend<SmokeFixtures>({
  // Playwright requires a destructuring pattern for the fixtures argument, so
  // a fixture that needs none takes an empty one.
  allowedBrowserErrors: async ({}, use) => {
    await use([]);
  },

  allowBrowserError: async ({ allowedBrowserErrors }, use) => {
    await use((pattern: RegExp) => {
      allowedBrowserErrors.push(pattern);
    });
  },

  browserErrors: [
    async ({ page, allowedBrowserErrors }, use) => {
      const errors: string[] = [];

      // The product must remain usable with its declared system-font fallback.
      // Fulfilling these requests avoids making the smoke gate depend on Google.
      await page.route('https://fonts.googleapis.com/**', (route) =>
        route.fulfill({ status: 200, contentType: 'text/css', body: '' }),
      );
      await page.route('https://fonts.gstatic.com/**', (route) =>
        route.fulfill({ status: 200, contentType: 'font/woff2', body: '' }),
      );

      page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(`console: ${message.text()}`);
      });

      await use(errors);
      const unexpected = errors.filter(
        (message) => !allowedBrowserErrors.some((pattern) => pattern.test(message)),
      );
      expect(unexpected, 'the production page emitted unexpected browser errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export async function precompleteOnboarding(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('onboarding_complete', 'true');
    localStorage.setItem('theme', 'light');
    localStorage.setItem('high_contrast', 'false');
    localStorage.setItem('accessible_routing', 'false');
    localStorage.removeItem('voicegis_active_venue_url');
  });
}

export async function openVisitor(page: Page): Promise<void> {
  await precompleteOnboarding(page);
  await page.goto('/#/visitor');
  await expect(page.locator('.compiled-map')).toBeVisible();
}

export async function openPharmacyRoute(page: Page): Promise<void> {
  await precompleteOnboarding(page);
  const payload = encodeURIComponent('voicegis://asterion/l2/east');
  await page.goto(`/?checkin=${payload}#/visitor`);

  await expect(page.locator('.compiled-map')).toBeVisible();
  await expect(page.locator('.checkin-toast')).toContainText('Checked in at Family Care Concourse');
  expect(new URL(page.url()).searchParams.has('checkin')).toBe(false);

  await page.getByRole('button', { name: 'Search rooms and departments', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Search rooms and departments' })
    .fill('Outpatient Pharmacy');
  await page.getByRole('button', { name: 'Navigate to Outpatient Pharmacy' }).click();
  await expect(page.getByLabel('Fastest available route')).toBeVisible();
}

export async function expectCenterHitTarget(locator: Locator): Promise<void> {
  await expect
    .poll(() =>
      locator.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
          bounds.left + bounds.width / 2,
          bounds.top + bounds.height / 2,
        );
        return hit === element || (hit !== null && element.contains(hit));
      }),
    )
    .toBe(true);
}

export async function expectInsideViewport(locator: Locator): Promise<void> {
  await expect
    .poll(() =>
      locator.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return (
          bounds.left >= -0.5 &&
          bounds.right <= window.innerWidth + 0.5 &&
          bounds.top >= -0.5 &&
          bounds.bottom <= window.innerHeight + 0.5
        );
      }),
    )
    .toBe(true);
}
