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
    async ({ context, allowedBrowserErrors }, use) => {
      const errors: string[] = [];

      const listen = (candidatePage: Page) => {
        candidatePage.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
        candidatePage.on('console', (message) => {
          if (message.type() !== 'error') return;
          const source = message.location().url;
          errors.push(`console: ${message.text()}${source ? ` at ${source}` : ''}`);
        });
      };
      context.pages().forEach(listen);
      context.on('page', listen);

      await use(errors);
      context.off('page', listen);
      const matchCounts = allowedBrowserErrors.map(() => 0);
      const unexpected = errors.filter((message) => {
        const allowanceIndex = allowedBrowserErrors.findIndex((pattern) => {
          // Global/sticky expressions carry state between calls. An allowance
          // is a predicate, so reset that state before and after using it.
          pattern.lastIndex = 0;
          const matched = pattern.test(message);
          pattern.lastIndex = 0;
          return matched;
        });
        if (allowanceIndex === -1) return true;
        matchCounts[allowanceIndex] += 1;
        return false;
      });
      expect(unexpected, 'the production page emitted unexpected browser errors').toEqual([]);
      allowedBrowserErrors.forEach((pattern, index) => {
        expect(
          matchCounts[index],
          `expected browser error ${String(pattern)} must occur exactly once`,
        ).toBe(1);
      });
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
