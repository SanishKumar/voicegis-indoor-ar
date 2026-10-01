import { expect, precompleteOnboarding, test } from './support';

test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) return;
  await page.getByRole('button', { name: 'Test log', exact: true }).click();
  await info.attach('field-report', {
    body: await page.getByRole('textbox', { name: 'Field test report' }).inputValue(),
    contentType: 'text/plain',
  });
});

test('a quiet scanned sign supplies both camera direction and forward/backward map walking', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await precompleteOnboarding(page);
  await page.addInitScript(() => {
    const phone = {
      alpha: 0,
      changed: true,
      started: 0,
      walking: false,
      handHeld: false,
      lastAttitudeAt: 0,
      handTurns: 0,
    };
    Object.defineProperty(window, 'signWalkPhone', { value: phone });
    const request = async () => {
      if (!phone.started) phone.started = performance.now();
      return 'granted';
    };
    for (const name of ['DeviceMotionEvent', 'DeviceOrientationEvent']) {
      Object.defineProperty(window, name, {
        configurable: true,
        value: class {
          static requestPermission = request;
        },
      });
    }
    Object.defineProperty(navigator.permissions, 'query', {
      value: async () => Object.assign(new EventTarget(), { state: 'granted' }),
    });
    for (const type of ['deviceorientation', 'deviceorientationabsolute', 'devicemotion']) {
      window.addEventListener(
        type,
        (event) => {
          if (event.isTrusted) event.stopImmediatePropagation();
        },
        true,
      );
    }
    const emit = (type: string, fields: Record<string, unknown>) => {
      const event = new Event(type);
      Object.entries({ ...fields, timeStamp: performance.now() }).forEach(([key, value]) =>
        Object.defineProperty(event, key, { value }),
      );
      window.dispatchEvent(event);
    };
    setInterval(() => {
      if (!phone.started) return;
      const now = performance.now();
      // The scan remains completely still for three seconds. Afterwards model
      // a hand changing yaw by two degrees periodically, not an orientation
      // heartbeat. Use elapsed time: a narrow modulo window can be missed for
      // seconds on a busy runner, accidentally simulating a stopped sensor.
      if (phone.changed || (phone.handHeld && now - phone.lastAttitudeAt >= 400)) {
        if (phone.handHeld) phone.handTurns += 1;
        const jitter = phone.handHeld && phone.handTurns % 2 === 1 ? 2 : 0;
        emit('deviceorientation', {
          alpha: phone.alpha + jitter,
          beta: 75,
          gamma: 0,
          absolute: false,
        });
        phone.lastAttitudeAt = now;
        phone.changed = false;
      }
      const magnitude = phone.walking && performance.now() % 500 < 160 ? 12.81 : 9.81;
      emit('devicemotion', {
        rotationRate: { alpha: 0, beta: 0, gamma: 0 },
        accelerationIncludingGravity: { x: 0, y: magnitude, z: 0 },
      });
    }, 20);
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 480;
        canvas.getContext('2d')!.fillRect(0, 0, 640, 480);
        return canvas.captureStream(10);
      },
    });
    Object.defineProperty(window, 'BarcodeDetector', {
      value: class {
        async detect() {
          // The phone has emitted no orientation changes for three seconds by
          // the time the sign decodes, exactly the change-driven sensor case.
          return phone.started && performance.now() - phone.started > 3000
            ? [{ rawValue: 'voicegis://asterion/g/east' }]
            : [];
        }
      },
    });
  });
  await page.goto('/?fieldtest=1#/visitor');
  await expect(page.locator('.compiled-map')).toBeVisible();
  await page.getByRole('button', { name: /Change start location/ }).click();
  await page
    .getByRole('dialog', { name: 'Set Your Location' })
    .getByRole('button', { name: 'Scan a check-in code' })
    .click();
  await expect(page.locator('.checkin-toast')).toContainText('Checked in at');
  await expect(page.locator('.checkin-toast')).not.toContainText('direction was not captured');
  await page.locator('.checkin-toast').getByRole('button', { name: 'Dismiss' }).click();
  await page.evaluate(() => {
    (window as unknown as { signWalkPhone: { handHeld: boolean } }).signWalkPhone.handHeld = true;
  });
  await page.getByRole('button', { name: 'Search rooms and departments', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Search rooms and departments' })
    .fill('Civic Plaza Entrance');
  await page.getByRole('button', { name: 'Navigate to Civic Plaza Entrance' }).click();
  await page.getByRole('button', { name: 'Camera view' }).click();
  await expect(page.locator('.camera-preview')).toHaveAttribute('data-heading-source', 'sign');
  await expect(page.getByText('The route is behind you. Turn around')).toBeVisible();
  await page.getByRole('button', { name: 'Exit to plan' }).click();
  await page.getByRole('button', { name: 'Track my walk', exact: true }).click();
  await page.evaluate(() => {
    const phone = (
      window as unknown as { signWalkPhone: { alpha: number; changed: boolean; walking: boolean } }
    ).signWalkPhone;
    phone.alpha = 180;
    phone.changed = true;
    phone.walking = true;
  });
  const canvas = page.locator('.compiled-map-canvas');
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-route-progress')))
    .toBeGreaterThan(3);
  const before = Number(await canvas.getAttribute('data-route-progress'));
  await page.evaluate(() => {
    const phone = (window as unknown as { signWalkPhone: { alpha: number; changed: boolean } })
      .signWalkPhone;
    phone.alpha = 0;
    phone.changed = true;
  });
  await expect(page.locator('.jr')).toHaveAttribute('data-tracking-reason', 'wrong-way');
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-route-progress')))
    .toBeLessThan(before);
  await page.evaluate(() => {
    (window as unknown as { signWalkPhone: { walking: boolean } }).signWalkPhone.walking = false;
  });
  await page.getByRole('button', { name: 'Test log', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Field test report' })).toHaveValue(
    /sign-heading accepted=true/,
  );
  await expect(page.getByRole('textbox', { name: 'Field test report' })).toHaveValue(
    /headingBasis=sign/,
  );
});
