import type { CompiledBuildingPackage } from '@voicegis/map-compiler';

export interface CachedPackageRecord {
  key: string;
  buildingId: string;
  contentHash: string;
  installedAt: string;
  buildingPackage: CompiledBuildingPackage;
}

export interface PackageActivationState {
  buildingId: string;
  activeHash: string;
  previousHash: string | null;
  activatedAt: string;
}

export interface PackageStore {
  getPackage(key: string): Promise<CachedPackageRecord | null>;
  putPackage(record: CachedPackageRecord): Promise<void>;
  getActivation(buildingId: string): Promise<PackageActivationState | null>;
  commitActivation(record: CachedPackageRecord, state: PackageActivationState): Promise<void>;
}

export class PackageIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PackageIntegrityError';
  }
}

export class PackageLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PackageLifecycleError';
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function stablePackageJson(value: unknown) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

function bytesToHex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function packageKey(buildingId: string, contentHash: string) {
  return `${buildingId}:${contentHash}`;
}

export async function calculatePackageContentHash(
  buildingPackage: CompiledBuildingPackage,
): Promise<string> {
  const { manifest: _manifest, ...packageContent } = buildingPackage;
  const bytes = new TextEncoder().encode(stablePackageJson(packageContent));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return bytesToHex(digest);
}

export async function verifyPackageIntegrity(
  buildingPackage: CompiledBuildingPackage,
): Promise<boolean> {
  if (buildingPackage.manifest.hashAlgorithm !== 'sha256') return false;
  const actualHash = await calculatePackageContentHash(buildingPackage);
  return actualHash === buildingPackage.manifest.contentHash;
}

export class PackageLifecycle {
  constructor(private readonly store: PackageStore) {}

  async install(
    buildingPackage: CompiledBuildingPackage,
    installedAt: string,
  ): Promise<CachedPackageRecord> {
    if (!(await verifyPackageIntegrity(buildingPackage))) {
      throw new PackageIntegrityError(
        `Package ${buildingPackage.building.id} failed SHA-256 content verification.`,
      );
    }

    const contentHash = buildingPackage.manifest.contentHash;
    const record: CachedPackageRecord = {
      key: packageKey(buildingPackage.building.id, contentHash),
      buildingId: buildingPackage.building.id,
      contentHash,
      installedAt,
      buildingPackage: structuredClone(buildingPackage),
    };
    await this.store.putPackage(record);
    return record;
  }

  async activate(
    buildingId: string,
    contentHash: string,
    activatedAt: string,
  ): Promise<PackageActivationState> {
    const key = packageKey(buildingId, contentHash);
    const record = await this.store.getPackage(key);
    if (!record) throw new PackageLifecycleError(`Package is not installed: ${key}.`);
    if (!(await verifyPackageIntegrity(record.buildingPackage))) {
      throw new PackageIntegrityError(`Cached package failed verification: ${key}.`);
    }

    const current = await this.store.getActivation(buildingId);
    const state: PackageActivationState = {
      buildingId,
      activeHash: contentHash,
      previousHash:
        current && current.activeHash !== contentHash
          ? current.activeHash
          : (current?.previousHash ?? null),
      activatedAt,
    };
    await this.store.commitActivation(record, state);
    return state;
  }

  async rollback(buildingId: string, activatedAt: string): Promise<PackageActivationState> {
    const current = await this.store.getActivation(buildingId);
    if (!current?.previousHash) {
      throw new PackageLifecycleError(`No previous package is available for ${buildingId}.`);
    }

    const previous = await this.store.getPackage(packageKey(buildingId, current.previousHash));
    if (!previous) {
      throw new PackageLifecycleError(`Previous package is missing for ${buildingId}.`);
    }
    if (!(await verifyPackageIntegrity(previous.buildingPackage))) {
      throw new PackageIntegrityError(`Previous package failed verification for ${buildingId}.`);
    }

    const nextState: PackageActivationState = {
      buildingId,
      activeHash: current.previousHash,
      previousHash: current.activeHash,
      activatedAt,
    };
    await this.store.commitActivation(previous, nextState);
    return nextState;
  }

  async getActive(buildingId: string): Promise<CachedPackageRecord | null> {
    const state = await this.store.getActivation(buildingId);
    if (!state) return null;
    const record = await this.store.getPackage(packageKey(buildingId, state.activeHash));
    if (!record) throw new PackageLifecycleError(`Active package is missing for ${buildingId}.`);
    if (!(await verifyPackageIntegrity(record.buildingPackage))) {
      throw new PackageIntegrityError(`Active package failed verification for ${buildingId}.`);
    }
    return record;
  }
}
