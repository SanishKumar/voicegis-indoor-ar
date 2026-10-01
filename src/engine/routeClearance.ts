import type { CompiledBuildingPackage } from '@voicegis/map-compiler';
import type { Coordinate2D, PortalSource, SpaceSource } from '@voicegis/spatial-schema';
import { pointInPolygon } from '../../packages/map-compiler/src/geometry';
import type { GraphNode } from './routingCore';

/** A graphic envelope, NOT a person's width or an accessibility certification. */
export const ROUTE_GRAPHIC_WIDTH_METERS = 0.7;
export const MAP_ROUTE_RADIUS_METERS = 0.26;
export const CAMERA_ROUTE_HALF_WIDTH_METERS = 0.32;
export const DESTINATION_RADIUS_METERS = 0.45;
export const CHEVRON_OUTLINE_SCALE = 1.25;
export const CHEVRON_POINTS: readonly Coordinate2D[] = [
  [-0.28, -0.2],
  [0, 0.2],
  [0.28, -0.2],
  [0.28, -0.38],
  [0, -0.02],
  [-0.28, -0.38],
];
export const ROUTE_CLEARANCE_MESSAGE =
  'Route graphics hidden: the mapped walls or openings do not fit the displayed path. Written directions remain available. Check signs and ask venue staff if the way is unclear.';

export interface ClearanceIssue {
  code:
    | 'invalid-path'
    | 'centerline-outside'
    | 'space-policy'
    | 'portal-policy'
    | 'portal-geometry'
    | 'insufficient-clearance';
  sourceId: string;
}
export interface RouteDisplayClearance {
  basis: 'authored-geometry';
  packageHash: string;
  profile: 'standard' | 'wheelchair';
  allowRestricted: boolean;
  widthMeters: number;
  status: 'checked' | 'withheld';
  centerlineValid: boolean;
  issues: ClearanceIssue[];
}

type Segment = [Coordinate2D, Coordinate2D];
type PathPoint = Pick<GraphNode, 'id' | 'x' | 'y' | 'floor'>;
const EPS = 1e-7;
const subtract = (a: Coordinate2D, b: Coordinate2D): Coordinate2D => [a[0] - b[0], a[1] - b[1]];
const dot = (a: Coordinate2D, b: Coordinate2D) => a[0] * b[0] + a[1] * b[1];
const cross = (a: Coordinate2D, b: Coordinate2D) => a[0] * b[1] - a[1] * b[0];
const lerp = (a: Coordinate2D, b: Coordinate2D, t: number): Coordinate2D => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];
function sides(polygon: Coordinate2D[]): Segment[] {
  return polygon.map((a, i) => [a, polygon[(i + 1) % polygon.length]]);
}
function pointDistance(p: Coordinate2D, [a, b]: Segment) {
  const direction = subtract(b, a);
  const lengthSquared = dot(direction, direction);
  const t =
    lengthSquared < EPS * EPS
      ? 0
      : Math.max(0, Math.min(1, dot(subtract(p, a), direction) / lengthSquared));
  const nearest = lerp(a, b, t);
  return Math.hypot(p[0] - nearest[0], p[1] - nearest[1]);
}
/** Exact boundary intersections, including collinear overlap endpoints. No distance sampling. */
function cuts([a, b]: Segment, [c, d]: Segment): number[] {
  const ab = subtract(b, a);
  const cd = subtract(d, c);
  const ca = subtract(c, a);
  const denominator = cross(ab, cd);
  if (Math.abs(denominator) > EPS) {
    const t = cross(ca, cd) / denominator;
    const u = cross(ca, ab) / denominator;
    return t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS
      ? [Math.max(0, Math.min(1, t))]
      : [];
  }
  const lengthSquared = dot(ab, ab);
  if (lengthSquared < EPS * EPS || Math.abs(cross(ca, ab)) > EPS) return [];
  const t0 = dot(ca, ab) / lengthSquared;
  const t1 = dot(subtract(d, a), ab) / lengthSquared;
  if (Math.max(t0, t1) < -EPS || Math.min(t0, t1) > 1 + EPS) return [];
  return [Math.max(0, Math.min(1, t0)), Math.max(0, Math.min(1, t1))];
}
function segmentDistance(a: Segment, b: Segment) {
  if (cuts(a, b).length) return 0;
  return Math.min(
    pointDistance(a[0], b),
    pointDistance(a[1], b),
    pointDistance(b[0], a),
    pointDistance(b[1], a),
  );
}
function intervals(segment: Segment, boundaries: Segment[]) {
  const values = [...new Set([0, 1, ...boundaries.flatMap((side) => cuts(segment, side))])].sort(
    (a, b) => a - b,
  );
  return values
    .slice(1)
    .map((end, index) => lerp(segment[0], segment[1], (values[index] + end) / 2));
}
function segmentInside(segment: Segment, polygons: Coordinate2D[][]) {
  const inside = (p: Coordinate2D) => polygons.some((polygon) => pointInPolygon(p, polygon));
  return [...segment, ...intervals(segment, polygons.flatMap(sides))].every(inside);
}
const pairKey = (a: string, b: string) => (a < b ? `${a}::${b}` : `${b}::${a}`);

