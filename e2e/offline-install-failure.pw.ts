import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, precompleteOnboarding, test } from './support';
import {
  closeClientsAndActivate,
  expectRelease,
  installWaitingRelease,
  withChangedReleases,
} from './offline-release-fixture';
import {
  collectOfflineEntries,
  renderOfflineWorker,
} from '../scripts/offlineServiceWorkerPlugin.js';

test('a failed first precache install settles online-only instead of preparing forever', async ({
  page,
}) => {
  const outDir = process.env.VOICEGIS_SMOKE_OUT_DIR;
  if (!outDir) throw new Error('The isolated public build directory was not provided.');
  const manifestPath = path.join(outDir, 'manifest.webmanifest');
  const original = await readFile(manifestPath);

  // Keep the response valid JSON so the only failure under test is the
  // generated worker's exact-revision check.
  await writeFile(manifestPath, '{"name":"bytes from another release"}\n');
  try {
    await precompleteOnboarding(page);
    await page.goto('/#/visitor');
    await expect(page.locator('.compiled-map')).toBeVisible();

    const status = page.locator('.status-offline');
    await expect(status).toBeVisible();
    await expect(status).toHaveAttribute('data-offline-state', 'online-only');
    await expect(status).toContainText('Online only');
    await expect
      .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
      .toBe(false);
  } finally {
    await writeFile(manifestPath, original);
  }
});

test('an active release stays coherent while a complete update waits and a later update fails', async ({
  allowBrowserError,
  context,
  page,
}) => {
  const outDir = process.env.VOICEGIS_SMOKE_OUT_DIR;
  if (!outDir) throw new Error('The isolated public build directory was not provided.');
  const indexPath = path.join(outDir, 'index.html');
  const manifestPath = path.join(outDir, 'manifest.webmanifest');
  const catalogPath = path.join(outDir, 'venues', 'catalog.json');
  const workerPath = path.join(outDir, 'sw.js');
  const [v1Index, v1Manifest, v1Catalog, v1Worker] = await Promise.all([
    readFile(indexPath, 'utf8'),
    readFile(manifestPath, 'utf8'),
    readFile(catalogPath, 'utf8'),
    readFile(workerPath, 'utf8'),
  ]);
  const v1Title = 'VoiceGIS Indoor Navigation';
  const v2Title = 'VoiceGIS Indoor Navigation · Release 2';
  const v2Index = v1Index.replace(`<title>${v1Title}</title>`, `<title>${v2Title}</title>`);
  const v2Manifest = `${JSON.stringify({ ...JSON.parse(v1Manifest), short_name: 'VoiceGIS v2' })}\n`;
  const v2Catalog = `${v1Catalog}\n`;

  try {
    await precompleteOnboarding(page);
    await page.goto('/#/visitor');
    await expect(page.locator('.compiled-map')).toBeVisible();
    await expect(page.locator('.status-offline')).toHaveAttribute(
      'data-offline-state',
      'available',
    );
    await expect(page).toHaveTitle(v1Title);

    await writeFile(indexPath, v2Index);
    await writeFile(manifestPath, v2Manifest);
    await writeFile(catalogPath, v2Catalog);
    const v2Worker = renderOfflineWorker(await collectOfflineEntries(outDir));
    await writeFile(workerPath, v2Worker);
    const candidate = await installWaitingRelease(context, page);

    // The new bytes exist on the server, but this client is still controlled
    // by v1. Its navigation and data reads must remain one cached revision.
    await page.reload();
    await expect(page).toHaveTitle(v1Title);
    await expect
      .poll(() => page.evaluate(() => fetch('/manifest.webmanifest').then((r) => r.text())))
      .toBe(v1Manifest);

    // Storage can be evicted after the earlier completeness handshake. With
    // v2 already on the server, a v1 cache miss must fail instead of returning
    // v2 bytes through v1's fetch handler.
    await page.evaluate(async (expectedTitle) => {
      for (const name of await caches.keys()) {
        if (!name.startsWith('voicegis-visitor-')) continue;
        const cache = await caches.open(name);
        const shell = await cache.match('/index.html');
        if (!shell || !(await shell.text()).includes(`<title>${expectedTitle}</title>`)) continue;
        await Promise.all([cache.delete('/index.html'), cache.delete('/venues/catalog.json')]);
        return;
      }
      throw new Error('The active release-1 cache was not found.');
    }, v1Title);
    allowBrowserError(/Failed to load resource.*index\.html/);
    allowBrowserError(/Failed to load resource.*venues\/catalog\.json/);
    const missResults = await page.evaluate(async () =>
      Promise.all(
        ['/index.html', '/venues/catalog.json'].map(async (url) => {
          try {
            return await fetch(url).then((response) => response.text());
          } catch {
            return 'refused';
          }
        }),
      ),
    );
    expect(missResults).toEqual(['refused', 'refused']);

    await closeClientsAndActivate(candidate, page);
    const v2Page = await context.newPage();
    await precompleteOnboarding(v2Page);
    await v2Page.goto('/#/visitor');
    await expect(v2Page).toHaveTitle(v2Title);
    await expect
      .poll(() => v2Page.evaluate(() => fetch('/manifest.webmanifest').then((r) => r.text())))
      .toBe(v2Manifest);

    // Make the worker script a new version while serving manifest bytes that
    // do not match the revisions embedded in it. Installation must become
    // redundant and leave the active v2 worker and its complete cache intact.
    await writeFile(manifestPath, '{"name":"incomplete release 3"}\n');
    await writeFile(workerPath, `${v2Worker}\n/* release 3 update probe */\n`);
    const failedState = await v2Page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration('/');
      if (!registration) throw new Error('No public worker registration exists.');
      return new Promise<string>((resolve) => {
        const candidate = { current: null as ServiceWorker | null };
        let settled = false;
        const finish = (state: string) => {
          if (settled) return;
          settled = true;
          resolve(state);
        };
        registration.addEventListener(
          'updatefound',
          () => {
            candidate.current = registration.installing;
            candidate.current?.addEventListener('statechange', () => {
              if (candidate.current?.state === 'redundant') finish('redundant');
            });
          },
          { once: true },
        );
        void registration.update().then(
          () => {
            if (candidate.current?.state === 'redundant') finish('redundant');
          },
          () => finish('update-rejected'),
        );
        window.setTimeout(() => finish(candidate.current?.state ?? 'no-candidate'), 10_000);
      });
    });
    expect(failedState).toBe('redundant');

    await v2Page.reload();
    await expect(v2Page).toHaveTitle(v2Title);
    await expect
      .poll(() => v2Page.evaluate(() => fetch('/manifest.webmanifest').then((r) => r.text())))
      .toBe(v2Manifest);
  } finally {
    await Promise.all([
      writeFile(indexPath, v1Index),
      writeFile(manifestPath, v1Manifest),
      writeFile(catalogPath, v1Catalog),
      writeFile(workerPath, v1Worker),
    ]);
  }
});

