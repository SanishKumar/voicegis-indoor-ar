import {
  expect,
  expectCenterHitTarget,
  openPharmacyRoute,
  precompleteOnboarding,
  test,
} from './support';

test('previewing the whole route preserves location and totals until arrival is confirmed', async ({
  page,
}) => {
  test.setTimeout(45_000);
  await openPharmacyRoute(page);
  const directions = page.getByRole('region', { name: 'Directions to Outpatient Pharmacy' });
  const banner = page.getByRole('region', { name: 'Next step' });
  await expect(banner).toContainText('Overview');
  const facts = await directions.locator('.jr-trip-time').innerText();
  const start = page.getByRole('button', { name: /Change start location/ });
  const startLabel = await start.getAttribute('aria-label');
  const map = page.locator('.compiled-map');
  const locationFloor = await map.getAttribute('data-location-floor');
  const total = Number(await directions.getAttribute('data-step-count'));
  expect(total).toBeGreaterThan(1);
  for (let index = 1; index < total; index += 1) {
    await directions.getByRole('button', { name: 'Next instruction' }).click();
  }
  await expect(directions).toHaveAttribute('data-step-index', String(total - 1));
  // Stepping through is a preview: the trip, the start and its floor stay put.
  await expect(directions.locator('.jr-trip-time')).toHaveText(facts, { useInnerText: true });
  await expect(start).toHaveAttribute('aria-label', startLabel!);
  await expect(map).toHaveAttribute('data-location-floor', locationFloor!);
  await expect(banner).toContainText('Preview');
  // Reaching the end of the steps is not arriving.
  await expect(page.locator('.jr-arrived')).toHaveCount(0);
  await directions.getByRole('button', { name: 'I’m at my destination' }).click();
  await expect(page.locator('.jr-arrived')).toContainText('Arrival confirmed by you');
  await directions.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(directions).toHaveCount(0);
});

test('dismissing a check-in and browsing floors preserves a recenterable checkpoint', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await openPharmacyRoute(page);
  const map = page.locator('.compiled-map');
  const floor = await map.getAttribute('data-location-floor');
  await page.locator('.checkin-toast').getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.getByLabel('Planning location')).toContainText('Last check-in');
  await expect(page.getByRole('button', { name: /Change start location/ })).toHaveAttribute(
    'aria-label',
    /Family Care Concourse/,
  );
  const floors = page.getByRole('group', { name: 'Floors', exact: true });
  const checkpointFloor = await floors
    .locator('button[aria-pressed="true"]')
    .getAttribute('aria-label');
  await floors.locator('button[aria-pressed="false"]').first().click();
  await expect(map).toHaveAttribute('data-location-floor', floor!);
  // Inside a journey, recentering returns to the route from where guidance is.
  await page.getByRole('button', { name: 'Show whole route' }).click();
  await expect(floors.getByRole('button', { name: checkpointFloor! })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('camera preview returns to the same shared instruction without moving the checkpoint', async ({
  page,
}) => {
  // A blank test stream exercises view switching without enrolling a camera.
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: async () => new MediaStream(),
    });
  });
  await openPharmacyRoute(page);
  await page.locator('.checkin-toast').getByRole('button', { name: 'Dismiss' }).click();
  await page.getByRole('button', { name: 'Next instruction' }).click();
  const instruction = await page.locator('.jr-banner-text').innerText();
  const floor = await page.locator('.compiled-map').getAttribute('data-location-floor');
  await page.getByRole('button', { name: 'Camera view' }).click();
  // The camera shows the instruction the banner shows: one guidance, two windows onto it.
  // The card names the place at a glance; the sheet keeps the whole sentence.
  await expect(page.locator('.ar-sheet-instruction')).toHaveText(instruction);
  await expect(page.locator('.camera-preview-instruction-text')).not.toBeEmpty();
  await expectCenterHitTarget(page.getByRole('button', { name: 'Exit to plan' }));
  await page.getByRole('button', { name: 'Exit to plan' }).click();
  await expect(page.locator('.jr-banner-text')).toHaveText(instruction);
  await expect(page.locator('.compiled-map')).toHaveAttribute('data-location-floor', floor!);
});

