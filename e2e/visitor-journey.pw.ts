import { expect, openPharmacyRoute, precompleteOnboarding, test } from './support';

test('a first-time visitor names a destination, then a start, and gets a route', async ({
  page,
}) => {
  await page.goto('/#/visitor');

  await expect(page.getByRole('heading', { name: 'Where are you going?' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search destination rooms' }).fill('Outpatient Pharmacy');
  await page.getByRole('button', { name: /Outpatient Pharmacy/ }).click();

  await expect(page.getByRole('heading', { name: 'Now, where are you?' })).toBeVisible();
  await page.getByRole('button', { name: /Civic Plaza Entrance/ }).click();

  await expect(page.locator('.compiled-map')).toBeVisible();
  await expect(page.getByLabel('Fastest available route')).toBeVisible();
  await expect(page.getByText('Outpatient Pharmacy', { exact: true }).first()).toBeVisible();
});

test('a verified check-in drives fastest and step-free routes through different connectors', async ({
  page,
}) => {
  await openPharmacyRoute(page);

  const fastest = page.getByLabel('Fastest available route');
  await expect(fastest).toContainText('South Public Stair');

  const accessibleToggle = page.getByRole('button', {
    name: 'Use step-free accessible routing',
  });
  await accessibleToggle.click();

  const stepFree = page.getByLabel('Step-free route');
  await expect(stepFree).toContainText('Panoramic Atrium Lift');
  const fastestToggle = page.getByRole('button', { name: 'Use fastest available routing' });
  await expect(fastestToggle).toHaveAttribute('aria-pressed', 'true');
});

test('a foreign-venue check-in is consumed with a visible refusal', async ({ page }) => {
  await precompleteOnboarding(page);
  const payload = encodeURIComponent('voicegis://harbor-exchange/g/ferry-entry');
  await page.goto(`/?checkin=${payload}#/visitor`);

  const alert = page.getByRole('alert');
  await expect(alert).toContainText('That check-in link did not work here');
  await expect(alert).toContainText(/That code is not one of this venue.s check-in points/);
  await expect(alert).toContainText('Active venue: Asterion University Medical Center');
  expect(new URL(page.url()).searchParams.has('checkin')).toBe(false);
  await expect(page.getByText(/Checked in at/)).toHaveCount(0);
});

test('Escape closes only the topmost dialog and restores focus', async ({ page }) => {
  await precompleteOnboarding(page);
  await page.goto('/#/visitor');
  await expect(page.locator('.compiled-map')).toBeVisible();

  const trigger = page.getByRole('button', { name: /Change start location/ });
  await trigger.click();

  const locationDialog = page.getByRole('dialog', { name: 'Set Your Location' });
  await expect(locationDialog).toBeVisible();
  await expect
    .poll(() => locationDialog.evaluate((dialog) => dialog.contains(document.activeElement)))
    .toBe(true);

  await locationDialog.getByRole('button', { name: 'Scan a check-in code' }).click();
  const scannerDialog = page.getByRole('dialog', { name: 'Scan a check-in code' });
  await expect(scannerDialog).toBeVisible();
  await expect
    .poll(() => scannerDialog.evaluate((dialog) => dialog.contains(document.activeElement)))
    .toBe(true);

  await page.keyboard.press('Escape');
  await expect(scannerDialog).toHaveCount(0);
  await expect(locationDialog).toBeVisible();
  await expect
    .poll(() => locationDialog.evaluate((dialog) => dialog.contains(document.activeElement)))
    .toBe(true);

  await page.keyboard.press('Escape');
  await expect(locationDialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
