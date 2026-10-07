import {
  test,
  expect,
  openVisitor,
  openPharmacyRoute,
  expectCenterHitTarget,
  precompleteOnboarding,
} from './support';

for (const width of [320, 390]) {
  test(`folded search and place details preserve selection and release the map at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await openVisitor(page);
    await page.getByRole('button', { name: 'Search rooms and departments', exact: true }).click();
    const input = page.getByRole('textbox', { name: 'Search rooms and departments' });
    await input.fill('Pharmacy');
    await page.getByRole('button', { name: 'Collapse destination search' }).click();
    await expect(input).toBeHidden();
    await expect(page.locator('#search-panel')).not.toHaveAttribute('aria-modal', 'true');
    await expectCenterHitTarget(page.getByRole('button', { name: '3D model', exact: true }));
    await page.getByRole('button', { name: 'Expand destination search' }).press('Enter');
    await expect(input).toHaveValue('Pharmacy');
    await page.getByRole('button', { name: 'View details for Outpatient Pharmacy' }).click();
    await page.getByRole('button', { name: 'Collapse destination details' }).click();
    await expect(page.locator('.poi-card-desc')).toBeHidden();
    await expectCenterHitTarget(page.getByRole('button', { name: 'Navigate Here' }));
    await page.getByRole('button', { name: 'Navigate Here' }).click();
    await expect(page.locator('#nav-panel')).toBeVisible();
  });

  test(`route and location panels fold without losing progress at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await openPharmacyRoute(page);
    await page.locator('.checkin-toast').getByRole('button', { name: 'Dismiss' }).click();
    const sheet = page.locator('#nav-panel');
    const expandedHeight = (await sheet.boundingBox())!.height;
    await page.getByRole('button', { name: 'Collapse route details' }).click();
    await expect(sheet).toHaveAttribute('data-panel-collapsed', 'true');
    expect((await sheet.boundingBox())!.height).toBeLessThan(expandedHeight - 50);
    await expect(page.locator('.jr-meta')).toBeHidden();
    await expectCenterHitTarget(page.getByRole('button', { name: 'End route', exact: true }));
    await page.getByRole('button', { name: 'Next instruction', exact: true }).click();
    const progress = await page.locator('.compiled-map-canvas').getAttribute('data-route-progress');
    await page.getByRole('button', { name: '3D model', exact: true }).click();
    await expect(sheet).toHaveAttribute('data-panel-collapsed', 'true');
    await expect(page.locator('.compiled-map-canvas')).toHaveAttribute(
      'data-route-progress',
      progress!,
    );
    await page.getByRole('button', { name: 'Expand route details' }).click();
    await page.getByRole('button', { name: /Change start location/ }).click();
    const location = page.getByRole('textbox', { name: 'Search starting locations' });
    await location.fill('Emergency');
    await page.getByRole('button', { name: 'Collapse location picker' }).click();
    await expect(location).toBeHidden();
    await expectCenterHitTarget(
      page.getByRole('button', { name: 'Scan a check-in code', exact: true }),
    );
    await page.getByRole('button', { name: 'Expand location picker' }).click();
    await expect(location).toHaveValue('Emergency');
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Collapse route details' }).click();
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.locator('.jr-meta')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Expand route details' })).toHaveCount(0);
  });
}

test('the route handle supports a downward swipe and upward swipe', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPharmacyRoute(page);
  const sheet = page.locator('#nav-panel');
  const down = (await page.getByRole('button', { name: 'Collapse route details' }).boundingBox())!;
  await page.mouse.move(down.x + down.width / 2, down.y + 10);
  await page.mouse.down();
  await page.mouse.move(down.x + down.width / 2, down.y + 70, { steps: 6 });
  await page.mouse.up();
  await expect(sheet).toHaveAttribute('data-panel-collapsed', 'true');
  const up = (await page.getByRole('button', { name: 'Expand route details' }).boundingBox())!;
  await page.mouse.move(up.x + up.width / 2, up.y + 25);
  await page.mouse.down();
  await page.mouse.move(up.x + up.width / 2, up.y - 35, { steps: 6 });
  await page.mouse.up();
  await expect(sheet).toHaveAttribute('data-panel-collapsed', 'false');
});

test('operator panels fold without discarding the selected space or source draft', async ({
  page,
}) => {
  test.slow();
  await page.setViewportSize({ width: 390, height: 844 });
  await precompleteOnboarding(page);
  await page.goto('/?venue=/venues/meridian-park-campus.package.json#/inspector');
  const select = page.getByRole('combobox', { name: 'Inspect a space' });
  await select.selectOption({ label: 'Triage' });
  const selected = await select.inputValue();
  await page.getByRole('button', { name: 'Collapse space inspector' }).click();
  await expect(select).toBeHidden();
  await page.getByRole('button', { name: 'Expand space inspector' }).click();
  await expect(select).toHaveValue(selected);
  await expect(page.getByRole('heading', { name: 'Triage', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Studio', exact: true }).click();
  await page.getByRole('tab', { name: 'Source JSON', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'BuildingSource JSON draft' });
  const draft = `${JSON.stringify(JSON.parse(await editor.inputValue()))}\n `;
  await editor.fill(draft);
  await page.getByRole('button', { name: 'Collapse validation details' }).click();
  await expect(page.locator('#studio-validation-details')).toBeHidden();
  await expect(page.locator('.studio-validation-hero')).toBeVisible();
  await page.getByRole('button', { name: 'Expand validation details' }).click();
  await expect(editor).toHaveValue(draft);
  await expect(page.locator('#studio-validation-details')).toBeVisible();
});
