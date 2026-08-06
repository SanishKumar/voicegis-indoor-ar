import type { Coordinate2D, PortalSource, SpaceSource } from '@voicegis/spatial-schema';

const GEOMETRY_EPSILON = 1e-6;
const LINE_BUCKET_PRECISION = 4;
const PORTAL_EDGE_TOLERANCE_METERS = 0.18;
const MIN_WALL_BODY_METERS = 0.08;

export type WallBodyKind = 'interior' | 'exterior';

export interface WallBody {
  id: string;
  kind: WallBodyKind;
  spaceIds: string[];
  start: Coordinate2D;
  end: Coordinate2D;
  length: number;
  angleRadians: number;
}

interface SupportLine {
  origin: Coordinate2D;
  direction: Coordinate2D;
}

interface OwnedInterval {
  spaceId: string;
  from: number;
  to: number;
}

function round(value: number, precision: number) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

/**
 * Canonicalises the infinite line an edge lies on. Direction is flipped into a
 * half-plane so an edge and its reverse land in the same bucket, and the signed
 * perpendicular offset separates parallel lines.
 */
function supportLineKey(a: Coordinate2D, b: Coordinate2D) {
  let dx = b[0] - a[0];
  let dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  if (length <= GEOMETRY_EPSILON) return null;
  dx /= length;
  dy /= length;
  if (dx < -GEOMETRY_EPSILON || (Math.abs(dx) <= GEOMETRY_EPSILON && dy < 0)) {
    dx = -dx;
    dy = -dy;
  }
  // Perpendicular distance from the origin to the line.
  const offset = dx * a[1] - dy * a[0];
  return {
    key: `${round(dx, LINE_BUCKET_PRECISION)}:${round(dy, LINE_BUCKET_PRECISION)}:${round(offset, LINE_BUCKET_PRECISION)}`,
    direction: [dx, dy] as Coordinate2D,
  };
}

function project(point: Coordinate2D, line: SupportLine) {
  return (point[0] - line.origin[0]) * line.direction[0] + (point[1] - line.origin[1]) * line.direction[1];
}

function pointAt(line: SupportLine, distance: number): Coordinate2D {
  return [
    round(line.origin[0] + line.direction[0] * distance, 6),
    round(line.origin[1] + line.direction[1] * distance, 6),
  ];
}

function perpendicularDistance(point: Coordinate2D, line: SupportLine) {
  const dx = point[0] - line.origin[0];
  const dy = point[1] - line.origin[1];
  return Math.abs(dx * line.direction[1] - dy * line.direction[0]);
}

function subtractGaps(
  spans: Array<{ from: number; to: number }>,
  gaps: Array<{ from: number; to: number }>,
) {
  let remaining = spans;
  for (const gap of gaps) {
    const next: Array<{ from: number; to: number }> = [];
    for (const span of remaining) {
      if (gap.to <= span.from + GEOMETRY_EPSILON || gap.from >= span.to - GEOMETRY_EPSILON) {
        next.push(span);
        continue;
      }
      if (gap.from > span.from + GEOMETRY_EPSILON) next.push({ from: span.from, to: gap.from });
      if (gap.to < span.to - GEOMETRY_EPSILON) next.push({ from: gap.to, to: span.to });
    }
    remaining = next;
  }
  return remaining;
}

/**
 * Derives one wall body per physical wall for a single floor.
 *
 * Walling each space independently emits a slab per side of every shared
 * boundary, which reads as doubled thickness and z-fights in 3D. Deduplicating
 * by exact endpoints only fixes boundaries that happen to match end to end, so
 * a corridor abutting two rooms of unequal length still doubles.
 *
 * Every edge is instead resolved against the infinite line it lies on. Edges
 * sharing a line are projected to 1D, split at every breakpoint, and each atomic
 * interval is attributed to the spaces covering it: two owners means an interior
 * wall, one means an exterior wall. Portal openings are cut once, after
 * ownership is known, so a door never reopens on the far side.
 *
 * This is a display derivation. The compiled package stays authoritative and
 * routing geometry is never consulted or mutated.
 */
