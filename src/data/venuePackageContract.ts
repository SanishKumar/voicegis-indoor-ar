import type { CompiledBuildingPackage } from '@voicegis/map-compiler';
import { verifyPackageIntegrity } from './packageLifecycle';

export const VENUE_PACKAGE_CONTRACT_VERSION = '0.1.0' as const;
export const SUPPORTED_PACKAGE_VERSION = '0.2.0' as const;
export const SUPPORTED_SOURCE_SCHEMA_VERSION = '0.1.0' as const;
export const SUPPORTED_COMPILER_VERSION = '0.2.0' as const;

export interface VenuePackageIssue {
  path: string;
  code: string;
  message: string;
}

export class VenuePackageVerificationError extends Error {
  constructor(
    message: string,
    readonly issues: VenuePackageIssue[] = [],
  ) {
    super(message);
    this.name = 'VenuePackageVerificationError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isCoordinate(value: unknown) {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))
  );
}

function requireArray(
  record: Record<string, unknown>,
  key: string,
  issues: VenuePackageIssue[],
): unknown[] {
  const value = record[key];
  if (Array.isArray(value)) return value;
  issues.push({
    path: `/${key}`,
    code: 'required-array',
    message: `${key} must be an array.`,
  });
  return [];
}

function requireString(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: VenuePackageIssue[],
) {
  const value = record[key];
  if (typeof value === 'string' && value.length > 0) return value;
  issues.push({
    path: `${path}/${key}`,
    code: 'required-string',
    message: `${key} must be a non-empty string.`,
  });
  return '';
}

function requireBoolean(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: VenuePackageIssue[],
) {
  if (typeof record[key] === 'boolean') return;
  issues.push({
    path: `${path}/${key}`,
    code: 'required-boolean',
    message: `${key} must be an explicit boolean so routing policy can fail closed.`,
  });
}

function addDuplicateIssues(
  values: unknown[],
  path: string,
  issues: VenuePackageIssue[],
): Set<string> {
  const ids = new Set<string>();
  values.forEach((value, index) => {
    if (!isRecord(value)) {
      issues.push({
        path: `${path}/${index}`,
        code: 'required-object',
        message: 'Entry must be an object.',
      });
      return;
    }
    const id = requireString(value, 'id', `${path}/${index}`, issues);
    if (!id) return;
    if (ids.has(id)) {
      issues.push({
        path: `${path}/${index}/id`,
        code: 'duplicate-id',
        message: `Duplicate identifier: ${id}.`,
      });
    }
    ids.add(id);
  });
  return ids;
}

function requireReference(
  value: unknown,
  ids: Set<string>,
  path: string,
  kind: string,
  issues: VenuePackageIssue[],
) {
  if (typeof value === 'string' && ids.has(value)) return;
  issues.push({
    path,
    code: `unknown-${kind}`,
    message: `${String(value)} does not identify a compiled ${kind}.`,
  });
}

