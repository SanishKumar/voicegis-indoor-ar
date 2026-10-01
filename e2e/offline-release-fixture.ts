import { createHash } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BrowserContext, Page, Worker } from '@playwright/test';
import { expect } from './support';
import {
  collectOfflineEntries,
  renderOfflineWorker,
} from '../scripts/offlineServiceWorkerPlugin.js';

export type TestRelease = { title: string; entryUrl: string; cacheName: string };

/** Changes the actual entry module and its URL, not just the document title.
 * Only the runner's private output directory is mutated; every byte is restored.
 * Tests using this fixture must run serially, as the offline lifecycle command does.
 */
export async function withChangedReleases(
  run: (publish: (version: 1 | 2) => Promise<TestRelease>) => Promise<void>,
) {
  const outDir = process.env.VOICEGIS_SMOKE_OUT_DIR;
  if (!outDir) throw new Error('The isolated public build directory was not provided.');
  const indexPath = path.join(outDir, 'index.html');
  const workerPath = path.join(outDir, 'sw.js');
  const [index, worker] = await Promise.all([
    readFile(indexPath, 'utf8'),
    readFile(workerPath, 'utf8'),
  ]);
  const entryUrl = index.match(/<script[^>]+src="(\/assets\/index-[^/"\s]+\.js)"/)?.[1];
  if (!entryUrl) throw new Error('No public entry module found.');
  const ownedPaths = new Set<string>();
  try {
    await run(async (version) => {
      // A versioned bootstrap imports the real production app. Execution, not
      // an HTML attribute, proves which revision booted, without breaking the
      // shared chunk imports that refer back to the original application module.
      const bytes = `import './${path.posix.basename(entryUrl)}';\ndocument.documentElement.dataset.testRelease = '${version}';\n`;
      const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
      const changedUrl = `/assets/release-entry-${hash}.js`;
      const changedPath = path.resolve(outDir, changedUrl.slice(1));
      if (path.dirname(changedPath) !== path.resolve(outDir, 'assets')) {
        throw new Error('Release fixture must stay inside its isolated assets directory.');
      }
      // Model a whole-site publication: old entry URLs no longer exist online.
      // Active clients must use their verified cache, not leftover server files.
      for (const owned of ownedPaths) await rm(owned, { force: true });
      ownedPaths.add(changedPath);
      const title = `VoiceGIS Indoor Navigation · Test release ${version}`;
      await writeFile(changedPath, bytes);
      await writeFile(
        indexPath,
        index
          .replace(entryUrl, changedUrl)
          .replace(/<title>.*?<\/title>/, `<title>${title}</title>`),
      );
      const entries = await collectOfflineEntries(outDir);
      await writeFile(workerPath, renderOfflineWorker(entries));
      const cacheName = `voicegis-visitor-${createHash('sha256')
        .update(JSON.stringify(entries))
        .digest('hex')
        .slice(0, 24)}`;
      return { title, entryUrl: changedUrl, cacheName };
    });
  } finally {
    await Promise.all([writeFile(indexPath, index), writeFile(workerPath, worker)]);
    for (const owned of ownedPaths) await rm(owned, { force: true });
  }
}

export async function installWaitingRelease(context: BrowserContext, page: Page): Promise<Worker> {
  const candidate = context.waitForEvent('serviceworker');
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration('/');
    if (!registration) throw new Error('No public worker registration exists.');
    await registration.update();
  });
  const worker = await candidate;
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration('/');
        return registration?.waiting?.state ?? null;
      }),
    )
    .toBe('installed');
  return worker;
}

export async function closeClientsAndActivate(worker: Worker, ...pages: Page[]) {
  await Promise.all(pages.map((page) => page.close()));
  // Observe the candidate itself: creating a new client to poll can keep the
  // old release alive. No guessed delay and no skipWaiting shortcut.
  await expect
    .poll(() =>
      worker.evaluate(() => {
        const registration = (self as unknown as ServiceWorkerGlobalScope).registration;
        return { active: registration.active?.state, waiting: registration.waiting !== null };
      }),
    )
    .toEqual({ active: 'activated', waiting: false });
}

export async function expectRelease(page: Page, release: TestRelease, version: 1 | 2) {
  await expect(page).toHaveTitle(release.title);
  await expect(page.locator('html')).toHaveAttribute('data-test-release', String(version));
  await expect(page.locator('.compiled-map')).toBeVisible();
}
