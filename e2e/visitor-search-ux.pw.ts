import {
  expect,
  expectCenterHitTarget,
  expectInsideViewport,
  openVisitor,
  precompleteOnboarding,
  test,
} from './support';

test('empty search explains recovery and removing a category preserves the query', async ({
  page,
}) => {
  await openVisitor(page);
  await page.getByRole('button', { name: 'Search rooms and departments', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Find a destination' });
  const input = panel.getByRole('textbox', { name: 'Search rooms and departments' });
  await expect(input).toBeFocused();
  await panel.locator('.category-chip[data-cat="pharmacy"]').click();
  await input.fill('Civic Plaza Entrance');
  await expect(panel.getByRole('heading', { name: 'No destinations found' })).toBeVisible();
  await expect(panel.getByRole('status', { name: 'Search results' })).toContainText(
    '0 destinations matching “Civic Plaza Entrance” in Pharmacy',
  );
  const broaden = panel.getByRole('button', { name: 'Search all categories' });
  await expectCenterHitTarget(broaden);
  await broaden.click();
  await expect(input).toHaveValue('Civic Plaza Entrance');
  await expect(input).toBeFocused();
  await expect(
    panel.getByRole('button', { name: 'View details for Civic Plaza Entrance' }),
  ).toBeVisible();
  await expect(panel.locator('.category-chip[data-cat="pharmacy"]')).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  // Search Enter is not permission to change destination or begin a route.
  await input.press('Enter');
  await expect(page.locator('.jr')).toHaveCount(0);
  await input.fill('zzzzzzzzzzzzzz');
  await expect(
    panel.getByText('Try a room name, department, service or a shorter spelling.'),
  ).toBeVisible();
  await panel.getByRole('button', { name: 'Try another search' }).click();
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
  await expect(panel.getByRole('list', { name: 'Destination results' })).toBeVisible();
});

test('all destinations are reachable and Show more focuses the first new result', async ({
  page,
}) => {
  await openVisitor(page);
  await page.getByRole('button', { name: 'Search rooms and departments', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Find a destination' });
  const summary = panel.getByRole('status', { name: 'Search results' });
  const list = panel.getByRole('list', { name: 'Destination results' });
  const total = Number((await summary.innerText()).match(/^\d+/)?.[0]);
  expect(total).toBeGreaterThan(10);
  await expect(list.getByRole('listitem')).toHaveCount(10);
  await expect(summary).toContainText('Showing 10; more are available below');
  for (let shown = 10; shown < total; shown += 10) {
    await panel.getByRole('button', { name: /Show \d+ more destinations/ }).click();
    await expect(list.getByRole('listitem')).toHaveCount(Math.min(shown + 10, total));
    await expect(list.getByRole('button', { name: /View details for/ }).nth(shown)).toBeFocused();
  }
  await expect(panel.getByRole('button', { name: /Show \d+ more destinations/ })).toHaveCount(0);
  await expect(summary).not.toContainText('Showing');
  // List expansion has never requested a journey.
  await expect(page.locator('.jr')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: 'Search rooms and departments', exact: true }),
  ).toBeFocused();
});

test('lower search recovery reveals the input when the whole enlarged dialog scrolls', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await openVisitor(page);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '32px';
  });
  await page.getByRole('button', { name: 'Search rooms and departments', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Find a destination' });
  const input = panel.getByRole('textbox', { name: 'Search rooms and departments' });
  await input.fill('zzzzzzzzzzzzzz');
  const recovery = panel.getByRole('button', { name: 'Try another search', exact: true });
  await recovery.focus();
  await expectCenterHitTarget(recovery);
  expect(await panel.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  expect(
    await input.evaluate((node) => {
      const bounds = node.getBoundingClientRect();
      const dialog = node.closest('.search-panel')!.getBoundingClientRect();
      return bounds.bottom <= dialog.top;
    }),
  ).toBe(true);
  await page.keyboard.press('Enter');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('');
  await expectInsideViewport(input);
  await expectCenterHitTarget(input);
});

test('search dismissal and nested details preserve the check-in and step-free preference', async ({
  page,
}) => {
  await precompleteOnboarding(page);
  const payload = encodeURIComponent('voicegis://asterion/l2/east');
  await page.goto(`/?checkin=${payload}#/visitor`);
  await expect(page.locator('.compiled-map')).toBeVisible();
  await page.locator('.checkin-toast').getByRole('button', { name: 'Dismiss' }).click();
  const location = page.getByRole('button', { name: /Change start location/ });
  const locationLabel = await location.getAttribute('aria-label');
  await page.getByRole('button', { name: 'Use step-free accessible routing' }).click();
  await page.getByRole('button', { name: 'Search rooms and departments', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Find a destination' });
  await panel
    .getByRole('textbox', { name: 'Search rooms and departments' })
    .fill('Outpatient Pharmacy');
  const details = panel.getByRole('button', { name: 'View details for Outpatient Pharmacy' });
  await expect(details).toHaveAccessibleDescription(/Ground · Diagnostics & Outpatients/);
  await details.click();
  await expect(page.getByRole('dialog', { name: 'Outpatient Pharmacy' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('textbox', { name: 'Search rooms and departments' })).toHaveValue(
    'Outpatient Pharmacy',
  );
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: 'Search rooms and departments', exact: true }),
  ).toBeFocused();
  await expect(location).toHaveAttribute('aria-label', locationLabel!);
  await expect(page.getByRole('button', { name: 'Use fastest available routing' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.jr')).toHaveCount(0);
  await expect(page.locator('#search-panel')).toHaveAttribute('inert', '');
});

test('search recovery controls and wrapped result names remain usable at 320px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openVisitor(page);
  await page.getByRole('button', { name: 'Search rooms and departments', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Find a destination' });
  const input = panel.getByRole('textbox', { name: 'Search rooms and departments' });
  await input.fill('zzzzzzzzzzzzzz');
  for (const name of [
    'Close destination search',
    'Clear search',
    'Try another search',
    'Browse all destinations',
  ]) {
    const control = panel.getByRole('button', { name, exact: true });
    await control.scrollIntoViewIfNeeded();
    await expectInsideViewport(control);
    await expectCenterHitTarget(control);
    const box = await control.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await input.fill('Civic Plaza Entrance');
  const details = panel.getByRole('button', { name: 'View details for Civic Plaza Entrance' });
  await expectInsideViewport(details);
  await expectCenterHitTarget(details);
  const name = details.locator('.search-result-name');
  expect(await name.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
