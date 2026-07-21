import type { CachedPackageRecord, PackageActivationState, PackageStore } from './packageLifecycle';

const DATABASE_NAME = 'voicegis-building-packages';
const DATABASE_VERSION = 1;
const PACKAGE_STORE = 'packages';
const ACTIVATION_STORE = 'activations';

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
  });
}

export async function openPackageDatabase(): Promise<IDBDatabase> {
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(PACKAGE_STORE)) {
      const packages = database.createObjectStore(PACKAGE_STORE, { keyPath: 'key' });
      packages.createIndex('buildingId', 'buildingId', { unique: false });
    }
    if (!database.objectStoreNames.contains(ACTIVATION_STORE)) {
      database.createObjectStore(ACTIVATION_STORE, { keyPath: 'buildingId' });
    }
  };
  return requestResult(request);
}

export class IndexedDbPackageStore implements PackageStore {
  constructor(private readonly database: IDBDatabase) {}

  async getPackage(key: string): Promise<CachedPackageRecord | null> {
    const transaction = this.database.transaction(PACKAGE_STORE, 'readonly');
    const result = await requestResult(
      transaction.objectStore(PACKAGE_STORE).get(key) as IDBRequest<
        CachedPackageRecord | undefined
      >,
    );
    return result ?? null;
  }

  async putPackage(record: CachedPackageRecord): Promise<void> {
    const transaction = this.database.transaction(PACKAGE_STORE, 'readwrite');
    transaction.objectStore(PACKAGE_STORE).put(record);
    await transactionComplete(transaction);
  }

  async getActivation(buildingId: string): Promise<PackageActivationState | null> {
    const transaction = this.database.transaction(ACTIVATION_STORE, 'readonly');
    const result = await requestResult(
      transaction.objectStore(ACTIVATION_STORE).get(buildingId) as IDBRequest<
        PackageActivationState | undefined
      >,
    );
    return result ?? null;
  }

  async commitActivation(
    record: CachedPackageRecord,
    state: PackageActivationState,
  ): Promise<void> {
    const transaction = this.database.transaction([PACKAGE_STORE, ACTIVATION_STORE], 'readwrite');
    transaction.objectStore(PACKAGE_STORE).put(record);
    transaction.objectStore(ACTIVATION_STORE).put(state);
    await transactionComplete(transaction);
  }
}
