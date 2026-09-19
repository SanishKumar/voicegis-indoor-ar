import {
  expect,
  expectCenterHitTarget,
  expectInsideViewport,
  openPharmacyRoute,
  test,
} from './support';

test('camera alignment follows real-time attitude, expires silence and never advances position by turning', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: async () => new MediaStream(),
    });
    Object.defineProperty(window, 'DeviceOrientationEvent', { value: class {} });
    const attitude = { alpha: 0, beta: 75, gamma: 0, sending: true };
    Object.defineProperty(window, 'cameraTestAttitude', { value: attitude });
    for (const type of ['deviceorientation', 'deviceorientationabsolute']) {
      window.addEventListener(
        type,
        (event) => {
          if (event.isTrusted) event.stopImmediatePropagation();
        },
        true,
      );
    }
    setInterval(() => {
      if (!attitude.sending) return;
      const event = new Event('deviceorientation');
      Object.entries({ ...attitude, absolute: false, timeStamp: performance.now() }).forEach(
        ([key, value]) => Object.defineProperty(event, key, { value }),
      );
      window.dispatchEvent(event);
    }, 50);
  });
  await openPharmacyRoute(page);
  await page.locator('.checkin-toast').getByRole('button', { name: 'Dismiss' }).click();
  const before = await page.locator('.jr-banner-text').innerText();
  await page.getByRole('button', { name: 'Camera view' }).click();
  const view = page.locator('.camera-preview');
  const align = page.getByRole('button', { name: 'I’m facing the corridor' });
  await expect(align).toBeVisible();
  await expect(view).toHaveAttribute('data-ribbon', '0');
  await align.click();
  await expect(view).toHaveAttribute('data-heading-source', 'aligned');
  await expect.poll(async () => Number(await view.getAttribute('data-ribbon'))).toBeGreaterThan(5);
  const facing = Number(await view.getAttribute('data-facing'));
  await page.setViewportSize({ width: 320, height: 700 });
  await expectCenterHitTarget(page.getByRole('button', { name: 'Re-align', exact: true }));
  await expectInsideViewport(page.getByRole('button', { name: 'Exit to plan' }));
  await page.screenshot({ path: testInfo.outputPath('aligned-camera-320.png') });

  await page.evaluate(() => {
    const attitude = (window as unknown as { cameraTestAttitude: { alpha: number } })
      .cameraTestAttitude;
    attitude.alpha = 180;
  });
  await expect
    .poll(async () =>
      Math.abs(((Number(await view.getAttribute('data-facing')) - facing + 540) % 360) - 180),
    )
    .toBe(180);
  await expect(view).toHaveAttribute('data-ribbon', '0');
  await expect(page.getByText(/Turn (left|right) to find the route/)).toBeVisible();
  await page.evaluate(() => {
    const attitude = (
      window as unknown as { cameraTestAttitude: { alpha: number; sending: boolean } }
    ).cameraTestAttitude;
    attitude.alpha = 0;
    attitude.sending = false;
  });
  await expect(view).toHaveAttribute('data-heading-source', 'off');
  await expect(view).toHaveAttribute('data-callouts', '0');
  await expect(page.getByText(/Orientation signal lost/)).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { cameraTestAttitude: { sending: boolean } }).cameraTestAttitude.sending =
      true;
  });
  await expect(align).toBeVisible();
  await expect(view).toHaveAttribute('data-ribbon', '0');
  await align.click();
  await expect.poll(async () => Number(await view.getAttribute('data-ribbon'))).toBeGreaterThan(5);
  await page.getByRole('button', { name: 'Exit to plan' }).click();
  await expect(page.locator('.jr-banner-text')).toHaveText(before);
  await expect(page.locator('.compiled-map-canvas')).toHaveAttribute('data-route-progress', '0.00');
});
