import {
  expect,
  expectCenterHitTarget,
  expectInsideViewport,
  openPharmacyRoute,
  precompleteOnboarding,
  test,
} from './support';

test('the two map presentations render an unobstructed venue', async ({ page }, testInfo) => {
  await precompleteOnboarding(page);
  await page.goto('/#/visitor');
  const canvas = page.locator('.compiled-map-canvas');
  await expect(canvas).toHaveAttribute('data-camera-transition', 'settled');
  await page.screenshot({ path: testInfo.outputPath('venue-2d.png') });
  await page.getByRole('button', { name: '3D model', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-camera-transition', 'settled');
  await page.screenshot({ path: testInfo.outputPath('venue-3d.png') });

  // A map nobody is touching is not redrawn: on a phone that is battery.
  const idle = await canvas.getAttribute('data-draws');
  await page.waitForTimeout(1000);
  await expect(canvas).toHaveAttribute('data-draws', idle!);
  // And it is redrawn the moment the view changes.
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-draws')))
    .toBeGreaterThan(Number(idle));
});

test('two-finger gestures pan and zoom the 3D view without rotating it', async ({ page }) => {
  await precompleteOnboarding(page);
  await page.goto('/#/visitor');
  await page.getByRole('button', { name: '3D model', exact: true }).click();
  const canvas = page.locator('.compiled-map-canvas');
  await expect(canvas).toHaveAttribute('data-camera-transition', 'settled');
  const bounds = await canvas.boundingBox();
  const left = bounds!.x + bounds!.width / 2 - 35;
  const y = bounds!.y + bounds!.height / 2;
  const target = await canvas.getAttribute('data-camera-target');
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { id: 1, x: left, y },
      { id: 2, x: left + 70, y },
    ],
  });
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { id: 1, x: left + 15, y: y + 15 },
      { id: 2, x: left + 85, y: y + 15 },
    ],
  });
  await expect(canvas).not.toHaveAttribute('data-camera-target', target!);
  await expect(canvas).toHaveAttribute('data-camera-bearing', '0.0000');
  await expect(canvas).toHaveAttribute('data-camera-scale', '1.0000');
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { id: 1, x: left, y: y + 15 },
      { id: 2, x: left + 100, y: y + 15 },
    ],
  });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-camera-scale')))
    .toBeLessThan(1);
  await expect(canvas).toHaveAttribute('data-camera-bearing', '0.0000');
  await session.detach();
  const afterTouch = await canvas.getAttribute('data-camera-target');
  await canvas.focus();
  await page.keyboard.press('ArrowRight');
  await expect(canvas).not.toHaveAttribute('data-camera-target', afterTouch!);
});

