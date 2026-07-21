import type { BuildingSource, Coordinate2D, SpaceSource } from '@voicegis/spatial-schema';
import {
  distanceBetween,
  pointInPolygon,
  pointOnPolygonBoundary,
  polygonArea,
  polygonCentroid,
  segmentInsidePolygon,
} from './geometry';

export type IssueSeverity = 'error' | 'warning';

export interface ValidationIssue {
  severity: IssueSeverity;
  code: string;
  path: string;
  message: string;
}

export interface ValidationReport {
  schemaVersion: string;
  buildingId: string | null;
  valid: boolean;
  summary: {
    errors: number;
    warnings: number;
  };
  issues: ValidationIssue[];
}

function issue(
  severity: IssueSeverity,
  code: string,
  path: string,
  message: string,
): ValidationIssue {
  return { severity, code, path, message };
}

function sortIssues(issues: ValidationIssue[]) {
  return [...issues].sort((a, b) => {
    const severityDifference = (a.severity === 'error' ? 0 : 1) - (b.severity === 'error' ? 0 : 1);
    return (
      severityDifference ||
      a.code.localeCompare(b.code) ||
      a.path.localeCompare(b.path) ||
      a.message.localeCompare(b.message)
    );
  });
}

export function createValidationReport(
  schemaVersion: string,
  buildingId: string | null,
  issues: ValidationIssue[],
): ValidationReport {
  const sortedIssues = sortIssues(issues);
  const errors = sortedIssues.filter((entry) => entry.severity === 'error').length;
  const warnings = sortedIssues.length - errors;
  return {
    schemaVersion,
    buildingId,
    valid: errors === 0,
    summary: { errors, warnings },
    issues: sortedIssues,
  };
}

function validateUniqueIds(source: BuildingSource, issues: ValidationIssue[]) {
  const entities = [
    ...source.floors.map((value, index) => ({ value, path: `/floors/${index}` })),
    ...source.spaces.map((value, index) => ({ value, path: `/spaces/${index}` })),
    ...source.portals.map((value, index) => ({ value, path: `/portals/${index}` })),
    ...source.verticalConnectors.map((value, index) => ({
      value,
      path: `/verticalConnectors/${index}`,
    })),
    ...source.pois.map((value, index) => ({ value, path: `/pois/${index}` })),
    ...source.localizationAnchors.map((value, index) => ({
      value,
      path: `/localizationAnchors/${index}`,
    })),
  ];
  const firstPathById = new Map<string, string>();

  for (const entity of entities) {
    const firstPath = firstPathById.get(entity.value.id);
    if (firstPath) {
      issues.push(
        issue(
          'error',
          'duplicate-id',
          `${entity.path}/id`,
          `Identifier "${entity.value.id}" is already used at ${firstPath}.`,
        ),
      );
    } else {
      firstPathById.set(entity.value.id, `${entity.path}/id`);
    }
  }
}

function validateFloorGeometry(source: BuildingSource, issues: ValidationIssue[]) {
  const levels = new Map<number, string>();
  for (const [index, floor] of source.floors.entries()) {
    if (polygonArea(floor.outline) < 0.01) {
      issues.push(
        issue(
          'error',
          'degenerate-floor',
          `/floors/${index}/outline`,
          'Floor outline has no area.',
        ),
      );
    }
    const existing = levels.get(floor.level);
    if (existing) {
      issues.push(
        issue(
          'error',
          'duplicate-floor-level',
          `/floors/${index}/level`,
          `Floor level ${floor.level} is already used by "${existing}".`,
        ),
      );
    } else {
      levels.set(floor.level, floor.id);
    }
  }
}

