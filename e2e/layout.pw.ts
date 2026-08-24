import {
  expect,
  expectCenterHitTarget,
  expectInsideViewport,
  openPharmacyRoute,
  openVisitor,
  test,
} from './support';

const surfaces = [
  { link: '2D map', selector: '.visitor-shell' },
  { link: '3D + venues', selector: '.inspector-surface' },
  { link: 'Studio', selector: '.studio-surface' },
  { link: 'Record', selector: '.walk-recorder' },
] as const;

test('every surface round-trips to a non-empty visitor map', async ({ page }) => {
  await openVisitor(page);

  await page.getByRole('link', { name: '3D + venues' }).click();
  await expect(page.locator('.inspector-surface')).toBeVisible();

  await page.getByRole('link', { name: 'Studio' }).click();
  await expect(page.getByRole('heading', { name: 'BuildingSource workspace' })).toBeVisible();

  await page.getByRole('link', { name: 'Record' }).click();
  await expect(page.getByRole('heading', { name: 'Record a walk' })).toBeVisible();

  await page.getByRole('link', { name: '2D map' }).click();
  await expect(page.locator('.compiled-map')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Switch to map view' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect
    .poll(() => page.locator('#main-content').evaluate((main) => main.childElementCount))
    .toBeGreaterThan(0);
});

test('surface navigation stays in the viewport, owns its row, and never scrolls away', async ({
  page,
}) => {
  await openVisitor(page);

  const locationControl = page.getByRole('button', { name: /Change start location/ });
  await expectCenterHitTarget(locationControl);

  for (const surface of surfaces) {
    const link = page.getByRole('link', { name: surface.link });
    await link.click();
    await expect(link).toHaveAttribute('aria-current', 'page');

    const scrollOwner = page.locator(surface.selector);
    await expect(scrollOwner).toBeVisible();

    const nav = page.getByRole('navigation', { name: 'Application surface' });
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
  await page.getByRole('button', { name: 'Switch to camera preview' }).click();

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