test('changed JavaScript waits for every tab, boots offline, and rolls back as another complete release', async ({
  context,
  page,
}) => {
  await withChangedReleases(async (publish) => {
    const v1 = await publish(1);
    await precompleteOnboarding(page);
    await page.goto('/#/visitor');
    await expectRelease(page, v1, 1);
    await expect(page.locator('.status-offline')).toHaveAttribute(
      'data-offline-state',
      'available',
    );
    const second = await context.newPage();
    await second.goto('/#/visitor');
    await expectRelease(second, v1, 1);

    const v2 = await publish(2);
    expect(v2.entryUrl).not.toBe(v1.entryUrl);
    const upgrade = await installWaitingRelease(context, page);
    await page.reload();
    await second.reload();
    await expectRelease(page, v1, 1);
    await expectRelease(second, v1, 1);
    await page.close();
    // Closing one tab is not enough. Even a newly opened tab stays on v1
    // while the second tab still holds the old worker alive.
    const third = await context.newPage();
    await third.goto('/#/visitor');
    await expectRelease(third, v1, 1);
    await expect
      .poll(() =>
        second.evaluate(
          async () => (await navigator.serviceWorker.getRegistration('/'))?.waiting?.state,
        ),
      )
      .toBe('installed');

    const cdp = await context.newCDPSession(second);
    await cdp.send('Network.clearBrowserCache');
    await cdp.detach();
    await context.setOffline(true);
    await closeClientsAndActivate(upgrade, second, third);
    const upgraded = await context.newPage();
    const entryResponses: boolean[] = [];
    upgraded.on('response', (response) => {
      if (new URL(response.url()).pathname === v2.entryUrl) {
        entryResponses.push(response.fromServiceWorker());
      }
    });
    await upgraded.goto('/#/visitor');
    await expectRelease(upgraded, v2, 2);
    await expect(upgraded.locator('.status-offline')).toHaveAttribute(
      'data-offline-state',
      'available',
    );
    expect(entryResponses).toEqual([true]);
    expect(await upgraded.evaluate(() => caches.keys())).toEqual([v2.cacheName]);

    await context.setOffline(false);
    // Operational rollback means republishing the earlier complete artifact,
    // not reviving an obsolete worker or mixing its files with release 2.
    expect(await publish(1)).toEqual(v1);
    const rollback = await installWaitingRelease(context, upgraded);
    const held = await context.newPage();
    await held.goto('/#/visitor');
    await expectRelease(held, v2, 2);
    await closeClientsAndActivate(rollback, upgraded, held);
    await context.setOffline(true);
    const restored = await context.newPage();
    await restored.goto('/#/visitor');
    await expectRelease(restored, v1, 1);
    await expect(restored.locator('.status-offline')).toHaveAttribute(
      'data-offline-state',
      'available',
    );
    expect(await restored.evaluate(() => caches.keys())).toEqual([v1.cacheName]);
  });
});