function validateSpaceGeometry(source: BuildingSource, issues: ValidationIssue[]) {
  const floorById = new Map(source.floors.map((floor) => [floor.id, floor]));
  for (const [index, space] of source.spaces.entries()) {
    const floor = floorById.get(space.floorId);
    if (!floor) {
      issues.push(
        issue(
          'error',
          'unknown-floor',
          `/spaces/${index}/floorId`,
          `Space refers to unknown floor "${space.floorId}".`,
        ),
      );
      continue;
    }
    if (polygonArea(space.polygon) < 0.01) {
      issues.push(
        issue(
          'error',
          'degenerate-space',
          `/spaces/${index}/polygon`,
          'Space polygon has no area.',
        ),
      );
    }
    if (!space.polygon.every((point) => pointInPolygon(point, floor.outline))) {
      issues.push(
        issue(
          'error',
          'space-outside-floor',
          `/spaces/${index}/polygon`,
          `Space "${space.id}" extends outside floor "${floor.id}".`,
        ),
      );
    }
    const centroid = polygonCentroid(space.polygon);
    if (!pointInPolygon(centroid, space.polygon)) {
      issues.push(
        issue(
          'error',
          'centroid-outside-space',
          `/spaces/${index}/polygon`,
          `Space "${space.id}" needs a navigation seed because its centroid is outside the polygon.`,
        ),
      );
    }
  }
}

function validatePointInSpace(
  point: Coordinate2D,
  space: SpaceSource | undefined,
  path: string,
  label: string,
  issues: ValidationIssue[],
) {
  if (space && !pointInPolygon(point, space.polygon)) {
    issues.push(
      issue(
        'error',
        'point-outside-space',
        path,
        `${label} is outside referenced space "${space.id}".`,
      ),
    );
  }
}

function validatePortals(source: BuildingSource, issues: ValidationIssue[]) {
  const floorById = new Map(source.floors.map((floor) => [floor.id, floor]));
  const spaceById = new Map(source.spaces.map((space) => [space.id, space]));

  for (const [index, portal] of source.portals.entries()) {
    if (!floorById.has(portal.floorId)) {
      issues.push(
        issue(
          'error',
          'unknown-floor',
          `/portals/${index}/floorId`,
          `Portal refers to unknown floor "${portal.floorId}".`,
        ),
      );
    }

    for (const [connectionIndex, spaceId] of portal.connects.entries()) {
      const space = spaceById.get(spaceId);
      if (!space) {
        issues.push(
          issue(
            'error',
            'unknown-space',
            `/portals/${index}/connects/${connectionIndex}`,
            `Portal refers to unknown space "${spaceId}".`,
          ),
        );
        continue;
      }
      if (space.floorId !== portal.floorId) {
        issues.push(
          issue(
            'error',
            'portal-floor-mismatch',
            `/portals/${index}/connects/${connectionIndex}`,
            `Space "${space.id}" is on floor "${space.floorId}", not "${portal.floorId}".`,
          ),
        );
      }
      if (!pointOnPolygonBoundary(portal.position, space.polygon)) {
        issues.push(
          issue(
            'error',
            'portal-off-boundary',
            `/portals/${index}/position`,
            `Portal "${portal.id}" is not on the boundary of space "${space.id}".`,
          ),
        );
      }
      if (!segmentInsidePolygon(polygonCentroid(space.polygon), portal.position, space.polygon)) {
        issues.push(
          issue(
            'error',
            'navigation-segment-outside-space',
            `/portals/${index}/position`,
            `Generated path from space "${space.id}" to portal "${portal.id}" leaves the space.`,
          ),
        );
      }
    }

    if (portal.accessible && portal.width < 0.85) {
      issues.push(
        issue(
          'warning',
          'narrow-accessible-portal',
          `/portals/${index}/width`,
          `Portal "${portal.id}" is marked accessible but is narrower than the 0.85 m review threshold.`,
        ),
      );
    }
  }
}

