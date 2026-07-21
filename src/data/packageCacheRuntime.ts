import { BUILDING_PACKAGE } from './compiledBuilding';
import { IndexedDbPackageStore, openPackageDatabase } from './indexedDbPackageStore';
import { PackageLifecycle } from './packageLifecycle';

export interface PackageCacheStatus {
  state: 'verified' | 'unavailable' | 'failed';
  activeHash: string | null;
  previousHash: string | null;
  detail: string;
}

export async function bootstrapReferencePackageCache(): Promise<PackageCacheStatus> {
  if (typeof indexedDB === 'undefined') {
    return {
      state: 'unavailable',
      activeHash: null,
      previousHash: null,
      detail: 'IndexedDB is not available in this browser context.',
    };
  }

  let database: IDBDatabase | null = null;
  try {
    database = await openPackageDatabase();
    const store = new IndexedDbPackageStore(database);
    const lifecycle = new PackageLifecycle(store);
    const now = new Date().toISOString();
    const installed = await lifecycle.install(BUILDING_PACKAGE, now);
    const current = await store.getActivation(BUILDING_PACKAGE.building.id);
    const activation =
      current?.activeHash === installed.contentHash
        ? current
        : await lifecycle.activate(BUILDING_PACKAGE.building.id, installed.contentHash, now);
    await lifecycle.getActive(BUILDING_PACKAGE.building.id);

    return {
      state: 'verified',
      activeHash: activation.activeHash,
      previousHash: activation.previousHash,
      detail: 'The active package was verified and cached for offline use.',
    };
  } catch (error) {
    return {
      state: 'failed',
      activeHash: null,
      previousHash: null,
      detail: error instanceof Error ? error.message : 'Package cache initialization failed.',
    };
  } finally {
    database?.close();
  }
}
