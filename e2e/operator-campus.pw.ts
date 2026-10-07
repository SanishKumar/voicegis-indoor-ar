import { expect, precompleteOnboarding, test } from './support';

const CAMPUS = '/?venue=/venues/meridian-park-campus.package.json#/inspector';

test('the campus can be inspected, compiled in Studio, activated and viewed by a visitor', async ({
  page,
}, testInfo) => {
  test.slow();
  await precompleteOnboarding(page);
  await page.goto(CAMPUS);
  await expect(
    page.getByRole('heading', { name: 'Meridian Park Medical Campus', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.twin-canvas canvas')).toBeVisible();
  await page.getByRole('combobox', { name: 'Inspect a space' }).selectOption({ label: 'Triage' });
  await expect(page.getByRole('heading', { name: 'Triage', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'G', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('campus-inspector.png') });

  await page.getByRole('link', { name: 'Studio', exact: true }).click();
  await page.getByRole('tab', { name: 'Source JSON', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'BuildingSource JSON draft' });
  const source = JSON.parse(await editor.inputValue());
  expect(source.site.buildings).toHaveLength(3);
  expect(source.site.grounds.some((ground: { kind: string }) => ground.kind === 'lawn')).toBe(true);
  source.building.name = 'Campus workflow test';
  await editor.fill(`${JSON.stringify(source)}\n`);
  await page.getByRole('button', { name: 'Compile preview', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Download verified package' })).toBeEnabled();
  await page.getByRole('button', { name: 'Review activation', exact: true }).click();
  await page.getByRole('button', { name: 'Activate verified package', exact: true }).click();
  await expect(page.locator('.studio-active-runtime')).toContainText('Campus workflow test');

  await page.getByRole('link', { name: 'Visitor view', exact: true }).click();
  await expect(page.locator('.compiled-map')).toHaveAttribute('data-zone', 'grounds');
  await expect(
    page.getByRole('button', { name: 'Explore Main Hospital', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Explore Main Hospital', exact: true }).click();
  await expect(page.locator('.compiled-map')).toHaveAttribute('data-zone', 'main-hospital');
  await expect(page.getByRole('group', { name: 'Floors of Main Hospital' })).toBeVisible();

  await page.getByRole('link', { name: 'Studio', exact: true }).click();
  await page.getByRole('button', { name: 'Roll back', exact: true }).click();
  await expect(page.locator('.studio-active-runtime')).toContainText(
    'Meridian Park Medical Campus',
  );
  await page.getByRole('link', { name: 'Visitor view', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Explore Wellness Pavilion', exact: true }),
  ).toBeVisible();
});

test('an unpublished Studio draft survives visiting the Inspector and visitor view', async ({
  page,
}) => {
  test.slow();
  await precompleteOnboarding(page);
  await page.goto(CAMPUS);
  await page.getByRole('link', { name: 'Studio', exact: true }).click();
  await page.getByRole('tab', { name: 'Source JSON', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'BuildingSource JSON draft' });
  const source = JSON.parse(await editor.inputValue());
  source.building.name = 'Unpublished campus draft';
  const changed = `${JSON.stringify(source)}\n`;
  await editor.fill(changed);

  await page.getByRole('link', { name: '3D + venues', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Meridian Park Medical Campus', exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Visitor view', exact: true }).click();
  await expect(page.locator('.compiled-map')).toBeVisible();
  await page.getByRole('link', { name: 'Studio', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Source JSON', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(editor).toHaveValue(changed);
  await expect(page.locator('.studio-active-runtime')).toContainText(
    'Meridian Park Medical Campus',
  );
  await expect(page.getByRole('button', { name: 'Activate verified package' })).toHaveCount(0);
});
