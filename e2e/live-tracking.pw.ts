import type { Page } from '@playwright/test';
import { expect, openPharmacyRoute, test } from './support';

/**
 * Sensors as an Android phone presents them once access has been granted:
 * both event constructors, permission requests that resolve at once, and a
 * permissions query that reports them granted. Real motion events from the
 * host are stopped so only the walker below reaches the page.
 */
async function installSensors(page: Page) {
  await page.addInitScript(() => {
    const request = () => Promise.resolve('granted');
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
    for (const type of ['devicemotion', 'deviceorientation'])
      window.addEventListener(
        type,
        (event) => {
          if (event.isTrusted) event.stopImmediatePropagation();
        },
        true,
      );
  });
}

/**
 * A walker inside the page: footfalls as a rise above gravity that drops back,
 * turns as a gyroscope rate, tilt held flat. Everything is driven by the wall
 * clock rather than by timer ticks, because a busy renderer runs timers late:
 * a stride every 300 ms stays a stride every 300 ms however slowly the timer
 * fires, and a turn of ninety degrees ends when ninety degrees have been
 * integrated, not when the test happens to get back to the page.
 */
async function installWalker(page: Page) {
  await page.evaluate(() => {
    const GRAVITY = 9.81;
    const TURN_RATE = 90;
    let timer = 0;
    let cadenceMs = 0;
    let walkStart = 0;
    let turnRemaining = 0;
    let lastTick = 0;
    let obeyTimer = 0;
    const dispatch = (type: string, fields: Record<string, unknown>) => {
      const event = new Event(type);
      for (const [key, value] of Object.entries({ timeStamp: performance.now(), ...fields }))
        Object.defineProperty(event, key, { value });
      window.dispatchEvent(event);
    };
    const walker = {
      start() {
        walker.stop();
        lastTick = performance.now();
        timer = window.setInterval(() => {
          const now = performance.now();
          const elapsed = (now - lastTick) / 1000;
          lastTick = now;
          const phase = cadenceMs > 0 ? (now - walkStart) % cadenceMs : cadenceMs;
          const pulse = cadenceMs > 0 && phase < cadenceMs * 0.4;
          let rate = 0;
          if (turnRemaining !== 0) {
            const step =
              Math.sign(turnRemaining) * Math.min(Math.abs(turnRemaining), TURN_RATE * elapsed);
            rate = elapsed > 0 ? step / elapsed : 0;
            turnRemaining -= step;
          }
          dispatch('deviceorientation', { alpha: 0, beta: 0, gamma: 0, absolute: false });
          dispatch('devicemotion', {
            accelerationIncludingGravity: { x: 0, y: 0, z: pulse ? GRAVITY + 3 : GRAVITY },
            // Flat on its back, the rate about screen-Z is the turn; heading is its negative.
            rotationRate: { alpha: -rate, beta: 0, gamma: 0 },
          });
        }, 16);
      },
      stand() {
        cadenceMs = 0;
      },
      walk(stepEveryMs = 300) {
        cadenceMs = stepEveryMs;
        walkStart = performance.now();
      },
      /** Turn through this many degrees, clockwise when positive, then walk on. */
      turnBy(degrees: number) {
        turnRemaining = degrees;
      },
      /**
       * Do what the banner says, the way a person following it would: when
       * the instruction becomes "Now", make that turn. Each instruction is
       * acted on once.
       */
      obey() {
        let acted = '';
        obeyTimer = window.setInterval(() => {
          const lead = document.querySelector('.jr-banner-lead')?.textContent ?? '';
          const text = document.querySelector('.jr-banner-text')?.textContent ?? '';
          if (!lead.startsWith('Now') || text === acted) return;
          acted = text;
          const turn = /^Turn right/.test(text)
            ? 90
            : /^Turn left/.test(text)
              ? -90
              : /^Bear right/.test(text)
                ? 35
                : /^Bear left/.test(text)
                  ? -35
                  : /^Turn around/.test(text)
                    ? 180
                    : 0;
          if (turn !== 0) walker.turnBy(turn);
        }, 150);
      },
      stop() {
        window.clearInterval(timer);
        timer = 0;
      },
      stopObeying() {
        window.clearInterval(obeyTimer);
        obeyTimer = 0;
      },
    };
    (window as unknown as { walker: typeof walker }).walker = walker;
  });
}