test('a first-time visitor names a destination, then a start, and gets a route', async ({
  page,
}) => {
  await page.goto('/#/visitor');

  await expect(page.getByRole('heading', { name: 'Where are you going?' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search destination rooms' }).fill('Outpatient Pharmacy');
  await page.getByRole('button', { name: /Outpatient Pharmacy/ }).click();

  await expect(page.getByRole('heading', { name: 'Now, where are you?' })).toBeVisible();
  await page.getByRole('button', { name: /Civic Plaza Entrance/ }).click();

  await expect(page.locator('.compiled-map')).toBeVisible();
  await expect(page.getByLabel('Fastest available route')).toBeVisible();
  await expect(page.getByText('Outpatient Pharmacy', { exact: true }).first()).toBeVisible();
});

test('a missing camera explains the failure and preserves the route on return', async ({
  page,
  allowBrowserError,
}) => {
  allowBrowserError(/console: Camera preview failed: NotFoundError: Requested device not found/);
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: async () => {
        throw new DOMException('Requested device not found', 'NotFoundError');
      },
    });
  });
  await openPharmacyRoute(page);
  await page.locator('.checkin-toast').getByRole('button', { name: 'Dismiss' }).click();
  const instruction = await page.locator('.jr-banner-copy').innerText();
  await page.getByRole('button', { name: 'Camera view' }).click();
  await expect(page.locator('.camera-preview-fallback')).toContainText(
    'Requested device not found',
  );
  const exit = page.getByRole('button', { name: 'Exit to plan', exact: true });
  await expectCenterHitTarget(exit);
  await exit.click();
  await expect(page.locator('.jr-banner-copy')).toHaveText(instruction, {
    useInnerText: true,
  });
});

test('the camera view says what it knows and its controls remain reachable', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: async () => new MediaStream(),
    });
  });
  await openPharmacyRoute(page);
  await page.locator('.checkin-toast').getByRole('button', { name: 'Dismiss' }).click();
  await page.getByRole('button', { name: 'Camera view' }).click();
  const view = page.locator('.camera-preview');
  const telemetry = page.getByRole('complementary', { name: 'Guidance readiness' });
  // With no attitude/alignment, no fictitious floor route is drawn.
  await expect(telemetry).toContainText('Not tracked');
  await expect(telemetry.locator('div', { hasText: 'Heading' })).toContainText('Not known');
  await expect(view).toHaveAttribute('data-heading-source', 'off');
  await expect(view).toHaveAttribute('data-ribbon', '0');
  await expect(page.locator('.camera-preview-status')).toContainText('Not world-anchored');
  // No immersive session is offered where the browser has none.
  await expect(view).toHaveAttribute('data-ar', 'no');
  await expect(page.getByRole('button', { name: 'Start AR' })).toHaveCount(0);
  await expectCenterHitTarget(page.getByRole('button', { name: 'Track my walk' }));
  await expectCenterHitTarget(page.getByRole('button', { name: 'Exit to plan' }));
  await page.screenshot({ path: testInfo.outputPath('camera-guidance.png') });
  await page.setViewportSize({ width: 320, height: 700 });
  await expect
    .poll(() =>
      telemetry.evaluate((panel) => {
        const bounds = panel.getBoundingClientRect();
        return [...panel.querySelectorAll('div, span, strong')].every((element) => {
          const box = element.getBoundingClientRect();
          return box.left >= bounds.left && box.right <= bounds.right;
        });
      }),
    )
    .toBe(true);
  await expectCenterHitTarget(page.getByRole('button', { name: 'Track my walk' }));
  await expectCenterHitTarget(page.getByRole('button', { name: 'Exit to plan' }));
  await page.screenshot({ path: testInfo.outputPath('camera-320px.png') });
  await page.getByRole('button', { name: 'Exit to plan' }).click();
  await expect(page.locator('.compiled-map')).toBeVisible();
});

