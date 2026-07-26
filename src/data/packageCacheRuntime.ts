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
