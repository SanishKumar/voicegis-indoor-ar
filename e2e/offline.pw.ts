import type { BrowserContext, Page } from '@playwright/test';
import { expect, precompleteOnboarding, test } from './support';

async function expectOfflineReady(page: Page) {
  const status = page.locator('.status-offline');
  await expect(status).toBeVisible();
  await expect(status).toHaveAttribute('data-offline-state', 'available');
  await expect(status).toContainText(/Offline ready|Working offline/);
}

async function warmOfflineInstall(page: Page, url = '/#/visitor') {
  await precompleteOnboarding(page);
  await page.goto(url);
  await expect(page.locator('.compiled-map')).toBeVisible();
  await expectOfflineReady(page);
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('voicegis_offline_active_venue')))
    .not.toBeNull();
}

async function clearHttpCache(context: BrowserContext, page: Page) {
  const session = await context.newCDPSession(page);
  try {
    await session.send('Network.clearBrowserCache');
  } finally {
    await session.detach();
  }
}

async function removeCachedVenueResponses(page: import('@playwright/test').Page) {
  await page.evaluate(async () => {
    for (const name of await caches.keys()) {
      if (!name.startsWith('voicegis-visitor-')) continue;
      const cache = await caches.open(name);
      const requests = await cache.keys();
      await Promise.all(
        requests
          .filter(({ url }) => {
            const path = new URL(url).pathname;
            return path === '/venues/catalog.json' || path.endsWith('.package.json');
          })
          .map((request) => cache.delete(request)),
      );
    }
  });
}

async function swapInSelfConsistentForeignPackage(page: import('@playwright/test').Page) {
  await page.evaluate(async () => {
    const harborPackage = await fetch('/venues/harbor-exchange.package.json').then((response) =>
      response.json(),
    );
    const pointer = JSON.parse(localStorage.getItem('voicegis_offline_active_venue') ?? 'null');
    if (pointer === null) throw new Error('No active offline venue pointer was stored.');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('voicegis-building-packages', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction('packages', 'readwrite');
        const store = transaction.objectStore('packages');
        const key = `${pointer.buildingId}:${pointer.contentHash}`;
        const get = store.get(key);
        get.onsuccess = () => {
          const record = get.result;
          record.buildingPackage = harborPackage;
          store.put(record);
        };
        get.onerror = () => reject(get.error);
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
        transaction.onerror = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  });
}

test('the deployable shell contains no operator route, even when its hash is guessed', async ({
  context,
  page,
}) => {
  await warmOfflineInstall(page, '/#/studio');

  await expect(page.locator('.compiled-map')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Operator tools' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'BuildingSource workspace' })).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    )
    .toBe(true);

  const session = await context.newCDPSession(page);
  try {
    const manifest = await session.send('Page.getAppManifest');
    expect(manifest.errors).toEqual([]);
    const installability = await session.send('Page.getInstallabilityErrors');
    expect(installability.installabilityErrors).toEqual([]);
  } finally {
    await session.detach();
  }

  await page.setViewportSize({ width: 320, height: 640 });
  const readiness = page.locator('.status-offline');
  await expect(readiness).toBeVisible();
  expect(
    await readiness.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const label = element.querySelector('span');
      return {
        inside: bounds.left >= 0 && bounds.right <= window.innerWidth,
        labelVisible: label !== null && getComputedStyle(label).display !== 'none',
        labelClipped: label !== null && label.scrollWidth > label.clientWidth,
      };
    }),
  ).toEqual({ inside: true, labelVisible: true, labelClipped: false });
});

