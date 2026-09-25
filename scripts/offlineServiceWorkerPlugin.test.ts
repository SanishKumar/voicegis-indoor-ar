import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertVisitorOnlyBundle,
  collectOfflineEntries,
  operatorModulesIn,
  renderOfflineWorker,
} from './offlineServiceWorkerPlugin.js';

const temporaryDirectories: string[] = [];

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'voicegis-offline-plugin-'));
  temporaryDirectories.push(root);
  await mkdir(path.join(root, 'assets'));
  await mkdir(path.join(root, 'venues'));
  await Promise.all([
    writeFile(path.join(root, 'index.html'), '<main>visitor</main>'),
    writeFile(path.join(root, 'favicon.svg'), '<svg/>'),
    writeFile(path.join(root, 'manifest.webmanifest'), '{}'),
    writeFile(path.join(root, 'check-in-codes.html'), 'operator print sheet'),
    writeFile(path.join(root, 'assets', 'index-hash.js'), 'console.log("visitor")'),
    writeFile(path.join(root, 'assets', 'index-hash.js.map'), '{}'),
    writeFile(path.join(root, 'venues', 'catalog.json'), '{}'),
    writeFile(path.join(root, 'venues', 'venue.package.json'), '{}'),
  ]);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('public offline build', () => {
  it('precaches the visitor shell and venues but not maps, print sheets, or itself', async () => {
    const root = await fixture();
    const entries = await collectOfflineEntries(root);
    const urls = entries.map(({ url }) => url);

    expect(urls).toEqual([
      '/assets/index-hash.js',
      '/favicon.svg',
      '/index.html',
      '/manifest.webmanifest',
      '/venues/catalog.json',
      '/venues/venue.package.json',
    ]);
  });

  it('changes the cache revision when bytes change and leaves updates waiting', async () => {
    const root = await fixture();
    const firstEntries = await collectOfflineEntries(root);
    const firstWorker = renderOfflineWorker(firstEntries);
    await writeFile(path.join(root, 'assets', 'index-hash.js'), 'console.log("changed")');
    const secondWorker = renderOfflineWorker(await collectOfflineEntries(root));

    expect(secondWorker).not.toBe(firstWorker);
    expect(firstWorker).toContain("request.mode === 'navigate'");
    expect(firstWorker).toContain('navigationResponse()');
    expect(firstWorker).toContain('const INDEX_PATH = "/index.html";');
    expect(firstWorker).toContain('PRECACHE_BY_PATH.get(INDEX_PATH)');
    expect(firstWorker).toContain('return verifiedResponse');
    expect(firstWorker).toContain('self.clients.claim()');
    expect(firstWorker).toContain("event.data?.type !== 'voicegis:verify-offline-cache'");
    expect(firstWorker).toContain('await cacheVerifiedEntries(cache, missing)');
    expect(firstWorker).toContain("crypto.subtle.digest('SHA-256'");
    expect(firstWorker).not.toContain('skipWaiting');
    expect(firstWorker).not.toContain("cache.put('/venues/");
  });

  it('serves a project site from under its base, and nothing outside it', async () => {
    const base = '/voicegis-indoor-ar/';
    const entries = await collectOfflineEntries(await fixture(), base);
    expect(entries.map(({ url }) => url)).toEqual([
      `${base}assets/index-hash.js`,
      `${base}favicon.svg`,
      `${base}index.html`,
      `${base}manifest.webmanifest`,
      `${base}venues/catalog.json`,
      `${base}venues/venue.package.json`,
    ]);

    const listeners = new Map<string, (event: unknown) => void>();
    const shell = new Response('<main>visitor</main>');
    const catalog = new Response('{}');
    const cachedResponses = new Map([
      [`${base}index.html`, shell],
      [`${base}venues/catalog.json`, catalog],
    ]);
    const match = vi.fn(async (url: string) => cachedResponses.get(url));
    const networkFetch = vi.fn(async () => new Response('network'));
    runInNewContext(renderOfflineWorker(entries, base), {
      caches: { keys: vi.fn(async () => []), open: vi.fn(async () => ({ match, put: vi.fn() })) },
      crypto: globalThis.crypto,
      fetch: networkFetch,
      self: {
        clients: { claim: vi.fn(async () => undefined) },
        location: { origin: 'https://owner.github.io' },
        addEventListener(type: string, listener: (event: unknown) => void) {
          listeners.set(type, listener);
        },
      },
      Set,
      Map,
      Uint8Array,
      URL,
    });
    const answered = (url: string, mode = 'cors') => {
      let response: Promise<unknown> | undefined;
      listeners.get('fetch')?.({
        request: { method: 'GET', mode, url },
        respondWith(result: Promise<unknown>) {
          response = result;
        },
      });
      return response;
    };

    // A check-in link opens the cached shell of this site, not the domain's.
    await expect(
      answered('https://owner.github.io/voicegis-indoor-ar/?checkin=abc', 'navigate'),
    ).resolves.toBe(shell);
    expect(match).toHaveBeenCalledWith(`${base}index.html`);
    await expect(answered(`https://owner.github.io${base}venues/catalog.json`)).resolves.toBe(
      catalog,
    );
    expect(networkFetch).not.toHaveBeenCalled();
    // A missing package cannot be repaired with bytes from another build.
    await expect(
      answered(`https://owner.github.io${base}venues/venue.package.json`),
    ).rejects.toThrow('Offline asset did not match its build revision');
    // Another site on the same origin keeps its own files.
    expect(answered('https://owner.github.io/venues/catalog.json')).toBeUndefined();
  });

  it('keeps an active v1 navigation on the cached v1 shell while v2 is on the network', async () => {
    const listeners = new Map<string, (event: unknown) => void>();
    const v1Bytes = '<title>release 1</title>';
    const v1Shell = new Response(v1Bytes);
    const v2Shell = { release: 'v2-network-shell' };
    const match = vi.fn(async (url: string) => (url === '/index.html' ? v1Shell : undefined));
    const open = vi.fn(async () => ({ match }));
    const networkFetch = vi.fn(async () => v2Shell);
    const entries = [
      {
        url: '/index.html',
        revision: createHash('sha256').update(v1Bytes).digest('hex'),
      },
    ];

    runInNewContext(renderOfflineWorker(entries), {
      caches: {
        keys: vi.fn(async () => []),
        open,
      },
      crypto: globalThis.crypto,
      fetch: networkFetch,
      self: {
        clients: { claim: vi.fn(async () => undefined) },
        location: { origin: 'https://visitor.example' },
        addEventListener(type: string, listener: (event: unknown) => void) {
          listeners.set(type, listener);
        },
      },
      Set,
      Map,
      Uint8Array,
      URL,
    });

    const fetchListener = listeners.get('fetch');
    expect(fetchListener).toBeTypeOf('function');
    let response: Promise<unknown> | undefined;
    fetchListener?.({
      request: {
        method: 'GET',
        mode: 'navigate',
        url: 'https://visitor.example/destination/clinic',
      },
      respondWith(result: Promise<unknown>) {
        response = result;
      },
    });

    await expect(response).resolves.toBe(v1Shell);
    expect(open).toHaveBeenCalledOnce();
    expect(match).toHaveBeenCalledWith('/index.html');
    expect(networkFetch).not.toHaveBeenCalled();
  });

  it('refuses a newer network shell when the active release has lost its cached shell', async () => {
    const listeners = new Map<string, (event: unknown) => void>();
    const v2Shell = new Response('<title>release 2</title>');
    const match = vi.fn(async () => undefined);
    const networkFetch = vi.fn(async () => v2Shell);
    const entries = [{ url: '/index.html', revision: 'a'.repeat(64) }];

    runInNewContext(renderOfflineWorker(entries), {
      caches: {
        keys: vi.fn(async () => []),
        open: vi.fn(async () => ({ match, put: vi.fn() })),
      },
      crypto: globalThis.crypto,
      fetch: networkFetch,
      self: {
        clients: { claim: vi.fn(async () => undefined) },
        location: { origin: 'https://visitor.example' },
        addEventListener(type: string, listener: (event: unknown) => void) {
          listeners.set(type, listener);
        },
      },
      Map,
      Set,
      Uint8Array,
      URL,
    });

    let response: Promise<unknown> | undefined;
    listeners.get('fetch')?.({
      request: {
        method: 'GET',
        mode: 'navigate',
        url: 'https://visitor.example/destination/clinic',
      },
      respondWith(result: Promise<unknown>) {
        response = result;
      },
    });

    await expect(response).rejects.toThrow('Offline asset did not match its build revision');
    expect(networkFetch).toHaveBeenCalledWith('/index.html', { cache: 'no-cache' });
  });

  it('fails the public build if an operator entry graph leaks into it', async () => {
    const root = await fixture();
    await expect(assertVisitorOnlyBundle(root)).resolves.toBeUndefined();
    await writeFile(
      path.join(root, 'assets', 'operator.js'),
      'export const title = "BuildingSource workspace";',
    );

    await expect(assertVisitorOnlyBundle(root)).rejects.toThrow(
      'Public build contains operator-only markers',
    );
    expect(
      operatorModulesIn([
        'D:\\repo\\src\\components\\SpatialTwinViewer.tsx',
        'D:\\repo\\src\\components\\SessionHarness.tsx',
        'D:\\repo\\src\\navigation\\prepareDiagnosticSession.ts',
        'D:\\repo\\src\\capture\\liveHandsetInput.ts',
        'D:\\repo\\src\\sensors\\handsetSubscription.ts',
        'D:\\repo\\src\\components\\VisitorApp.jsx',
      ]),
    ).toEqual([
      'D:/repo/src/components/SpatialTwinViewer.tsx',
      'D:/repo/src/components/SessionHarness.tsx',
      'D:/repo/src/navigation/prepareDiagnosticSession.ts',
      'D:/repo/src/capture/liveHandsetInput.ts',
      // src/sensors/handsetSubscription.ts is deliberately absent. The visitor
      // tracker asks the browser for motion through the same consent-correct
      // subscription the operator harness uses, and a second copy of it would
      // drift exactly where it is hardest to test. What this list guards is
      // the evidence pipeline and the operator surfaces, not sensor plumbing.
    ]);
  });
});
