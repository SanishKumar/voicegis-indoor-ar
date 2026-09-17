import {
  expect,
  expectCenterHitTarget,
  expectInsideViewport,
  openPharmacyRoute,
  test,
} from './support';
import type { Page } from '@playwright/test';

type HandsetTest = { requests: number; pending: () => void; grant: () => void };
async function installHandsetFixture(page: Page, permission: 'granted' | 'denied' = 'granted') {
  await page.addInitScript((initial) => {
    let mode: string = initial;
    let requests = 0;
    const pending: Array<(value: string) => void> = [];
    const request = () => {
      requests += 1;
      return mode === 'pending'
        ? new Promise<string>((resolve) => pending.push(resolve))
        : Promise.resolve(mode);
    };
    Object.defineProperty(window, 'DeviceMotionEvent', {
      value: class {
        static requestPermission = request;
      },
    });
    Object.defineProperty(window, 'DeviceOrientationEvent', {
      value: class {
        static requestPermission = request;
      },
    });
    Object.defineProperty(navigator.permissions, 'query', {
      value: async () => Object.assign(new EventTarget(), { state: 'granted' }),
    });
    Object.defineProperty(window, 'handsetTest', {
      value: {
        get requests() {
          return requests;
        },
        pending() {
          mode = 'pending';
        },
        grant() {
          for (const resolve of pending.splice(0)) resolve('granted');
        },
      },
    });
    for (const type of ['devicemotion', 'deviceorientation'])
      window.addEventListener(
        type,
        (event) => {
          if (event.isTrusted) event.stopImmediatePropagation();
        },
        true,
      );
  }, permission);
}

async function openDiagnostic(page: Page) {
  await openPharmacyRoute(page);
  await page.locator('.checkin-toast').getByRole('button', { name: 'Dismiss' }).click();
  await page.getByRole('link', { name: 'Record', exact: true }).click();
  const diagnostic = page.getByRole('region', { name: 'Checkpoint session diagnostic' });
  await diagnostic.getByRole('button', { name: 'Start checkpoint diagnostic' }).click();
  await expect(diagnostic).toContainText('Waiting for a checkpoint test');
  return diagnostic;
}

test('opt-in handset diagnostics reject partial input without granting Visitor progress', async ({
  page,
}, testInfo) => {
  await installHandsetFixture(page);
  const diagnostic = await openDiagnostic(page);
  const input = diagnostic.getByRole('group', { name: 'Handset input diagnostics' });
  const enable = input.getByRole('button', { name: 'Enable motion diagnostics' });
  const disable = input.getByRole('button', { name: 'Disable motion diagnostics' });
  expect(
    await page.evaluate(
      () => (window as unknown as { handsetTest: HandsetTest }).handsetTest.requests,
    ),
  ).toBe(0);
  await enable.click();
  await expect(input).toContainText('Listening · sensor delivery is not tracking');
  const timer = await page.evaluate(() =>
    window.setInterval(() => {
      const timeStamp = performance.now();
      for (const [type, fields] of [
        ['deviceorientation', { alpha: 90, beta: 0, gamma: 0, absolute: true }],
        [
          'devicemotion',
          {
            accelerationIncludingGravity: { x: 0, y: 0, z: 9.81 },
            rotationRate: { alpha: 0, beta: 0, gamma: 0 },
          },
        ],
      ] as const) {
        const event = new Event(type);
        for (const [key, value] of Object.entries({ timeStamp, ...fields }))
          Object.defineProperty(event, key, { value });
        window.dispatchEvent(event);
      }
    }, 50),
  );
  await diagnostic
    .getByLabel('Checkpoint payload (manual test)')
    .fill('voicegis://asterion/l2/east');
  await diagnostic.getByRole('button', { name: 'Test checkpoint / reacquire' }).click();
  const complete = input
    .locator('dt')
    .filter({ hasText: /^Complete paired samples$/ })
    .locator('..')
    .locator('dd');
  await expect.poll(async () => Number(await complete.innerText())).toBeGreaterThan(2);
  await expect(diagnostic).toContainText('Guidance frozen');
  await expect(input).toContainText('Unavailable · guidance stays frozen');
  await page.evaluate(() => {
    const event = new Event('devicemotion');
    Object.defineProperties(event, {
      timeStamp: { value: performance.now() },
      accelerationIncludingGravity: { value: { x: 0, y: 0, z: 9.81 } },
      rotationRate: { value: null },
    });
    window.dispatchEvent(event);
  });
  await expect(input).toContainText('Incomplete motion sample');
  await page.setViewportSize({ width: 320, height: 700 });
  for (const control of [enable, disable]) {
    await control.scrollIntoViewIfNeeded();
    await expectInsideViewport(control);
    await expectCenterHitTarget(control);
  }
  await page.screenshot({ path: testInfo.outputPath('motion-diagnostic-320px.png') });
  await disable.click();
  await expect(input).toContainText('Stopped · no sensor listeners');
  const count = await complete.innerText();
  await page.evaluate((id) => window.clearInterval(id), timer);
  await page.getByRole('link', { name: 'Visitor view', exact: true }).click();
  await expect(page.locator('#nav-panel')).toHaveAttribute('data-step-index', '0');
  await expect(page.locator('.compiled-map')).toHaveAttribute('data-location-floor', 'l2');
  await page.getByRole('link', { name: 'Record', exact: true }).click();
  await expect(input).toContainText('Off · no sensor listeners');
  expect(Number(count)).toBeGreaterThan(0);
  expect(
    await page.evaluate(
      () => (window as unknown as { handsetTest: HandsetTest }).handsetTest.requests,
    ),
  ).toBe(2);
});

