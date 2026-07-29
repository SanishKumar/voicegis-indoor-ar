import type { CompiledBuildingPackage } from '@voicegis/map-compiler';

export interface RuntimePackageSnapshot {
  buildingPackage: CompiledBuildingPackage;
  source: string;
}

export interface RuntimeActivationHistory {
  active: RuntimePackageSnapshot | null;
  rollback: RuntimePackageSnapshot | null;
}

export interface RuntimePackageSummary {
  buildingId: string;
  buildingName: string;
  contentHash: string;
  source: string;
}

export function createRuntimeActivationHistory(): RuntimeActivationHistory {
  return { active: null, rollback: null };
}

export function recordRuntimeActivation(
  history: RuntimeActivationHistory,
  next: RuntimePackageSnapshot,
): RuntimeActivationHistory {
  if (
    history.active?.buildingPackage.manifest.contentHash ===
    next.buildingPackage.manifest.contentHash
  ) {
    return history;
  }

  return {
    active: next,
    rollback: history.active,
  };
}

export function consumeRuntimeRollback(
  history: RuntimeActivationHistory,
): RuntimeActivationHistory {
  if (!history.rollback) throw new Error('No previous runtime package is available.');
  return {
    active: history.rollback,
    rollback: null,
  };
}

export function summarizeRuntimePackage(
  snapshot: RuntimePackageSnapshot | null,
): RuntimePackageSummary | null {
  if (!snapshot) return null;
  return {
    buildingId: snapshot.buildingPackage.building.id,
    buildingName: snapshot.buildingPackage.building.name,
    contentHash: snapshot.buildingPackage.manifest.contentHash,
    source: snapshot.source,
  };
}
