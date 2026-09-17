import {
  expect,
  expectCenterHitTarget,
  expectInsideViewport,
  openPharmacyRoute,
  openVisitor,
  test,
} from './support';

/**
 * The operator surfaces, which now carry the navigation between them. The
 * visitor shell deliberately has none, so a round-trip starts from an operator
 * route rather than from the map.
 */
const operatorSurfaces = [
  { link: '3D + venues', selector: '.inspector-surface' },
  { link: 'Studio', selector: '.studio-surface' },
  { link: 'Record', selector: '.walk-recorder' },
] as const;

test('every surface round-trips to a non-empty visitor map', async ({ page }) => {
  await openVisitor(page);
  // Operator tooling is not offered in the visitor shell, so the round-trip
  // enters it the way an operator does: by its own route.
  await page.goto('/#/inspector');
  await expect(page.locator('.inspector-surface')).toBeVisible();

  await page.getByRole('link', { name: 'Studio' }).click();
  await expect(page.getByRole('heading', { name: 'BuildingSource workspace' })).toBeVisible();

  await page.getByRole('link', { name: 'Record' }).click();
  await expect(page.getByRole('heading', { name: 'Record a walk' })).toBeVisible();

  await page.getByRole('link', { name: 'Visitor view' }).click();
  await expect(page.locator('.compiled-map')).toBeVisible();
  // The Plan/Guide switch is gone, so arriving back on the visitor surface is
  // proven by its own chrome rather than by a toggle's pressed state.
  await expect(page.getByRole('button', { name: 'Which way?' })).toBeVisible();
  await expect
    .poll(() => page.locator('#main-content').evaluate((main) => main.childElementCount))
    .toBeGreaterThan(0);
});

test('surface navigation stays in the viewport, owns its row, and never scrolls away', async ({
  page,
}) => {
  await openVisitor(page);

  // The operator build carries the nav here too. What must stay true is the
  // defect this test exists for: the nav shares the surface with the visitor
  // header without covering any of its controls.
  const locationControl = page.getByRole('button', { name: /Change start location/ });
  await expectCenterHitTarget(locationControl);
  await expectCenterHitTarget(page.getByRole('button', { name: 'Which way?' }));
  await expectCenterHitTarget(page.getByRole('button', { name: /routing/ }));
  await expect(page.getByRole('navigation', { name: 'Operator tools' })).toBeVisible();

  await page.goto('/#/inspector');

  for (const surface of operatorSurfaces) {
    const link = page.getByRole('link', { name: surface.link });
    await link.click();
    await expect(link).toHaveAttribute('aria-current', 'page');

    const scrollOwner = page.locator(surface.selector);
    await expect(scrollOwner).toBeVisible();

    const nav = page.getByRole('navigation', { name: 'Operator tools' });
    const before = await nav.boundingBox();
    expect(before).not.toBeNull();

    await scrollOwner.evaluate((element) => {
      element.scrollTop = 900;
    });
    await page.evaluate(() => window.scrollTo(0, 900));

    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      )
      .toBe(true);

    const after = await nav.boundingBox();
    expect(after).not.toBeNull();
    expect(after?.y).toBeCloseTo(before?.y ?? 0, 1);

    await expectInsideViewport(nav);
    await expectCenterHitTarget(link);
  }
});

test('the operator workbench is a desktop rail and a labelled mobile dock', async ({ page }) => {
  await openVisitor(page);

  await page.setViewportSize({ width: 1280, height: 800 });
  const nav = page.getByRole('navigation', { name: 'Operator tools' });
  const workspace = page.locator('.operator-workspace');
  const desktopNav = await nav.boundingBox();
  const desktopWorkspace = await workspace.boundingBox();
  expect(desktopNav).not.toBeNull();
  expect(desktopWorkspace).not.toBeNull();
  expect(desktopNav!.x).toBeCloseTo(0, 1);
  expect(desktopNav!.width).toBeCloseTo(176, 1);
  expect(desktopWorkspace!.x).toBeCloseTo(desktopNav!.x + desktopNav!.width, 1);
  expect(desktopNav!.height).toBeCloseTo(800, 1);

  await page.setViewportSize({ width: 375, height: 812 });
  const mobileNav = await nav.boundingBox();
  const mobileWorkspace = await workspace.boundingBox();
  expect(mobileNav).not.toBeNull();
  expect(mobileWorkspace).not.toBeNull();
  expect(mobileNav!.x).toBeCloseTo(0, 1);
  expect(mobileNav!.width).toBeCloseTo(375, 1);
  expect(mobileNav!.y).toBeCloseTo(mobileWorkspace!.y + mobileWorkspace!.height, 1);
  for (const label of ['Visitor view', '3D + venues', 'Studio', 'Record']) {
    const link = nav.getByRole('link', { name: label, exact: true });
    await expect(link).toBeVisible();
    await expect(link.locator('span')).toHaveText(label);
  }
});