export function buildFloorWallTopology(
  spaces: Pick<SpaceSource, 'id' | 'polygon'>[],
  portals: Pick<PortalSource, 'connects' | 'position' | 'width'>[],
): WallBody[] {
  const groups = new Map<string, { direction: Coordinate2D; edges: OwnedInterval[]; origin: Coordinate2D }>();

  for (const space of [...spaces].sort((left, right) => left.id.localeCompare(right.id))) {
    space.polygon.forEach((start, index) => {
      const end = space.polygon[(index + 1) % space.polygon.length];
      const support = supportLineKey(start, end);
      if (!support) return;
      let group = groups.get(support.key);
      if (!group) {
        group = { direction: support.direction, edges: [], origin: start };
        groups.set(support.key, group);
      }
      const line: SupportLine = { origin: group.origin, direction: group.direction };
      const from = project(start, line);
      const to = project(end, line);
      group.edges.push({
        spaceId: space.id,
        from: Math.min(from, to),
        to: Math.max(from, to),
      });
    });
  }

  const bodies: WallBody[] = [];

  for (const [, group] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const line: SupportLine = { origin: group.origin, direction: group.direction };

    const breakpoints = [...new Set(group.edges.flatMap((edge) => [edge.from, edge.to]))].sort(
      (a, b) => a - b,
    );

    // Attribute each atomic interval to the spaces whose edges cover it.
    const atoms: Array<{ from: number; to: number; spaceIds: string[] }> = [];
    for (let index = 0; index < breakpoints.length - 1; index += 1) {
      const from = breakpoints[index];
      const to = breakpoints[index + 1];
      if (to - from <= GEOMETRY_EPSILON) continue;
      const midpoint = (from + to) / 2;
      const spaceIds = [
        ...new Set(
          group.edges
            .filter((edge) => edge.from < midpoint && edge.to > midpoint)
            .map((edge) => edge.spaceId),
        ),
      ].sort();
      if (spaceIds.length === 0) continue;
      atoms.push({ from, to, spaceIds });
    }

    // Merge neighbouring atoms that belong to the same set of spaces.
    const runs: Array<{ from: number; to: number; spaceIds: string[] }> = [];
    for (const atom of atoms) {
      const previous = runs.at(-1);
      if (
        previous &&
        Math.abs(previous.to - atom.from) <= GEOMETRY_EPSILON &&
        previous.spaceIds.join('|') === atom.spaceIds.join('|')
      ) {
        previous.to = atom.to;
        continue;
      }
      runs.push({ ...atom });
    }

    for (const run of runs) {
      const gaps = portals
        .filter((portal) => run.spaceIds.some((spaceId) => portal.connects.includes(spaceId)))
        .filter((portal) => perpendicularDistance(portal.position, line) <= PORTAL_EDGE_TOLERANCE_METERS)
        .map((portal) => {
          const centre = project(portal.position, line);
          return { from: centre - portal.width / 2, to: centre + portal.width / 2 };
        })
        .filter((gap) => gap.to > run.from + GEOMETRY_EPSILON && gap.from < run.to - GEOMETRY_EPSILON)
        .sort((a, b) => a.from - b.from);

      for (const span of subtractGaps([{ from: run.from, to: run.to }], gaps)) {
        const length = span.to - span.from;
        if (length < MIN_WALL_BODY_METERS) continue;
        const start = pointAt(line, span.from);
        const end = pointAt(line, span.to);
        bodies.push({
          id: `wall:${start[0]},${start[1]}--${end[0]},${end[1]}`,
          kind: run.spaceIds.length > 1 ? 'interior' : 'exterior',
          spaceIds: run.spaceIds,
          start,
          end,
          length: round(length, 6),
          angleRadians: Math.atan2(end[1] - start[1], end[0] - start[0]),
        });
      }
    }
  }

  return bodies.sort((left, right) => left.id.localeCompare(right.id));
}