test('eviction while an update waits retains earlier cache bytes and requires exact-release repair', async ({
  context,
  page,
}) => {
  await withChangedReleases(async (publish) => {
    const v1 = await publish(1);
    await precompleteOnboarding(page);
    await page.goto('/#/visitor');
    await expectRelease(page, v1, 1);
    await expect(page.locator('.status-offline')).toHaveAttribute(
      'data-offline-state',
      'available',
    );
    const v2 = await publish(2);
    const candidate = await installWaitingRelease(context, page);
    // Leave the shell runnable but evict a deferred module after installation.
    // This reproduces storage loss during a long wait for other tabs to close.
    const missingUrl = await page.evaluate(async (cacheName) => {
      const cache = await caches.open(cacheName);
      const requests = await cache.keys();
      const entry = requests.find(({ url }) =>
        /\/assets\/CameraPreview-[^/]+\.js$/.test(new URL(url).pathname),
      );
      if (!entry) throw new Error('No deferred camera module in the waiting cache.');
      if (!(await cache.delete(entry))) throw new Error('Waiting cache eviction failed.');
      return entry.url;
    }, v2.cacheName);
    await context.setOffline(true);
    await closeClientsAndActivate(candidate, page);
    const incomplete = await context.newPage();
    await incomplete.goto('/#/visitor');
    await expectRelease(incomplete, v2, 2);
    await expect(incomplete.locator('.status-offline')).toHaveAttribute(
      'data-offline-state',
      'online-only',
    );
    expect(await incomplete.evaluate(() => caches.keys())).toEqual(
      expect.arrayContaining([v1.cacheName, v2.cacheName]),
    );

    // Wrong server bytes cannot repair release 2. Reporting online-only remains
    // correct even if all files for a different, otherwise valid release exist.
    const outDir = process.env.VOICEGIS_SMOKE_OUT_DIR!;
    const missingPath = path.join(outDir, new URL(missingUrl).pathname.slice(1));
    const exactBytes = await readFile(missingPath);
    try {
      await writeFile(missingPath, '/* bytes from a different release */');
      await context.setOffline(false);
      const repaired = await incomplete.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration('/');
        const worker = registration?.active;
        if (!worker) throw new Error('No active worker.');
        return new Promise<boolean>((resolve) => {
          const channel = new MessageChannel();
          channel.port1.onmessage = (event) => {
            channel.port1.close();
            resolve(event.data.complete);
          };
          worker.postMessage({ type: 'voicegis:verify-offline-cache' }, [channel.port2]);
        });
      });
      expect(repaired).toBe(false);
      expect(
        await incomplete.evaluate(
          async ({ cacheName, url }) => Boolean(await (await caches.open(cacheName)).match(url)),
          { cacheName: v2.cacheName, url: missingUrl },
        ),
      ).toBe(false);
    } finally {
      await writeFile(missingPath, exactBytes);
    }
    await incomplete.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(incomplete.locator('.status-offline')).toHaveAttribute(
      'data-offline-state',
      'available',
    );
    const cdp = await context.newCDPSession(incomplete);
    await cdp.send('Network.clearBrowserCache');
    await cdp.detach();
    await incomplete.close();
    await context.setOffline(true);
    const recovered = await context.newPage();
    await recovered.goto('/#/visitor');
    await expectRelease(recovered, v2, 2);
    await expect(recovered.locator('.status-offline')).toHaveAttribute(
      'data-offline-state',
      'available',
    );
    expect(await recovered.evaluate(async (url) => (await fetch(url)).ok, missingUrl)).toBe(true);
  });
});