test('Studio controls wrap without clipping or collisions on a 320px phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await openVisitor(page);
  await page.goto('/#/studio');
  await expect(page.locator('.studio-surface')).toBeVisible();

  const controls = page.locator(
    '.studio-editor-actions button, .studio-canvas-toolbar button, .studio-canvas-toolbar select',
  );
  await expect.poll(() => controls.count()).toBeGreaterThan(0);
  const boxes = await controls.evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return {
        label: element.getAttribute('aria-label') ?? element.textContent?.trim() ?? '',
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
      };
    }),
  );
  expect(boxes.filter((box) => box.left < -0.5 || box.right > 320.5)).toEqual([]);

  const collisions = boxes.flatMap((box, index) =>
    boxes
      .slice(index + 1)
      .filter(
        (other) =>
          Math.min(box.right, other.right) - Math.max(box.left, other.left) > 1 &&
          Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top) > 1,
      ),
  );
  expect(collisions, 'Studio controls overlap one another').toEqual([]);
  await expect(page.getByRole('button', { name: 'Reset' }).first()).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
});

test('Inspector chrome keeps readable foreground and background contrast', async ({ page }) => {
  await openVisitor(page);
  await page.goto('/#/inspector');
  await expect(page.locator('.spatial-twin')).toBeVisible();

  const contrast = async (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((element) => {
        const channels = (value: string) =>
          (value.match(/[\d.]+/g) ?? []).slice(0, 3).map((channel) => Number(channel) / 255);
        const luminance = (value: string) => {
          const linear = channels(value).map((channel) =>
            channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
          );
          return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
        };
        let backgroundElement: Element | null = element;
        let background = 'rgb(255, 255, 255)';
        while (backgroundElement !== null) {
          const candidate = getComputedStyle(backgroundElement).backgroundColor;
          if (!candidate.endsWith(', 0)') && candidate !== 'rgba(0, 0, 0, 0)') {
            background = candidate;
            break;
          }
          backgroundElement = backgroundElement.parentElement;
        }
        const foregroundLuminance = luminance(getComputedStyle(element).color);
        const backgroundLuminance = luminance(background);
        return (
          (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
          (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
        );
      });

  await expect(page.locator('.twin-poi-label').first()).toBeVisible();
  expect(await contrast('.twin-poi-label')).toBeGreaterThanOrEqual(4.5);
  expect(await contrast('.twin-empty-inspector h2')).toBeGreaterThanOrEqual(4.5);
  expect(await contrast('.venue-package-manager-toggle')).toBeGreaterThanOrEqual(4.5);

  const space = page.getByRole('combobox', { name: 'Inspect a space' });
  const firstSpace = await space.evaluate(
    (select) =>
      [...(select as HTMLSelectElement).options].find((option) => option.value !== '')?.value,
  );
  expect(firstSpace).toBeTruthy();
  await space.selectOption(firstSpace!);
  await expect(page.locator('.twin-property-grid dd').first()).toBeVisible();
  expect(await contrast('.twin-property-grid dd')).toBeGreaterThanOrEqual(4.5);
});

test('camera guidance controls fit at both supported narrow widths', async ({ page }) => {
  // Geometry must not depend on the runner having a physical camera.
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: async () => new MediaStream(),
    });
  });
  await openPharmacyRoute(page);
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await page.getByRole('button', { name: 'Camera view' }).click();

  const controls = page.locator('.camera-preview-controls button');
  await expect.poll(() => controls.count()).toBeGreaterThanOrEqual(3);

  for (const viewport of [
    { width: 375, height: 812 },
    { width: 320, height: 700 },
  ]) {
    await page.setViewportSize(viewport);
    await expect
      .poll(() =>
        controls.evaluateAll((buttons) =>
          buttons.every((button) => {
            const bounds = button.getBoundingClientRect();
            return bounds.left >= -0.5 && bounds.right <= window.innerWidth + 0.5;
          }),
        ),
      )
      .toBe(true);
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      )
      .toBe(true);
  }
});

test('visitor header recovery controls remain reachable and tappable at 320px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await openVisitor(page);

  const controls = [
    page.getByRole('button', { name: /Change start location/ }),
    page.getByRole('button', { name: 'Which way?' }),
    page.getByRole('button', { name: /routing/ }),
    page.getByRole('button', { name: 'Go to welcome screen' }),
  ];

  for (const control of controls) {
    await expectInsideViewport(control);
    await expectCenterHitTarget(control);
    // Reachable was never the whole bar: these were 29x38 while passing the
    // checks above, which is a control you can hit only if you aim.
    const bounds = await control.boundingBox();
    expect(bounds, 'control has no box').not.toBeNull();
    expect(
      bounds!.width,
      `${await control.getAttribute('aria-label')} is too narrow`,
    ).toBeGreaterThanOrEqual(44);
    expect(
      bounds!.height,
      `${await control.getAttribute('aria-label')} is too short`,
    ).toBeGreaterThanOrEqual(44);
  }
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    )
    .toBe(true);
});
