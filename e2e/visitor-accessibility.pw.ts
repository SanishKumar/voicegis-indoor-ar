import {
  expect,
  expectCenterHitTarget,
  expectInsideViewport,
  openPharmacyRoute,
  openVisitor,
  test,
} from './support';

test('a narrow phone retains a usable map band and its primary action without scrolling', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await openPharmacyRoute(page);
  await page.locator('.checkin-toast').getByRole('button', { name: 'Dismiss' }).click();
  const primary = page.locator('.jr-primary');
  await expectInsideViewport(primary);
  await expectCenterHitTarget(primary);
  await expect
    .poll(() =>
      page.locator('.compiled-map').evaluate((node) => {
        const style = getComputedStyle(node);
        return (
          node.clientHeight -
          parseFloat(style.getPropertyValue('--map-inset-top')) -
          parseFloat(style.getPropertyValue('--map-inset-bottom'))
        );
      }),
    )
    .toBeGreaterThan(160);
  const voice = page.getByRole('button', { name: 'Speak directions aloud' });
  const box = await voice.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  const graphics = page.getByRole('button', { name: 'Graphics detail', exact: true });
  await graphics.click();
  const choices = page.getByRole('group', { name: 'Map graphics detail', exact: true });
  for (const name of ['Automatic', 'Full detail', 'Low detail']) {
    const choice = choices.getByRole('button', { name, exact: true });
    await expectInsideViewport(choice);
    await expectCenterHitTarget(choice);
    const bounds = await choice.boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
  }
  await page.keyboard.press('Escape');
  await expect(choices).toHaveCount(0);
  await expect(graphics).toBeFocused();

  // A sticky primary action must not cover the trip's other keyboard actions.
  const panel = page.getByRole('region', { name: 'Directions to Outpatient Pharmacy' });
  await panel.getByRole('button', { name: 'End route' }).focus();
  for (const action of [
    panel.locator('.jr-destination-context summary'),
    panel.getByRole('button', { name: /^Change start location/ }),
    panel.getByRole('button', { name: 'Use step-free accessible routing' }),
    primary,
    panel.getByRole('button', { name: 'Next instruction' }),
    panel.getByRole('button', { name: /^Show all \d+ steps$/ }),
  ]) {
    await page.keyboard.press('Tab');
    await expect(action).toBeFocused();
    await expectInsideViewport(action);
    await expectCenterHitTarget(action);
  }
});

test('200% search text retains empty-result recovery and the keyboard dismissal path', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await openVisitor(page);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '32px';
  });
  await page.getByRole('button', { name: 'Search rooms and departments', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Find a destination' });
  const input = panel.getByRole('textbox', { name: 'Search rooms and departments' });
  await expect(input).toBeFocused();
  await expectInsideViewport(input);
  await expectCenterHitTarget(input);
  await input.fill('zzzzzzzzzzzzzz');
  expect(await input.evaluate((node) => getComputedStyle(node).fontSize)).toBe('32px');
  const retry = panel.getByRole('button', { name: 'Try another search', exact: true });
  await retry.focus();
  await expectInsideViewport(retry);
  await expectCenterHitTarget(retry);
  await page.keyboard.press('Enter');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('');
  const close = panel.getByRole('button', { name: 'Close destination search', exact: true });
  await close.focus();
  await expectInsideViewport(close);
  await expectCenterHitTarget(close);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('search-200-percent.png') });
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: 'Search rooms and departments', exact: true }),
  ).toBeFocused();
});

test('200% text on a short phone keeps instructions, destination and every preview step reachable', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await openPharmacyRoute(page);
  await page.locator('.checkin-toast').getByRole('button', { name: 'Dismiss' }).click();
  const panel = page.getByRole('region', { name: 'Directions to Outpatient Pharmacy' });
  const map = page.locator('.compiled-map');
  const location = await map.getAttribute('data-location-floor');
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '32px';
  });

  await expect
    .poll(() =>
      panel.evaluate((sheet) => {
        const banner = document.querySelector('.jr-banner')!.getBoundingClientRect();
        const bounds = sheet.getBoundingClientRect();
        return bounds.top >= banner.bottom + 10 && bounds.bottom <= innerHeight + 1;
      }),
    )
    .toBe(true);
  expect(
    await panel
      .locator('.jr-trip-time')
      .evaluate((node) => parseFloat(getComputedStyle(node).fontSize)),
  ).toBe(48);
  const banner = page.getByRole('region', { name: 'Next step' });
  await expectInsideViewport(banner);
  await banner.focus();
  await page.keyboard.press('End');
  await expect
    .poll(() =>
      banner.evaluate(
        (node) => Math.abs(node.scrollHeight - node.clientHeight - node.scrollTop) < 1,
      ),
    )
    .toBe(true);
  await page.keyboard.press('Home');
  await expect.poll(() => banner.evaluate((node) => node.scrollTop)).toBe(0);
  const show = panel.getByRole('button', { name: /^Show all \d+ steps$/ });
  await show.click();
  const toggle = panel.getByRole('button', { name: 'Hide all steps' });
  await toggle.focus();
  const rows = panel.getByRole('button', { name: /^Preview step / });
  const count = await rows.count();
  expect(count).toBeGreaterThan(1);
  const preview = panel.getByRole('button', { name: 'preview it as a walk-through' });
  if (await preview.isVisible()) {
    await page.keyboard.press('Tab');
    await expect(preview).toBeFocused();
    await expectCenterHitTarget(preview);
  }
  // Real Tab traversal, not scrollIntoView: focused rows must be revealed by
  // the sheet's one scroll owner and cannot be clipped behind the banner.
  for (let index = 0; index < count; index += 1) {
    await page.keyboard.press('Tab');
    await expect(rows.nth(index)).toBeFocused();
    // A full sentence plus floor metadata can be taller than the sheet at
    // 200% text. It must scroll, not shrink the text or pretend the entire
    // row fits at once. Require a visible focus boundary and hit target.
    await expect
      .poll(() =>
        rows.nth(index).evaluate((node) => {
          const box = node.getBoundingClientRect();
          const sheet = node.closest('.jr-sheet')!.getBoundingClientRect();
          return (
            box.left >= sheet.left &&
            box.right <= sheet.right &&
            Math.min(box.bottom, sheet.bottom) - Math.max(box.top, sheet.top) >= 44
          );
        }),
      )
      .toBe(true);
    await expectCenterHitTarget(rows.nth(index));
  }
  expect(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await expect(map).toHaveAttribute('data-location-floor', location!);
  await page.screenshot({ path: testInfo.outputPath('journey-200-percent.png') });
  const end = panel.getByRole('button', { name: 'End route', exact: true });
  await end.focus();
  await expectCenterHitTarget(end);
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('button', { name: 'Search rooms and departments', exact: true }),
  ).toBeFocused();
  await expectCenterHitTarget(
    page.getByRole('button', { name: 'Search rooms and departments', exact: true }),
  );
});

