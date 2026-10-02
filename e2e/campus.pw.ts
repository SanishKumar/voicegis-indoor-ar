import type { Page } from '@playwright/test';
import { expect, precompleteOnboarding, test } from './support';

/*
 * A venue with grounds: several buildings, and open ground between them.
 * From outside it is read as buildings; close to, as rooms. These hold the two
 * views apart, the way from one to the other, and a route that crosses both.
 */

const CAMPUS = '/?venue=/venues/meridian-park-campus.package.json#/visitor';

async function openCampus(page: Page) {
  await precompleteOnboarding(page);
  await page.goto(CAMPUS);
  await expect(page.locator('.compiled-map')).toBeVisible();
  await expect(page.getByText('Meridian Park Medical Campus').first()).toBeVisible();
}

/** The labels actually drawn. One that lost its place is still in the page, at no opacity. */
function shownLabels(page: Page) {
  return page
    .locator('.map-pill')
    .evaluateAll((labels) =>
      labels
        .filter((label) => getComputedStyle(label).opacity === '1')
        .map((label) => label.textContent ?? ''),
    );
}

test('a campus opens on its buildings and grounds, not on a hundred room names', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openCampus(page);

  await expect
    .poll(() => shownLabels(page))
    .toEqual(expect.arrayContaining(['Main Hospital', 'Emergency Centre', 'Wellness Pavilion']));
  const outside = await shownLabels(page);
  // What is in the open is named; what is under a roof is not, yet.
  expect(outside).toEqual(expect.arrayContaining(['Main Gate', 'Central Fountain']));
  for (const room of ['Hospital Pharmacy', 'Triage', 'Rehabilitation Gym']) {
    expect(outside, `${room} is named from outside`).not.toContain(room);
  }
});

test('pressing a building goes in to it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openCampus(page);
  await expect.poll(() => shownLabels(page)).toContain('Main Hospital');

  // The name sits over the middle of the roof, so that is where to press.
  const name = page.locator('.map-pill-building', { hasText: 'Main Hospital' });
  const box = await name.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

  // The roof is gone and the rooms under it have their names.
  await expect.poll(() => shownLabels(page), { timeout: 15_000 }).toContain('Hospital Pharmacy');
  const inside = await shownLabels(page);
  expect(inside).not.toContain('Main Hospital');
  // Still the visitor's own view: nothing was selected by going in.
  await expect(page.locator('.poi-card-overlay.open')).toHaveCount(0);
});

/** Opens the campus by the link printed on one of its signs. */
async function checkInAt(page: Page, sign: string) {
  await precompleteOnboarding(page);
  const payload = encodeURIComponent(`voicegis://meridian/${sign}`);
  await page.goto(`/?venue=/venues/meridian-park-campus.package.json&checkin=${payload}#/visitor`);
  await expect(page.locator('.checkin-toast')).toBeVisible();
}

test('a sign indoors opens the map among the rooms round it, and the outside is one press away', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await checkInAt(page, 'g/emergency-entrance');

  // In the Emergency Centre: its rooms are named and the buildings are not.
  await expect.poll(() => shownLabels(page), { timeout: 15_000 }).toContain('Triage');
  expect(await shownLabels(page)).not.toContain('Emergency Centre');

  await page.locator('.checkin-toast').getByRole('button', { name: 'Dismiss' }).click();
  await page.getByRole('button', { name: 'Reset the map view' }).click();
  await expect
    .poll(() => shownLabels(page), { timeout: 15_000 })
    .toEqual(expect.arrayContaining(['Main Hospital', 'Emergency Centre', 'Wellness Pavilion']));
  expect(await shownLabels(page)).not.toContain('Triage');

  // And back in to where the sign is.
  await page.getByRole('button', { name: 'Recenter on last check-in' }).click();
  await expect.poll(() => shownLabels(page), { timeout: 15_000 }).not.toContain('Emergency Centre');
});

test('a sign out of doors opens on the whole site', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await checkInAt(page, 'g/main-gate');
  await expect
    .poll(() => shownLabels(page), { timeout: 15_000 })
    .toEqual(expect.arrayContaining(['Main Hospital', 'Emergency Centre', 'Wellness Pavilion']));
  expect(await shownLabels(page)).not.toContain('Triage');
});

test('a floor that is not under the view is brought into it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await checkInAt(page, 'g/emergency-entrance');
  await expect.poll(() => shownLabels(page), { timeout: 15_000 }).toContain('Triage');

  // Level 1 exists only over the Main Hospital, across the site from here.
  // Left where it was, the view would be of nothing.
  await page.getByRole('button', { name: /^Show Level 1/ }).click();
  await expect
    .poll(() => shownLabels(page), { timeout: 15_000 })
    .toEqual(expect.arrayContaining(['Maternity Unit', 'Day Surgery']));
});

test('a route leaves one building, crosses the garden and enters another', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openCampus(page);

  await page.getByRole('button', { name: 'Search rooms and departments', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search rooms and departments' }).fill('Triage');
  await page.getByRole('button', { name: 'View details for Triage', exact: true }).click();
  await page.getByRole('button', { name: 'Set Triage as starting point' }).click();
  await expect(
    page.getByRole('button', { name: /Change start location. Current: Triage/ }),
  ).toBeVisible();

  // Search stays open after a start is chosen, ready for the destination.
  await page
    .getByRole('textbox', { name: 'Search rooms and departments' })
    .fill('Rehabilitation Gym');
  await page.getByRole('button', { name: 'Navigate to Rehabilitation Gym' }).click();

  const directions = page.getByRole('region', { name: 'Directions to Rehabilitation Gym' });
  await expect(directions).toBeVisible();
  // From the Emergency Centre in the west to the pavilion in the east is most
  // of the width of the site: well over a hundred metres, all on the ground.
  const summary = await directions.locator('.jr-trip-time').innerText();
  const metres = Number(/(\d+)\s*m\b/.exec(summary)?.[1]);
  expect(metres).toBeGreaterThan(120);
  await expect(page.locator('.compiled-map')).toHaveAttribute('data-route-floors', '1');

  await directions.getByRole('button', { name: /Show all \d+ steps/ }).click();
  const steps = directions.locator('.jr-step-list');
  await expect(steps).toContainText('West Garden Walk');
  await expect(steps).toContainText('Fountain Court');
  await expect(steps).toContainText('East Garden Walk');
});