test('2D and 3D use one scene and preserve the inspected journey', async ({ page }) => {
  // Four eased camera switches under software rendering; the budget is time, not frames.
  test.setTimeout(60_000);
  await openPharmacyRoute(page);
  await page.locator('.checkin-toast').getByRole('button', { name: 'Dismiss' }).click();
  const map = page.locator('.compiled-map');
  const canvas = map.locator('canvas');
  await expect(page.getByRole('button', { name: '2D plan', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(canvas).toHaveAttribute('data-camera-tilt', '0.0000');
  await page.getByRole('button', { name: 'Next instruction' }).click();
  const instruction = await page.locator('.jr-banner-copy').innerText();
  const facts = await page.locator('.jr-trip-time').innerText();
  const location = await map.getAttribute('data-location-floor');
  const floor = await page
    .getByRole('group', { name: 'Floors', exact: true })
    .locator('[aria-pressed="true"]')
    .getAttribute('aria-label');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  // The camera eases; read the zoom the visitor chose once it has landed.
  await expect(canvas).toHaveAttribute('data-camera-transition', 'settled');
  const zoom = await canvas.getAttribute('data-camera-scale');
  await canvas.evaluate((element) => element.setAttribute('data-same-scene', 'yes'));

  for (const mode of ['3D model', '2D plan', '3D model', '2D plan']) {
    const button = page.getByRole('button', { name: mode, exact: true });
    await expectCenterHitTarget(button);
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(canvas).toHaveAttribute('data-camera-mode', mode.startsWith('2D') ? '2d' : '3d');
    await expect(canvas).toHaveAttribute('data-camera-transition', 'settled');
    await expect(canvas).toHaveAttribute('data-same-scene', 'yes');
    await expect(canvas).toHaveAttribute('data-camera-scale', zoom!);
    await expect(map).toHaveAttribute('data-floors-shown', '1');
    await expect(map).toHaveAttribute('data-location-floor', location!);
    await expect(page.getByRole('button', { name: floor!, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('.jr-banner-copy')).toHaveText(instruction, {
      useInnerText: true,
    });
    await expect(page.locator('.jr-trip-time')).toHaveText(facts, { useInnerText: true });
  }
});

test('a small-phone map keeps browsing intent through switching and camera preview', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: async () => new MediaStream(),
    });
  });
  await openPharmacyRoute(page);
  await page.locator('.checkin-toast').getByRole('button', { name: 'Dismiss' }).click();
  const canvas = page.locator('.compiled-map-canvas');
  const map = page.locator('.compiled-map');
  const originalInstruction = await page.locator('.jr-banner-copy').innerText();
  await expect(canvas).toHaveAttribute('data-camera-transition', 'settled');
  // Directions and map share the screen: drag in the band left between them.
  const inset = async (edge: string) =>
    Number.parseFloat(
      await map.evaluate(
        (element, name) => getComputedStyle(element).getPropertyValue(`--map-inset-${name}`),
        edge,
      ),
    );
  const top = await inset('top');
  const bottom = await inset('bottom');
  const bounds = await canvas.boundingBox();
  expect(bounds!.height - top - bottom, 'no map left between the panels').toBeGreaterThan(160);
  const y = bounds!.y + top + (bounds!.height - top - bottom) / 2;
  const before = await canvas.getAttribute('data-camera-target');
  // In the flat plan, dragging pans rather than rotating the building.
  await page.mouse.move(bounds!.x + 110, y - 12);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + 150, y + 12, { steps: 15 });
  await page.mouse.up();
  await expect(canvas).not.toHaveAttribute('data-camera-target', before!);
  await expect(canvas).toHaveAttribute('data-camera-bearing', '0.0000');
  await expect(map).toHaveAttribute('data-camera-owner', 'visitor');
  const target = await canvas.getAttribute('data-camera-target');
  await page.screenshot({ path: testInfo.outputPath('visitor-2d-320.png') });
  for (const name of ['3D model', '2D plan']) {
    const control = page.getByRole('button', { name, exact: true });
    await expectInsideViewport(control);
    await expectCenterHitTarget(control);
    const box = await control.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole('button', { name: '3D model', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-camera-transition', 'settled');
  await expect(canvas).toHaveAttribute('data-camera-target', target!);
  await page.screenshot({ path: testInfo.outputPath('visitor-3d-320.png') });
  await page.getByRole('button', { name: 'Camera view', exact: true }).click();
  await page.getByRole('button', { name: 'Exit to plan', exact: true }).click();
  await expect(page.getByRole('button', { name: '3D model', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // Coming back from the camera keeps the view the visitor chose.
  await expect(canvas).toHaveAttribute('data-camera-target', target!);
  await expect(map).toHaveAttribute('data-camera-owner', 'visitor');
  await expect(
    page.getByRole('region', { name: 'Directions to Outpatient Pharmacy' }),
  ).toBeVisible();
  await expect(page.locator('.jr-banner-copy')).toHaveText(originalInstruction, {
    useInnerText: true,
  });
});

test('reduced motion settles each camera switch on the first rendered frame', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openPharmacyRoute(page);
  await page.locator('.checkin-toast').getByRole('button', { name: 'Dismiss' }).click();
  for (const [name, tilt] of [
    ['3D model', '0.8600'],
    ['2D plan', '0.0000'],
  ]) {
    // Observe every rendered tilt, not only the final DOM state.
    const tilts = await page.evaluate(
      async ({ name }) => {
        const canvas = document.querySelector<HTMLCanvasElement>('.compiled-map-canvas')!;
        const observed: string[] = [];
        const observer = new MutationObserver(() => {
          observed.push(canvas.dataset.cameraTilt!);
        });
        observer.observe(canvas, { attributes: true, attributeFilter: ['data-camera-tilt'] });
        document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!.click();
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        observer.disconnect();
        return observed;
      },
      { name },
    );
    expect(tilts.length).toBeGreaterThan(0);
    expect(tilts.every((value) => value === tilt)).toBe(true);
  }
});

test('WebGL context restoration keeps the presentation and written journey', async ({ page }) => {
  await openPharmacyRoute(page);
  await page.locator('.checkin-toast').getByRole('button', { name: 'Dismiss' }).click();
  await page.getByRole('button', { name: '3D model', exact: true }).click();
  const map = page.locator('.compiled-map');
  const canvas = map.locator('canvas');
  const instruction = await page.locator('.jr-banner-copy').innerText();
  await canvas.evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) throw new Error('Map canvas not found');
    const context = element.getContext('webgl2')!;
    const extension = context.getExtension('WEBGL_lose_context');
    if (!extension) throw new Error('Chromium must expose context-loss test support');
    // Extensions cannot be looked up while the context is lost. Retain the
    // original extension and invoke it after the test has inspected the UI.
    element.addEventListener('test-restore-map', () => extension.restoreContext(), { once: true });
    extension.loseContext();
  });
  await expect(map).toHaveAttribute('data-render-status', 'lost');
  await expect(page.getByText('Map display paused', { exact: true })).toBeVisible();
  await expect(page.locator('.jr-banner-copy')).toHaveText(instruction, {
    useInnerText: true,
  });
  await canvas.dispatchEvent('test-restore-map');
  await expect(map).toHaveAttribute('data-render-status', 'ready');
  await expect(canvas).toHaveAttribute('data-camera-mode', '3d');
  await expect(page.locator('.jr-banner-copy')).toHaveText(instruction, {
    useInnerText: true,
  });
});

test('a device without WebGL can still search and read the full route', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    let supported = false;
    document.addEventListener('test-enable-webgl', () => {
      supported = true;
    });
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      value: function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
        if (!supported && (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl'))
          return null;
        return Reflect.apply(original, this, [type, ...args]);
      },
    });
  });
  testInfo.annotations.push({ type: 'capability', description: 'No WebGL context available' });
  await openPharmacyRoute(page);
  await page.locator('.checkin-toast').getByRole('button', { name: 'Dismiss' }).click();
  const directions = page.getByRole('region', { name: 'Directions to Outpatient Pharmacy' });
  await expect(page.getByText('Map display unavailable', { exact: true })).toBeVisible();
  await expect(page.locator('.jr-banner-copy')).toBeVisible();
  await page.getByRole('button', { name: 'Next instruction', exact: true }).click();
  await expect(directions).toHaveAttribute('data-step-index', '1');
  await expect(page.getByRole('button', { name: '3D model', exact: true })).toBeDisabled();
  const instruction = await page.locator('.jr-banner-copy').innerText();
  const retry = page.getByRole('button', { name: 'Retry map display', exact: true });
  await retry.scrollIntoViewIfNeeded();
  await expectCenterHitTarget(retry);
  // Phones keep the step list folded; wide screens always show it.
  const showSteps = page.getByRole('button', { name: /^Show all \d+ steps$/ });
  if (await showSteps.isVisible()) await showSteps.click();
  await retry.scrollIntoViewIfNeeded();
  await expectInsideViewport(retry);
  await expectCenterHitTarget(retry);
  const originalViewport = page.viewportSize()!;
  await page.setViewportSize({ width: 320, height: 700 });
  await retry.scrollIntoViewIfNeeded();
  await expectInsideViewport(retry);
  await expectCenterHitTarget(retry);
  await expectInsideViewport(page.getByRole('button', { name: 'End route', exact: true }));
  await page.screenshot({ path: testInfo.outputPath('map-recovery-in-directions.png') });
  await page.evaluate(() => document.dispatchEvent(new Event('test-enable-webgl')));
  await page.getByRole('button', { name: 'Retry map display', exact: true }).click();
  await expect(page.locator('.compiled-map')).toHaveAttribute('data-render-status', 'ready');
  await page.setViewportSize(originalViewport);
  const hideSteps = page.getByRole('button', { name: 'Hide all steps' });
  if (await hideSteps.isVisible()) await hideSteps.click();
  await page.getByRole('button', { name: '3D model', exact: true }).click();
  await expect(page.locator('.compiled-map-canvas')).toHaveAttribute('data-camera-mode', '3d');
  await expect(page.locator('.jr-banner-copy')).toHaveText(instruction, {
    useInnerText: true,
  });
});

