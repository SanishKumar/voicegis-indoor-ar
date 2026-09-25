import { expect, precompleteOnboarding, test } from './support';

/*
 * A project site such as GitHub Pages serves the app under a sub-path on an
 * origin it shares with the owner's other sites. Run by
 * `node scripts/runBrowserSmoke.js --public-build --base=/voicegis-indoor-ar/`;
 * playwright.config.ts leaves it out of every run served from the root.
 */
const base = process.env.VOICEGIS_SMOKE_BASE ?? '/';

test('the visitor build boots, installs and reopens offline from a sub-path', async ({
  context,
  page,
}) => {
  const outside: string[] = [];
  context.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin === 'http://127.0.0.1:4187' && !url.pathname.startsWith(base))
      outside.push(url.pathname);
  });

  await precompleteOnboarding(page);
  await page.goto(`${base}#/visitor`);
  await expect(page.locator('.compiled-map')).toBeVisible();
  const status = page.locator('.status-offline');
  await expect(status).toHaveAttribute('data-offline-state', 'available');

  // The worker owns this site only, not the origin it shares with others.
  const scope = await page.evaluate(
    async () => (await navigator.serviceWorker.getRegistration())?.scope ?? null,
  );
  expect(scope).not.toBeNull();
  expect(new URL(scope!).pathname).toBe(base);
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);

  const session = await context.newCDPSession(page);
  try {
    const manifest = await session.send('Page.getAppManifest');
    expect(manifest.errors).toEqual([]);
    const installability = await session.send('Page.getInstallabilityErrors');
    expect(installability.installabilityErrors).toEqual([]);
    await session.send('Network.clearBrowserCache');
  } finally {
    await session.detach();
  }

  // A check-in link opened with no network still reaches the venue.
  await context.setOffline(true);
  const offline = await context.newPage();
  await offline.goto(`${base}?checkin=not-a-real-code#/visitor`);
  await expect(offline.locator('.compiled-map')).toBeVisible();
  await context.setOffline(false);

  expect(outside).toEqual([]);
});