function validateConnectors(source: BuildingSource, issues: ValidationIssue[]) {
  const floorById = new Map(source.floors.map((floor) => [floor.id, floor]));
  const spaceById = new Map(source.spaces.map((space) => [space.id, space]));

  for (const [index, connector] of source.verticalConnectors.entries()) {
    const usedFloors = new Set<string>();
    for (const [stopIndex, stop] of connector.stops.entries()) {
      const floor = floorById.get(stop.floorId);
      const space = spaceById.get(stop.spaceId);
      if (!floor) {
        issues.push(
          issue(
            'error',
            'unknown-floor',
            `/verticalConnectors/${index}/stops/${stopIndex}/floorId`,
            `Connector stop refers to unknown floor "${stop.floorId}".`,
          ),
        );
      }
      if (!space) {
        issues.push(
          issue(
            'error',
            'unknown-space',
            `/verticalConnectors/${index}/stops/${stopIndex}/spaceId`,
            `Connector stop refers to unknown space "${stop.spaceId}".`,
          ),
        );
      } else {
        if (space.floorId !== stop.floorId) {
          issues.push(
            issue(
              'error',
              'connector-floor-mismatch',
              `/verticalConnectors/${index}/stops/${stopIndex}`,
              `Connector stop space "${space.id}" is not on floor "${stop.floorId}".`,
            ),
          );
        }
        validatePointInSpace(
          stop.position,
          space,
          `/verticalConnectors/${index}/stops/${stopIndex}/position`,
          `Connector stop for "${connector.id}"`,
          issues,
        );
        if (!segmentInsidePolygon(polygonCentroid(space.polygon), stop.position, space.polygon)) {
          issues.push(
            issue(
              'error',
              'navigation-segment-outside-space',
              `/verticalConnectors/${index}/stops/${stopIndex}/position`,
              `Generated path from space "${space.id}" to connector "${connector.id}" leaves the space.`,
            ),
          );
        }
      }
      if (usedFloors.has(stop.floorId)) {
        issues.push(
          issue(
            'error',
            'duplicate-connector-stop',
            `/verticalConnectors/${index}/stops/${stopIndex}/floorId`,
            `Connector "${connector.id}" has more than one stop on floor "${stop.floorId}".`,
          ),
        );
      }
      usedFloors.add(stop.floorId);
    }

    if (connector.kind === 'elevator') {
      const firstPosition = connector.stops[0]?.position;
      if (
        firstPosition &&
        connector.stops.some((stop) => distanceBetween(firstPosition, stop.position) > 0.25)
      ) {
        issues.push(
          issue(
            'error',
            'misaligned-elevator',
            `/verticalConnectors/${index}/stops`,
            `Elevator "${connector.id}" stops differ by more than 0.25 m in plan coordinates.`,
          ),
        );
      }
    }

    if (connector.accessible && ['stairs', 'escalator'].includes(connector.kind)) {
      issues.push(
        issue(
          'error',
          'invalid-accessible-connector',
          `/verticalConnectors/${index}/accessible`,
          `${connector.kind} connector "${connector.id}" cannot be the accessible path in this schema version.`,
        ),
      );
    }
  }
}

function validatePoisAndAnchors(source: BuildingSource, issues: ValidationIssue[]) {
  const spaceById = new Map(source.spaces.map((space) => [space.id, space]));
  const floorIds = new Set(source.floors.map((floor) => floor.id));

  const entities = [
    ...source.pois.map((value, index) => ({
      value,
      path: `/pois/${index}`,
      label: `POI "${value.id}"`,
    })),
    ...source.localizationAnchors.map((value, index) => ({
      value,
      path: `/localizationAnchors/${index}`,
      label: `Localization anchor "${value.id}"`,
    })),
  ];

  for (const entity of entities) {
    const space = spaceById.get(entity.value.spaceId);
    if (!floorIds.has(entity.value.floorId)) {
      issues.push(
        issue(
          'error',
          'unknown-floor',
          `${entity.path}/floorId`,
          `${entity.label} refers to unknown floor "${entity.value.floorId}".`,
        ),
      );
    }
    if (!space) {
      issues.push(
        issue(
          'error',
          'unknown-space',
          `${entity.path}/spaceId`,
          `${entity.label} refers to unknown space "${entity.value.spaceId}".`,
        ),
      );
      continue;
    }
    if (space.floorId !== entity.value.floorId) {
      issues.push(
        issue(
          'error',
          'entity-floor-mismatch',
          `${entity.path}/floorId`,
          `${entity.label} is not on the same floor as space "${space.id}".`,
        ),
      );
    }
    validatePointInSpace(
      entity.value.position,
      space,
      `${entity.path}/position`,
      entity.label,
      issues,
    );
    if (
      !segmentInsidePolygon(polygonCentroid(space.polygon), entity.value.position, space.polygon)
    ) {
      issues.push(
        issue(
          'error',
          'navigation-segment-outside-space',
          `${entity.path}/position`,
          `Generated path from space "${space.id}" to ${entity.label} leaves the space.`,
        ),
      );
    }
  }
}