test('route labels never sit under the map controls or the directions', async ({ page }) => {
  await openPharmacyRoute(page);
  await page.locator('.checkin-toast').getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.locator('.compiled-map-canvas')).toHaveAttribute(
    'data-camera-transition',
    'settled',
  );
  const covered = () =>
    page.evaluate(() => {
      const box = (element: Element) => element.getBoundingClientRect();
      const covers = [
        ...document.querySelectorAll(
          '.compiled-map-presentation, .compiled-map-floors, .compiled-map-zoom, .jr-banner, .jr-sheet',
        ),
      ].map(box);
      return [...document.querySelectorAll<HTMLElement>('.map-pill')]
        .filter((pill) => pill.style.opacity === '1')
        .filter((pill) => {
          const label = box(pill);
          return covers.some(
            (cover) =>
              label.right > cover.left &&
              cover.right > label.left &&
              label.bottom > cover.top &&
              cover.bottom > label.top,
          );
        })
        .map((pill) => pill.textContent);
    });
  await expect.poll(covered).toEqual([]);
  // The controls are measured the moment they move. If they slid there, the
  // measurement would record where they started, and nothing would measure
  // them again: a slow test browser measures late and hides that, so the
  // cause is pinned directly.
  const durations = await page
    .locator('.compiled-map-presentation, .compiled-map-floors, .compiled-map-zoom')
    .evaluateAll((groups) => groups.map((group) => getComputedStyle(group).transitionDuration));
  expect(durations.every((value) => value.split(',').every((part) => parseFloat(part) === 0))).toBe(
    true,
  );
  // Still true after the controls change shape and the view changes.
  await page.getByRole('button', { name: '3D model', exact: true }).click();
  await expect.poll(covered).toEqual([]);
});
