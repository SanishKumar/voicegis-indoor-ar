import {
  expect,
  expectCenterHitTarget,
  expectInsideViewport,
  openVisitor,
  precompleteOnboarding,
  test,
} from './support';

test('onboarding moves focus to every newly displayed step', async ({ page }) => {
  await page.goto('/#/visitor');

  // Destination is asked first now, so it is also the screen the flow returns
  // to. Searching rather than taking a suggestion keeps the target fixed
  // regardless of how the venue orders its most-asked-for list.
  const destinationHeading = page.getByRole('heading', { name: 'Where are you going?' });
  await expect(destinationHeading).toBeVisible();

  await page.getByRole('textbox', { name: 'Search destination rooms' }).fill('Outpatient Pharmacy');
  await page.getByRole('button', { name: /Outpatient Pharmacy/ }).click();
  const positionHeading = page.getByRole('heading', { name: 'Now, where are you?' });
  await expect(positionHeading).toBeFocused();

  await page.getByRole('button', { name: 'Back' }).click();
  await expect(destinationHeading).toBeFocused();
});

test('every onboarding exit without a route hands focus to the map search', async ({ page }) => {
  // "Skip" and "Just show map" are gone: skipping used to leave the runtime
  // with no start and therefore no route. One honest exit remains, and it is
  // exercised from a cold start and again after a reset.
  test.setTimeout(45_000);
  await page.goto('/#/visitor');
  const searchTrigger = page.getByRole('button', {
    name: 'Search rooms and departments',
    exact: true,
  });
  const resetOnboarding = page.getByRole('button', { name: 'Go to welcome screen' });
  const destinationHeading = page.getByRole('heading', { name: 'Where are you going?' });

  await page.getByRole('button', { name: 'Browse the map instead' }).click();
  await expect(searchTrigger).toBeFocused();

  // Reset from Guide, not only from the already-correct map state. Welcome is
  // a planning flow and must normalize the surface it returns to.
  await page.getByRole('button', { name: 'Which way?' }).click();
  await expectInsideViewport(resetOnboarding);
  await expectCenterHitTarget(resetOnboarding);
  await resetOnboarding.click();
  await expect(destinationHeading).toBeFocused();

  await page.getByRole('button', { name: 'Browse the map instead' }).click();
  await expect(searchTrigger).toBeFocused();
});

