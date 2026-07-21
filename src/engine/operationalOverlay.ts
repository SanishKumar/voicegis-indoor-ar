import type { CompiledBuildingPackage } from '@voicegis/map-compiler';

export const OPERATIONAL_OVERLAY_VERSION = '0.1.0' as const;

export interface OperationalClosure {
  id: string;
  target: {
    type: 'edge' | 'source';
    id: string;
  };
  reason: string;
}

export interface OperationalOverlay {
  schemaVersion: typeof OPERATIONAL_OVERLAY_VERSION;
  id: string;
  buildingId: string;
  packageHash: string;
  validFrom: string;
  validUntil: string;
  closures: OperationalClosure[];
}

export interface OverlayIssue {
  code:
    | 'invalid-shape'
    | 'invalid-schema-version'
    | 'building-mismatch'
    | 'package-mismatch'
    | 'invalid-time'
    | 'overlay-not-active'
    | 'overlay-expired'
    | 'duplicate-closure'
    | 'unknown-target';
  message: string;
  closureId?: string;
}

export interface OverlayResolution {
  valid: boolean;
  overlayId: string;
  evaluatedAt: string;
  activeClosureIds: string[];
  closedEdgeIds: string[];
  issues: OverlayIssue[];
}

function parseTimestamp(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isOperationalOverlay(value: unknown): value is OperationalOverlay {
  if (!isRecord(value) || !Array.isArray(value.closures)) return false;
  if (
    typeof value.schemaVersion !== 'string' ||
    typeof value.id !== 'string' ||
    typeof value.buildingId !== 'string' ||
    typeof value.packageHash !== 'string' ||
    typeof value.validFrom !== 'string' ||
    typeof value.validUntil !== 'string'
  ) {
    return false;
  }
  return value.closures.every((closure) => {
    if (!isRecord(closure) || !isRecord(closure.target)) return false;
    return (
      typeof closure.id === 'string' &&
      closure.id.length > 0 &&
      typeof closure.reason === 'string' &&
      closure.reason.length > 0 &&
      (closure.target.type === 'edge' || closure.target.type === 'source') &&
      typeof closure.target.id === 'string' &&
      closure.target.id.length > 0
    );
  });
}

export function resolveOperationalOverlay(
  value: unknown,
  buildingPackage: CompiledBuildingPackage,
  evaluatedAt: string,
): OverlayResolution {
  if (!isOperationalOverlay(value)) {
    return {
      valid: false,
      overlayId: isRecord(value) && typeof value.id === 'string' ? value.id : '<invalid>',
      evaluatedAt,
      activeClosureIds: [],
      closedEdgeIds: [],
      issues: [
        {
          code: 'invalid-shape',
          message: 'Operational overlay does not match the required runtime shape.',
        },
      ],
    };
  }
  const overlay = value;
  const issues: OverlayIssue[] = [];
  const evaluationTime = parseTimestamp(evaluatedAt);
  const validFrom = parseTimestamp(overlay.validFrom);
  const validUntil = parseTimestamp(overlay.validUntil);

  if (overlay.schemaVersion !== OPERATIONAL_OVERLAY_VERSION) {
    issues.push({
      code: 'invalid-schema-version',
      message: `Unsupported operational overlay version: ${String(overlay.schemaVersion)}.`,
    });
  }
  if (overlay.buildingId !== buildingPackage.building.id) {
    issues.push({
      code: 'building-mismatch',
      message: `Overlay building ${overlay.buildingId} does not match ${buildingPackage.building.id}.`,
    });
  }
  if (overlay.packageHash !== buildingPackage.manifest.contentHash) {
    issues.push({
      code: 'package-mismatch',
      message: 'Overlay package hash does not match the active building package.',
    });
  }
  if (
    evaluationTime === null ||
    validFrom === null ||
    validUntil === null ||
    validUntil <= validFrom
  ) {
    issues.push({
      code: 'invalid-time',
      message: 'Overlay timestamps must be valid and validUntil must be after validFrom.',
    });
  } else if (evaluationTime < validFrom) {
    issues.push({
      code: 'overlay-not-active',
      message: 'Operational overlay is not active at the requested evaluation time.',
    });
  } else if (evaluationTime >= validUntil) {
    issues.push({
      code: 'overlay-expired',
      message: 'Operational overlay has expired and cannot be applied.',
    });
  }

  const edgeIds = new Set(buildingPackage.routing.edges.map((edge) => edge.id));
  const edgesBySource = new Map<string, string[]>();
  for (const edge of buildingPackage.routing.edges) {
    const values = edgesBySource.get(edge.sourceId) ?? [];
    values.push(edge.id);
    edgesBySource.set(edge.sourceId, values);
  }

  const seenClosureIds = new Set<string>();
  const closedEdgeIds = new Set<string>();
  for (const closure of overlay.closures) {
    if (seenClosureIds.has(closure.id)) {
      issues.push({
        code: 'duplicate-closure',
        closureId: closure.id,
        message: `Duplicate closure ID: ${closure.id}.`,
      });
      continue;
    }
    seenClosureIds.add(closure.id);

    const matches =
      closure.target.type === 'edge'
        ? edgeIds.has(closure.target.id)
          ? [closure.target.id]
          : []
        : (edgesBySource.get(closure.target.id) ?? []);
    if (matches.length === 0) {
      issues.push({
        code: 'unknown-target',
        closureId: closure.id,
        message: `Closure target does not exist in the active package: ${closure.target.id}.`,
      });
      continue;
    }
    matches.forEach((edgeId) => closedEdgeIds.add(edgeId));
  }

  const valid = issues.length === 0;
  return {
    valid,
    overlayId: overlay.id,
    evaluatedAt,
    activeClosureIds: valid ? [...seenClosureIds].sort() : [],
    closedEdgeIds: valid ? [...closedEdgeIds].sort() : [],
    issues,
  };
}
