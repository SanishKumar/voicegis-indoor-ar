/*
 * The shapes that make the model soft.
 *
 * A building's outline and its rooms arrive as polygons with square corners,
 * and drawn as they are the model is all points and knife edges. Four small
 * operations take that off without moving anything that matters:
 *
 *   inset    pull a polygon's edges in a little, so neighbouring rooms have a
 *            seam of light between them instead of sharing a line
 *   round    replace each corner with a short curve
 *   cut      take the doorways out of an outline, leaving the rim between them
 *   ribbon   the footprint of a rim: a line given a width and round ends
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

/** A doorway: where it is, and how far it opens to either side. */
export interface Opening {
  at: Point;
  halfWidth: number;
}

/**
 * A closed outline with its doorways cut out: the stretches of rim that are
 * left, each as one line of points.
 *
 * A doorway takes its width out of whichever edge it lies beside (within
 * `reach` of it). What remains is joined up across corners, so a rim that
 * runs round three sides of a room between two doors is one line and can be
 * drawn as one piece.
 */
export function cutOutline(
  outline: readonly Point[],
  openings: readonly Opening[],
  reach = 0.6,
): Point[][] {
  const points = cleaned(outline);
  if (points.length < 3) return [];
  const lines: Point[][] = [];
  /** The line being walked, if the rim is unbroken up to here. */
  let current: Point[] | null = null;

  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ux = (b[0] - a[0]) / length;
    const uy = (b[1] - a[1]) / length;
    const along = (distance: number): Point => [a[0] + ux * distance, a[1] + uy * distance];

    const gaps = openings
      .map((opening) => {
        const px = opening.at[0] - a[0];
        const py = opening.at[1] - a[1];
        return {
          along: px * ux + py * uy,
          across: Math.abs(py * ux - px * uy),
          half: opening.halfWidth,
        };
      })
      .filter((hit) => hit.across < reach && hit.along > -hit.half && hit.along < length + hit.half)
      .map((hit): [number, number] => [
        Math.max(0, hit.along - hit.half),
        Math.min(length, hit.along + hit.half),
      ])
      .sort((left, right) => left[0] - right[0]);

    let cursor = 0;
    const runs: Array<[number, number]> = [];
    for (const [from, to] of gaps) {
      if (from > cursor) runs.push([cursor, from]);
      cursor = Math.max(cursor, to);
    }
    if (cursor < length) runs.push([cursor, length]);

    // A gap at the very start of this edge ends whatever line reached it.
    if (runs.length === 0 || runs[0][0] > 0) current = null;
    for (const [from, to] of runs) {
      if (from === 0 && current !== null) {
        current.push(along(to));
      } else {
        current = [along(from), along(to)];
        lines.push(current);
      }
      if (to < length) current = null;
    }
  }

  // The walk started at an arbitrary corner. If the rim was unbroken there,
  // the last line and the first are one line.
  if (current !== null && lines.length > 1 && lines[0] !== current) {
    const first = lines[0];
    if (Math.hypot(first[0][0] - points[0][0], first[0][1] - points[0][1]) < 1e-6) {
      current.push(...first.slice(1));
      lines.shift();
    }
  }
  return lines.filter((line) => lineLength(line) > 0.05);
}

function lineLength(line: readonly Point[]) {
  let total = 0;
  for (let index = 1; index < line.length; index += 1) {
    total += Math.hypot(line[index][0] - line[index - 1][0], line[index][1] - line[index - 1][1]);
  }
  return total;
}

/**
 * The footprint of a rim that follows a line: `2 * halfWidth` wide all the
 * way along, mitred where the line turns, with a round end at each end.
 *
 * One outline for the whole line, however many points it has. Built as a row
 * of separate round-ended pieces, the rim of a room came to some fifteen
 * hundred triangles; as one ribbon it is about a tenth of that.
 */
export function ribbon(line: readonly Point[], halfWidth: number, capSteps = 2): Point[] {
  // Unlike an outline, the two ends of a line may be the same point.
  const points: Point[] = [];
  for (const point of line) {
    const previous = points[points.length - 1];
    if (
      previous === undefined ||
      Math.hypot(point[0] - previous[0], point[1] - previous[1]) > 1e-6
    ) {
      points.push(point);
    }
  }
  if (points.length < 2 || halfWidth <= 0) return [];
  const last = points.length - 1;
  const direction = (from: Point, to: Point): Point => {
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    return [(to[0] - from[0]) / length, (to[1] - from[1]) / length];
  };

  const left: Point[] = [];
  const right: Point[] = [];
  for (let index = 0; index <= last; index += 1) {
    const before = index > 0 ? direction(points[index - 1], points[index]) : null;
    const after = index < last ? direction(points[index], points[index + 1]) : null;
    const [ax, ay] = (before ?? after) as Point;
    const [bx, by] = (after ?? before) as Point;
    // The left-hand normals of the two edges meeting here, and the mitre between them.
    const facing = Math.max(0.35, 1 + ax * bx + ay * by);
    const mx = ((-ay - by) * halfWidth) / facing;
    const my = ((ax + bx) * halfWidth) / facing;
    left.push([points[index][0] + mx, points[index][1] + my]);
    right.push([points[index][0] - mx, points[index][1] - my]);
  }

  /** The points of a half-turn round an end, between the two sides and not including them. */
  const cap = (centre: Point, heading: number): Point[] => {
    const arc: Point[] = [];
    for (let step = 1; step <= capSteps; step += 1) {
      const angle = heading + Math.PI / 2 - (Math.PI * step) / (capSteps + 1);
      arc.push([centre[0] + Math.cos(angle) * halfWidth, centre[1] + Math.sin(angle) * halfWidth]);
    }
    return arc;
  };
  const [ex, ey] = direction(points[last - 1], points[last]);
  const [sx, sy] = direction(points[0], points[1]);
  return [
    ...left,
    // Round the far end, from the left side past the tip to the right.
    ...cap(points[last], Math.atan2(ey, ex)),
    ...right.reverse(),
    // And the near end, from the right side back to the left.
    ...cap(points[0], Math.atan2(-sy, -sx)),
  ];
}
