import { createHash } from 'node:crypto';
import {
  SPATIAL_SCHEMA_VERSION,
  isBuildingSource,
  validateBuildingSourceShape,
  type BuildingSource,
  type Coordinate2D,
} from '@voicegis/spatial-schema';
import { distanceBetween, polygonCentroid, segmentInsidePolygon } from './geometry';
import {
  createValidationReport,
  validateBuildingSemantics,
  type ValidationIssue,
  type ValidationReport,
} from './validation';

export const COMPILER_VERSION = '0.2.0' as const;
export const BUILDING_PACKAGE_VERSION = '0.2.0' as const;

export interface CompiledNavigationNode {
  id: string;
  kind: 'space' | 'waypoint' | 'portal' | 'connector-stop' | 'poi';
  floorId: string;
  position: Coordinate2D;
  sourceId: string;
}

export interface CompiledNavigationEdge {
  id: string;
  from: string;
  to: string;
  kind: 'within-space' | 'vertical-connector';
  distanceMeters: number;
  accessible: boolean;
  restricted: boolean;
  floorIds: string[];
  sourceId: string;
  spaceId?: string;
  connectorKind?: string;
}

export interface CompiledBuildingPackage {
  packageVersion: typeof BUILDING_PACKAGE_VERSION;
  sourceSchemaVersion: typeof SPATIAL_SCHEMA_VERSION;
  compilerVersion: typeof COMPILER_VERSION;
  building: BuildingSource['building'];
  floors: BuildingSource['floors'];
  spaces: BuildingSource['spaces'];
  portals: BuildingSource['portals'];
  verticalConnectors: BuildingSource['verticalConnectors'];
  pois: BuildingSource['pois'];
  localizationAnchors: BuildingSource['localizationAnchors'];
  routing: {
    nodes: CompiledNavigationNode[];
    edges: CompiledNavigationEdge[];
  };
  manifest: {
    hashAlgorithm: 'sha256';
    contentHash: string;
  };
}

export interface CompilationResult {
  package: CompiledBuildingPackage | null;
  report: ValidationReport;
}

function roundedDistance(a: Coordinate2D, b: Coordinate2D) {
  return Math.max(0.01, Number(distanceBetween(a, b).toFixed(3)));
}

function sortById<T extends { id: string }>(values: T[]) {
  return [...values].sort((a, b) => a.id.localeCompare(b.id));
}

function edgeId(from: string, to: string) {
  return from < to ? `edge:${from}--${to}` : `edge:${to}--${from}`;
}

interface SpaceAccess {
  nodeId: string;
  position: Coordinate2D;
  accessible: boolean;
  restricted: boolean;
  sourceId: string;
}

function coordinateKey([x, y]: Coordinate2D) {
  return `${x.toFixed(6)},${y.toFixed(6)}`;
}

