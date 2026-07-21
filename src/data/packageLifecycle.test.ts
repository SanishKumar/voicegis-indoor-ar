import { describe, expect, it } from 'vitest';
import type { CompiledBuildingPackage } from '@voicegis/map-compiler';
import { BUILDING_PACKAGE } from './compiledBuilding';
import {
  PackageIntegrityError,
  PackageLifecycle,
  calculatePackageContentHash,
  type CachedPackageRecord,
  type PackageActivationState,
  type PackageStore,
} from './packageLifecycle';

class MemoryPackageStore implements PackageStore {
  readonly packages = new Map<string, CachedPackageRecord>();
  readonly activations = new Map<string, PackageActivationState>();

  async getPackage(key: string) {
    return structuredClone(this.packages.get(key) ?? null);
  }

  async putPackage(record: CachedPackageRecord) {
    this.packages.set(record.key, structuredClone(record));
  }

  async getActivation(buildingId: string) {
    return structuredClone(this.activations.get(buildingId) ?? null);
  }

  async commitActivation(record: CachedPackageRecord, state: PackageActivationState) {
    this.packages.set(record.key, structuredClone(record));
    this.activations.set(state.buildingId, structuredClone(state));
  }
}

async function createNextPackage(): Promise<CompiledBuildingPackage> {
  const next = structuredClone(BUILDING_PACKAGE);
  next.building.name = `${next.building.name} v2`;
  next.manifest.contentHash = await calculatePackageContentHash(next);
  return next;
}

describe('verified package lifecycle', () => {
  it('reproduces the compiler content hash in the browser-compatible verifier', async () => {
    expect(await calculatePackageContentHash(BUILDING_PACKAGE)).toBe(
      BUILDING_PACKAGE.manifest.contentHash,
    );
  });

  it('refuses a tampered package before writing it to storage', async () => {
    const store = new MemoryPackageStore();
    const lifecycle = new PackageLifecycle(store);
    const tampered = structuredClone(BUILDING_PACKAGE);
    tampered.building.name = 'Tampered after compilation';

    await expect(lifecycle.install(tampered, '2026-07-22T00:00:00.000Z')).rejects.toBeInstanceOf(
      PackageIntegrityError,
    );
    expect(store.packages.size).toBe(0);
  });

  it('activates a verified update and can atomically roll back', async () => {
    const store = new MemoryPackageStore();
    const lifecycle = new PackageLifecycle(store);
    const next = await createNextPackage();
    const first = await lifecycle.install(BUILDING_PACKAGE, '2026-07-22T00:00:00.000Z');
    await lifecycle.activate(first.buildingId, first.contentHash, '2026-07-22T00:01:00.000Z');
    const second = await lifecycle.install(next, '2026-07-22T00:02:00.000Z');
    const upgraded = await lifecycle.activate(
      second.buildingId,
      second.contentHash,
      '2026-07-22T00:03:00.000Z',
    );

    expect(upgraded).toMatchObject({
      activeHash: second.contentHash,
      previousHash: first.contentHash,
    });

    const rolledBack = await lifecycle.rollback(
      BUILDING_PACKAGE.building.id,
      '2026-07-22T00:04:00.000Z',
    );
    expect(rolledBack).toMatchObject({
      activeHash: first.contentHash,
      previousHash: second.contentHash,
    });
  });

  it('leaves the last known-good activation unchanged when a cached candidate is corrupted', async () => {
    const store = new MemoryPackageStore();
    const lifecycle = new PackageLifecycle(store);
    const next = await createNextPackage();
    const first = await lifecycle.install(BUILDING_PACKAGE, '2026-07-22T00:00:00.000Z');
    await lifecycle.activate(first.buildingId, first.contentHash, '2026-07-22T00:01:00.000Z');
    const second = await lifecycle.install(next, '2026-07-22T00:02:00.000Z');
    const corrupted = store.packages.get(second.key)!;
    corrupted.buildingPackage.building.name = 'Corrupted cache record';

    await expect(
      lifecycle.activate(second.buildingId, second.contentHash, '2026-07-22T00:03:00.000Z'),
    ).rejects.toBeInstanceOf(PackageIntegrityError);
    expect(await store.getActivation(first.buildingId)).toMatchObject({
      activeHash: first.contentHash,
      previousHash: null,
    });
  });
});
