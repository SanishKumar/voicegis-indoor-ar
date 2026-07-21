import type { Coordinate2D } from '@voicegis/spatial-schema';

const EPSILON = 1e-7;

export function distanceBetween(a: Coordinate2D, b: Coordinate2D) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

export function polygonArea(polygon: Coordinate2D[]) {
  let doubledArea = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    doubledArea += current[0] * next[1] - next[0] * current[1];
  }
  return Math.abs(doubledArea) / 2;
}

export function polygonCentroid(polygon: Coordinate2D[]): Coordinate2D {
  let doubledArea = 0;
  let x = 0;
  let y = 0;

  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    const cross = current[0] * next[1] - next[0] * current[1];
    doubledArea += cross;
    x += (current[0] + next[0]) * cross;
    y += (current[1] + next[1]) * cross;
  }

  if (Math.abs(doubledArea) < EPSILON) {
    const sum = polygon.reduce(
      (result, point) => [result[0] + point[0], result[1] + point[1]] as Coordinate2D,
      [0, 0] as Coordinate2D,
    );
    return [sum[0] / polygon.length, sum[1] / polygon.length];
  }

  return [x / (3 * doubledArea), y / (3 * doubledArea)];
}

function pointToSegmentDistance(point: Coordinate2D, start: Coordinate2D, end: Coordinate2D) {
  const segmentX = end[0] - start[0];
  const segmentY = end[1] - start[1];
  const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY;

  if (segmentLengthSquared < EPSILON) return distanceBetween(point, start);

  const projection = Math.max(
    0,
    Math.min(
      1,
      ((point[0] - start[0]) * segmentX + (point[1] - start[1]) * segmentY) / segmentLengthSquared,
    ),
  );
  return distanceBetween(point, [
    start[0] + projection * segmentX,
    start[1] + projection * segmentY,
  ]);
}

export function pointOnPolygonBoundary(
  point: Coordinate2D,
  polygon: Coordinate2D[],
  tolerance = 0.05,
) {
  return polygon.some((start, index) => {
    const end = polygon[(index + 1) % polygon.length];
    return pointToSegmentDistance(point, start, end) <= tolerance;
  });
}

export function pointInPolygon(point: Coordinate2D, polygon: Coordinate2D[]) {
  if (pointOnPolygonBoundary(point, polygon, EPSILON)) return true;

  let inside = false;
  for (
    let current = 0, previous = polygon.length - 1;
    current < polygon.length;
    previous = current++
  ) {
    const currentPoint = polygon[current];
    const previousPoint = polygon[previous];
    const crossesRay =
      currentPoint[1] > point[1] !== previousPoint[1] > point[1] &&
      point[0] <
        ((previousPoint[0] - currentPoint[0]) * (point[1] - currentPoint[1])) /
          (previousPoint[1] - currentPoint[1]) +
          currentPoint[0];
    if (crossesRay) inside = !inside;
  }
  return inside;
}

export function segmentInsidePolygon(
  start: Coordinate2D,
  end: Coordinate2D,
  polygon: Coordinate2D[],
  samples = 32,
) {
  for (let index = 0; index <= samples; index += 1) {
    const progress = index / samples;
    const point: Coordinate2D = [
      start[0] + (end[0] - start[0]) * progress,
      start[1] + (end[1] - start[1]) * progress,
    ];
    if (!pointInPolygon(point, polygon)) return false;
  }
  return true;
}
