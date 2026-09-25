import {
  expect,
  expectCenterHitTarget,
  expectInsideViewport,
  precompleteOnboarding,
  test,
} from './support';

test('the phone test log is opt-in, reports motion refusal and copies the complete report', async ({
  page,
}) => {
  await precompleteOnboarding(page);
  await page.addInitScript(() => {
    const request = () => Promise.resolve('denied');
    for (const name of ['DeviceMotionEvent', 'DeviceOrientationEvent']) {
      Object.defineProperty(window, name, {
        value: class {
          static requestPermission = request;
        },
        configurable: true,
      });
    }
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async (text: string) => {
          (window as unknown as { copiedFieldReport: string }).copiedFieldReport = text;
        },
      },
      configurable: true,
    });
  });

  await page.goto('/#/visitor');
  await expect(page.locator('.compiled-map')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Test log', exact: true })).toHaveCount(0);

  const checkin = encodeURIComponent('voicegis://asterion/l2/east');
  await page.goto(`/?fieldtest=1&checkin=${checkin}#/visitor`);
  await expect(page.locator('.checkin-toast')).toContainText('Family Care Concourse');
  await page.locator('.checkin-toast').getByRole('button', { name: 'Dismiss' }).click();
  await page.getByRole('button', { name: 'Search rooms and departments', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Search rooms and departments' })
    .fill('Outpatient Pharmacy');
  await page.getByRole('button', { name: 'Navigate to Outpatient Pharmacy' }).click();
  await page.getByRole('button', { name: 'Track my walk', exact: true }).click();
  await expect(page.locator('.jr')).toHaveAttribute('data-tracking', 'denied');

  await page.setViewportSize({ width: 320, height: 700 });
  const opener = page.getByRole('button', { name: 'Test log', exact: true });
  await expectCenterHitTarget(opener);
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Field test log' });
  const report = dialog.getByRole('textbox', { name: 'Field test report' });
  await expect(report).toHaveValue(/motion-access status=denied/);
  await expect(report).toHaveValue(/venue asterion-medical-center/);
  await expectInsideViewport(dialog);
  const copy = dialog.getByRole('button', { name: 'Copy report', exact: true });
  await expectInsideViewport(copy);
  await expectCenterHitTarget(copy);
  const text = await report.inputValue();
  await copy.click();
  await expect(dialog.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { copiedFieldReport: string }).copiedFieldReport,
    ),
  ).toBe(text);
  await dialog.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(report).toHaveValue(/0 events/);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  await page.goto('/?fieldtest=0#/visitor');
  await expect(page.locator('.compiled-map')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Test log', exact: true })).toHaveCount(0);
});
