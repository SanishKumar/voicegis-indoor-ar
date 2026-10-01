import {
  expect,
  expectCenterHitTarget,
  expectInsideViewport,
  openPharmacyRoute,
  precompleteOnboarding,
  test,
} from './support';

test('conservative device hints start low; full override and Auto work at 320px', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'hardwareConcurrency', { value: 4 });
    Object.defineProperty(navigator, 'deviceMemory', { value: 2 });
  });
  await precompleteOnboarding(page);
  await page.goto('/#/visitor');
  const canvas = page.locator('.compiled-map-canvas');
  await expect(canvas).toHaveAttribute('data-graphics-setting', 'auto');
  await expect(canvas).toHaveAttribute('data-graphics-detail', 'low');
  await expect(canvas).toHaveAttribute('data-graphics-reason', 'device-hint');
  await expect(canvas).toHaveAttribute('data-graphics-shadows', 'false');
  await expect
    .poll(() =>
      canvas.evaluate((element: HTMLCanvasElement) => element.width === element.clientWidth),
    )
    .toBe(true);
  const control = page.getByRole('button', { name: 'Graphics detail', exact: true });
  await expectInsideViewport(control);
  await expectCenterHitTarget(control);
  const bounds = await control.boundingBox();
  expect(bounds!.width).toBeGreaterThanOrEqual(44);
  expect(bounds!.height).toBeGreaterThanOrEqual(44);
  await control.click();
  const group = page.getByRole('group', { name: 'Map graphics detail', exact: true });
  await expect(group.getByRole('button', { name: 'Automatic', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  for (const name of ['Automatic', 'Full detail', 'Low detail']) {
    const button = group.getByRole('button', { name, exact: true });
    await expectInsideViewport(button);
    await expectCenterHitTarget(button);
    // Centre-only hit testing missed a floor button painted over the right
    // edge of this disclosure at 320px. The whole option must be actionable.
    expect(
      await button.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return [bounds.left + 12, bounds.right - 12].every((x) => {
          const hit = document.elementFromPoint(x, bounds.top + bounds.height / 2);
          return hit === element || (hit !== null && element.contains(hit));
        });
      }),
    ).toBe(true);
  }
  await page.screenshot({ path: testInfo.outputPath('map-graphics-320.png') });
  // Escape also works with focus still on the opener.
  await page.keyboard.press('Escape');
  await expect(group).toHaveCount(0);
  await expect(control).toBeFocused();
  await control.click();
  await group.getByRole('button', { name: 'Low detail', exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(group).toHaveCount(0);
  await expect(control).toBeFocused();
  await control.click();
  await group.getByRole('button', { name: 'Full detail', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-graphics-setting', 'full');
  await expect(canvas).toHaveAttribute('data-graphics-shadows', 'true');
  await expect(control).toBeFocused();
  await expect
    .poll(() =>
      canvas.evaluate(
        (element: HTMLCanvasElement) =>
          element.width === Math.floor(element.clientWidth * Math.min(devicePixelRatio, 2)),
      ),
    )
    .toBe(true);
  await control.click();
  await group.getByRole('button', { name: 'Automatic', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-graphics-detail', 'low');
  await expect(canvas).toHaveAttribute('data-graphics-setting', 'auto');
  await control.click();
  // The operator toolbar makes the map shorter, so a detail disclosure may
  // legitimately cover zoom. Use an outside control that remains visible.
  const plan = page.getByRole('button', { name: '2D plan', exact: true });
  await expectCenterHitTarget(plan);
  await plan.click();
  await expect(group).toHaveCount(0);
  await expect(plan).toBeFocused();
});

test('graphics changes preserve the same journey and 3D camera, including a camera-view round trip', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: async () => new MediaStream(),
    });
  });
  await openPharmacyRoute(page);
  await page.locator('.checkin-toast').getByRole('button', { name: 'Dismiss' }).click();
  await page.getByRole('button', { name: 'Next instruction', exact: true }).click();
  const canvas = page.locator('.compiled-map-canvas');
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-route-progress')))
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: '3D model', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-camera-mode', '3d');
  await expect(canvas).toHaveAttribute('data-camera-transition', 'settled');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-camera-transition', 'settled');
  const view = await canvas.evaluate((element) => ({
    target: element.dataset.cameraTarget,
    scale: element.dataset.cameraScale,
    bearing: element.dataset.cameraBearing,
    progress: element.dataset.routeProgress,
  }));
  const instruction = await page.locator('.jr-banner-copy').innerText();
  const floor = await page
    .getByRole('group', { name: 'Floors', exact: true })
    .locator('[aria-pressed="true"]')
    .getAttribute('aria-label');
  await canvas.evaluate((element) => {
    element.dataset.sameScene = 'yes';
  });
  const control = page.getByRole('button', { name: 'Graphics detail', exact: true });
  for (const setting of ['Full detail', 'Low detail', 'Full detail', 'Low detail']) {
    await expectCenterHitTarget(control);
    await control.click();
    const button = page
      .getByRole('group', { name: 'Map graphics detail', exact: true })
      .getByRole('button', { name: setting, exact: true });
    await expectCenterHitTarget(button);
    await button.click();
    await expect(canvas).toHaveAttribute(
      'data-graphics-setting',
      setting.startsWith('Full') ? 'full' : 'low',
    );
    await expect(canvas).toHaveAttribute('data-same-scene', 'yes');
    await expect(canvas).toHaveAttribute('data-camera-target', view.target!);
    await expect(canvas).toHaveAttribute('data-camera-scale', view.scale!);
    await expect(canvas).toHaveAttribute('data-route-progress', view.progress!);
  }
  await page.getByRole('button', { name: 'Camera view', exact: true }).click();
  await page.getByRole('button', { name: 'Exit to plan', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-graphics-setting', 'low');
  await expect(canvas).toHaveAttribute('data-graphics-detail', 'low');
  await expect(canvas).toHaveAttribute('data-graphics-shadows', 'false');
  await expect(canvas).toHaveAttribute('data-camera-mode', '3d');
  await expect(canvas).toHaveAttribute('data-camera-target', view.target!);
  await expect(canvas).toHaveAttribute('data-camera-scale', view.scale!);
  await expect(canvas).toHaveAttribute('data-camera-bearing', view.bearing!);
  await expect(canvas).toHaveAttribute('data-route-progress', view.progress!);
  await expect(page.locator('.jr-banner-copy')).toHaveText(instruction, { useInnerText: true });
  await expect(page.getByRole('button', { name: floor!, exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await control.click();
  await expect(page.getByRole('button', { name: 'Low detail', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
