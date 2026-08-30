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
async function touchTargets(page: import('@playwright/test').Page, containerSelector: string) {
  return page.evaluate((selector) => {
    const container = document.querySelector(selector);
    if (container === null) return [];
    return [...container.querySelectorAll('button, a[href]')].map((element) => {
      const bounds = element.getBoundingClientRect();
      const hit = document.elementFromPoint(
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2,
      );
      return {
        label: element.getAttribute('aria-label') ?? element.textContent?.trim() ?? '',
        width: bounds.width,
        height: bounds.height,
        contained:
          bounds.left >= -0.5 &&
          bounds.right <= window.innerWidth + 0.5 &&
          bounds.top >= -0.5 &&
          bounds.bottom <= window.innerHeight + 0.5,
        hittable: hit === element || (hit !== null && element.contains(hit)),
      };
    });
  }, containerSelector);
}

test('the operator build reaches its tooling from the visitor view', async ({ page }) => {
  await openVisitor(page);

  // Only in this build. The public shell's absence of all of it is proven
  // against the real public bundle in the offline suite, and by the compiler
  // refusing to emit a public build that so much as imports these modules.
  const nav = page.getByRole('navigation', { name: 'Operator tools' });
  await expect(nav).toBeVisible();
  for (const route of OPERATOR_ROUTES) {
    await expect(nav.locator(`a[href="${route}"]`)).toHaveCount(1);
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
  // The nav stays: this build is for operators, and they came from a tool.
  await expect(page.getByRole('navigation', { name: 'Operator tools' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Search rooms and departments' })).toBeFocused();
});

test('operator navigation is reachable and named for the keyboard', async ({ page }) => {
  await precompleteOnboarding(page);
  await page.goto('/#/inspector');

  const nav = page.getByRole('navigation', { name: 'Operator tools' });
  await expect(nav).toBeVisible();

  // The mobile dock keeps its labels instead of becoming four mystery icons;
  // the explicit names also remain stable for assistive technology.
  for (const name of ['Visitor view', '3D + venues', 'Studio', 'Record']) {
    await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
  }

  const studio = nav.getByRole('link', { name: 'Studio', exact: true });
  await studio.focus();
  await expect(studio).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(page.locator('.studio-surface')).toBeVisible();
  await expect(
    page
      .getByRole('navigation', { name: 'Operator tools' })
      .getByRole('link', { name: 'Studio', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
});

for (const width of [320, 375]) {
  test(`every visitor header control is a real touch target at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 640 });
    await openVisitor(page);

    const targets = await touchTargets(page, '.app-header');
    expect(targets.length, 'no header controls were measured').toBeGreaterThan(0);

    // 44x44 is the floor. These had been shrinking to fit instead - 29x38 at
    // 320px - which keeps the row on one line by making it unusable.
    const tooSmall = targets.filter((target) => target.width < 44 || target.height < 44);
    expect(tooSmall, `controls below 44x44 at ${width}px`).toEqual([]);
    expect(
      targets.filter((target) => !target.contained),
      `controls outside the viewport at ${width}px`,
    ).toEqual([]);
    expect(
      targets.filter((target) => !target.hittable),
      `controls whose centre is intercepted at ${width}px`,
    ).toEqual([]);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, 'the header widened the document').toBeLessThanOrEqual(0);
  });

  test(`every operator navigation target is tappable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 640 });
    await precompleteOnboarding(page);
    await page.goto('/#/inspector');
    await expect(page.getByRole('navigation', { name: 'Operator tools' })).toBeVisible();

    const targets = await touchTargets(page, '.surface-nav');
    expect(targets).toHaveLength(4);
    expect(
      targets.filter((target) => target.width < 44 || target.height < 44),
      `operator links below 44x44 at ${width}px`,
    ).toEqual([]);
    expect(targets.filter((target) => !target.contained)).toEqual([]);
    expect(targets.filter((target) => !target.hittable)).toEqual([]);
  });
}
