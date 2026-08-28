/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompiledBuildingPackage } from '@voicegis/map-compiler';
import CATALOG from '../../public/venues/catalog.json';
import { calculatePackageContentHash } from '../data/packageLifecycle';
import { ASTERION_PACKAGE } from '../test/venueFixtures';

const cacheMocks = vi.hoisted(() => ({
  cacheAndActivateVenuePackage: vi.fn(),
  loadCachedVenuePackage: vi.fn(async () => null),
  rememberCachedVenuePackage: vi.fn(),
}));
const contractMocks = vi.hoisted(() => ({
  loadVenuePackageFromUrl: vi.fn(),
}));

vi.mock('../data/packageCacheRuntime', () => cacheMocks);
vi.mock('../data/venuePackageContract', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/venuePackageContract')>()),
  loadVenuePackageFromUrl: contractMocks.loadVenuePackageFromUrl,
}));

import { VenueProvider, useVenue } from './VenueContext.jsx';

function verifiedStatus(buildingPackage: CompiledBuildingPackage) {
  return {
    state: 'verified' as const,
    buildingId: buildingPackage.building.id,
    activeHash: buildingPackage.manifest.contentHash,
    previousHash: null,
    detail: 'verified for race test',
  };
}

async function nextAsterionPackage(): Promise<CompiledBuildingPackage> {
  const next: CompiledBuildingPackage = structuredClone(ASTERION_PACKAGE);
  next.building.name = `${next.building.name} v2`;
  next.manifest.contentHash = await calculatePackageContentHash(next);
  return next;
}

describe('VenueProvider cache activation ordering', () => {
  type VenueContextValue = {
    status: { state: string };
    venue: {
      buildingPackage: { building: { id: string }; manifest: { contentHash: string } };
    };
    activateFromUrl: (url: string) => Promise<unknown>;
  };
  let current: VenueContextValue | null = null;
  let asterionV2: CompiledBuildingPackage | null = null;

  function getCurrent(): VenueContextValue {
    if (current === null) {
      throw new Error('Venue context has not rendered yet');
    }
    return current;
  }

  function Probe() {
    // VenueContext is implemented in JavaScript, where createContext(null)
    // cannot expose the provider value shape to this TypeScript-only harness.
    const value = useVenue() as unknown as VenueContextValue;
    current = value;
    return <span data-testid="active-venue">{value.venue?.buildingPackage.building.id}</span>;
  }

  beforeEach(() => {
    current = null;
    asterionV2 = null;
    localStorage.clear();
    window.history.replaceState(null, '', '/#/visitor');
    cacheMocks.cacheAndActivateVenuePackage.mockReset();
    cacheMocks.loadCachedVenuePackage.mockClear();
    cacheMocks.rememberCachedVenuePackage.mockClear();
    contractMocks.loadVenuePackageFromUrl.mockReset();
    contractMocks.loadVenuePackageFromUrl.mockImplementation(async () => ASTERION_PACKAGE);
    cacheMocks.cacheAndActivateVenuePackage.mockImplementation(async (buildingPackage) =>
      verifiedStatus(buildingPackage),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const value = url.includes('catalog.json')
          ? CATALOG
          : url.includes('asterion-v2') && asterionV2 !== null
            ? asterionV2
            : ASTERION_PACKAGE;
        return new Response(JSON.stringify(value), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('serializes overlapping releases of one building so the newest cache commit is last', async () => {
    render(
      <VenueProvider>
        <Probe />
      </VenueProvider>,
    );
    await waitFor(() => expect(getCurrent().status.state).toBe('ready'));
    asterionV2 = await nextAsterionPackage();

    cacheMocks.cacheAndActivateVenuePackage.mockReset();
    cacheMocks.rememberCachedVenuePackage.mockClear();
    let markV2Loaded!: () => void;
    const v2Loaded = new Promise<void>((resolve) => {
      markV2Loaded = resolve;
    });
    contractMocks.loadVenuePackageFromUrl.mockImplementation(async (url: string) => {
      if (url.includes('asterion-v2')) {
        markV2Loaded();
        return asterionV2!;
      }
      return ASTERION_PACKAGE;
    });
    let releaseV1!: () => void;
    let markV1Started!: () => void;
    const v1Gate = new Promise<void>((resolve) => {
      releaseV1 = resolve;
    });
    const v1Started = new Promise<void>((resolve) => {
      markV1Started = resolve;
    });
    const commits: string[] = [];
    cacheMocks.cacheAndActivateVenuePackage.mockImplementation(async (buildingPackage) => {
      if (buildingPackage.manifest.contentHash === ASTERION_PACKAGE.manifest.contentHash) {
        markV1Started();
        await v1Gate;
      }
      commits.push(buildingPackage.manifest.contentHash);
      return verifiedStatus(buildingPackage);
    });

    let v1Activation!: Promise<unknown>;
    act(() => {
      v1Activation = getCurrent().activateFromUrl('/race/asterion-v1.package.json');
    });
    await v1Started;

    let v2Activation!: Promise<unknown>;
    act(() => {
      v2Activation = getCurrent().activateFromUrl('/race/asterion-v2.package.json');
    });
    await v2Loaded;
    await act(async () => {
      await Promise.resolve();
    });

    // The newer release has been fetched, but its storage mutation must wait
    // behind the already-running v1 transaction. Removing the queue wiring
    // makes this two calls and ultimately commits v1 last for the same key.
    expect(cacheMocks.cacheAndActivateVenuePackage).toHaveBeenCalledTimes(1);
    releaseV1();
    await act(async () => {
      await Promise.all([v1Activation, v2Activation]);
    });

    expect(commits).toEqual([
      ASTERION_PACKAGE.manifest.contentHash,
      asterionV2.manifest.contentHash,
    ]);
    expect(getCurrent().venue.buildingPackage.building.id).toBe(ASTERION_PACKAGE.building.id);
    expect(getCurrent().venue.buildingPackage.manifest.contentHash).toBe(
      asterionV2.manifest.contentHash,
    );
    expect(cacheMocks.rememberCachedVenuePackage).toHaveBeenCalledOnce();
    expect(cacheMocks.rememberCachedVenuePackage).toHaveBeenCalledWith(
      expect.objectContaining({
        building: expect.objectContaining({ id: ASTERION_PACKAGE.building.id }),
        manifest: expect.objectContaining({ contentHash: asterionV2.manifest.contentHash }),
      }),
      '/race/asterion-v2.package.json',
      false,
    );
  });
});