test('destination search sends focus to the outcome of every close path', async ({ page }) => {
  await openVisitor(page);

  const trigger = page.getByRole('button', {
    name: 'Search rooms and departments',
    exact: true,
  });
  await trigger.click();

  const searchDialog = page.getByRole('dialog', { name: 'Find a destination' });
  const searchInput = page.getByRole('textbox', { name: 'Search rooms and departments' });
  await expect(searchInput).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(searchDialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await expect(searchInput).toBeFocused();
  await page.getByRole('button', { name: 'Close destination search' }).click();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await searchInput.fill('Outpatient Pharmacy');
  const details = page.getByRole('button', { name: 'View details for Outpatient Pharmacy' });
  await details.click();

  const poiDialog = page.getByRole('dialog', { name: 'Outpatient Pharmacy' });
  await expect(poiDialog).toBeVisible();
  await expect
    .poll(() => poiDialog.evaluate((dialog) => dialog.contains(document.activeElement)))
    .toBe(true);

  await page.keyboard.press('Escape');
  await expect(poiDialog).toHaveCount(0);
  await expect(searchDialog).toBeVisible();
  await expect(details).toBeFocused();

  await page.getByRole('button', { name: 'Navigate to Outpatient Pharmacy' }).click();
  const directions = page.getByRole('region', { name: 'Directions to Outpatient Pharmacy' });
  await expect(directions).toBeVisible();
  await expect(directions).toBeFocused();

  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(trigger).toBeFocused();
});

test('routing from destination details retires the search dialog before guidance takes focus', async ({
  page,
}) => {
  await openVisitor(page);
  await page.getByRole('button', { name: 'Search rooms and departments', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Search rooms and departments' })
    .fill('Outpatient Pharmacy');
  await page.getByRole('button', { name: 'View details for Outpatient Pharmacy' }).click();

  await page.getByRole('button', { name: 'Navigate Here' }).click();

  await expect(page.getByRole('dialog', { name: 'Find a destination' })).toHaveCount(0);
  const directions = page.getByRole('region', { name: 'Directions to Outpatient Pharmacy' });
  await expect(directions).toBeVisible();
  await expect(directions).toBeFocused();
});

test('route calculation owns focus immediately and cancellation cannot be resurrected', async ({
  page,
}) => {
  let releaseWorker!: () => void;
  const workerGate = new Promise<void>((resolve) => {
    releaseWorker = resolve;
  });
  let workerRequested = false;
  await page.route('**/assets/routing.worker-*.js', async (route) => {
    workerRequested = true;
    await workerGate;
    await route.continue();
  });

  await openVisitor(page);
  const searchTrigger = page.getByRole('button', {
    name: 'Search rooms and departments',
    exact: true,
  });
  await searchTrigger.click();
  await page
    .getByRole('textbox', { name: 'Search rooms and departments' })
    .fill('Outpatient Pharmacy');
  await page.getByRole('button', { name: 'Navigate to Outpatient Pharmacy' }).click();

  const pending = page.getByRole('status', {
    name: 'Calculating route to Outpatient Pharmacy',
  });
  await expect(pending).toBeVisible();
  await expect(pending).toBeFocused();
  await expect.poll(() => workerRequested).toBe(true);

  await pending.getByRole('button', { name: 'Cancel' }).click();
  await expect(pending).toHaveCount(0);
  await expect(searchTrigger).toBeFocused();

  const workerResponse = page.waitForResponse(/routing\.worker-.*\.js/);
  releaseWorker();
  await workerResponse;
  await page.waitForTimeout(250);

  await expect(page.getByRole('region', { name: 'Directions to Outpatient Pharmacy' })).toHaveCount(
    0,
  );
  await expect(searchTrigger).toBeFocused();
});

test('changing the start restores the location opener instead of the search trigger', async ({
  page,
}) => {
  await openVisitor(page);
  await page.getByRole('button', { name: 'Search rooms and departments', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Search rooms and departments' })
    .fill('Outpatient Pharmacy');
  await page.getByRole('button', { name: 'Navigate to Outpatient Pharmacy' }).click();
  await expect(
    page.getByRole('region', { name: 'Directions to Outpatient Pharmacy' }),
  ).toBeVisible();

  const locationTrigger = page.getByRole('button', { name: /Change start location/ });
  await locationTrigger.click();
  const picker = page.getByRole('dialog', { name: 'Set Your Location' });
  await picker.getByRole('button', { name: /Civic Plaza Entrance/ }).click();

  await expect(picker).toHaveCount(0);
  await expect(locationTrigger).toBeFocused();
  await expect(
    page.getByRole('button', { name: 'Search rooms and departments' }),
  ).not.toBeFocused();
});

test('the 3D inspector exposes keyboard space selection without false application semantics', async ({
  page,
}) => {
  await precompleteOnboarding(page);
  await page.goto('/#/inspector');

  const model = page.getByRole('region', { name: '3D model view' });
  await expect(model).toBeVisible();
  await expect(page.getByRole('application')).toHaveCount(0);

  const spaceSelector = page.getByRole('combobox', { name: 'Inspect a space' });
  await expectInsideViewport(spaceSelector);
  await expectCenterHitTarget(spaceSelector);
  await spaceSelector.focus();
  await page.keyboard.press('ArrowDown');

  await expect(spaceSelector).toHaveValue('g-arrival');
  await expect(page.getByRole('heading', { name: 'Civic Plaza Entrance' })).toBeVisible();
  await expect(page.locator('.twin-selection-status')).toContainText(
    'Selected Civic Plaza Entrance, Ground · Diagnostics & Outpatients, public, accessible.',
  );

  // Hiding a selected space must clear state, not merely make the controlled
  // select look empty while its option is absent. Reversing each filter is the
  // assertion that catches a stale selection silently returning.
  await spaceSelector.selectOption('g-pathology');
  await expect(page.getByRole('heading', { name: 'Pathology Operations' })).toBeVisible();

  const restrictedToggle = page.getByRole('button', { name: 'Restricted' });
  await restrictedToggle.focus();
  await page.keyboard.press('Enter');

  await expect(restrictedToggle).toHaveAttribute('aria-pressed', 'false');
  await expect(spaceSelector).toHaveValue('');
  await expect(spaceSelector.locator('option[value="g-pathology"]')).toHaveCount(0);
  await expect(page.locator('.twin-selection-status')).toHaveText('No space selected.');
  await expect(page.getByRole('heading', { name: 'Inspect a semantic space' })).toBeVisible();

  await restrictedToggle.focus();
  await page.keyboard.press('Enter');
  await expect(spaceSelector.locator('option[value="g-pathology"]')).toHaveCount(1);
  await expect(spaceSelector).toHaveValue('');

  await spaceSelector.selectOption('g-arrival');
  const levelOne = page.getByRole('button', { name: 'L1', exact: true });
  await levelOne.focus();
  await page.keyboard.press('Enter');
  await expect(spaceSelector).toHaveValue('');

  const allFloors = page.getByRole('button', { name: 'All', exact: true });
  await allFloors.focus();
  await page.keyboard.press('Enter');
  await expect(spaceSelector.locator('option[value="g-arrival"]')).toHaveCount(1);
  await expect(spaceSelector).toHaveValue('');

  const runtimeControls = page.getByRole('button', { name: 'Open venue runtime controls' });
  await runtimeControls.scrollIntoViewIfNeeded();
  await expectInsideViewport(runtimeControls);
  await expectCenterHitTarget(runtimeControls);
  await runtimeControls.click();
  await expect(page.getByRole('textbox', { name: 'VenuePackage URL' })).toBeVisible();
});