function generateNavigationGraph(source: BuildingSource) {
  const nodes: CompiledNavigationNode[] = [];
  const edges: CompiledNavigationEdge[] = [];
  const spaceById = new Map(source.spaces.map((space) => [space.id, space]));
  const floorById = new Map(source.floors.map((floor) => [floor.id, floor]));
  const spaceCentroidById = new Map<string, Coordinate2D>();
  const accessBySpaceId = new Map(source.spaces.map((space) => [space.id, [] as SpaceAccess[]]));

  for (const space of source.spaces) {
    const position = polygonCentroid(space.polygon);
    spaceCentroidById.set(space.id, position);
    nodes.push({
      id: `space:${space.id}`,
      kind: 'space',
      floorId: space.floorId,
      position,
      sourceId: space.id,
    });
  }

  for (const portal of source.portals) {
    const portalNodeId = `portal:${portal.id}`;
    nodes.push({
      id: portalNodeId,
      kind: 'portal',
      floorId: portal.floorId,
      position: portal.position,
      sourceId: portal.id,
    });
    for (const spaceId of portal.connects) {
      const space = spaceById.get(spaceId);
      if (!space) continue;
      accessBySpaceId.get(spaceId)?.push({
        nodeId: portalNodeId,
        position: portal.position,
        accessible: portal.accessible && space.accessible,
        restricted: portal.restricted === true || !space.public,
        sourceId: portal.id,
      });
    }
  }

  for (const poi of source.pois) {
    const poiNodeId = `poi:${poi.id}`;
    const space = spaceById.get(poi.spaceId);
    const centroid = spaceCentroidById.get(poi.spaceId);
    nodes.push({
      id: poiNodeId,
      kind: 'poi',
      floorId: poi.floorId,
      position: poi.position,
      sourceId: poi.id,
    });
    if (!space || !centroid) continue;
    accessBySpaceId.get(space.id)?.push({
      nodeId: poiNodeId,
      position: poi.position,
      accessible: poi.accessible && space.accessible,
      restricted: !poi.public || !space.public,
      sourceId: poi.id,
    });
  }

  for (const connector of source.verticalConnectors) {
    const sortedStops = [...connector.stops].sort(
      (a, b) => (floorById.get(a.floorId)?.level ?? 0) - (floorById.get(b.floorId)?.level ?? 0),
    );
    for (const stop of sortedStops) {
      const stopNodeId = `connector:${connector.id}:${stop.floorId}`;
      const space = spaceById.get(stop.spaceId);
      const centroid = spaceCentroidById.get(stop.spaceId);
      nodes.push({
        id: stopNodeId,
        kind: 'connector-stop',
        floorId: stop.floorId,
        position: stop.position,
        sourceId: connector.id,
      });
      if (!space || !centroid) continue;
      accessBySpaceId.get(space.id)?.push({
        nodeId: stopNodeId,
        position: stop.position,
        accessible: connector.accessible && space.accessible,
        restricted: connector.restricted === true || !space.public,
        sourceId: connector.id,
      });
    }

    for (let index = 1; index < sortedStops.length; index += 1) {
      const fromStop = sortedStops[index - 1];
      const toStop = sortedStops[index];
      const fromFloor = floorById.get(fromStop.floorId);
      const toFloor = floorById.get(toStop.floorId);
      const fromNodeId = `connector:${connector.id}:${fromStop.floorId}`;
      const toNodeId = `connector:${connector.id}:${toStop.floorId}`;
      edges.push({
        id: edgeId(fromNodeId, toNodeId),
        from: fromNodeId,
        to: toNodeId,
        kind: 'vertical-connector',
        distanceMeters: Math.max(
          0.01,
          Number(Math.abs((toFloor?.elevation ?? 0) - (fromFloor?.elevation ?? 0)).toFixed(3)),
        ),
        accessible: connector.accessible,
        restricted: connector.restricted === true,
        floorIds: [fromStop.floorId, toStop.floorId],
        sourceId: connector.id,
        connectorKind: connector.kind,
      });
    }
  }

  const addWithinSpaceEdge = (
    space: BuildingSource['spaces'][number],
    from: { nodeId: string; position: Coordinate2D },
    to: { nodeId: string; position: Coordinate2D },
    policy: Pick<SpaceAccess, 'accessible' | 'restricted' | 'sourceId'>,
  ) => {
    edges.push({
      id: edgeId(from.nodeId, to.nodeId),
      from: from.nodeId,
      to: to.nodeId,
      kind: 'within-space',
      distanceMeters: roundedDistance(from.position, to.position),
      accessible: policy.accessible,
      restricted: policy.restricted,
      floorIds: [space.floorId],
      sourceId: policy.sourceId,
      spaceId: space.id,
    });
  };

  for (const space of source.spaces) {
    const centroid = spaceCentroidById.get(space.id);
    const access = accessBySpaceId.get(space.id) ?? [];
    if (!centroid || access.length === 0) continue;

    if (space.type === 'corridor') {
      const xValues = space.polygon.map(([x]) => x);
      const yValues = space.polygon.map(([, y]) => y);
      const horizontal =
        Math.max(...xValues) - Math.min(...xValues) >= Math.max(...yValues) - Math.min(...yValues);
      const projectionFor = (position: Coordinate2D): Coordinate2D =>
        horizontal ? [position[0], centroid[1]] : [centroid[0], position[1]];
      const projectedAccess = access.map((item) => ({
        access: item,
        projection: projectionFor(item.position),
      }));
      const uniqueProjections = new Map<string, Coordinate2D>([
        [coordinateKey(centroid), centroid],
      ]);
      projectedAccess.forEach(({ projection }) =>
        uniqueProjections.set(coordinateKey(projection), projection),
      );
      const orderedProjections = [...uniqueProjections.values()].sort((a, b) =>
        horizontal ? a[0] - b[0] || a[1] - b[1] : a[1] - b[1] || a[0] - b[0],
      );
      const corridorTopologyIsValid =
        projectedAccess.every(({ access: item, projection }) =>
          segmentInsidePolygon(item.position, projection, space.polygon),
        ) &&
        orderedProjections.slice(1).every((projection, index) =>
          segmentInsidePolygon(orderedProjections[index], projection, space.polygon),
        );

      if (corridorTopologyIsValid) {
        const projectionNodes = new Map<
          string,
          { nodeId: string; position: Coordinate2D }
        >();
        let waypointIndex = 0;
        for (const projection of orderedProjections) {
          const isCentroid = coordinateKey(projection) === coordinateKey(centroid);
          const nodeId = isCentroid
            ? `space:${space.id}`
            : `waypoint:${space.id}:${String((waypointIndex += 1)).padStart(2, '0')}`;
          projectionNodes.set(coordinateKey(projection), { nodeId, position: projection });
          if (!isCentroid) {
            nodes.push({
              id: nodeId,
              kind: 'waypoint',
              floorId: space.floorId,
              position: projection,
              sourceId: space.id,
            });
          }
        }

        for (const { access: item, projection } of projectedAccess) {
          const projectionNode = projectionNodes.get(coordinateKey(projection));
          if (projectionNode) addWithinSpaceEdge(space, item, projectionNode, item);
        }
        for (let index = 1; index < orderedProjections.length; index += 1) {
          const from = projectionNodes.get(coordinateKey(orderedProjections[index - 1]));
          const to = projectionNodes.get(coordinateKey(orderedProjections[index]));
          if (!from || !to) continue;
          addWithinSpaceEdge(space, from, to, {
            accessible: space.accessible,
            restricted: !space.public,
            sourceId: space.id,
          });
        }
        continue;
      }
    }

    const spaceNode = { nodeId: `space:${space.id}`, position: centroid };
    for (const item of access) addWithinSpaceEdge(space, spaceNode, item, item);
  }

  return {
    nodes: sortById(nodes),
    edges: sortById(edges),
  };
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

export function stableJson(value: unknown) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

function sourceShapeIssues(value: unknown): ValidationIssue[] {
  const result = validateBuildingSourceShape(value);
  return result.errors.map((error) => ({
    severity: 'error',
    code: `schema-${error.keyword}`,
    path: error.instancePath || '/',
    message: error.message ?? 'Value does not match the building source schema.',
  }));
}

function normalizedSource(source: BuildingSource): BuildingSource {
  return {
    schemaVersion: source.schemaVersion,
    building: structuredClone(source.building),
    floors: sortById(source.floors).map((value) => structuredClone(value)),
    spaces: sortById(source.spaces).map((value) => structuredClone(value)),
    portals: sortById(source.portals).map((value) => structuredClone(value)),
    verticalConnectors: sortById(source.verticalConnectors).map((value) => ({
      ...structuredClone(value),
      stops: [...value.stops].sort((a, b) => a.floorId.localeCompare(b.floorId)),
    })),
    pois: sortById(source.pois).map((value) => ({
      ...structuredClone(value),
      aliases: value.aliases ? [...value.aliases].sort() : undefined,
    })),
    localizationAnchors: sortById(source.localizationAnchors).map((value) =>
      structuredClone(value),
    ),
  };
}

export function compileBuilding(value: unknown): CompilationResult {
  if (!isBuildingSource(value)) {
    const schemaVersion =
      value && typeof value === 'object' && 'schemaVersion' in value
        ? String(value.schemaVersion)
        : 'unknown';
    const buildingId =
      value &&
      typeof value === 'object' &&
      'building' in value &&
      value.building &&
      typeof value.building === 'object' &&
      'id' in value.building
        ? String(value.building.id)
        : null;
    return {
      package: null,
      report: createValidationReport(schemaVersion, buildingId, sourceShapeIssues(value)),
    };
  }

  const normalized = normalizedSource(value);
  const report = createValidationReport(
    normalized.schemaVersion,
    normalized.building.id,
    validateBuildingSemantics(normalized),
  );
  if (!report.valid) return { package: null, report };

  const packageContent = {
    packageVersion: BUILDING_PACKAGE_VERSION,
    sourceSchemaVersion: SPATIAL_SCHEMA_VERSION,
    compilerVersion: COMPILER_VERSION,
    building: normalized.building,
    floors: normalized.floors,
    spaces: normalized.spaces,
    portals: normalized.portals,
    verticalConnectors: normalized.verticalConnectors,
    pois: normalized.pois,
    localizationAnchors: normalized.localizationAnchors,
    routing: generateNavigationGraph(normalized),
  };
  const contentHash = createHash('sha256').update(stableJson(packageContent)).digest('hex');
  return {
    package: {
      ...packageContent,
      manifest: { hashAlgorithm: 'sha256', contentHash },
    },
    report,
  };
}
