import type { CompiledBuildingPackage } from '@voicegis/map-compiler';
import { IndexedDbPackageStore, openPackageDatabase } from './indexedDbPackageStore';
import { PackageLifecycle } from './packageLifecycle';

export interface PackageCacheStatus {
  state: 'verified' | 'unavailable' | 'failed';
  buildingId: string | null;
  activeHash: string | null;
  previousHash: string | null;
  detail: string;
}

export interface CachedVenuePointer {
  buildingId: string;
  contentHash: string;
  source: string;
}

const ACTIVE_OFFLINE_VENUE_KEY = 'voicegis_offline_active_venue';
const DEFAULT_OFFLINE_VENUE_KEY = 'voicegis_offline_default_venue';
const SHA256_HEX = /^[a-f0-9]{64}$/;

function pointerKey(asDefault: boolean) {
  return asDefault ? DEFAULT_OFFLINE_VENUE_KEY : ACTIVE_OFFLINE_VENUE_KEY;
}

function decodePointer(value: string | null): CachedVenuePointer | null {
  if (value === null) return null;
  try {
    const candidate: unknown = JSON.parse(value);
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return null;
    }
    const record = candidate as Record<string, unknown>;
    const buildingId = record.buildingId;
    const contentHash = record.contentHash;
    const source = record.source;
    if (
      typeof buildingId !== 'string' ||
      buildingId.length === 0 ||
      typeof source !== 'string' ||
      source.length === 0 ||
      typeof contentHash !== 'string' ||
      !SHA256_HEX.test(contentHash)
    ) {
      return null;
    }
    return {
      buildingId,
      contentHash,
      source,
    };
  } catch {
    return null;
  }
}

export function readCachedVenuePointer(
  asDefault = false,
  storage: Pick<Storage, 'getItem'> | undefined = typeof localStorage === 'undefined'
    ? undefined
    : localStorage,
): CachedVenuePointer | null {
  return decodePointer(storage?.getItem(pointerKey(asDefault)) ?? null);
}

export function rememberCachedVenuePackage(
  buildingPackage: CompiledBuildingPackage,
  source: string,
  asDefault = false,
) {
  if (typeof localStorage === 'undefined') return;
  const pointer = {
    buildingId: buildingPackage.building.id,
    contentHash: buildingPackage.manifest.contentHash,
    source,
  };
  localStorage.setItem(ACTIVE_OFFLINE_VENUE_KEY, JSON.stringify(pointer));
  if (asDefault) localStorage.setItem(DEFAULT_OFFLINE_VENUE_KEY, JSON.stringify(pointer));
}

export interface CachedVenuePackage {
  buildingPackage: CompiledBuildingPackage;
  source: string;
}

/** Reopens and re-verifies the last active package before offline activation. */
export async function loadCachedVenuePackage({
  requiredSource,
  preferDefault = false,
}: {
  requiredSource?: string | null;
  preferDefault?: boolean;
} = {}): Promise<CachedVenuePackage | null> {
  if (typeof indexedDB === 'undefined') return null;
  const pointer = readCachedVenuePointer(preferDefault);
  if (pointer === null || (requiredSource && pointer.source !== requiredSource)) return null;

  let database: IDBDatabase | null = null;
  try {
    database = await openPackageDatabase();
    const lifecycle = new PackageLifecycle(new IndexedDbPackageStore(database));
    // The local pointer names the exact record the runtime last accepted. Do
    // not trust the store's mutable "active" pointer here: a superseded async
    // activation or a crash between IndexedDB and localStorage can leave that
    // metadata one commit ahead or behind without invalidating this record.
    const active = await lifecycle.getInstalled(pointer.buildingId, pointer.contentHash);
    if (active === null) return null;
    return {
      buildingPackage: active.buildingPackage,
      source: pointer.source,
    };
  } finally {
    database?.close();
  }
}

export async function cacheAndActivateVenuePackage(
  buildingPackage: CompiledBuildingPackage,
): Promise<PackageCacheStatus> {
  if (typeof indexedDB === 'undefined') {
    return {
      state: 'unavailable',
      buildingId: buildingPackage.building.id,
      activeHash: buildingPackage.manifest.contentHash,
      previousHash: null,
      detail: 'Package verified in memory; IndexedDB is not available in this browser context.',
    };
  }

  let database: IDBDatabase | null = null;
  try {
    database = await openPackageDatabase();
    const store = new IndexedDbPackageStore(database);
    const lifecycle = new PackageLifecycle(store);
    const now = new Date().toISOString();
    const installed = await lifecycle.install(buildingPackage, now);
    const current = await store.getActivation(buildingPackage.building.id);
    const activation =
      current?.activeHash === installed.contentHash
        ? current
        : await lifecycle.activate(buildingPackage.building.id, installed.contentHash, now);
    await lifecycle.getActive(buildingPackage.building.id);

    return {
      state: 'verified',
      buildingId: buildingPackage.building.id,
      activeHash: activation.activeHash,
      previousHash: activation.previousHash,
      detail: 'The active venue package was verified and cached for offline use.',
    };
  } catch (error) {
    return {
      state: 'failed',
      buildingId: buildingPackage.building.id,
      activeHash: buildingPackage.manifest.contentHash,
      previousHash: null,
      detail: error instanceof Error ? error.message : 'Package cache activation failed.',
    };
  } finally {
    database?.close();
  }
}
