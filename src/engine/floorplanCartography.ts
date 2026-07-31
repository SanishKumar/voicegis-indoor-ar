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
const PERSPECTIVE_ROTATION_RADIANS = (-7 * Math.PI) / 180;
const PERSPECTIVE_DEPTH_SCALE = 0.72;

export type CartographicWallKind = 'exterior' | 'partition' | 'restricted';
export type CartographicProjectionMode = 'perspective' | 'plan';

export interface CartographicBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
  center: Coordinate2D;
}

export interface CartographicProjection {
  mode: CartographicProjectionMode;
  scale: number;
  padding: number;
  projectedBounds: CartographicBounds;
  width: number;
  height: number;
}

export interface CartographicPortalFrame {
  center: Coordinate2D;
  width: number;
  angleRadians: number;
}

export interface CartographicExtrusionFace {
  id: string;
  points: [Coordinate2D, Coordinate2D, Coordinate2D, Coordinate2D];
  shade: 'front' | 'side';
}

export interface CartographicLabelCandidate {
  id: string;
  center: Coordinate2D;
  width: number;
  height: number;
  priority: number;
  required?: boolean;
}

export interface CartographicLabelPlacement extends CartographicLabelCandidate {
  bounds: CartographicBounds;
}

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

export function getCartographicBounds(points: Coordinate2D[]): CartographicBounds {
  if (points.length === 0) {
    return {
      minX: 0,
      minY: 0,
      maxX: 0,
      maxY: 0,
      width: 0,
      height: 0,
      center: [0, 0],
    };
  }

  const xValues = points.map(([x]) => x);
  const yValues = points.map(([, y]) => y);
  const minX = Math.min(...xValues);
  const minY = Math.min(...yValues);
  const maxX = Math.max(...xValues);
  const maxY = Math.max(...yValues);
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
    center: [(minX + maxX) / 2, (minY + maxY) / 2],
  };
}

export function projectCartographicCoordinate(
  [x, y]: Coordinate2D,
  mode: CartographicProjectionMode,
): Coordinate2D {
  if (mode === 'plan') return [x, y];

  const cosine = Math.cos(PERSPECTIVE_ROTATION_RADIANS);
  const sine = Math.sin(PERSPECTIVE_ROTATION_RADIANS);
  const rotatedX = x * cosine - y * sine;
  const rotatedY = x * sine + y * cosine;
  return [rotatedX, rotatedY * PERSPECTIVE_DEPTH_SCALE];
}

export function createCartographicProjection(
  outline: Coordinate2D[],
  mode: CartographicProjectionMode,
  scale: number,
  padding: number,
): CartographicProjection {
  const projectedBounds = getCartographicBounds(
    outline.map((point) => projectCartographicCoordinate(point, mode)),
  );
  return {
    mode,
    scale,
    padding,
    projectedBounds,
    width: projectedBounds.width * scale + padding * 2,
    height: projectedBounds.height * scale + padding * 2,
  };
}

export function projectCartographicPoint(
  projection: CartographicProjection,
  point: Coordinate2D,
): Coordinate2D {
  const projected = projectCartographicCoordinate(point, projection.mode);
  return [
    (projected[0] - projection.projectedBounds.minX) * projection.scale + projection.padding,
    (projected[1] - projection.projectedBounds.minY) * projection.scale + projection.padding,
  ];
}

export function projectCartographicPortalFrame(
  projection: CartographicProjection,
  portal: Pick<CartographicPortal, 'position' | 'width' | 'angleRadians'>,
): CartographicPortalFrame {
  const direction: Coordinate2D = [Math.cos(portal.angleRadians), Math.sin(portal.angleRadians)];
  const halfWidth = portal.width / 2;
  const start = projectCartographicPoint(projection, [
    portal.position[0] - direction[0] * halfWidth,
    portal.position[1] - direction[1] * halfWidth,
  ]);
  const end = projectCartographicPoint(projection, [
    portal.position[0] + direction[0] * halfWidth,
    portal.position[1] + direction[1] * halfWidth,
  ]);

  return {
    center: [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2],
    width: Math.hypot(end[0] - start[0], end[1] - start[1]),
    angleRadians: Math.atan2(end[1] - start[1], end[0] - start[0]),
  };
}

export function deriveCartographicExtrusionFaces(
  polygon: Coordinate2D[],
  depth: number,
): CartographicExtrusionFace[] {
  if (polygon.length < 2 || depth <= 0) return [];
  const centerY = getCartographicBounds(polygon).center[1];

  return polygon.flatMap((start, index) => {
    const end = polygon[(index + 1) % polygon.length];
    const midpointY = (start[1] + end[1]) / 2;
    if (midpointY < centerY - 0.5) return [];

    return [
      {
        id: `extrusion:${index}`,
        points: [start, end, [end[0], end[1] + depth], [start[0], start[1] + depth]],
        shade: Math.abs(end[0] - start[0]) >= Math.abs(end[1] - start[1]) ? 'front' : 'side',
      } satisfies CartographicExtrusionFace,
    ];
  });
}

function labelBounds(candidate: CartographicLabelCandidate): CartographicBounds {
  const minX = candidate.center[0] - candidate.width / 2;
  const minY = candidate.center[1] - candidate.height / 2;
  const maxX = candidate.center[0] + candidate.width / 2;
  const maxY = candidate.center[1] + candidate.height / 2;
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: candidate.width,
    height: candidate.height,
    center: candidate.center,
  };
}

function boundsOverlap(left: CartographicBounds, right: CartographicBounds, padding: number) {
  return !(
    left.maxX + padding <= right.minX ||
    right.maxX + padding <= left.minX ||
    left.maxY + padding <= right.minY ||
    right.maxY + padding <= left.minY
  );
}

export function placeCartographicLabels(
  candidates: CartographicLabelCandidate[],
  reservedBounds: CartographicBounds[] = [],
  padding = 8,
): CartographicLabelPlacement[] {
  const occupied = [...reservedBounds];
  const placements: CartographicLabelPlacement[] = [];

  [...candidates]
    .sort(
      (left, right) =>
        right.priority - left.priority ||
        Number(right.required === true) - Number(left.required === true) ||
        left.id.localeCompare(right.id),
    )
    .forEach((candidate) => {
      const bounds = labelBounds(candidate);
      if (
        candidate.required !== true &&
        occupied.some((occupiedBounds) => boundsOverlap(bounds, occupiedBounds, padding))
      ) {
        return;
      }
      occupied.push(bounds);
      placements.push({ ...candidate, bounds });
    });

  return placements;
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
    Math.min(1, ((point[0] - start[0]) * deltaX + (point[1] - start[1]) * deltaY) / lengthSquared),
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
        .map((stop): CartographicConnectorStop => ({
          id: `connector-stop:${connector.id}:${floorId}`,
          connectorId: connector.id,
          name: connector.name,
          kind: connector.kind,
          position: stop.position,
          spaceId: stop.spaceId,
          accessible: connector.accessible,
          restricted: connector.restricted === true,
        })),
    )
    .sort((left, right) => left.id.localeCompare(right.id));

  return {
    floorId,
    walls: floor ? deriveCartographicWalls(spaces, portals, floor.outline) : [],
    portals: cartographicPortals,
    connectorStops,
  };
}
