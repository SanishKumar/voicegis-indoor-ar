import { expect, expectCenterHitTarget, openPharmacyRoute, test } from './support';

test('the routing worker qualifies the authored envelope and 2D/3D keep the same route', async ({
  page,
}) => {
  await openPharmacyRoute(page);
  const map = page.locator('.compiled-map');
  const canvas = page.locator('.compiled-map-canvas');
  await expect(map).toHaveAttribute('data-route-clearance', 'checked');
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-route-segments')))
    .toBeGreaterThan(0);
  const segments = await canvas.getAttribute('data-route-segments');
  await page.getByRole('button', { name: '3D model', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-camera-mode', '3d');
  await expect(canvas).toHaveAttribute('data-route-segments', segments!);
  await page.getByRole('button', { name: '2D plan', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-camera-mode', '2d');
  await expect(map).toHaveAttribute('data-route-clearance', 'checked');
});

test('a width failure withholds actual map tubes and camera graphics but leaves usable written directions', async ({
  page,
}) => {
  // Inject one worker-result width failure. Geometry algorithms are exercised
  // on narrow-door/notch fixtures in unit tests; this checks the UI contract.
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener('message', (event) => {
          const result = event.data?.result;
          if (result?.found && result.displayClearance) {
            result.displayClearance = {
              ...result.displayClearance,
              status: 'withheld',
              issues: [{ code: 'insufficient-clearance', sourceId: 'test-narrow-door' }],
            };
          }
        });
      }
    };
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: async () => new MediaStream(),
    });
    Object.defineProperty(navigator, 'xr', {
      value: {
        isSessionSupported: async () => true,
        requestSession: async () => {
          throw new Error('Withheld route must not request AR');
        },
      },
    });
  });
  await openPharmacyRoute(page);
  await page.locator('.checkin-toast').getByRole('button', { name: 'Dismiss' }).click();
  const map = page.locator('.compiled-map');
  await expect(map).toHaveAttribute('data-route-clearance', 'withheld');
  await expect(page.locator('.compiled-map-canvas')).toHaveAttribute('data-route-segments', '0');
  await expect(page.getByRole('status').filter({ hasText: 'Route graphics hidden' })).toContainText(
    'Written directions remain available',
  );
  const instruction = await page.locator('.jr-banner-text').innerText();
  await page.getByRole('button', { name: '3D model', exact: true }).click();
  await expect(page.locator('.compiled-map-canvas')).toHaveAttribute('data-route-segments', '0');
  await page.getByRole('button', { name: 'Camera view' }).click();
  const camera = page.locator('.camera-preview');
  await expect(camera).toHaveAttribute('data-route-clearance', 'withheld');
  await expect(camera).toHaveAttribute('data-ribbon', '0');
  await expect(page.getByRole('button', { name: 'Start AR', exact: true })).toBeDisabled();
  await expect(page.getByRole('status').filter({ hasText: 'Route graphics hidden' })).toContainText(
    'mapped walls or openings',
  );
  await expect(page.locator('.ar-sheet-instruction')).toHaveText(instruction);
  const exit = page.getByRole('button', { name: 'Exit to plan' });
  await expectCenterHitTarget(exit);
  await exit.click();
  await expect(map).toHaveAttribute('data-route-clearance', 'withheld');
  await expect(page.getByRole('button', { name: 'Next instruction' })).toBeEnabled();
  await page.getByRole('button', { name: 'End route' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Route graphics hidden' })).toHaveCount(
    0,
  );
});