test('an immersive session is offered where the browser has one, and a refusal is explained', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: async () => new MediaStream(),
    });
    Object.defineProperty(navigator, 'xr', {
      value: {
        isSessionSupported: async (mode: string) => mode === 'immersive-ar',
        requestSession: async () => {
          throw new DOMException('Immersive sessions are not allowed here', 'NotAllowedError');
        },
      },
    });
  });
  await openPharmacyRoute(page);
  await page.locator('.checkin-toast').getByRole('button', { name: 'Dismiss' }).click();
  await page.getByRole('button', { name: 'Camera view' }).click();
  const view = page.locator('.camera-preview');
  await expect(view).toHaveAttribute('data-ar', 'available');
  const start = page.getByRole('button', { name: 'Start AR' });
  // Nothing from the flat view's orientation feed is needed first: the
  // session tracks the phone itself, and the tap is the visitor facing the
  // corridor. Requiring an alignment first left this button dead on a phone.
  await expect(start).toBeEnabled();
  await expectCenterHitTarget(start);
  await start.click();
  await expect(page.locator('.camera-preview-note')).toContainText(
    'The immersive session was not allowed.',
  );
  await expect(view).toHaveAttribute('data-ar', 'available');
  await expect(page.locator('.camera-preview-status')).toContainText('Not world-anchored');
});

test('a verified check-in drives fastest and step-free routes through different connectors', async ({
  page,
}) => {
  await openPharmacyRoute(page);

  const fastest = page.getByLabel('Fastest available route');
  await expect(fastest).toContainText('South Public Stair');

  const accessibleToggle = page.getByRole('button', {
    name: 'Use step-free accessible routing',
  });
  await accessibleToggle.click();

  const stepFree = page.getByLabel('Step-free route');
  await expect(stepFree).toContainText('Panoramic Atrium Lift');
  const fastestToggle = page.getByRole('button', { name: 'Use fastest available routing' });
  await expect(fastestToggle).toHaveAttribute('aria-pressed', 'true');
});

test('map guidance preserves every exact turn without opening the camera', async ({ page }) => {
  await openPharmacyRoute(page);

  const directions = page.getByRole('region', { name: 'Directions to Outpatient Pharmacy' });
  const current = page.locator('.jr-banner-text');
  await expect(directions).toHaveAttribute('data-step-index', '0');
  await expect(page.locator('.camera-preview')).toHaveCount(0);

  const expand = directions.getByRole('button', { name: /Show all \d+ steps/ });
  if (await expand.isVisible()) await expand.click();
  const exactTurn = directions
    .locator('.jr-step-text')
    .filter({ hasText: /(?:Turn|Bear|Keep|Make a U-turn)/i })
    .first();
  await expect(exactTurn, 'the step list contains no exact turn instruction').toBeVisible();
  const turnText = (await exactTurn.innerText()).trim();
  expect(turnText).not.toBe('');

  const total = Number(await directions.getAttribute('data-step-count'));
  expect(total).toBeGreaterThan(1);
  for (let index = 1; index < total && (await current.innerText()) !== turnText; index += 1) {
    await directions.getByRole('button', { name: 'Next instruction' }).click();
  }

  // The banner carries the exact manoeuvre, word for word, without the camera.
  await expect(current).toHaveText(turnText);
  await expect(page.locator('.camera-preview')).toHaveCount(0);
});

test('the current map instruction and its controls stay reachable on a small phone', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await openPharmacyRoute(page);

  const directions = page.getByRole('region', { name: 'Directions to Outpatient Pharmacy' });
  const current = page.locator('.jr-banner-copy');
  const next = directions.getByRole('button', { name: 'Next instruction' });
  await expect(current).toBeVisible();
  await expect(next).toBeVisible();
  await expectCenterHitTarget(next);

  for (const control of [current, next]) {
    const bounds = await control.boundingBox();
    expect(bounds, 'guidance control has no box').not.toBeNull();
    expect(bounds!.y).toBeGreaterThanOrEqual(-0.5);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(700.5);
  }
});