const walker = (page: Page, call: string) =>
  page.evaluate((code) => {
    new Function('walker', code)((window as unknown as { walker: unknown }).walker);
  }, call);

test('a checked-in visitor can track their walk and the guidance follows their steps', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await installSensors(page);
  await openPharmacyRoute(page);
  await page.locator('.checkin-toast').getByRole('button', { name: 'Dismiss' }).click();
  await installWalker(page);
  const journey = page.locator('.jr');
  const canvas = page.locator('.compiled-map-canvas');
  const directions = page.getByRole('region', { name: 'Directions to Outpatient Pharmacy' });

  // Sensors and a scanned start: tracking is the offer, the walk-through the fallback.
  const track = page.getByRole('button', { name: 'Track my walk' });
  await expect(track).toBeVisible();
  // The walk-through stays available as a preview, beside the step list.
  const showSteps = page.getByRole('button', { name: /^Show all [0-9]+ steps$/ });
  if (await showSteps.isVisible()) await showSteps.click();
  await expect(page.getByRole('button', { name: /walk-through/i })).toBeVisible();
  const hideSteps = page.getByRole('button', { name: 'Hide all steps' });
  if (await hideSteps.isVisible()) await hideSteps.click();
  await track.click();
  await expect(journey).toHaveAttribute('data-tracking', 'on');
  await expect(journey).toHaveAttribute('data-tracking-reason', 'awaiting-departure');
  await expect(directions.getByRole('button', { name: 'Stop tracking' })).toBeVisible();
  // Nobody presses Next while walking.
  await expect(page.getByRole('button', { name: 'Next instruction' })).toHaveCount(0);

  // Standing still at the sign moves nothing.
  await walker(page, 'walker.start(); walker.stand();');
  await page.waitForTimeout(1_200);
  await expect(canvas).toHaveAttribute('data-route-progress', '0.00');
  await expect(journey).toHaveAttribute('data-tier', 'anchored');

  // Walking moves the marker along the route and the banner counts down.
  const leadBefore = await page.locator('.jr-banner-lead').innerText();
  await walker(page, 'walker.walk(300);');
  await expect(journey).toHaveAttribute('data-tier', 'tracking', { timeout: 15_000 });
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-route-progress')), {
      timeout: 15_000,
    })
    .toBeGreaterThan(3);
  await expect(canvas).toHaveAttribute('data-camera-follow', 'following');
  await expect.poll(() => page.locator('.jr-banner-lead').innerText()).not.toBe(leadBefore);
  const progressWhileWalking = Number(await canvas.getAttribute('data-route-progress'));

  // A sensor stream that stops is a paused tracker, not a marker that keeps going.
  await walker(page, 'walker.stop();');
  await expect(journey).toHaveAttribute('data-tracking-reason', 'sensors-silent', {
    timeout: 5_000,
  });
  await expect(journey).toHaveAttribute('data-tier', 'frozen');
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-route-progress')))
    .toBeGreaterThanOrEqual(progressWhileWalking);

  // Sensors back: tracking resumes from where it was. From here the walker
  // does what the banner tells it, turning where the route turns.
  await walker(page, 'walker.start(); walker.walk(300); walker.obey();');
  await expect(journey).toHaveAttribute('data-tier', 'tracking', { timeout: 10_000 });

  // The route changes floor by the South Public Stair. The tracker stops at the
  // top and asks, rather than deciding the visitor went down.
  await expect(journey).toHaveAttribute('data-tracking-reason', 'floor-change', {
    timeout: 60_000,
  });
  await expect(journey).toHaveAttribute('data-tier', 'frozen');
  const atStairs = Number(await canvas.getAttribute('data-route-progress'));
  await page.waitForTimeout(1_500);
  expect(Number(await canvas.getAttribute('data-route-progress'))).toBe(atStairs);
  const confirm = directions.getByRole('button', { name: /I’m on Ground/ });
  await expect(confirm).toBeVisible();
  await confirm.click();
  await expect(journey).not.toHaveAttribute('data-tracking-reason', 'floor-change');
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-route-progress')))
    .toBeGreaterThan(atStairs);
  await expect(
    page.getByRole('group', { name: 'Floors', exact: true }).getByRole('button', {
      name: /Show Ground/,
    }),
  ).toHaveAttribute('aria-pressed', 'true');

  // Stopping gives the manual controls back, and starting again carries on
  // from where the visitor is rather than from the sign they scanned.
  await directions.getByRole('button', { name: 'Stop tracking' }).click();
  await expect(journey).toHaveAttribute('data-tracking', 'off');
  await expect(page.getByRole('button', { name: 'Next instruction' })).toBeVisible();
  const paused = Number(await canvas.getAttribute('data-route-progress'));
  expect(paused).toBeGreaterThan(atStairs);
  await page.getByRole('button', { name: 'Track my walk' }).click();
  await expect(journey).toHaveAttribute('data-tracking', 'on');
  expect(Number(await canvas.getAttribute('data-route-progress'))).toBeGreaterThanOrEqual(paused);
  await expect(page.getByRole('button', { name: 'Next instruction' })).toHaveCount(0);

  // Following the instructions all the way brings the visitor to the door.
  await expect(journey).toHaveAttribute('data-tracking-reason', 'arrived', { timeout: 60_000 });
  await expect(page.locator('.jr-banner-lead')).toContainText('Arriving');
  await directions.getByRole('button', { name: 'I’m at my destination' }).click();
  await expect(journey).toHaveAttribute('data-tracking', 'off');
  await expect(directions.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
  await walker(page, 'walker.stopObeying(); walker.stop();');
});

