import { readFile } from 'node:fs/promises';
import { importCaptureSession } from '../packages/localization-core/src/captureStream';
import { expect, precompleteOnboarding, test } from './support';

// Synthetic browser events prove wiring and exported chronology, not handset
// timing, permission behavior on iOS, or localization accuracy.
test('recorder exports continuity boundaries and fresh tilt after foregrounding', async ({
  page,
}) => {
  await precompleteOnboarding(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'DeviceMotionEvent', { configurable: true, value: class {} });
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    for (const type of ['devicemotion', 'deviceorientation']) {
      window.addEventListener(
        type,
        (event) => {
          if (event.isTrusted) event.stopImmediatePropagation();
        },
        true,
      );
    }
  });
  await page.goto('/#/recorder');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  await page.evaluate(() => {
    const emit = (type: string, fields: Record<string, unknown>) => {
      const event = new Event(type);
      for (const [key, value] of Object.entries(fields))
        Object.defineProperty(event, key, { value });
      window.dispatchEvent(event);
    };
    const motion = () =>
      emit('devicemotion', {
        accelerationIncludingGravity: { x: 0, y: 0, z: 9.81 },
        rotationRate: { alpha: 0, beta: 0, gamma: 0 },
      });
    const orientation = () => emit('deviceorientation', { alpha: 0, beta: 0, gamma: 0 });
    const visibility = (hidden: boolean) => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    orientation();
    motion();
    const queuedAtMs = performance.now() - 1;
    visibility(true);
    motion();
    orientation(); // Neither may enter the capture while suspended.
    visibility(false);
    emit('deviceorientation', { timeStamp: queuedAtMs, alpha: 0, beta: 0, gamma: 0 });
    motion(); // The old tilt is no longer usable.
    orientation();
    motion();
  });
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByText(/Capture is valid:/)).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download capture', exact: true }).click();
  const download = await downloaded;
  const path = await download.path();
  expect(path).not.toBeNull();
  const imported = importCaptureSession(await readFile(path!, 'utf8'));
  expect(imported.issues).toEqual([]);
  expect(imported.session).not.toBeNull();
  const events = imported.session!.events;
  expect(events.filter((event) => event.type === 'lifecycle').map((event) => event.event)).toEqual([
    'session-start',
    'backgrounded',
    'foregrounded',
    'session-end',
  ]);
  const samples = events.filter((event) => event.type === 'imu');
  expect(samples).toHaveLength(3);
  expect(samples.map((sample) => sample.orientation === null)).toEqual([false, true, false]);
  expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index));
});
