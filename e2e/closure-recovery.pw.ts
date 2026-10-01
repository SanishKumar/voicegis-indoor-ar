import type { Page } from '@playwright/test';
import overlayFixture from '../buildings/asterion-medical-center/operations/all-public-lifts-closed.overlay.json' with { type: 'json' };
import {
  expect,
  expectCenterHitTarget,
  expectInsideViewport,
  openPharmacyRoute,
  test,
} from './support';

const epoch = Date.parse('2026-09-30T12:00:00Z');
async function importPolicy(page: Page, id: string, lifetime = 60_000) {
  await page.getByRole('link', { name: '3D + venues', exact: true }).click();
  const open = page.getByRole('button', { name: 'Open venue runtime controls', exact: true });
  await open.click();
  await page.getByLabel('Load closure overlay').setInputFiles({
    name: `${id}.json`,
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        ...overlayFixture,
        id,
        validFrom: new Date(epoch - 1000).toISOString(),
        validUntil: new Date(epoch + lifetime).toISOString(),
      }),
    ),
  });
  await expect(page.locator('.venue-runtime-message')).toContainText(`${id}.json was imported`);
  await page.getByRole('link', { name: 'Visitor view', exact: true }).click();
}
async function confirmStart(page: Page) {
  await page.getByRole('button', { name: 'Choose current location', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search starting locations' }).fill('General Pediatrics');
  await page.locator('.lp-result-item').filter({ hasText: 'General Pediatrics' }).click();
  await expect(page.locator('.jr')).toHaveAttribute('data-journey', 'guiding');
}
async function policyJourney(page: Page) {
  await openPharmacyRoute(page);
  await page.locator('.checkin-toast').getByRole('button', { name: 'Dismiss' }).click();
  // Freeze Date only; rendering and sensor time keep using a real monotonic clock.
  await page.clock.setFixedTime(epoch);
  await importPolicy(page, 'initial-policy');
  await expect(page.locator('.jr')).toHaveAttribute('data-journey', 'policy-paused');
  await confirmStart(page);
}

test('closure expiry pauses offline, preserves intent and needs a new location after an update', async ({
  page,
  context,
}, testInfo) => {
  await policyJourney(page);
  await page.getByRole('button', { name: 'Next instruction', exact: true }).click();
  await context.setOffline(true);
  await page.clock.setFixedTime(epoch + 60_000);
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  const panel = page.getByRole('alert', { name: 'Directions paused', exact: true });
  await expect(panel).toContainText('Your trip to Outpatient Pharmacy is saved');
  await expect(panel).toContainText('A cached map does not confirm that paths are open');
  await expect(page.locator('.compiled-map')).toHaveAttribute('data-route-floors', '0');
  await expect(page.getByRole('button', { name: 'Next instruction' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Scan a code', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 700 });
  await expectInsideViewport(panel.getByRole('button', { name: 'End route' }));
  await expectCenterHitTarget(panel.getByRole('button', { name: 'End route' }));
  await page.screenshot({ path: testInfo.outputPath('expired-policy-offline-320.png') });
  await context.setOffline(false);
  await importPolicy(page, 'updated-policy', 180_000);
  await expect(panel).toContainText('Confirm where you are now');
  await expect(page.locator('.jr')).toHaveAttribute('data-journey', 'policy-paused');
  await confirmStart(page);
  await expect(page.getByLabel('Fastest available route')).toBeVisible();
});

test('expiry exits the camera and releases its media stream without waiting for a new motion event', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const report = { stopped: 0 };
    Object.defineProperty(window, 'closureCameraTest', { value: report });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: async () => {
        const stream = new MediaStream();
        Object.defineProperty(stream, 'getTracks', {
          value: () => [
            {
              stop: () => {
                report.stopped += 1;
              },
            },
          ],
        });
        return stream;
      },
    });
  });
  await policyJourney(page);
  await page.getByRole('button', { name: 'Camera view', exact: true }).click();
  await expect(page.locator('.camera-preview')).toBeVisible();
  await expect(page.locator('.camera-error')).toHaveCount(0);
  await page.clock.setFixedTime(epoch + 60_000);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.camera-preview')).toHaveCount(0);
  await expect(page.getByRole('alert', { name: 'Directions paused' })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { closureCameraTest: { stopped: number } }).closureCameraTest
            .stopped,
      ),
    )
    .toBeGreaterThan(0);
});

test('closure recovery retains step-free choice and does not silently switch to stairs', async ({
  page,
}) => {
  await openPharmacyRoute(page);
  await page.getByRole('button', { name: 'Use step-free accessible routing' }).click();
  await expect(page.getByLabel('Step-free route')).toBeVisible();
  await page.clock.setFixedTime(epoch);
  await importPolicy(page, 'lifts-closed');
  await expect(page.getByRole('alert', { name: 'Directions paused' })).toContainText(
    'Step-free route',
  );
  await page.getByRole('button', { name: 'Choose current location', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search starting locations' }).fill('General Pediatrics');
  await page.locator('.lp-result-item').filter({ hasText: 'General Pediatrics' }).click();
  await expect(page.locator('.jr')).toHaveAttribute('data-journey', 'failed');
  await expect(page.locator('.jr-banner-lead')).toHaveText('No step-free route');
  await page.getByRole('button', { name: 'Try the fastest route', exact: true }).click();
  await expect(page.locator('.jr')).toHaveAttribute('data-journey', 'guiding');
  await expect(page.getByLabel('Fastest available route')).toContainText('South Public Stair');
});