/** Infer an opening ONLY from one shared straight boundary, never from a guessed door yaw. */
function openingFor(portal: PortalSource, spaces: SpaceSource[]): Segment | null {
  const containing = spaces.map((space) =>
    sides(space.polygon).filter((side) => pointDistance(portal.position, side) < EPS),
  );
  if (containing.length !== 2 || containing.some((list) => list.length === 0)) return null;
  const first = containing[0][0];
  const delta = subtract(first[1], first[0]);
  const length = Math.hypot(...delta);
  if (length < EPS || !(portal.width > 0) || !Number.isFinite(portal.width)) return null;
  const tangent: Coordinate2D = [delta[0] / length, delta[1] / length];
  if (containing.flat().some((side) => Math.abs(cross(subtract(side[1], side[0]), tangent)) > EPS))
    return null;
  const opening: Segment = [
    [
      portal.position[0] - (tangent[0] * portal.width) / 2,
      portal.position[1] - (tangent[1] * portal.width) / 2,
    ],
    [
      portal.position[0] + (tangent[0] * portal.width) / 2,
      portal.position[1] + (tangent[1] * portal.width) / 2,
    ],
  ];
  // Collinear authored vertices can split one wall; both ends must remain on that wall.
  if (
    containing.some((list) =>
      opening.some((p) => !list.some((side) => pointDistance(p, side) < EPS)),
    )
  )
    return null;
  const normal: Coordinate2D = [-tangent[1] * 0.0001, tangent[0] * 0.0001];
  const forward = lerp(
    portal.position,
    [portal.position[0] + normal[0], portal.position[1] + normal[1]],
    1,
  );
  const back: Coordinate2D = [portal.position[0] - normal[0], portal.position[1] - normal[1]];
  // Coincident/overlapping spaces are not evidence of a traversable shared opening.
  if (
    pointInPolygon(forward, spaces[0].polygon) === pointInPolygon(forward, spaces[1].polygon) ||
    pointInPolygon(back, spaces[0].polygon) === pointInPolygon(back, spaces[1].polygon)
  )
    return null;
  return opening;
}

function subtractOpenings(wall: Segment, openings: Segment[]): Segment[] {
  const direction = subtract(wall[1], wall[0]);
  const lengthSquared = dot(direction, direction);
  if (lengthSquared < EPS * EPS) return [];
  const removed = openings
    .filter((opening) =>
      opening.every((p) => Math.abs(cross(subtract(p, wall[0]), direction)) < EPS),
    )
    .map((opening) =>
      opening
        .map((p) => dot(subtract(p, wall[0]), direction) / lengthSquared)
        .sort((a, b) => a - b),
    )
    .filter(([a, b]) => b > 0 && a < 1)
    .sort((a, b) => a[0] - b[0]);
  const result: Segment[] = [];
  let cursor = 0;
  for (const [a, b] of removed) {
    const start = Math.max(0, a);
    if (start > cursor + EPS) result.push([lerp(...wall, cursor), lerp(...wall, start)]);
    cursor = Math.max(cursor, Math.min(1, b));
  }
  if (cursor < 1 - EPS) result.push([lerp(...wall, cursor), wall[1]]);
  return result;
}

