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

  // The visitor header owns its full width now that the nav has left it.
  const locationControl = page.getByRole('button', { name: /Change start location/ });
  await expectCenterHitTarget(locationControl);
  await expect(page.getByRole('navigation', { name: 'Operator tools' })).toHaveCount(0);

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

test('camera guidance controls fit at both supported narrow widths', async ({ page }) => {
  await openPharmacyRoute(page);
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await page.getByRole('button', { name: 'Which way?' }).click();

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
