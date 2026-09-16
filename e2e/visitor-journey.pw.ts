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
  await expect(directions.getByText('Route preview', { exact: true })).toBeVisible();
  await expect(directions.locator('.nav-legs')).toBeHidden();
  const facts = await directions.locator('.nav-journey-facts').innerText();
  const start = page.getByRole('button', { name: /Change start location/ });
  const startLabel = await start.getAttribute('aria-label');
  const map = page.locator('.compiled-map');
  const locationFloor = await map.getAttribute('data-location-floor');
  const label = await directions.locator('.nav-current-instruction-label').innerText();
  const total = Number(label.match(/of\s+(\d+)/i)?.[1]);
  expect(total).toBeGreaterThan(1);
  for (let index = 1; index < total; index += 1) {
    await directions.getByRole('button', { name: 'Next instruction' }).click();
  }
  await expect(directions.locator('.nav-journey-facts')).toHaveText(facts, { useInnerText: true });
  await expect(start).toHaveAttribute('aria-label', startLabel!);
  await expect(map).toHaveAttribute('data-location-floor', locationFloor!);
  await expect(page.getByLabel('Map status')).toContainText('Route ready');
  await expect(directions.locator('.nav-arrived')).toHaveCount(0);
  await directions.getByRole('button', { name: 'I’m at my destination' }).click();
  await expect(directions.locator('.nav-arrived')).toContainText('Arrival confirmed by you');
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
  await page.getByRole('button', { name: 'Recenter on last check-in' }).click();
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
  const instruction = await page.locator('.nav-current-instruction strong').innerText();
  const floor = await page.locator('.compiled-map').getAttribute('data-location-floor');
  await page.getByRole('button', { name: 'Which way?' }).click();
  await expect(page.locator('.camera-preview-step-kicker')).toContainText('Preview instruction 2');
  await expectCenterHitTarget(page.getByRole('button', { name: 'Exit to plan' }));
  await page.getByRole('button', { name: 'Exit to plan' }).click();
  await expect(page.locator('.nav-current-instruction strong')).toHaveText(instruction);
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
  const instruction = await page.locator('.nav-current-instruction').innerText();
  await page.getByRole('button', { name: 'Which way?' }).click();
  await expect(page.locator('.camera-preview-fallback')).toContainText(
    'Requested device not found',
  );
  const exit = page.getByRole('button', { name: 'Exit to plan', exact: true });
  await expectCenterHitTarget(exit);
  await exit.click();
  await expect(page.locator('.nav-current-instruction')).toHaveText(instruction, {
    useInnerText: true,
  });
});

test('camera heading stays uncalibrated and its controls remain reachable', async ({
  page,
}, testInfo) => {
  // Controlled browser events test UI semantics, not sensor accuracy.
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: async () => new MediaStream(),
    });
    Object.defineProperty(window, 'DeviceOrientationEvent', {
      value: class {
        static requestPermission() {
          return Promise.resolve('granted');
        }
      },
    });
    for (const name of ['deviceorientation', 'deviceorientationabsolute']) {
      window.addEventListener(
        name,
        (event) => {
          if (event.isTrusted) event.stopImmediatePropagation();
        },
        true,
      );
    }
  });
  await openPharmacyRoute(page);
  await page.locator('.checkin-toast').getByRole('button', { name: 'Dismiss' }).click();
  await page.getByRole('button', { name: 'Which way?' }).click();
  const telemetry = page.getByRole('complementary', { name: 'Guidance readiness' });
  await expect(telemetry).toContainText('Not enabled');
  await page.getByRole('button', { name: 'Enable heading' }).click();
  await expect(page.getByRole('button', { name: 'Disable heading' })).toBeVisible();
  await page.evaluate(() => {
    const event = new Event('deviceorientation');
    Object.defineProperties(event, {
      alpha: { value: 270 },
      absolute: { value: false },
      timeStamp: { value: performance.now() },
    });
    window.dispatchEvent(event);
  });
  await expect(telemetry).toContainText('Relative only');
  await expect(page.locator('.camera-preview-step-kicker span')).toHaveCount(0);
  const compassTimer = await page.evaluate(() => {
    const emitCompass = () => {
      const event = new Event('deviceorientation');
      Object.defineProperties(event, {
        webkitCompassHeading: { value: 90 },
        webkitCompassAccuracy: { value: 5 },
        timeStamp: { value: performance.now() },
      });
      window.dispatchEvent(event);
    };
    emitCompass();
    return window.setInterval(emitCompass, 100);
  });
  await expect(telemetry).toContainText('Uncalibrated');
  await expect(page.locator('.camera-preview-step-kicker span')).toHaveCount(0);
  await expectCenterHitTarget(page.getByRole('button', { name: 'Disable heading' }));
  await expectCenterHitTarget(page.getByRole('button', { name: 'Exit to plan' }));
  await page.screenshot({ path: testInfo.outputPath('heading-uncalibrated.png') });
  await page.setViewportSize({ width: 320, height: 700 });
  await expect
    .poll(() =>
      telemetry.evaluate((panel) => {
        const bounds = panel.getBoundingClientRect();
        return (
          panel.textContent?.includes('Uncalibrated') &&
          [...panel.querySelectorAll('div, span, strong')].every((element) => {
            const box = element.getBoundingClientRect();
            return box.left >= bounds.left && box.right <= bounds.right;
          })
        );
      }),
    )
    .toBe(true);
  await expectCenterHitTarget(page.getByRole('button', { name: 'Disable heading' }));
  await expectCenterHitTarget(page.getByRole('button', { name: 'Exit to plan' }));
  await expect(telemetry).toContainText('Uncalibrated');
  await page.screenshot({ path: testInfo.outputPath('heading-320px.png') });
  await page.getByRole('button', { name: 'Disable heading' }).click();
  await expect(telemetry).toContainText('Not enabled');
  await page.evaluate((timer) => window.clearInterval(timer), compassTimer);
  await page.getByRole('button', { name: 'Exit to plan' }).click();
  await expect(page.locator('.compiled-map')).toBeVisible();
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
  const current = directions.locator('.nav-current-instruction');
  await expect(current).toContainText(/^Instruction 1 of \d+/);
  await expect(page.locator('.camera-preview')).toHaveCount(0);

  const expand = directions.getByRole('button', { name: /Show all \d+ legs/ });
  if (await expand.isVisible()) await expand.click();
  const exactTurn = directions
    .locator('.nav-leg-instructions li')
    .filter({ hasText: /(?:Turn|Bear|Keep|Make a U-turn)/i })
    .first();
  await expect(exactTurn, 'the expanded route contains no exact turn instruction').toBeVisible();
  const turnText = (await exactTurn.locator('span').innerText()).trim();
  expect(turnText).not.toBe('');

  const label = await current.locator('.nav-current-instruction-label').innerText();
  const total = Number(label.match(/\d+\s+of\s+(\d+)/i)?.[1]);
  expect(total).toBeGreaterThan(1);
  for (
    let index = 1;
    index < total && !(await current.innerText()).includes(turnText);
    index += 1
  ) {
    await directions.getByRole('button', { name: 'Next instruction' }).click();
  }

  await expect(current).toContainText(turnText);
  await expect(page.locator('.camera-preview')).toHaveCount(0);
});

test('the current map instruction and its controls stay reachable on a small phone', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await openPharmacyRoute(page);

  const directions = page.getByRole('region', { name: 'Directions to Outpatient Pharmacy' });
  const current = directions.locator('.nav-current-instruction');
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

  await page.getByRole('button', { name: 'Cancel' }).click();

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
