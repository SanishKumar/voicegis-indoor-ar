import type { Page } from '@playwright/test';
import { expect, precompleteOnboarding, test, waitForMapAtRest } from './support';

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

test('a building opens into rooms on a phone and is operable by keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openCampus(page);
  await page.getByRole('button', { name: '3D model', exact: true }).click();
  const entrance = page.getByRole('button', { name: 'Explore Main Hospital', exact: true });
  await expect(entrance).toBeVisible();
  const bounds = await entrance.boundingBox();
  expect(bounds!.height).toBeGreaterThanOrEqual(44);
  await entrance.press('Enter');
  await expect.poll(() => shownLabels(page)).toContain('Imaging & Radiology');
  await expect(entrance).toBeHidden();
  await expect(page.locator('.compiled-map-canvas')).toBeFocused();
  await expect(
    page.getByRole('button', { name: /Change start location. Current: Main Gate/ }),
  ).toBeVisible();
  await expect(page.locator('.poi-card-overlay.open')).toHaveCount(0);

  // Resizing and focusing a control must not scroll the map's enclosing stage.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('button', { name: 'Reset the map view' }).click();
  await expect(
    page.getByRole('button', { name: 'Explore Main Hospital', exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => page.locator('.visitor-map-stage').evaluate((stage) => stage.scrollTop))
    .toBe(0);
  await expect(
    page.getByRole('button', { name: 'Search rooms and departments', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '3D model', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
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
  // Told which building, not only which floor: every building has a ground floor.
  await expect(page.locator('.checkin-toast')).toContainText('Emergency Centre · Ground');
  await expect(page.locator('.compiled-map-location')).toContainText('Emergency Centre · Ground');

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

test('the floors offered are those of the building the map is in', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openCampus(page);
  const map = page.locator('.compiled-map');
  const floorButtons = page.locator('.compiled-map-floor');

  // Out on the grounds there is no floor to choose: "Level 1" is not a floor
  // of a garden, and of three buildings it would not say which.
  await expect(map).toHaveAttribute('data-zone', 'grounds');
  await expect(floorButtons).toHaveCount(0);

  // Going in to the hospital brings its three floors, and says where this is.
  await page.getByRole('button', { name: 'Explore Main Hospital', exact: true }).click();
  await expect(map).toHaveAttribute('data-zone', 'main-hospital');
  await expect(page.locator('.map-area-card')).toContainText('Main Hospital');
  await expect(page.getByRole('group', { name: 'Floors of Main Hospital' })).toBeVisible();
  await expect(floorButtons).toHaveCount(3);

  // A floor upstairs is still the hospital's map, and is named as it opens.
  await page.getByRole('button', { name: /^Show Level 1/ }).click();
  await expect(page.locator('.map-area-card')).toContainText('Level 1');
  // The view stays over the middle of the building, as it does in any building.
  await expect
    .poll(() => shownLabels(page), { timeout: 15_000 })
    .toEqual(expect.arrayContaining(["Children's Ward", 'Day Surgery']));
  await expect(map).toHaveAttribute('data-zone', 'main-hospital');

  // Back down and out to the campus: the floors go with the building.
  await page.getByRole('button', { name: /^Show Ground/ }).click();
  await page.getByRole('button', { name: 'Reset the map view' }).click();
  await expect(map).toHaveAttribute('data-zone', 'grounds');
  await expect(floorButtons).toHaveCount(0);
  await expect.poll(() => shownLabels(page), { timeout: 15_000 }).toContain('Main Hospital');
});

test('a building of one storey offers no floors', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await checkInAt(page, 'g/emergency-entrance');
  await expect(page.locator('.compiled-map')).toHaveAttribute('data-zone', 'emergency-centre');
  await expect.poll(() => shownLabels(page), { timeout: 15_000 }).toContain('Triage');
  await expect(page.locator('.compiled-map-floor')).toHaveCount(0);
});

async function openCrossCampusRoute(page: Page) {
  await openCampus(page);
  await page.getByRole('button', { name: 'Search rooms and departments', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search rooms and departments' }).fill('Triage');
  await page.getByRole('button', { name: 'View details for Triage', exact: true }).click();
  await page.getByRole('button', { name: 'Set Triage as starting point' }).click();
  await page
    .getByRole('textbox', { name: 'Search rooms and departments' })
    .fill('Rehabilitation Gym');
  await page.getByRole('button', { name: 'Navigate to Rehabilitation Gym' }).click();
  await expect(
    page.getByRole('region', { name: 'Directions to Rehabilitation Gym' }),
  ).toBeVisible();
  await page.getByRole('button', { name: '3D model', exact: true }).click();
}

test('exploring a different building survives a camera round-trip without moving the visitor', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: async () => new MediaStream(),
    });
  });
  await openCrossCampusRoute(page);
  const map = page.locator('.compiled-map');
  const canvas = page.locator('.compiled-map-canvas');
  await expect(map).toHaveAttribute('data-zone', 'emergency-centre');
  await page.getByRole('button', { name: 'Explore Main Hospital', exact: true }).click();
  await expect(map).toHaveAttribute('data-zone', 'main-hospital');
  await expect(map).toHaveAttribute('data-camera-owner', 'visitor');
  await waitForMapAtRest(page);
  const target = await canvas.getAttribute('data-camera-target');
  const scale = await canvas.getAttribute('data-camera-scale');
  // The marker takes another step inside Emergency while the visitor browses
  // Main Hospital. That must not steal the chosen camera or building.
  await page.getByRole('button', { name: 'Next instruction', exact: true }).click();
  await expect(map).toHaveAttribute('data-zone', 'main-hospital');
  await expect(canvas).toHaveAttribute('data-camera-target', target!);
  const instruction = await page.locator('.jr-banner-copy').innerText();

  await page.getByRole('button', { name: 'Camera view', exact: true }).click();
  await page.getByRole('button', { name: 'Exit to plan', exact: true }).click();
  await expect(map).toHaveAttribute('data-zone', 'main-hospital');
  await expect(canvas).toHaveAttribute('data-camera-target', target!);
  await expect(canvas).toHaveAttribute('data-camera-scale', scale!);
  await expect(page.locator('.jr-banner-copy')).toHaveText(instruction, { useInnerText: true });

  // Recenter is an explicit return to the visitor, not just a camera move
  // into the roof of a building whose map is still closed.
  await page.getByRole('button', { name: 'Recenter on guidance', exact: true }).click();
  await expect(map).toHaveAttribute('data-zone', 'emergency-centre');
  await expect(page.locator('.compiled-map-floor')).toHaveCount(0);
  await expect(map).toHaveAttribute('data-camera-owner', 'guidance');
});

test('retrying a lost map display keeps the building being explored', async ({ page }) => {
  await openCrossCampusRoute(page);
  const map = page.locator('.compiled-map');
  await page.getByRole('button', { name: 'Explore Main Hospital', exact: true }).click();
  await expect(map).toHaveAttribute('data-zone', 'main-hospital');
  const canvas = page.locator('.compiled-map-canvas');
  await waitForMapAtRest(page);
  const target = await canvas.getAttribute('data-camera-target');
  // Exercise the Retry scene-recreation path with a recovered device. A real
  // GPU context held lost by WEBGL_lose_context cannot be recreated until
  // that extension restores it; the map-view suite covers that recovery.
  await canvas.dispatchEvent('webglcontextlost', { cancelable: true });
  await expect(map).toHaveAttribute('data-render-status', 'lost');
  await page.getByRole('button', { name: 'Retry map display', exact: true }).click();
  await expect(map).toHaveAttribute('data-render-status', 'ready');
  await expect(map).toHaveAttribute('data-zone', 'main-hospital');
  await expect(canvas).toHaveAttribute('data-camera-target', target!);
});

test('Campus exits an upper floor to the grounds without changing the chosen start', async ({
  page,
}) => {
  await openCampus(page);
  const map = page.locator('.compiled-map');
  await page.getByRole('button', { name: 'Explore Main Hospital', exact: true }).click();
  await page.getByRole('button', { name: /^Show Level 1/ }).click();
  await expect(page.locator('.compiled-map-canvas')).toHaveAttribute('aria-label', /Level 1/);
  await page.getByRole('button', { name: 'Reset the map view', exact: true }).click();
  await expect(map).toHaveAttribute('data-zone', 'grounds');
  await expect(page.locator('.compiled-map-canvas')).toHaveAttribute('aria-label', /Ground/);
  await expect(page.locator('.compiled-map-floor')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /Change start location. Current: Main Gate/ }),
  ).toBeVisible();
  await expect.poll(() => shownLabels(page)).toContain('Main Hospital');
});