test('a foreign-venue check-in is consumed with a visible refusal', async ({ page }) => {
  await precompleteOnboarding(page);
  const payload = encodeURIComponent('voicegis://harbor-exchange/g/ferry-entry');
  await page.goto(`/?checkin=${payload}#/visitor`);

  const alert = page.getByRole('alert');
  await expect(alert).toContainText('That check-in link did not work here');
  await expect(alert).toContainText(/That code is not one of this venue.s check-in points/);
  await expect(alert).toContainText('Active venue: Asterion University Medical Center');
  expect(new URL(page.url()).searchParams.has('checkin')).toBe(false);
  await expect(page.getByText(/Checked in at/)).toHaveCount(0);
});

test('Escape closes only the topmost dialog and restores focus', async ({ page }) => {
  await precompleteOnboarding(page);
  await page.goto('/#/visitor');
  await expect(page.locator('.compiled-map')).toBeVisible();

  const trigger = page.getByRole('button', { name: /Change start location/ });
  await trigger.click();

  const locationDialog = page.getByRole('dialog', { name: 'Set Your Location' });
  await expect(locationDialog).toBeVisible();
  await expect
    .poll(() => locationDialog.evaluate((dialog) => dialog.contains(document.activeElement)))
    .toBe(true);

  await locationDialog.getByRole('button', { name: 'Scan a check-in code' }).click();
  const scannerDialog = page.getByRole('dialog', { name: 'Scan a check-in code' });
  await expect(scannerDialog).toBeVisible();
  await expect
    .poll(() => scannerDialog.evaluate((dialog) => dialog.contains(document.activeElement)))
    .toBe(true);

  await page.keyboard.press('Escape');
  await expect(scannerDialog).toHaveCount(0);
  await expect(locationDialog).toBeVisible();
  await expect
    .poll(() => locationDialog.evaluate((dialog) => dialog.contains(document.activeElement)))
    .toBe(true);

  await page.keyboard.press('Escape');
  await expect(locationDialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('the stack requires a cross-floor route and an explicit 3D overview', async ({ page }) => {
  await precompleteOnboarding(page);
  await page.goto('/#/visitor');
  const map = page.locator('.compiled-map');
  await expect(map).toBeVisible();

  // Nothing routed yet, so there is nothing to stack: one storey drawn.
  await expect(map).toHaveAttribute('data-route-floors', '0');
  await expect(map).toHaveAttribute('data-floors-shown', '1');

  const routeTo = async (name: string) => {
    await page.getByRole('button', { name: 'Search rooms and departments', exact: true }).click();
    await page.getByRole('textbox', { name: 'Search rooms and departments' }).fill(name);
    await page.getByRole('button', { name: `Navigate to ${name}` }).click();
    await expect(page.getByLabel('Fastest available route')).toBeVisible();
  };

  // Same floor as the entrance: one storey, so the map stays flat.
  await routeTo('Outpatient Registration');
  await expect(map).toHaveAttribute('data-route-floors', '1');
  await expect(map).toHaveAttribute('data-floors-shown', '1');

  await page.getByRole('button', { name: 'End route' }).click();

  // A route that climbs still starts with just the floor being inspected.
  await routeTo('Maternity Clinic');
  const crossed = Number(await map.getAttribute('data-route-floors'));
  expect(crossed).toBeGreaterThan(1);
  await expect(map).toHaveAttribute('data-floors-shown', '1');
  await page.getByRole('button', { name: '3D model', exact: true }).click();
  await expect(map).toHaveAttribute('data-floors-shown', '1');
  await page.getByRole('button', { name: 'Route overview', exact: true }).click();
  // The scene's own count, not the route's: this is what proves it stacked.
  await expect
    .poll(async () => Number(await map.getAttribute('data-floors-shown')))
    .toBeGreaterThan(1);
  await page.getByRole('button', { name: '2D plan', exact: true }).click();
  await expect(map).toHaveAttribute('data-floors-shown', '1');
  await page.getByRole('button', { name: '3D model', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Route overview', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Route overview', exact: true }).click();
  await expect(map).toHaveAttribute('data-floors-shown', '1');
});
