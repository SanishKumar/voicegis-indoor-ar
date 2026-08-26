import { expect, test } from './support';

/**
 * A venue that will not load must never be a dead end.
 *
 * Bootstrap ran once, inside an effect, so any failure was terminal: the
 * visitor saw the reason and had nothing to do about it. A stored bad URL made
 * it permanent, because every reload retried exactly the source that had just
 * failed.
 *
 * Both cases are driven through the real production build with the network
 * intercepted, because the failure is in the loading path itself and nothing
 * below the browser exercises it.
 */

test('a failed catalog request can be retried without reloading', async ({
  page,
  allowBrowserError,
}) => {
  // The 503 below is the point of the test, so the browser logging it is
  // expected rather than a defect.
  allowBrowserError(/Failed to load resource.*503.*venues\/catalog\.json/);
  let attempts = 0;
  await page.route('**/venues/catalog.json', async (route) => {
    attempts += 1;
    // Only the first attempt fails, so Retry has something to succeed at.
    if (attempts === 1) {
      await route.fulfill({ status: 503, contentType: 'text/plain', body: 'unavailable' });
      return;
    }
    await route.fallback();
  });

  await page.addInitScript(() => {
    localStorage.setItem('onboarding_complete', 'true');
    localStorage.removeItem('voicegis_active_venue_url');
  });
  await page.goto('/#/visitor');

  const failure = page.getByRole('alert');
  await expect(failure).toContainText('Venue bootstrap failed');
  await expect(failure).toContainText('503');

  // The whole point: an action exists, and it recovers in place.
  await page.getByRole('button', { name: 'Retry venue loading' }).click();

  await expect(page.locator('.compiled-map')).toBeVisible();
  expect(attempts).toBeGreaterThan(1);
});

test('a missing package URL recovers to the default and stops being retried', async ({
  page,
  allowBrowserError,
}) => {
  allowBrowserError(/Failed to load resource.*404.*venues\/no-such-venue\.package\.json/);
  await page.addInitScript(() => {
    localStorage.setItem('onboarding_complete', 'true');
    // The query parameter wins this load, while the different stale stored
    // source proves "Use default venue" clears both places a bad source hides.
    // Seed it once: addInitScript runs again on reload, and reintroducing the
    // value ourselves would test the fixture rather than recovery persistence.
    if (sessionStorage.getItem('seeded_missing_venue') !== 'true') {
      sessionStorage.setItem('seeded_missing_venue', 'true');
      localStorage.setItem(
        'voicegis_active_venue_url',
        '/venues/another-missing-venue.package.json',
      );
    }
  });

  // A link to a package that is not there, which is what a stale printed URL or
  // a decommissioned venue looks like.
  await page.goto('/?venue=%2Fvenues%2Fno-such-venue.package.json#/visitor');

  const failure = page.getByRole('alert');
  await expect(failure).toContainText('Venue bootstrap failed');
  await expect(failure).toContainText('no-such-venue');

  await page.getByRole('button', { name: 'Use default venue' }).click();

  await expect(page.locator('.compiled-map')).toBeVisible();
  await expect(page.locator('.status-bar')).toContainText('Ground');

  // The failed source is forgotten in both places it can hide, so a reload does
  // not walk straight back into the same failure.
  expect(new URL(page.url()).searchParams.has('venue')).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem('voicegis_active_venue_url'))).toBeNull();

  await page.reload();
  await expect(page.locator('.compiled-map')).toBeVisible();
});