function addConnection(adjacency: Map<string, Set<string>>, from: string, to: string) {
  adjacency.get(from)?.add(to);
  adjacency.get(to)?.add(from);
}

function reachableSpaces(source: BuildingSource, accessibleOnly: boolean) {
  const spaceById = new Map(source.spaces.map((space) => [space.id, space]));
  const adjacency = new Map(source.spaces.map((space) => [space.id, new Set<string>()]));

  for (const portal of source.portals) {
    const [from, to] = portal.connects;
    const fromSpace = spaceById.get(from);
    const toSpace = spaceById.get(to);
    if (!fromSpace || !toSpace || portal.restricted) continue;
    if (accessibleOnly && (!portal.accessible || !fromSpace.accessible || !toSpace.accessible))
      continue;
    addConnection(adjacency, from, to);
  }

  for (const connector of source.verticalConnectors) {
    if (connector.restricted || (accessibleOnly && !connector.accessible)) continue;
    for (let index = 1; index < connector.stops.length; index += 1) {
      const from = connector.stops[index - 1].spaceId;
      const to = connector.stops[index].spaceId;
      const fromSpace = spaceById.get(from);
      const toSpace = spaceById.get(to);
      if (!fromSpace || !toSpace) continue;
      if (accessibleOnly && (!fromSpace.accessible || !toSpace.accessible)) continue;
      addConnection(adjacency, from, to);
    }
  }

  const visited = new Set<string>();
  const queue = [source.building.entrySpaceId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    for (const neighbor of adjacency.get(current) ?? []) {
      if (!visited.has(neighbor)) queue.push(neighbor);
    }
  }
  return visited;
}

function validateReachability(source: BuildingSource, issues: ValidationIssue[]) {
  const spaceById = new Map(source.spaces.map((space) => [space.id, space]));
  const entrySpace = spaceById.get(source.building.entrySpaceId);
  if (!entrySpace) {
    issues.push(
      issue(
        'error',
        'unknown-entry-space',
        '/building/entrySpaceId',
        `Entry space "${source.building.entrySpaceId}" does not exist.`,
      ),
    );
    return;
  }
  if (!entrySpace.public || entrySpace.type !== 'entrance') {
    issues.push(
      issue(
        'error',
        'invalid-entry-space',
        '/building/entrySpaceId',
        'Entry space must be a public entrance space.',
      ),
    );
  }

  const standardReachable = reachableSpaces(source, false);
  const accessibleReachable = reachableSpaces(source, true);
  for (const [index, space] of source.spaces.entries()) {
    if (space.public && !standardReachable.has(space.id)) {
      issues.push(
        issue(
          'error',
          'unreachable-public-space',
          `/spaces/${index}`,
          `Public space "${space.id}" is unreachable from the entry space.`,
        ),
      );
    }
  }
  for (const [index, poi] of source.pois.entries()) {
    if (poi.public && !standardReachable.has(poi.spaceId)) {
      issues.push(
        issue(
          'error',
          'unreachable-public-poi',
          `/pois/${index}`,
          `Public POI "${poi.id}" is unreachable from the entry space.`,
        ),
      );
    }
    if (poi.public && poi.accessible && !accessibleReachable.has(poi.spaceId)) {
      issues.push(
        issue(
          'error',
          'unreachable-accessible-poi',
          `/pois/${index}`,
          `Accessible POI "${poi.id}" has no accessible path from the entry space.`,
        ),
      );
    }
  }
}

export function validateBuildingSemantics(source: BuildingSource) {
  const issues: ValidationIssue[] = [];
  validateUniqueIds(source, issues);
  validateFloorGeometry(source, issues);
  validateSpaceGeometry(source, issues);
  validatePortals(source, issues);
  validateConnectors(source, issues);
  validatePoisAndAnchors(source, issues);
  validateReachability(source, issues);
  return issues;
}
