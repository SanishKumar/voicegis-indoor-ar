import { expect, test } from './support';
import { openVisitor, precompleteOnboarding } from './support';

/**
 * The public shell is for visitors, and the operator tooling is not.
 *
 * The surface navigation used to sit on every surface, so someone looking for a
 * toilet was offered a package inspector, a venue authoring workspace and a
 * sensor recorder. Those routes still exist and an operator still opens them
 * deliberately; what changed is that nothing in the visitor shell leads there.
 */

const OPERATOR_ROUTES = ['#/inspector', '#/studio', '#/recorder'];

/** Every control a finger has to hit, and the box it actually occupies. */
async function touchTargets(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const header = document.querySelector('.app-header');
    if (header === null) return [];
    return [...header.querySelectorAll('button, a[href]')].map((element) => {
      const bounds = element.getBoundingClientRect();
      return {
        label: element.getAttribute('aria-label') ?? element.textContent?.trim() ?? '',
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
      };
    });
  });
}

test('the visitor shell offers no route into operator tooling', async ({ page }) => {
  await openVisitor(page);

  // Not merely hidden from view: absent from the accessible tree and the DOM,
  // so it cannot be reached by tab, by screen reader, or by a stray click.
  await expect(page.getByRole('navigation', { name: 'Operator tools' })).toHaveCount(0);
  for (const route of OPERATOR_ROUTES) {
    await expect(page.locator(`a[href="${route}"]`)).toHaveCount(0);
  }
});

test('operator routes stay reachable directly and offer a way back', async ({ page }) => {
  await precompleteOnboarding(page);

  for (const route of OPERATOR_ROUTES) {
    await page.goto(`/${route}`);
    const nav = page.getByRole('navigation', { name: 'Operator tools' });
    await expect(nav, `${route} lost its operator navigation`).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Visitor view' })).toBeVisible();
  }

  // The way back actually goes back, and drops the tooling on arrival.
  await page
    .getByRole('navigation', { name: 'Operator tools' })
    .getByRole('link', { name: 'Visitor view' })
    .click();
  await expect(page.locator('.compiled-map')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Operator tools' })).toHaveCount(0);
});

test('operator navigation is reachable and named for the keyboard', async ({ page }) => {
  await precompleteOnboarding(page);
  await page.goto('/#/inspector');

  const nav = page.getByRole('navigation', { name: 'Operator tools' });
  await expect(nav).toBeVisible();

  // Named without depending on the label being rendered: below 700px the text
  // is display:none and the icon is aria-hidden.
  for (const name of ['Visitor view', '3D + venues', 'Studio', 'Record']) {
    await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
  }

  const studio = nav.getByRole('link', { name: 'Studio', exact: true });
  await studio.focus();
  await expect(studio).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(page.locator('.studio-surface')).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Operator tools' }).getByRole('link', { name: 'Studio', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
});

for (const width of [320, 375]) {
  test(`every visitor header control is a real touch target at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 640 });
    await openVisitor(page);

    const targets = await touchTargets(page);
    expect(targets.length, 'no header controls were measured').toBeGreaterThan(0);

    // 44x44 is the floor. These had been shrinking to fit instead - 29x38 at
    // 320px - which keeps the row on one line by making it unusable.
    const tooSmall = targets.filter((target) => target.width < 44 || target.height < 44);
    expect(tooSmall, `controls below 44x44 at ${width}px`).toEqual([]);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, 'the header widened the document').toBeLessThanOrEqual(0);
  });
}