test('a walk that leaves the route is reported, not followed', async ({ page }) => {
  test.setTimeout(60_000);
  await installSensors(page);
  await openPharmacyRoute(page);
  await page.locator('.checkin-toast').getByRole('button', { name: 'Dismiss' }).click();
  await installWalker(page);
  const journey = page.locator('.jr');
  const canvas = page.locator('.compiled-map-canvas');
  await page.getByRole('button', { name: 'Track my walk' }).click();
  await expect(journey).toHaveAttribute('data-tracking', 'on');
  await walker(page, 'walker.start(); walker.walk(300);');
  await expect(journey).toHaveAttribute('data-tier', 'tracking', { timeout: 15_000 });
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-route-progress')), {
      timeout: 15_000,
    })
    .toBeGreaterThan(4);

  // A quarter turn where the corridor does not turn, then keep walking.
  await walker(page, 'walker.turnBy(90);');
  await expect(journey).toHaveAttribute('data-tracking-reason', 'off-route', {
    timeout: 15_000,
  });
  const held = Number(await canvas.getAttribute('data-route-progress'));
  await expect(page.getByRole('button', { name: 'Scan a code' })).toBeVisible();
  await page.waitForTimeout(1_500);
  // The marker holds; it is not walked down a corridor the route never uses.
  expect(Number(await canvas.getAttribute('data-route-progress'))).toBe(held);

  // The scan offer opens the camera scanner directly.
  await page.getByRole('button', { name: 'Scan a code' }).click();
  await expect(page.getByRole('dialog', { name: 'Scan a check-in code' })).toBeVisible();
  await page.keyboard.press('Escape');
  await walker(page, 'walker.stop();');
});
