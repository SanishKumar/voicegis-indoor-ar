/*
 * The shapes that make the model soft.
 *
 * A building's outline and its rooms arrive as polygons with square corners,
 * and drawn as they are the model is all points and knife edges. Three small
 * operations take that off without moving anything that matters:
 *
 *   inset    pull a polygon's edges in a little, so neighbouring rooms have a
 *            seam of light between them instead of sharing a line
 *   round    replace each corner with a short curve
 *   stadium  the footprint of a wall run: a line with round ends
 *
 * They work in plan coordinates and return plain point lists. Nothing here
 * knows about a renderer, and none of it is used for routing or clearance:
 * this is how the building is drawn, not where it is.
 */

export type Point = readonly [number, number];

/** Twice the signed area: positive when the points run counter-clockwise (y up). */
function doubleArea(polygon: readonly Point[]): number {
  let total = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const [x1, y1] = polygon[index];
    const [x2, y2] = polygon[(index + 1) % polygon.length];
    total += x1 * y2 - x2 * y1;
  }
  return total;
}

/** A polygon without its repeated or collinear-duplicate points. */
function cleaned(polygon: readonly Point[]): Point[] {
  const points: Point[] = [];
  for (const point of polygon) {
    const last = points[points.length - 1];
    if (last === undefined || Math.hypot(point[0] - last[0], point[1] - last[1]) > 1e-6) {
      points.push(point);
    }
  }
  while (
    points.length > 1 &&
    Math.hypot(
      points[0][0] - points[points.length - 1][0],
      points[0][1] - points[points.length - 1][1],
    ) <= 1e-6
  ) {
    points.pop();
  }
  return points;
}

/**
 * Moves every edge of a polygon inward by `distance` (outward when negative),
 * joining them where the moved edges meet.
 *
 * A room too small to survive the move - one narrower than twice the distance
 * - is returned as it was rather than turned inside out.
 */
export function insetPolygon(polygon: readonly Point[], distance: number): Point[] {
  const points = cleaned(polygon);
  if (points.length < 3 || distance === 0) return points;
  const area = doubleArea(points);
  if (Math.abs(area) < 1e-9) return points;
  // The inward side of an edge is to its left when the points run counter-clockwise.
  const turn = area > 0 ? 1 : -1;

  const moved: Point[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const previous = points[(index + points.length - 1) % points.length];
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const inLength = Math.hypot(current[0] - previous[0], current[1] - previous[1]);
    const outLength = Math.hypot(next[0] - current[0], next[1] - current[1]);
    const inX = (current[0] - previous[0]) / inLength;
    const inY = (current[1] - previous[1]) / inLength;
    const outX = (next[0] - current[0]) / outLength;
    const outY = (next[1] - current[1]) / outLength;
    // Inward normals of the two edges meeting here.
    const n1x = -inY * turn;
    const n1y = inX * turn;
    const n2x = -outY * turn;
    const n2y = outX * turn;
    // Where the two moved edges cross: along the sum of the normals, further
    // out the sharper the corner. Capped so a spike does not shoot away.
    const facing = Math.max(0.25, 1 + n1x * n2x + n1y * n2y);
    moved.push([
      current[0] + ((n1x + n2x) * distance) / facing,
      current[1] + ((n1y + n2y) * distance) / facing,
    ]);
  }

  const movedArea = doubleArea(moved);
  const survived = Math.sign(movedArea) === Math.sign(area);
  const shrunkTooFar = distance > 0 && Math.abs(movedArea) < Math.abs(area) * 0.2;
  return survived && !shrunkTooFar ? moved : points;
}

/**
 * Replaces each corner with a curve that leaves the edges `radius` back from
 * the corner. A corner whose edges are shorter than that is rounded by as
 * much as its shorter edge allows, so two curves never overlap.
 */
export function roundCorners(polygon: readonly Point[], radius: number, steps = 5): Point[] {
  const points = cleaned(polygon);
  if (points.length < 3 || radius <= 0) return points;
  const rounded: Point[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const previous = points[(index + points.length - 1) % points.length];
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const inLength = Math.hypot(current[0] - previous[0], current[1] - previous[1]);
    const outLength = Math.hypot(next[0] - current[0], next[1] - current[1]);
    const cross =
      (current[0] - previous[0]) * (next[1] - current[1]) -
      (current[1] - previous[1]) * (next[0] - current[0]);
    // Nothing to round where the outline runs straight through.
    if (Math.abs(cross) < 1e-6 * inLength * outLength) {
      rounded.push(current);
      continue;
    }
    const cut = Math.min(radius, inLength / 2, outLength / 2);
    const start: Point = [
      current[0] + ((previous[0] - current[0]) / inLength) * cut,
      current[1] + ((previous[1] - current[1]) / inLength) * cut,
    ];
    const end: Point = [
      current[0] + ((next[0] - current[0]) / outLength) * cut,
      current[1] + ((next[1] - current[1]) / outLength) * cut,
    ];
    // A quadratic curve from one edge to the other, pulled towards the corner.
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const a = (1 - t) * (1 - t);
      const b = 2 * (1 - t) * t;
      const c = t * t;
      rounded.push([
        a * start[0] + b * current[0] + c * end[0],
        a * start[1] + b * current[1] + c * end[1],
      ]);
    }
  }
  return rounded;
}

/**
 * The footprint of a wall between two points: a strip `2 * halfWidth` wide
 * with a half-circle at each end.
 */
export function stadium(from: Point, to: Point, halfWidth: number, steps = 3): Point[] {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  if (length < 1e-9) return [];
  const ux = (to[0] - from[0]) / length;
  const uy = (to[1] - from[1]) / length;
  const points: Point[] = [];
  // Round the far end, then the near end, each a half-turn from one side to the other.
  for (const [centre, heading] of [
    [to, Math.atan2(uy, ux)],
    [from, Math.atan2(-uy, -ux)],
  ] as const) {
    for (let step = 0; step <= steps + 1; step += 1) {
      const angle = heading - Math.PI / 2 + (Math.PI * step) / (steps + 1);
      points.push([
        centre[0] + Math.cos(angle) * halfWidth,
        centre[1] + Math.sin(angle) * halfWidth,
      ]);
    }
  }
  return points;
}