export function inspectVenuePackageShape(value: unknown): VenuePackageIssue[] {
  const issues: VenuePackageIssue[] = [];
  if (!isRecord(value)) {
    return [{ path: '/', code: 'required-object', message: 'VenuePackage must be an object.' }];
  }

  if (value.packageVersion !== SUPPORTED_PACKAGE_VERSION) {
    issues.push({
      path: '/packageVersion',
      code: 'unsupported-package-version',
      message: `Runtime supports packageVersion ${SUPPORTED_PACKAGE_VERSION}.`,
    });
  }
  if (value.sourceSchemaVersion !== SUPPORTED_SOURCE_SCHEMA_VERSION) {
    issues.push({
      path: '/sourceSchemaVersion',
      code: 'unsupported-source-schema',
      message: `Runtime supports sourceSchemaVersion ${SUPPORTED_SOURCE_SCHEMA_VERSION}.`,
    });
  }
  if (value.compilerVersion !== SUPPORTED_COMPILER_VERSION) {
    issues.push({
      path: '/compilerVersion',
      code: 'unsupported-compiler-version',
      message: `Runtime supports compilerVersion ${SUPPORTED_COMPILER_VERSION}.`,
    });
  }

  const building = isRecord(value.building) ? value.building : {};
  if (!isRecord(value.building)) {
    issues.push({
      path: '/building',
      code: 'required-object',
      message: 'building must be an object.',
    });
  }
  requireString(building, 'id', '/building', issues);
  requireString(building, 'name', '/building', issues);
  const entrySpaceId = requireString(building, 'entrySpaceId', '/building', issues);

  const floors = requireArray(value, 'floors', issues);
  const spaces = requireArray(value, 'spaces', issues);
  const portals = requireArray(value, 'portals', issues);
  const connectors = requireArray(value, 'verticalConnectors', issues);
  const pois = requireArray(value, 'pois', issues);
  const anchors = requireArray(value, 'localizationAnchors', issues);

  const floorIds = addDuplicateIssues(floors, '/floors', issues);
  const spaceIds = addDuplicateIssues(spaces, '/spaces', issues);
  const portalIds = addDuplicateIssues(portals, '/portals', issues);
  const connectorIds = addDuplicateIssues(connectors, '/verticalConnectors', issues);
  const poiIds = addDuplicateIssues(pois, '/pois', issues);
  addDuplicateIssues(anchors, '/localizationAnchors', issues);

  if (floors.length === 0) {
    issues.push({
      path: '/floors',
      code: 'empty-floors',
      message: 'At least one floor is required.',
    });
  }
  requireReference(entrySpaceId, spaceIds, '/building/entrySpaceId', 'space', issues);

  floors.forEach((floor, index) => {
    if (!isRecord(floor)) return;
    if (
      !Array.isArray(floor.outline) ||
      floor.outline.length < 3 ||
      !floor.outline.every(isCoordinate)
    ) {
      issues.push({
        path: `/floors/${index}/outline`,
        code: 'invalid-outline',
        message: 'Floor outline must contain at least three finite 2D coordinates.',
      });
    }
  });

  spaces.forEach((space, index) => {
    if (!isRecord(space)) return;
    requireReference(space.floorId, floorIds, `/spaces/${index}/floorId`, 'floor', issues);
    requireBoolean(space, 'public', `/spaces/${index}`, issues);
    requireBoolean(space, 'accessible', `/spaces/${index}`, issues);
    if (
      !Array.isArray(space.polygon) ||
      space.polygon.length < 3 ||
      !space.polygon.every(isCoordinate)
    ) {
      issues.push({
        path: `/spaces/${index}/polygon`,
        code: 'invalid-polygon',
        message: 'Space polygon must contain at least three finite 2D coordinates.',
      });
    }
  });

  portals.forEach((portal, index) => {
    if (!isRecord(portal)) return;
    requireReference(portal.floorId, floorIds, `/portals/${index}/floorId`, 'floor', issues);
    requireBoolean(portal, 'accessible', `/portals/${index}`, issues);
    if (!Array.isArray(portal.connects) || portal.connects.length !== 2) {
      issues.push({
        path: `/portals/${index}/connects`,
        code: 'invalid-portal-connects',
        message: 'Portal connects must contain exactly two space identifiers.',
      });
    } else {
      portal.connects.forEach((spaceId, connectionIndex) =>
        requireReference(
          spaceId,
          spaceIds,
          `/portals/${index}/connects/${connectionIndex}`,
          'space',
          issues,
        ),
      );
    }
  });

  connectors.forEach((connector, index) => {
    if (!isRecord(connector)) return;
    requireBoolean(connector, 'accessible', `/verticalConnectors/${index}`, issues);
    if (!Array.isArray(connector.stops) || connector.stops.length < 2) {
      issues.push({
        path: `/verticalConnectors/${index}/stops`,
        code: 'invalid-connector-stops',
        message: 'A vertical connector must contain at least two stops.',
      });
      return;
    }
    connector.stops.forEach((stop, stopIndex) => {
      if (!isRecord(stop)) return;
      requireReference(
        stop.floorId,
        floorIds,
        `/verticalConnectors/${index}/stops/${stopIndex}/floorId`,
        'floor',
        issues,
      );
      requireReference(
        stop.spaceId,
        spaceIds,
        `/verticalConnectors/${index}/stops/${stopIndex}/spaceId`,
        'space',
        issues,
      );
    });
  });

  pois.forEach((poi, index) => {
    if (!isRecord(poi)) return;
    requireReference(poi.floorId, floorIds, `/pois/${index}/floorId`, 'floor', issues);
    requireReference(poi.spaceId, spaceIds, `/pois/${index}/spaceId`, 'space', issues);
    requireBoolean(poi, 'public', `/pois/${index}`, issues);
    requireBoolean(poi, 'accessible', `/pois/${index}`, issues);
  });

  anchors.forEach((anchor, index) => {
    if (!isRecord(anchor)) return;
    requireReference(
      anchor.floorId,
      floorIds,
      `/localizationAnchors/${index}/floorId`,
      'floor',
      issues,
    );
    requireReference(
      anchor.spaceId,
      spaceIds,
      `/localizationAnchors/${index}/spaceId`,
      'space',
      issues,
    );
  });

  const routing = isRecord(value.routing) ? value.routing : {};
  if (!isRecord(value.routing)) {
    issues.push({
      path: '/routing',
      code: 'required-object',
      message: 'routing must be an object.',
    });
  }
  const nodes = requireArray(routing, 'nodes', issues);
  const edges = requireArray(routing, 'edges', issues);
  const nodeIds = addDuplicateIssues(nodes, '/routing/nodes', issues);
  addDuplicateIssues(edges, '/routing/edges', issues);

  nodes.forEach((node, index) => {
    if (!isRecord(node)) return;
    requireReference(node.floorId, floorIds, `/routing/nodes/${index}/floorId`, 'floor', issues);
    if (!isCoordinate(node.position)) {
      issues.push({
        path: `/routing/nodes/${index}/position`,
        code: 'invalid-coordinate',
        message: 'Routing node position must be a finite 2D coordinate.',
      });
    }
    const sourceIds = new Set([...spaceIds, ...portalIds, ...connectorIds, ...poiIds]);
    requireReference(
      node.sourceId,
      sourceIds,
      `/routing/nodes/${index}/sourceId`,
      'source',
      issues,
    );
  });

  edges.forEach((edge, index) => {
    if (!isRecord(edge)) return;
    requireReference(edge.from, nodeIds, `/routing/edges/${index}/from`, 'routing-node', issues);
    requireReference(edge.to, nodeIds, `/routing/edges/${index}/to`, 'routing-node', issues);
    requireBoolean(edge, 'accessible', `/routing/edges/${index}`, issues);
    requireBoolean(edge, 'restricted', `/routing/edges/${index}`, issues);
    if (
      typeof edge.distanceMeters !== 'number' ||
      !Number.isFinite(edge.distanceMeters) ||
      edge.distanceMeters <= 0
    ) {
      issues.push({
        path: `/routing/edges/${index}/distanceMeters`,
        code: 'invalid-distance',
        message: 'Routing edge distanceMeters must be finite and greater than zero.',
      });
    }
  });

  const manifest = isRecord(value.manifest) ? value.manifest : {};
  if (manifest.hashAlgorithm !== 'sha256') {
    issues.push({
      path: '/manifest/hashAlgorithm',
      code: 'unsupported-hash',
      message: 'VenuePackage manifests must use sha256.',
    });
  }
  if (typeof manifest.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.contentHash)) {
    issues.push({
      path: '/manifest/contentHash',
      code: 'invalid-content-hash',
      message: 'Manifest contentHash must be a lowercase SHA-256 hex digest.',
    });
  }

  const hasPublicEntryPoi = pois.some(
    (poi) => isRecord(poi) && poi.spaceId === entrySpaceId && poi.public === true,
  );
  if (!hasPublicEntryPoi) {
    issues.push({
      path: '/pois',
      code: 'missing-entry-poi',
      message: 'The entry space must contain a public POI for deterministic runtime bootstrap.',
    });
  }

  return issues;
}

