import type { Coordinate2D, PortalSource, SpaceSource } from '@voicegis/spatial-schema';

const PORTAL_EDGE_TOLERANCE_METERS = 0.18;
const MIN_WALL_SEGMENT_METERS = 0.08;

export interface WallSegment {
  start: Coordinate2D;
  end: Coordinate2D;
  length: number;
  angleRadians: number;
}

export interface PolygonBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  depth: number;
  center: Coordinate2D;
}

interface EdgeProjection {
  distance: number;
  offset: number;
}

function distanceBetween(start: Coordinate2D, end: Coordinate2D): number {
  return Math.hypot(end[0] - start[0], end[1] - start[1]);
}

function projectPointOntoEdge(
  point: Coordinate2D,
  start: Coordinate2D,
  end: Coordinate2D,
): EdgeProjection {
  const deltaX = end[0] - start[0];
  const deltaY = end[1] - start[1];
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;

  if (lengthSquared === 0) return { distance: distanceBetween(point, start), offset: 0 };

  const unclampedOffset =
    ((point[0] - start[0]) * deltaX + (point[1] - start[1]) * deltaY) / lengthSquared;
  const offset = Math.max(0, Math.min(1, unclampedOffset));
  const projected: Coordinate2D = [start[0] + deltaX * offset, start[1] + deltaY * offset];

  return { distance: distanceBetween(point, projected), offset };
}

function pointAlongEdge(start: Coordinate2D, end: Coordinate2D, offset: number): Coordinate2D {
  return [start[0] + (end[0] - start[0]) * offset, start[1] + (end[1] - start[1]) * offset];
}

function createWallSegment(start: Coordinate2D, end: Coordinate2D): WallSegment {
  return {
    start,
    end,
    length: distanceBetween(start, end),
    angleRadians: Math.atan2(end[1] - start[1], end[0] - start[0]),
  };
}

/**
 * Converts a semantic space boundary into wall runs and removes portal-width
 * intervals. The source package remains authoritative; this is a visual
 * derivation and never mutates routing geometry.
 */
export function buildSpaceWallSegments(
  space: Pick<SpaceSource, 'id' | 'polygon'>,
  portals: Pick<PortalSource, 'connects' | 'position' | 'width'>[],
): WallSegment[] {
  const relevantPortals = portals.filter((portal) => portal.connects.includes(space.id));
  const segments: WallSegment[] = [];

  space.polygon.forEach((start, index) => {
    const end = space.polygon[(index + 1) % space.polygon.length];
    const edgeLength = distanceBetween(start, end);
    if (edgeLength === 0) return;

    const gaps = relevantPortals
      .map((portal) => {
        const projection = projectPointOntoEdge(portal.position, start, end);
        if (projection.distance > PORTAL_EDGE_TOLERANCE_METERS) return null;

        const halfWidthAsOffset = Math.min(portal.width / edgeLength / 2, 0.49);
        return {
          start: Math.max(0, projection.offset - halfWidthAsOffset),
          end: Math.min(1, projection.offset + halfWidthAsOffset),
        };
      })
      .filter((gap): gap is { start: number; end: number } => gap !== null)
      .sort((left, right) => left.start - right.start);

    const mergedGaps = gaps.reduce<Array<{ start: number; end: number }>>((merged, gap) => {
      const previous = merged.at(-1);
      if (!previous || gap.start > previous.end) {
        merged.push({ ...gap });
      } else {
        previous.end = Math.max(previous.end, gap.end);
      }
      return merged;
    }, []);

    let cursor = 0;
    [...mergedGaps, { start: 1, end: 1 }].forEach((gap) => {
      const wallStart = pointAlongEdge(start, end, cursor);
      const wallEnd = pointAlongEdge(start, end, gap.start);
      if (distanceBetween(wallStart, wallEnd) >= MIN_WALL_SEGMENT_METERS) {
        segments.push(createWallSegment(wallStart, wallEnd));
      }
      cursor = Math.max(cursor, gap.end);
    });
  });

  return segments;
}

export function getNearestBoundaryAngle(polygon: Coordinate2D[], point: Coordinate2D): number {
  let nearestDistance = Number.POSITIVE_INFINITY;
  let nearestAngle = 0;

  polygon.forEach((start, index) => {
    const end = polygon[(index + 1) % polygon.length];
    const projection = projectPointOntoEdge(point, start, end);
    if (projection.distance < nearestDistance) {
      nearestDistance = projection.distance;
      nearestAngle = Math.atan2(end[1] - start[1], end[0] - start[0]);
    }
  });

  return nearestAngle;
}

export function getPolygonBounds(polygon: Coordinate2D[]): PolygonBounds {
  const xValues = polygon.map(([x]) => x);
  const yValues = polygon.map(([, y]) => y);
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
    depth: maxY - minY,
    center: [(minX + maxX) / 2, (minY + maxY) / 2],
  };
}