test('walking through a door changes the map: out to the grounds, and in to another building', async ({
  page,
}) => {
  test.slow();
  await page.setViewportSize({ width: 390, height: 844 });
  await openCampus(page);
  await page.getByRole('button', { name: 'Search rooms and departments', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search rooms and departments' }).fill('Triage');
  await page.getByRole('button', { name: 'View details for Triage', exact: true }).click();
  await page.getByRole('button', { name: 'Set Triage as starting point' }).click();
  await page
    .getByRole('textbox', { name: 'Search rooms and departments' })
    .fill('Rehabilitation Gym');
  await page.getByRole('button', { name: 'Navigate to Rehabilitation Gym' }).click();
  const directions = page.getByRole('region', { name: 'Directions to Rehabilitation Gym' });
  await expect(directions).toBeVisible();
  // The model, where a building left behind is still in the picture.
  await page.getByRole('button', { name: '3D model', exact: true }).click();
  const map = page.locator('.compiled-map');
  const card = page.locator('.map-area-card');

  // The trip starts in the Emergency Centre, so that is the map that is open:
  // its rooms are named, and the buildings round it are closed and named.
  await expect(map).toHaveAttribute('data-zone', 'emergency-centre');
  // On a phone, expanded trip details can legitimately displace a building
  // label to keep the destination readable. Fold them before checking the
  // wider campus context; this must not change the trip or open building.
  await page.getByRole('button', { name: 'Collapse route details' }).click();
  await expect(map).toHaveAttribute('data-zone', 'emergency-centre');
  await expect
    .poll(() => shownLabels(page), { timeout: 15_000 })
    .toEqual(expect.arrayContaining(['Main Hospital', 'Wellness Pavilion']));
  expect(await shownLabels(page)).not.toContain('Emergency Centre');

  // Step by step to the door, and through it.
  const next = directions.getByRole('button', { name: 'Next instruction' });
  const zone = () => map.getAttribute('data-zone');
  const walkUntil = async (wanted: string) => {
    for (let step = 0; step < 20 && (await zone()) !== wanted; step += 1) await next.click();
    await expect(map).toHaveAttribute('data-zone', wanted);
  };
  await walkUntil('grounds');
  await expect(card).toContainText('Leaving Emergency Centre');
  await expect(card).toContainText('The grounds');
  // Seen from outside it is a building again, with its name on it.
  await expect.poll(() => shownLabels(page), { timeout: 15_000 }).toContain('Emergency Centre');
  expect(await shownLabels(page)).not.toContain('Triage');

  // On across the garden and in at the pavilion's door.
  await walkUntil('wellness-pavilion');
  await expect(card).toContainText('Entering');
  await expect(card).toContainText('Wellness Pavilion');
  await expect
    .poll(() => shownLabels(page), { timeout: 15_000 })
    .not.toContain('Wellness Pavilion');
  // The title is for the moment of coming in, and then gets out of the way.
  await expect(card).toHaveCount(0, { timeout: 10_000 });
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

  await page.getByRole('button', { name: '3D model', exact: true }).click();
  await expect.poll(() => shownLabels(page)).toContain('Rehabilitation Gym');
  await expect(
    page.locator('.map-pill-destination', { hasText: 'Rehabilitation Gym' }),
  ).toBeVisible();
});

test('the route overview shows a whole trip from upstairs in one building to a room in another', async ({
  page,
}) => {
  // Three stacked floors of a campus, drawn by a software renderer, several
  // times over. Each wait keeps its own deadline; the whole is allowed longer.
  test.slow();
  await page.setViewportSize({ width: 1280, height: 800 });
  await openCampus(page);

  // From the Dialysis Unit on Level 2 of the hospital to the gym in the pavilion.
  await page.getByRole('button', { name: 'Search rooms and departments', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search rooms and departments' }).fill('Dialysis Unit');
  await page.getByRole('button', { name: 'View details for Dialysis Unit', exact: true }).click();
  await page.getByRole('button', { name: 'Set Dialysis Unit as starting point' }).click();
  await page
    .getByRole('textbox', { name: 'Search rooms and departments' })
    .fill('Rehabilitation Gym');
  await page.getByRole('button', { name: 'Navigate to Rehabilitation Gym' }).click();

  const directions = page.getByRole('region', { name: 'Directions to Rehabilitation Gym' });
  await expect(directions).toBeVisible();
  const map = page.locator('.compiled-map');
  const canvas = page.locator('.compiled-map-canvas');
  // Level 2, Level 1 on the way down the stairs, and the ground.
  await expect(map).toHaveAttribute('data-route-floors', '3');

  // Every floor of it is in the written directions, in order. On a wide
  // screen they are all listed; on a narrow one they are a press away.
  const showAll = directions.getByRole('button', { name: /Show all \d+ steps/ });
  if (await showAll.isVisible()) await showAll.click();
  const steps = directions.locator('.jr-step-list');
  await expect(steps).toContainText('Turn right into Level 2 Stair Hall');
  await expect(steps).toContainText('Take Main Stairs to Ground · Campus');
  await expect(steps).toContainText('Continue on Hospital Forecourt');
  await expect(steps).toContainText('Turn left onto East Garden Walk');
  await expect(steps).toContainText('Turn left into Rehabilitation Gym');
  // A turn made inside a corridor is not a turn "onto" the corridor.
  await expect(steps).not.toContainText('onto Level 2 Concourse');

  // On the map, one floor of it at a time until the overview is asked for.
  await page.getByRole('button', { name: '3D model', exact: true }).click();
  await expect(map).toHaveAttribute('data-floors-shown', '1');
  await expect(canvas).toHaveAttribute('data-camera-transition', 'settled');
  const closeIn = Number(await canvas.getAttribute('data-camera-scale'));

  await page.getByRole('button', { name: 'Route overview', exact: true }).click();
  await expect
    .poll(async () => Number(await map.getAttribute('data-floors-shown')), { timeout: 15_000 })
    .toBe(3);
  // The view goes out from one leg in one building to the whole of the trip,
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-camera-scale')), { timeout: 15_000 })
    .toBeGreaterThan(closeIn * 2);
  // and its end, on another floor of another building, has its name on it.
  await expect(
    page.locator('.map-pill-destination', { hasText: 'Rehabilitation Gym' }),
  ).toBeVisible();

  // Stepping along it with the overview open keeps the whole trip in view:
  // the camera does not go off after the marker.
  for (let index = 0; index < 3; index += 1) {
    await directions.getByRole('button', { name: 'Next instruction' }).click();
  }
  await expect(canvas).toHaveAttribute('data-camera-follow', 'free');
  await expect(map).toHaveAttribute('data-floors-shown', '3');

  // Closing it gives the marker the camera back, on the floor it is on.
  await page.getByRole('button', { name: 'Route overview', exact: true }).click();
  await expect(map).toHaveAttribute('data-floors-shown', '1');
  await expect(canvas).toHaveAttribute('data-camera-follow', 'following');
});

test('a first visit by the code on a sign needs only a destination, and its route is drawn', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // Nothing set up beforehand: this is the first time the app has been opened,
  // by the camera of a phone pointed at the sign inside the Emergency Entrance.
  const payload = encodeURIComponent('voicegis://meridian/g/emergency-entrance');
  await page.goto(`/?venue=/venues/meridian-park-campus.package.json&checkin=${payload}#/visitor`);

  await expect(page.getByRole('heading', { name: 'Where are you going?' })).toBeVisible();
  // The sign said where the visitor is, and they are told it was heard.
  await expect(page.locator('.onboard-sub')).toContainText('You are at Emergency Entrance');
  await page.getByRole('textbox', { name: 'Search destination rooms' }).fill('Rehabilitation Gym');
  // Which building a place is in, because every building has a ground floor.
  await page
    .getByRole('button', { name: 'Rehabilitation Gym, Wellness Pavilion · Ground' })
    .click();

  // Not asked where they are, having just scanned where they are.
  await expect(page.getByRole('heading', { name: 'Now, where are you?' })).toHaveCount(0);
  const map = page.locator('.compiled-map');
  await expect(map).toBeVisible();
  const directions = page.getByRole('region', { name: 'Directions to Rehabilitation Gym' });
  await expect(directions).toBeVisible();
  await expect(directions).toContainText('Wellness Pavilion · Ground');

  // And the route is on the map. Started on the doorway beside the sign, as it
  // once was, its line could not be drawn clear of the wall and was withheld.
  await expect(map).toHaveAttribute('data-route-clearance', 'checked');
  await expect(page.getByText('Route graphics hidden')).toHaveCount(0);
  await expect
    .poll(async () =>
      Number(await page.locator('.compiled-map-canvas').getAttribute('data-route-segments')),
    )
    .toBeGreaterThan(0);
});

test('a visitor on the wrong map can choose the place, and it stays chosen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // Opened with no link to say which place: the catalog's default.
  await page.goto('/#/visitor');
  await expect(page.getByRole('heading', { name: 'Where are you going?' })).toBeVisible();
  await expect(page.locator('.onboard-eyebrow')).toHaveText('Asterion University Medical Center');

  await page.getByRole('button', { name: /Somewhere else\? Choose the place/ }).click();
  await expect(page.getByRole('heading', { name: 'Which place?' })).toBeFocused();
  await expect(
    page.getByRole('button', { name: /^Asterion University Medical Center, .* showing now$/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: /^Meridian Park Medical Campus, 3 floors/ }).click();

  // Back at the first question, for the place just chosen.
  await expect(page.getByRole('heading', { name: 'Where are you going?' })).toBeVisible();
  await expect(page.locator('.onboard-eyebrow')).toHaveText('Meridian Park Medical Campus');

  // It is remembered, without a link that names it.
  await page.reload();
  await expect(page.locator('.onboard-eyebrow')).toHaveText('Meridian Park Medical Campus');
  await page.getByRole('button', { name: /Browse the map instead/ }).click();
  await expect
    .poll(() => shownLabels(page), { timeout: 15_000 })
    .toEqual(expect.arrayContaining(['Main Hospital', 'Wellness Pavilion']));
});

test('a trip that is over brings the map home: to where the visitor is, the right way up', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await checkInAt(page, 'g/emergency-entrance');
  await page.locator('.checkin-toast').getByRole('button', { name: 'Dismiss' }).click();
  const map = page.locator('.compiled-map');
  const canvas = page.locator('.compiled-map-canvas');
  await expect(map).toHaveAttribute('data-zone', 'emergency-centre');
  // At rest: the view is fitted again to the room the check-in message left.
  await waitForMapAtRest(page);
  const home = Number(await canvas.getAttribute('data-camera-scale'));

  await page.getByRole('button', { name: 'Search rooms and departments', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Search rooms and departments' })
    .fill('Rehabilitation Gym');
  await page.getByRole('button', { name: 'Navigate to Rehabilitation Gym' }).click();
  const directions = page.getByRole('region', { name: 'Directions to Rehabilitation Gym' });
  await expect(directions).toBeVisible();

  // Out at the door and along the garden walk: the map has left the building
  // and turned to the way of travel.
  const next = directions.getByRole('button', { name: 'Next instruction' });
  for (let step = 0; step < 8; step += 1) {
    if ((await map.getAttribute('data-zone')) === 'grounds') break;
    await next.click();
  }
  await expect(map).toHaveAttribute('data-zone', 'grounds');
  await expect(canvas).toHaveAttribute('data-camera-follow', 'following');
  await expect(canvas).not.toHaveAttribute('data-camera-bearing', /^-?0\.0000$/);

  await page.getByRole('button', { name: 'End route' }).click();

  // Not left out on the walk, close in and turned to the last heading. The
  // visitor's known place is still the sign they scanned, in the Emergency
  // Centre, and that is the map that opens: the right way up,
  await expect(map).toHaveAttribute('data-zone', 'emergency-centre');
  await expect(canvas).toHaveAttribute('data-camera-bearing', /^-?0\.0000$/);
  await expect.poll(() => shownLabels(page), { timeout: 15_000 }).toContain('Triage');
  // and fitted to the room the map has once the trip's sheet has gone, which
  // is the view the check-in opened on. Fitted under the sheet, as it was at
  // first, it came out a third closer in and cropped at the sides.
  await expect
    .poll(async () => {
      const scale = Number(await canvas.getAttribute('data-camera-scale'));
      return Math.abs(scale - home) / home;
    })
    .toBeLessThan(0.02);
});
