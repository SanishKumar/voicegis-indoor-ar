import type { Page } from '@playwright/test';
import { measureTextContrast, tooFaint } from './contrast';
import { expect, openPharmacyRoute, openVisitor, test } from './support';

/*
 * White type on glass over a bright sky is the look, and it is also exactly
 * the arrangement in which text stops being readable without anyone noticing.
 * These walk the visitor's screens and measure every run of text against what
 * is really behind it.
 */

async function expectReadable(page: Page, screen: string) {
  // Let a pane that has just opened, and the map under it, come to rest.
  await page.waitForTimeout(600);
  const runs = await measureTextContrast(page);
  expect(runs.length, `${screen} showed no text to measure`).toBeGreaterThan(3);
  expect(tooFaint(runs), `${screen} has text below WCAG AA contrast`).toEqual([]);
}

for (const viewport of [
  { name: 'a phone', width: 390, height: 844 },
  { name: 'a desk', width: 1280, height: 800 },
]) {
  test(`the welcome screens are readable against the sky on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/#/visitor');
    await expect(page.locator('.onboard')).toBeVisible();
    await expectReadable(page, 'Choosing a destination');

    await page
      .getByRole('button', { name: /Emergency Reception/ })
      .first()
      .click();
    await expect(page.getByRole('button', { name: 'Scan a check-in code' })).toBeVisible();
    await expectReadable(page, 'Choosing a start');
  });

  test(`the map, search and location panes are readable on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openVisitor(page);
    await expectReadable(page, 'The idle map');

    await page.getByRole('button', { name: 'Search rooms and departments', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Find a destination' })).toBeVisible();
    await expectReadable(page, 'Destination search');
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: /Change start location/ }).click();
    await expect(page.getByRole('dialog', { name: 'Set Your Location' })).toBeVisible();
    await expectReadable(page, 'The location picker');
  });

  test(`a journey is readable in the plan and the model on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openPharmacyRoute(page);
    await page.locator('.checkin-toast').getByRole('button', { name: 'Dismiss' }).click();
    await expectReadable(page, 'A journey on the plan');

    const model = page.getByRole('button', { name: '3D model', exact: true });
    await model.click();
    await expect(model).toHaveAttribute('aria-pressed', 'true');
    // The camera eases into the tilted view; measure it where it settles.
    await page.waitForTimeout(1200);
    await expectReadable(page, 'A journey on the model');
  });
}