test('short landscape reflows the trip sheet below its measured banner', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 667, height: 375 });
  await openPharmacyRoute(page);
  await page.locator('.checkin-toast').getByRole('button', { name: 'Dismiss' }).click();
  const panel = page.getByRole('region', { name: 'Directions to Outpatient Pharmacy' });
  await expect
    .poll(() =>
      panel.evaluate((sheet) => {
        const banner = document.querySelector('.jr-banner')!.getBoundingClientRect();
        const bounds = sheet.getBoundingClientRect();
        return bounds.top >= banner.bottom + 10 && bounds.bottom <= innerHeight + 1;
      }),
    )
    .toBe(true);
  const primary = panel.locator('.jr-primary');
  await primary.focus();
  await expectInsideViewport(primary);
  await expectCenterHitTarget(primary);
  const end = panel.getByRole('button', { name: 'End route' });
  await end.focus();
  await expectInsideViewport(end);
  await expectCenterHitTarget(end);
  await page.screenshot({ path: testInfo.outputPath('journey-short-landscape.png') });
});

test('system high contrast retains visible keyboard focus and destination disclosure', async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await openPharmacyRoute(page);
  await page.locator('.checkin-toast').getByRole('button', { name: 'Dismiss' }).click();
  const details = page.locator('.jr-destination-context');
  const summary = details.locator('summary');
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(details).toHaveAttribute('open', '');
  await expect(details).toContainText('Ground');
  const border = await summary.evaluate((node) => {
    const style = getComputedStyle(node);
    return { width: style.outlineWidth, style: style.outlineStyle };
  });
  expect(border).toEqual({ width: '2px', style: 'solid' });
  await expectCenterHitTarget(summary);
});

test('route end is a preview until the visitor confirms arrival, and Done restores search focus', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: async () => new MediaStream(),
    });
    const phrases: string[] = [];
    Object.defineProperty(window, '__visitorSpeech', { value: phrases });
    Object.defineProperty(window, 'speechSynthesis', {
      value: {
        cancel() {},
        speak(utterance: SpeechSynthesisUtterance) {
          phrases.push(utterance.text);
        },
      },
    });
  });
  await openPharmacyRoute(page);
  await page.getByRole('button', { name: 'Speak directions aloud' }).click();
  const panel = page.getByRole('region', { name: 'Directions to Outpatient Pharmacy' });
  const count = Number(await panel.getAttribute('data-step-count'));
  for (let index = 1; index < count; index += 1) {
    await panel.getByRole('button', { name: 'Next instruction' }).click();
  }
  const banner = page.getByRole('region', { name: 'Next step' });
  await expect(banner).toContainText('End of route');
  await expect(page.locator('.jr')).toHaveAttribute('data-journey', 'guiding');
  await expect(page.locator('.jr-destination-context')).toHaveAttribute('open', '');
  const lastSpeech = () =>
    page.evaluate(() =>
      (window as Window & { __visitorSpeech?: string[] }).__visitorSpeech?.at(-1),
    );
  await expect.poll(lastSpeech).toContain('your arrival is not confirmed');
  await page.getByRole('button', { name: 'Camera view', exact: true }).click();
  const cameraFacts = page.locator('.camera-preview > .ar-sheet .ar-sheet-facts');
  await expect(cameraFacts).toContainText('End of route');
  await expect(cameraFacts).toContainText('Not yet confirmed');
  await expect(cameraFacts).not.toContainText('You are here');
  await page.getByRole('button', { name: 'Exit to plan', exact: true }).click();
  await panel.getByRole('button', { name: 'I’m at my destination' }).click();
  await expect(banner).toContainText('Arrival confirmed');
  await expect(banner).toContainText('Arrival confirmed by you');
  await expect.poll(lastSpeech).toContain('Arrival confirmed by you');
  await panel.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Search rooms and departments', exact: true }),
  ).toBeFocused();
});