export async function verifyVenuePackage(value: unknown): Promise<CompiledBuildingPackage> {
  const issues = inspectVenuePackageShape(value);
  if (issues.length > 0) {
    throw new VenuePackageVerificationError(
      `VenuePackage contract verification failed with ${issues.length} issue(s).`,
      issues,
    );
  }

  const buildingPackage = value as unknown as CompiledBuildingPackage;
  if (!(await verifyPackageIntegrity(buildingPackage))) {
    throw new VenuePackageVerificationError('VenuePackage SHA-256 content verification failed.', [
      {
        path: '/manifest/contentHash',
        code: 'content-hash-mismatch',
        message: 'Manifest hash does not match the canonical package content.',
      },
    ]);
  }
  return buildingPackage;
}

export async function loadVenuePackageFromUrl(
  url: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<CompiledBuildingPackage> {
  const response = await fetchImplementation(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new VenuePackageVerificationError(
      `VenuePackage request failed (${response.status} ${response.statusText}).`,
    );
  }
  return verifyVenuePackage(await response.json());
}

export async function loadVenuePackageFromFile(file: Pick<File, 'name' | 'text'>) {
  let value: unknown;
  try {
    value = JSON.parse(await file.text());
  } catch {
    throw new VenuePackageVerificationError(`${file.name} is not valid JSON.`);
  }
  return verifyVenuePackage(value);
}