/**
 * Validate the selected graph path, then its continuous swept graphic envelope.
 * Only portals actually used by that path remove walls. Adjacent polygons are
 * never silently merged into an open hall. Furniture is intentionally absent.
 * A failed envelope keeps written guidance; an invalid centerline cannot guide.
 */
export function createRouteGraphicGuard(
  venue: CompiledBuildingPackage,
  path: readonly PathPoint[],
  options: { profile?: 'standard' | 'wheelchair'; allowRestricted?: boolean } = {},
) {
  const profile = options.profile ?? 'standard';
  const allowRestricted = options.allowRestricted === true;
  const issues: ClearanceIssue[] = [];
  const add = (code: ClearanceIssue['code'], sourceId: string) => {
    if (!issues.some((issue) => issue.code === code && issue.sourceId === sourceId))
      issues.push({ code, sourceId });
  };
  const nodes = new Map(venue.routing.nodes.map((node) => [node.id, node]));
  const edges = new Map(venue.routing.edges.map((edge) => [pairKey(edge.from, edge.to), edge]));
  const spaceById = new Map(venue.spaces.map((space) => [space.id, space]));
  const usedSpaces = new Map<string, SpaceSource>();
  const usedPortals = new Map<string, PortalSource>();
  const planar: { segment: Segment; floor: string; edgeId: string }[] = [];
  if (!path.length) add('invalid-path', 'empty');
  for (const point of path) {
    const authored = nodes.get(point.id);
    if (
      !authored ||
      String(point.floor) !== authored.floorId ||
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      Math.hypot(point.x - authored.position[0], point.y - authored.position[1]) > EPS
    ) {
      add('invalid-path', point.id);
    }
    if (authored?.kind === 'poi') {
      const poi = venue.pois.find((item) => item.id === authored.sourceId);
      if (
        !poi ||
        poi.floorId !== String(point.floor) ||
        !pointInPolygon([point.x, point.y], spaceById.get(poi.spaceId)?.polygon ?? [])
      )
        add('invalid-path', point.id);
      if (
        poi &&
        ((!allowRestricted && !poi.public) || (profile === 'wheelchair' && !poi.accessible))
      )
        add('space-policy', poi.id);
    }
  }
  for (let i = 1; i < path.length; i++) {
    const from = path[i - 1];
    const to = path[i];
    const edge = edges.get(pairKey(from.id, to.id));
    if (!edge) {
      add('invalid-path', pairKey(from.id, to.id));
      continue;
    }
    if ((!allowRestricted && edge.restricted) || (profile === 'wheelchair' && !edge.accessible))
      add('space-policy', edge.id);
    if (edge.kind === 'vertical-connector') {
      const connector = venue.verticalConnectors.find((item) => item.id === edge.sourceId);
      const stops = [from, to].map((p) =>
        connector?.stops.find((stop) => stop.floorId === String(p.floor)),
      );
      if (
        !connector ||
        String(from.floor) === String(to.floor) ||
        stops.some(
          (stop, index) =>
            !stop ||
            nodes.get([from, to][index].id)?.kind !== 'connector-stop' ||
            nodes.get([from, to][index].id)?.sourceId !== connector.id ||
            Math.hypot(
              stop.position[0] - [from, to][index].x,
              stop.position[1] - [from, to][index].y,
            ) > EPS,
        )
      )
        add('invalid-path', edge.id);
      for (const stop of stops) {
        const space = stop ? spaceById.get(stop.spaceId) : undefined;
        if (
          space &&
          stop &&
          space.floorId === stop.floorId &&
          pointInPolygon(stop.position, space.polygon)
        )
          usedSpaces.set(space.id, space);
        else add('invalid-path', edge.id);
      }
      if (
        connector &&
        ((!allowRestricted && connector.restricted) ||
          (profile === 'wheelchair' && !connector.accessible))
      )
        add('space-policy', connector.id);
      continue; // A connector schematic is not a floor ribbon.
    }
    const space = edge.spaceId ? spaceById.get(edge.spaceId) : undefined;
    if (!space || space.floorId !== String(from.floor) || space.floorId !== String(to.floor)) {
      add('invalid-path', edge.id);
      continue;
    }
    usedSpaces.set(space.id, space);
    for (const point of [from, to]) {
      const node = nodes.get(point.id);
      const owner =
        node?.kind === 'poi'
          ? venue.pois.find((poi) => poi.id === node.sourceId)?.spaceId
          : node?.kind === 'connector-stop'
            ? venue.verticalConnectors
                .find((connector) => connector.id === node.sourceId)
                ?.stops.find((stop) => stop.floorId === node.floorId)?.spaceId
            : node?.kind === 'space' || node?.kind === 'waypoint'
              ? node.sourceId
              : null;
      if (node?.kind !== 'portal' && owner !== space.id) add('invalid-path', point.id);
    }
    const segment: Segment = [
      [from.x, from.y],
      [to.x, to.y],
    ];
    if (!segmentInside(segment, [space.polygon])) add('centerline-outside', edge.id);
    planar.push({ segment, floor: space.floorId, edgeId: edge.id });
  }
  // A one-point route still needs an authored containing space.
  if (path.length === 1) {
    const node = nodes.get(path[0].id);
    const poi = venue.pois.find((item) => item.id === node?.sourceId);
    const space = spaceById.get(poi?.spaceId ?? node?.sourceId ?? '');
    if (space) {
      usedSpaces.set(space.id, space);
      if (!pointInPolygon([path[0].x, path[0].y], space.polygon))
        add('centerline-outside', path[0].id);
    } else add('invalid-path', path[0].id);
  }
  for (const space of usedSpaces.values()) {
    if ((!allowRestricted && !space.public) || (profile === 'wheelchair' && !space.accessible))
      add('space-policy', space.id);
  }
  for (let i = 0; i < path.length; i++) {
    const point = path[i];
    const node = nodes.get(point.id);
    const adjacent = [
      i > 0 ? edges.get(pairKey(path[i - 1].id, point.id)) : null,
      i + 1 < path.length ? edges.get(pairKey(point.id, path[i + 1].id)) : null,
    ];
    const spaces = new Set(adjacent.map((edge) => edge?.spaceId).filter(Boolean));
    if (node?.kind !== 'portal') {
      if (spaces.size > 1) add('invalid-path', point.id);
      continue;
    }
    const portal = venue.portals.find((item) => item.id === node.sourceId);
    if (
      !portal ||
      portal.floorId !== String(point.floor) ||
      Math.hypot(portal.position[0] - point.x, portal.position[1] - point.y) > EPS ||
      [...spaces].some((id) => !portal.connects.includes(id!))
    ) {
      add('invalid-path', point.id);
      continue;
    }
    // A path touching a door without traversing it does not open the neighbouring room.
    if (spaces.size !== 2) continue;
    if ((!allowRestricted && portal.restricted) || (profile === 'wheelchair' && !portal.accessible))
      add('portal-policy', portal.id);
    usedPortals.set(portal.id, portal);
  }
  const wallsByFloor = new Map<string, Segment[]>();
  const polygonsByFloor = new Map<string, Coordinate2D[][]>();
  const openingsBySpace = new Map<string, Segment[]>();
  for (const portal of usedPortals.values()) {
    const spaces = portal.connects
      .map((id) => spaceById.get(id))
      .filter((s): s is SpaceSource => !!s);
    const opening = openingFor(portal, spaces);
    if (!opening) {
      add('portal-geometry', portal.id);
      continue;
    }
    for (const id of portal.connects)
      openingsBySpace.set(id, [...(openingsBySpace.get(id) ?? []), opening]);
  }
  for (const space of usedSpaces.values()) {
    const walls = sides(space.polygon).flatMap((wall) =>
      subtractOpenings(wall, openingsBySpace.get(space.id) ?? []),
    );
    wallsByFloor.set(space.floorId, [...(wallsByFloor.get(space.floorId) ?? []), ...walls]);
    polygonsByFloor.set(space.floorId, [
      ...(polygonsByFloor.get(space.floorId) ?? []),
      space.polygon,
    ]);
  }
  const centerlineValid = !issues.some((issue) => issue.code !== 'portal-geometry');
  const fitsDisc = (point: Coordinate2D, floor: string, radius: number) => {
    const polygons = polygonsByFloor.get(floor) ?? [];
    return (
      centerlineValid &&
      Number.isFinite(radius) &&
      radius >= 0 &&
      point.every(Number.isFinite) &&
      polygons.some((polygon) => pointInPolygon(point, polygon)) &&
      (wallsByFloor.get(floor) ?? []).every((wall) => pointDistance(point, wall) + EPS >= radius)
    );
  };
  for (const { segment, floor, edgeId } of planar) {
    if (
      (wallsByFloor.get(floor) ?? []).some(
        (wall) => segmentDistance(segment, wall) + EPS < ROUTE_GRAPHIC_WIDTH_METERS / 2,
      )
    ) {
      add('insufficient-clearance', edgeId);
    }
  }
  if (
    path.length === 1 &&
    !fitsDisc([path[0].x, path[0].y], String(path[0].floor), ROUTE_GRAPHIC_WIDTH_METERS / 2)
  )
    add('insufficient-clearance', path[0].id);
  const assessment: RouteDisplayClearance = {
    basis: 'authored-geometry',
    packageHash: venue.manifest.contentHash,
    profile,
    allowRestricted,
    widthMeters: ROUTE_GRAPHIC_WIDTH_METERS,
    status: issues.length ? 'withheld' : 'checked',
    centerlineValid,
    issues,
  };
  const fitsPolygon = (polygon: Coordinate2D[], floor: string) => {
    if (
      assessment.status !== 'checked' ||
      polygon.length < 3 ||
      polygon.some((p) => !p.every(Number.isFinite))
    )
      return false;
    const spaces = polygonsByFloor.get(floor) ?? [];
    const boundary = sides(polygon);
    if (!boundary.every((side) => segmentInside(side, spaces))) return false;
    // Also reject a wall fully enclosed by the footprint (a thin concave notch).
    return (wallsByFloor.get(floor) ?? []).every(
      (wall) =>
        !intervals(wall, boundary).some(
          (p) =>
            pointInPolygon(p, polygon) && boundary.every((side) => pointDistance(p, side) > EPS),
        ),
    );
  };
  return {
    assessment,
    fitsDisc: (point: Coordinate2D, floor: string, radius: number) =>
      assessment.status === 'checked' && fitsDisc(point, floor, radius),
    fitsPolygon,
  };
}

/** Conservative box around the ENTIRE outlined XR chevron, including its tail. */
export function arChevronFootprint(x: number, y: number, bearingDegrees: number): Coordinate2D[] {
  const angle = (bearingDegrees * Math.PI) / 180;
  const forward: Coordinate2D = [Math.sin(angle), -Math.cos(angle)];
  const right: Coordinate2D = [Math.cos(angle), Math.sin(angle)];
  const left = Math.min(...CHEVRON_POINTS.map(([across]) => across)) * CHEVRON_OUTLINE_SCALE;
  const rightEdge = Math.max(...CHEVRON_POINTS.map(([across]) => across)) * CHEVRON_OUTLINE_SCALE;
  const back = Math.min(...CHEVRON_POINTS.map(([, ahead]) => ahead)) * CHEVRON_OUTLINE_SCALE;
  const front = Math.max(...CHEVRON_POINTS.map(([, ahead]) => ahead)) * CHEVRON_OUTLINE_SCALE;
  return [
    [left, back],
    [rightEdge, back],
    [rightEdge, front],
    [left, front],
  ].map(([across, ahead]) => [
    x + right[0] * across + forward[0] * ahead,
    y + right[1] * across + forward[1] * ahead,
  ]);
}