test('denied or cancelled sensor requests cannot silently attach later', async ({ page }) => {
  await installHandsetFixture(page, 'denied');
  const diagnostic = await openDiagnostic(page);
  const input = diagnostic.getByRole('group', { name: 'Handset input diagnostics' });
  const enable = input.getByRole('button', { name: 'Enable motion diagnostics' });
  await enable.click();
  await expect(input).toContainText('Sensor access denied');
  await page.evaluate(() =>
    (window as unknown as { handsetTest: HandsetTest }).handsetTest.pending(),
  );
  await enable.click();
  await expect(input).toContainText('Waiting for motion and orientation permission');
  await expect(
    diagnostic.getByRole('button', { name: 'Test checkpoint / reacquire' }),
  ).toBeDisabled();
  await input.getByRole('button', { name: 'Disable motion diagnostics' }).click();
  await page.evaluate(() =>
    (window as unknown as { handsetTest: HandsetTest }).handsetTest.grant(),
  );
  await expect(input).toContainText('Stopped · no sensor listeners');
  await enable.click();
  await expect(input).toContainText('Waiting for motion and orientation permission');
  await page.getByRole('link', { name: 'Visitor view', exact: true }).click();
  await page.evaluate(() =>
    (window as unknown as { handsetTest: HandsetTest }).handsetTest.grant(),
  );
  await page.getByRole('link', { name: 'Record', exact: true }).click();
  await expect(input).toContainText('Off · no sensor listeners');
  await expect(diagnostic).toContainText('Not started');
});

test('the operator checkpoint diagnostic expires, reacquires and leaves Visitor progress untouched', async ({
  page,
}, testInfo) => {
  // A manual authored payload is deliberately not a measured scan. Permission
  // sentinels also prove that starting this diagnostic does not enroll hardware.
  await page.addInitScript(() => {
    let requests = 0;
    const request = async () => {
      requests += 1;
      throw new Error('Unexpected diagnostic hardware request');
    };
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: request });
    Object.defineProperty(window, 'DeviceMotionEvent', {
      value: class {
        static requestPermission = request;
      },
    });
    Object.defineProperty(window, 'DeviceOrientationEvent', {
      value: class {
        static requestPermission = request;
      },
    });
    Object.defineProperty(window, 'diagnosticHardwareRequests', { get: () => requests });
  });
  await openPharmacyRoute(page);
  await page.locator('.checkin-toast').getByRole('button', { name: 'Dismiss' }).click();
  await page.getByRole('button', { name: 'Next instruction' }).click();
  const instruction = await page.locator('.jr-banner-copy').innerText();
  const facts = await page.locator('.jr-trip-time').innerText();
  const floor = await page.locator('.compiled-map').getAttribute('data-location-floor');
  await page.getByRole('link', { name: 'Record', exact: true }).click();
  const diagnostic = page.getByRole('region', { name: 'Checkpoint session diagnostic' });
  const start = diagnostic.getByRole('button', { name: 'Start checkpoint diagnostic' });
  const stop = diagnostic.getByRole('button', { name: 'Stop diagnostic' });
  const payload = diagnostic.getByLabel('Checkpoint payload (manual test)');
  const reacquire = diagnostic.getByRole('button', { name: 'Test checkpoint / reacquire' });
  await start.click();
  await expect(diagnostic).toContainText('Waiting for a checkpoint test');
  await payload.fill('voicegis://foreign/checkpoint');
  await reacquire.click();
  await expect(diagnostic.getByRole('status')).toContainText('Checkpoint refused');
  await payload.fill('voicegis://asterion/l2/east');
  await reacquire.click();
  await expect(diagnostic).toContainText('Checkpoint resolved · independent heading unavailable');
  await expect(diagnostic.getByRole('status')).toContainText('not a physical scan');
  await expect(diagnostic).toContainText('Guidance frozen');
  await expect(diagnostic).toContainText('Expired · no qualified motion received');
  await reacquire.click();
  await expect(diagnostic).toContainText('Checkpoint resolved · independent heading unavailable');
  await stop.click();
  await expect(diagnostic.locator('dd').filter({ hasText: /^Stopped$/ })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 700 });
  for (const control of [start, payload, reacquire]) {
    await control.scrollIntoViewIfNeeded();
    await expectInsideViewport(control);
    await expectCenterHitTarget(control);
  }
  await page.screenshot({ path: testInfo.outputPath('checkpoint-diagnostic-controls-320px.png') });
  await diagnostic
    .getByRole('heading', { name: 'Checkpoint session', exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('checkpoint-diagnostic-heading-320px.png') });
  await start.click();
  await expect(diagnostic).toContainText('Waiting for a checkpoint test');
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect(diagnostic).toContainText('Paused · page hidden');
  await expect(reacquire).toBeDisabled();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { diagnosticHardwareRequests: number }).diagnosticHardwareRequests,
    ),
  ).toBe(0);
  await page.getByRole('link', { name: 'Visitor view', exact: true }).click();
  await expect(page.locator('.jr-banner-copy')).toHaveText(instruction, {
    useInnerText: true,
  });
  await expect(page.locator('.jr-trip-time')).toHaveText(facts, { useInnerText: true });
  await expect(page.locator('.compiled-map')).toHaveAttribute('data-location-floor', floor!);
  await page.getByRole('link', { name: 'Record', exact: true }).click();
  await expect(diagnostic).toContainText('Not started');
  await expect(reacquire).toBeDisabled();
});
