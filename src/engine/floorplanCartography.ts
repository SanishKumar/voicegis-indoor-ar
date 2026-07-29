import type { CompiledBuildingPackage } from '@voicegis/map-compiler';
import type {
  ConnectorKind,
  Coordinate2D,
  PortalKind,
  PortalSource,
  SpaceSource,
} from '@voicegis/spatial-schema';
import {
  buildSpaceWallSegments,
  getNearestBoundaryAngle,
  type WallSegment,
} from './spatialTwinArchitecture';

const CARTOGRAPHY_PRECISION = 5;
const FLOOR_BOUNDARY_TOLERANCE_METERS = 0.025;

export type CartographicWallKind = 'exterior' | 'partition' | 'restricted';

export interface CartographicWallRun extends WallSegment {
  id: string;
  kind: CartographicWallKind;
  spaceIds: string[];
}

export interface CartographicPortal {
  id: string;
  kind: PortalKind;
  position: Coordinate2D;
  width: number;
  angleRadians: number;
  accessible: boolean;
  restricted: boolean;
}

export interface CartographicConnectorStop {
  id: string;
  connectorId: string;
  name: string;
  kind: ConnectorKind;
  position: Coordinate2D;
  spaceId: string;
  accessible: boolean;
  restricted: boolean;
}

export interface FloorplanCartography {
  floorId: string;
  walls: CartographicWallRun[];
  portals: CartographicPortal[];
  connectorStops: CartographicConnectorStop[];
}

interface MutableWallRun extends WallSegment {
  id: string;
  spaceIds: Set<string>;
}

function coordinateKey([x, y]: Coordinate2D) {
  return `${x.toFixed(CARTOGRAPHY_PRECISION)},${y.toFixed(CARTOGRAPHY_PRECISION)}`;
}

function wallKey(start: Coordinate2D, end: Coordinate2D) {
  const startKey = coordinateKey(start);
  const endKey = coordinateKey(end);
  return startKey < endKey ? `${startKey}--${endKey}` : `${endKey}--${startKey}`;
}

function pointToSegmentDistance(point: Coordinate2D, start: Coordinate2D, end: Coordinate2D) {
  const deltaX = end[0] - start[0];
  const deltaY = end[1] - start[1];
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  if (lengthSquared === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);

  const offset = Math.max(
    0,
    Math.min(
      1,
      ((point[0] - start[0]) * deltaX + (point[1] - start[1]) * deltaY) / lengthSquared,
    ),
  );
  const projection: Coordinate2D = [start[0] + deltaX * offset, start[1] + deltaY * offset];
  return Math.hypot(point[0] - projection[0], point[1] - projection[1]);
}

function segmentFollowsFloorBoundary(segment: WallSegment, outline: Coordinate2D[]) {
  return outline.some((start, index) => {
    const end = outline[(index + 1) % outline.length];
    return (
      pointToSegmentDistance(segment.start, start, end) <= FLOOR_BOUNDARY_TOLERANCE_METERS &&
      pointToSegmentDistance(segment.end, start, end) <= FLOOR_BOUNDARY_TOLERANCE_METERS
    );
  });
}

/**
 * Derives display-only wall runs from the canonical space and portal geometry.
 * Shared boundaries are de-duplicated and portal-width gaps are preserved.
 */
export function deriveCartographicWalls(
  spaces: SpaceSource[],
  portals: PortalSource[],
  floorOutline: Coordinate2D[],
): CartographicWallRun[] {
  const spacesById = new Map(spaces.map((space) => [space.id, space] as const));
  const wallRuns = new Map<string, MutableWallRun>();

  [...spaces]
    .sort((left, right) => left.id.localeCompare(right.id))
    .forEach((space) => {
      buildSpaceWallSegments(space, portals).forEach((segment) => {
        const key = wallKey(segment.start, segment.end);
        const existing = wallRuns.get(key);
        if (existing) {
          existing.spaceIds.add(space.id);
          return;
        }

        wallRuns.set(key, {
          ...segment,
          id: `wall:${key}`,
          spaceIds: new Set([space.id]),
        });
      });
    });

  return [...wallRuns.values()]
    .map((wall): CartographicWallRun => {
      const spaceIds = [...wall.spaceIds].sort();
      const restricted = spaceIds.some((spaceId) => {
        const space = spacesById.get(spaceId);
        return space?.type === 'restricted' || space?.public === false;
      });
      return {
        id: wall.id,
        start: wall.start,
        end: wall.end,
        length: wall.length,
        angleRadians: wall.angleRadians,
        spaceIds,
        kind: segmentFollowsFloorBoundary(wall, floorOutline)
          ? 'exterior'
          : restricted
            ? 'restricted'
            : 'partition',
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function deriveFloorplanCartography(
  buildingPackage: CompiledBuildingPackage,
  floorId: string,
): FloorplanCartography {
  const floor = buildingPackage.floors.find((candidate) => candidate.id === floorId);
  const spaces = buildingPackage.spaces.filter((space) => space.floorId === floorId);
  const spacesById = new Map(spaces.map((space) => [space.id, space] as const));
  const portals = buildingPackage.portals
    .filter((portal) => portal.floorId === floorId)
    .sort((left, right) => left.id.localeCompare(right.id));

  const cartographicPortals = portals.map((portal): CartographicPortal => {
    const connectedSpace = portal.connects
      .map((spaceId) => spacesById.get(spaceId))
      .filter((space): space is SpaceSource => space !== undefined)
      .sort((left, right) => left.id.localeCompare(right.id))[0];

    return {
      id: portal.id,
      kind: portal.kind,
      position: portal.position,
      width: portal.width,
      angleRadians: connectedSpace
        ? getNearestBoundaryAngle(connectedSpace.polygon, portal.position)
        : 0,
      accessible: portal.accessible,
      restricted: portal.restricted === true,
    };
  });

  const connectorStops = buildingPackage.verticalConnectors
    .flatMap((connector) =>
      connector.stops
        .filter((stop) => stop.floorId === floorId)
        .map(
          (stop): CartographicConnectorStop => ({
            id: `connector-stop:${connector.id}:${floorId}`,
            connectorId: connector.id,
            name: connector.name,
            kind: connector.kind,
            position: stop.position,
            spaceId: stop.spaceId,
            accessible: connector.accessible,
            restricted: connector.restricted === true,
          }),
        ),
    )
    .sort((left, right) => left.id.localeCompare(right.id));

  return {
    floorId,
    walls: floor ? deriveCartographicWalls(spaces, portals, floor.outline) : [],
    portals: cartographicPortals,
    connectorStops,
  };
}