test('a fresh page can check in and route after the connection is removed', async ({
  context,
  page,
}) => {
  await warmOfflineInstall(page);
  await clearHttpCache(context, page);
  await page.close();
  await context.setOffline(true);

  const offlinePage = await context.newPage();
  const serviceWorkerResources = { document: false, script: false };
  offlinePage.on('response', (response) => {
    const type = response.request().resourceType();
    if ((type === 'document' || type === 'script') && response.fromServiceWorker()) {
      serviceWorkerResources[type] = true;
    }
  });
  const payload = encodeURIComponent('voicegis://asterion/l2/east');
  await offlinePage.goto(`/?checkin=${payload}#/visitor`);
  await expect(offlinePage.locator('.compiled-map')).toBeVisible();
  await expect(offlinePage.locator('.checkin-toast')).toContainText(
    'Checked in at Family Care Concourse',
  );
  await expectOfflineReady(offlinePage);
  expect(serviceWorkerResources).toEqual({ document: true, script: true });

  // This is a real map interaction, not just proof that the cached shell
  // rendered. Switch away from the checked-in floor and confirm the viewer
  // state follows before opening the mobile directions sheet.
  await offlinePage.getByRole('button', { name: 'Show Level 3 · Research & Learning' }).click();
  await expect(
    offlinePage.getByRole('button', { name: 'Show Level 3 · Research & Learning' }),
  ).toHaveAttribute('aria-pressed', 'true');

  await offlinePage
    .getByRole('button', { name: 'Search rooms and departments', exact: true })
    .click();
  await offlinePage
    .getByRole('textbox', { name: 'Search rooms and departments' })
    .fill('Outpatient Pharmacy');
  await offlinePage.getByRole('button', { name: 'Navigate to Outpatient Pharmacy' }).click();
  await expect(offlinePage.getByLabel('Fastest available route')).toBeVisible();
});

test('evicted precache bytes are reported unavailable and repaired only from exact build bytes', async ({
  context,
  page,
}) => {
  await warmOfflineInstall(page);
  await page.evaluate(async () => {
    await Promise.all(
      (await caches.keys())
        .filter((name) => name.startsWith('voicegis-visitor-'))
        .map((name) => caches.delete(name)),
    );
  });

  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  const status = page.locator('.status-offline');
  await expect(status).toBeVisible();
  await expect(status).toHaveAttribute('data-offline-state', 'online-only');
  await expect(status).toContainText('No connection');

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expectOfflineReady(page);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const names = (await caches.keys()).filter((name) => name.startsWith('voicegis-visitor-'));
        if (names.length !== 1) return 0;
        return (await (await caches.open(names[0])).keys()).length;
      }),
    )
    .toBeGreaterThan(0);
});

test('a cold reload can restore the reverified IndexedDB package without venue responses', async ({
  allowBrowserError,
  context,
  page,
}) => {
  allowBrowserError(/net::ERR_FAILED.*\/venues\/catalog\.json/);
  await warmOfflineInstall(page);
  await removeCachedVenueResponses(page);
  await page.close();
  await context.setOffline(true);

  const offlinePage = await context.newPage();
  await offlinePage.goto('/#/visitor');
  await expect(offlinePage.locator('.compiled-map')).toBeVisible();
  await expect(offlinePage.locator('.visitor-brand-copy')).toContainText(
    'Asterion University Medical Center',
  );
});

test('a self-consistent foreign IndexedDB package is refused when no network copy exists', async ({
  allowBrowserError,
  context,
  page,
}) => {
  allowBrowserError(/net::ERR_FAILED.*\/venues\/catalog\.json/);
  await warmOfflineInstall(page);
  await removeCachedVenueResponses(page);
  await swapInSelfConsistentForeignPackage(page);
  await page.close();
  await context.setOffline(true);

  const offlinePage = await context.newPage();
  await offlinePage.goto('/#/visitor');
  await expect(offlinePage.getByRole('alert')).toContainText("We couldn't load this venue");
  await expect(offlinePage.locator('.compiled-map')).toHaveCount(0);
});

test('an explicitly selected bundled venue survives a cold-offline reload', async ({
  context,
  page,
}) => {
  const harborUrl = '/venues/harbor-exchange.package.json';
  const route = `/?venue=${encodeURIComponent(harborUrl)}#/visitor`;
  await warmOfflineInstall(page, route);
  await expect(page.locator('.visitor-brand-copy')).toContainText('Harbor Exchange');
  await page.close();
  await context.setOffline(true);

  const offlinePage = await context.newPage();
  await offlinePage.goto(route);
  await expect(offlinePage.locator('.compiled-map')).toBeVisible();
  await expect(offlinePage.locator('.visitor-brand-copy')).toContainText('Harbor Exchange');
});
