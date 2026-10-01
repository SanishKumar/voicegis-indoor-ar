import {
  expect,
  expectCenterHitTarget,
  expectInsideViewport,
  openPharmacyRoute,
  precompleteOnboarding,
  test,
} from './support';

// The offline installer intentionally warms every chunk in the background.
// Block it here to measure view loading, not precaching. Offline coverage is
// separately exercised with the actual public worker in offline.pw.ts.
test.use({ serviceWorkers: 'block' });
const CAMERA_CHUNK = /\/assets\/CameraPreview-[^/]+\.js(?:\?|$)/;
const MAP_CHUNK = /\/assets\/VisitorMap-[^/]+\.js(?:\?|$)/;

test('camera code is deferred; a slow load can be cancelled without losing the journey', async ({
  page,
}) => {
  await page.addInitScript(() => {
    let requests = 0;
    Object.defineProperty(window, 'startupCameraRequests', { get: () => requests });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: async () => {
        requests += 1;
        return new MediaStream();
      },
    });
  });
  let requested = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(CAMERA_CHUNK, async (route) => {
    requested = true;
    await gate;
    await route.continue();
  });
  try {
    await openPharmacyRoute(page);
    await page.locator('.checkin-toast').getByRole('button', { name: 'Dismiss' }).click();
    const before = await page.locator('.jr-banner-text').innerText();
    expect(requested, 'opening the map must not download camera/AR code').toBe(false);
    await page.getByRole('button', { name: 'Camera view', exact: true }).click();
    const loading = page.getByRole('status').filter({ hasText: 'Opening the camera' });
    await expect(loading).toBeVisible();
    await expect(loading).toBeFocused();
    expect(requested).toBe(true);
    await page.setViewportSize({ width: 320, height: 640 });
    const exit = loading.getByRole('button', { name: 'Exit to plan' });
    await expectInsideViewport(exit);
    await expectCenterHitTarget(exit);
    await exit.click();
    await expect(page.locator('.jr-banner-text')).toHaveText(before);
    await expect(page.locator('.compiled-map-canvas')).toHaveAttribute(
      'data-route-progress',
      '0.00',
    );
    await expect(
      page.getByRole('region', { name: 'Directions to Outpatient Pharmacy' }),
    ).toBeFocused();
    release();
    expect(await page.evaluate(() => Reflect.get(window, 'startupCameraRequests'))).toBe(0);

    // Resolving a cancelled import must not open the camera in the background.
    // A later explicit opening gets the real view and keyboard focus.
    await page.getByRole('button', { name: 'Camera view', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Camera guidance' })).toBeFocused();
    await expect
      .poll(() => page.evaluate(() => Reflect.get(window, 'startupCameraRequests')))
      .toBe(1);
    await page.getByRole('button', { name: 'Exit to plan' }).click();
    await expect(page.locator('.jr-banner-text')).toHaveText(before);
  } finally {
    release();
  }
});

test('a failed camera download has a tappable map exit and keeps route progress', async ({
  page,
  allowBrowserError,
}) => {
  allowBrowserError(/console: Failed to load resource:.*503.*CameraPreview-/);
  allowBrowserError(
    /console: TypeError: Failed to fetch dynamically imported module:.*CameraPreview-/,
  );
  await page.route(CAMERA_CHUNK, (route) => route.fulfill({ status: 503, body: 'Unavailable' }));
  await openPharmacyRoute(page);
  await page.locator('.checkin-toast').getByRole('button', { name: 'Dismiss' }).click();
  const canvas = page.locator('.compiled-map-canvas');
  await expect(canvas).toHaveAttribute('data-route-progress', '0.00');
  await page.getByRole('button', { name: 'Next instruction' }).click();
  // Progress is published by the next map frame, not by the button's click.
  await expect(canvas).not.toHaveAttribute('data-route-progress', '0.00');
  const progress = await canvas.getAttribute('data-route-progress');
  const instruction = await page.locator('.jr-banner-text').innerText();
  await page.getByRole('button', { name: 'Camera view', exact: true }).click();
  const alert = page.getByRole('alert').filter({ hasText: 'The camera could not be opened' });
  await expect(alert).toBeVisible();
  await expect(alert).toBeFocused();
  await expect(alert).toContainText('Reloading the app restarts your journey');
  await page.setViewportSize({ width: 320, height: 640 });
  const exit = alert.getByRole('button', { name: 'Exit to plan' });
  await expectInsideViewport(exit);
  await expectCenterHitTarget(exit);
  await exit.click();
  await expect(page.locator('.jr-banner-text')).toHaveText(instruction);
  await expect(page.locator('.compiled-map-canvas')).toHaveAttribute(
    'data-route-progress',
    progress!,
  );
});

test('a failed map download leaves check-in, search and written directions usable', async ({
  page,
  allowBrowserError,
}) => {
  allowBrowserError(/console: Failed to load resource:.*503.*VisitorMap-/);
  allowBrowserError(
    /console: TypeError: Failed to fetch dynamically imported module:.*VisitorMap-/,
  );
  await page.route(MAP_CHUNK, (route) => route.fulfill({ status: 503, body: 'Unavailable' }));
  await precompleteOnboarding(page);
  await page.goto(`/?checkin=${encodeURIComponent('voicegis://asterion/l2/east')}#/visitor`);
  await expect(page.locator('.checkin-toast')).toContainText('Checked in at Family Care Concourse');
  await page.locator('.checkin-toast').getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.getByRole('alert')).toContainText('The map could not be opened');
  await page.getByRole('button', { name: 'Search rooms and departments', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Search rooms and departments' })
    .fill('Outpatient Pharmacy');
  await page.getByRole('button', { name: 'Navigate to Outpatient Pharmacy' }).click();
  const directions = page.getByRole('region', { name: 'Directions to Outpatient Pharmacy' });
  await expect(directions).toBeVisible();
  await expect(directions.getByRole('alert')).toContainText('written directions still work');
  await page.setViewportSize({ width: 320, height: 640 });
  const reload = directions.getByRole('button', { name: 'Reload app' });
  await reload.focus();
  await expect(reload).toBeFocused();
  await expectInsideViewport(reload);
  await expectCenterHitTarget(reload);
  await reload.scrollIntoViewIfNeeded();
  await expectInsideViewport(reload);
  await expectCenterHitTarget(reload);
  const instruction = await page.locator('.jr-banner-text').innerText();
  await page.getByRole('button', { name: 'Next instruction' }).click();
  await expect(page.locator('.jr-banner-text')).not.toHaveText(instruction);
  await page.getByRole('button', { name: 'End route' }).click();
  await expect(
    page.getByRole('button', { name: 'Search rooms and departments', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('The map could not be opened');
});
