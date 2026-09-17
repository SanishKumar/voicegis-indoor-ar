import { STEP_TYPE, type GraphNode, type RouteStep } from './routingCore';

/**
 * Directions phrased in landmarks.
 *
 * Nobody indoors can judge twelve metres, and there is no street name to fall
 * back on; what people navigate buildings by is the named places they pass.
 * Every turn is described at the place nearest to it, every stretch by the
 * last place it passes, and the arrival by which side the door is on. All of
 * it comes from the destinations the venue package already publishes - a
 * landmark is never invented, and a place that is not near enough to be seen
 * from the route is not named.
 *
 * "Near" is judged from the room, not the pin. A destination's position is
 * the middle of its room, ten metres from the corridor in a hospital ward,
 * but what a visitor walks past is the room's doorway on that corridor. So a
 * landmark carries its room's outline, and adjacency is the distance from the
 * route to that outline.
 */

export interface Landmark {
  id: string;
  name: string;
  floorId: string;
  position: readonly [number, number];
  /** The room the place is in, when the package names one. */
  outline?: ReadonlyArray<readonly [number, number]>;
}

export interface LandmarkOptions {
  /** How near a place's room must be to a corner to describe the turn. */
  turnRadiusMeters?: number;
  /** How far a room may sit from the route's centreline and still be "passed". */
  doorwayMeters?: number;
  /** Stretches shorter than this are not worth a landmark. */
  minimumStretchMeters?: number;
  /** Nearer than this to the door, the destination is straight ahead. */
  aheadMeters?: number;
}

const DEFAULTS: Required<LandmarkOptions> = {
  turnRadiusMeters: 7,
  // Half a wide corridor plus a little: a room's wall is that far from the
  // line a route is drawn along the middle of it.
  doorwayMeters: 5.5,
  minimumStretchMeters: 8,
  aheadMeters: 1.5,
};

/** A doorway hop shorter than this is the step off the corridor, not the corridor. */
const DOORWAY_HOP_METERS = 6;

const TURNS: ReadonlySet<string> = new Set([
  STEP_TYPE.TURN_LEFT,
  STEP_TYPE.TURN_RIGHT,
  STEP_TYPE.SLIGHT_LEFT,
  STEP_TYPE.SLIGHT_RIGHT,
  STEP_TYPE.U_TURN,
]);

type Point = readonly [number, number];

/** The venue's public destinations, which are the places a visitor can see and name. */
export function landmarksFrom(buildingPackage: {
  pois: ReadonlyArray<{
    id: string;
    name: string;
    floorId: string;
    position: Point;
    public?: boolean;
    spaceId?: string;
  }>;
  spaces?: ReadonlyArray<{ id: string; polygon: ReadonlyArray<Point> }>;
}): Landmark[] {
  const outlines = new Map(
    (buildingPackage.spaces ?? []).map((space) => [space.id, space.polygon]),
  );
  return buildingPackage.pois
    .filter((poi) => poi.public !== false && poi.name.trim() !== '')
    .map((poi) => {
      const outline = poi.spaceId === undefined ? undefined : outlines.get(poi.spaceId);
      return {
        id: poi.id,
        name: poi.name,
        floorId: poi.floorId,
        position: [poi.position[0], poi.position[1]] as const,
        ...(outline && outline.length >= 3
          ? { outline: outline.map((p) => [p[0], p[1]] as const) }
          : {}),
      };
    });
}

const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function pointToSegment(point: Point, from: Point, to: Point) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const squared = dx * dx + dy * dy;
  const t =
    squared === 0
      ? 0
      : Math.max(0, Math.min(1, ((point[0] - from[0]) * dx + (point[1] - from[1]) * dy) / squared));
  return distance(point, [from[0] + dx * t, from[1] + dy * t]);
}

function orientation(a: Point, b: Point, c: Point) {
  const value = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return value > 1e-9 ? 1 : value < -1e-9 ? -1 : 0;
}

function segmentsCross(a1: Point, a2: Point, b1: Point, b2: Point) {
  return (
    orientation(a1, a2, b1) !== orientation(a1, a2, b2) &&
    orientation(b1, b2, a1) !== orientation(b1, b2, a2)
  );
}

function segmentToSegment(a1: Point, a2: Point, b1: Point, b2: Point) {
  if (segmentsCross(a1, a2, b1, b2)) return 0;
  return Math.min(
    pointToSegment(a1, b1, b2),
    pointToSegment(a2, b1, b2),
    pointToSegment(b1, a1, a2),
    pointToSegment(b2, a1, a2),
  );
}

/** How far a place is from a segment of route: its room's nearest wall, or its pin. */
function landmarkToSegment(landmark: Landmark, from: Point, to: Point) {
  if (!landmark.outline) return pointToSegment(landmark.position, from, to);
  let best = Infinity;
  for (let index = 0; index < landmark.outline.length; index += 1) {
    const a = landmark.outline[index];
    const b = landmark.outline[(index + 1) % landmark.outline.length];
    best = Math.min(best, segmentToSegment(a, b, from, to));
  }
  return best;
}

function landmarkToPoint(landmark: Landmark, point: Point) {
  if (!landmark.outline) return distance(landmark.position, point);
  let best = Infinity;
  for (let index = 0; index < landmark.outline.length; index += 1) {
    const a = landmark.outline[index];
    const b = landmark.outline[(index + 1) % landmark.outline.length];
    best = Math.min(best, pointToSegment(point, a, b));
  }
  return best;
}

/** How far along a segment a place sits, as a fraction, from its pin. */
function alongFraction(point: Point, from: Point, to: Point) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const squared = dx * dx + dy * dy;
  return squared === 0 ? 0 : ((point[0] - from[0]) * dx + (point[1] - from[1]) * dy) / squared;
}

/** Indices into the path where each step's manoeuvre sits, in path order. */
function stepAnchors(steps: readonly RouteStep[], path: readonly GraphNode[]) {
  let cursor = 0;
  return steps.map((step) => {
    const found = path.findIndex((node, index) => index >= cursor && node.id === step.nodeId);
    if (found >= 0) cursor = found;
    return cursor;
  });
}

function splitCorridor(instruction: string) {
  const onto = instruction.indexOf(' onto ');
  return onto === -1
    ? { head: instruction, corridor: null }
    : { head: instruction.slice(0, onto), corridor: instruction.slice(onto + 6) };
}

export function describeWithLandmarks(
  steps: readonly RouteStep[],
  path: readonly GraphNode[],
  landmarks: readonly Landmark[],
  options: LandmarkOptions = {},
): RouteStep[] {
  if (steps.length === 0 || path.length === 0) return [...steps];
  const config = { ...DEFAULTS, ...options };
  const anchors = stepAnchors(steps, path);
  const first = path[0];
  const last = path[path.length - 1];
  // The ends of the journey are named already; using them as landmarks for
  // other steps would say "past the Pharmacy" on the way to the Pharmacy.
  const endpoints = new Set(
    [first.poi?.name, last.poi?.name].filter((name): name is string => Boolean(name)),
  );
  const usable = landmarks.filter((landmark) => !endpoints.has(landmark.name));
  const onFloor = (floor: string | number | undefined) =>
    usable.filter((landmark) => String(landmark.floorId) === String(floor));

  const nearestTo = (node: GraphNode) => {
    let best: Landmark | null = null;
    let bestDistance = config.turnRadiusMeters;
    for (const landmark of onFloor(node.floor)) {
      const d = landmarkToPoint(landmark, [node.x, node.y]);
      if (d < bestDistance || (d === bestDistance && best !== null && landmark.name < best.name)) {
        best = landmark;
        bestDistance = d;
      }
    }
    return best;
  };

  /**
   * Places passed along a stretch of path, with how far along each is.
   *
   * A room counts as passed when its wall lies beside any segment of the
   * stretch and its pin sits within the stretch's middle nine tenths - not
   * within each segment's, because a corridor is drawn as a chain of short
   * waypoint hops and a room's pin lands squarely on one of them.
   */
  const passedAlong = (start: number, end: number) => {
    const found = new Map<string, { landmark: Landmark; along: number }>();
    let offset = 0;
    for (let index = start; index < end; index += 1) {
      const from = path[index];
      const to = path[index + 1];
      if (to === undefined) break;
      if (String(from.floor) !== String(to.floor)) continue;
      const a: Point = [from.x, from.y];
      const b: Point = [to.x, to.y];
      const length = distance(a, b);
      if (length < 1e-6) continue;
      for (const landmark of onFloor(from.floor)) {
        if (found.has(landmark.id)) continue;
        const t = alongFraction(landmark.position, a, b);
        if (t < -0.01 || t > 1.01) continue;
        if (landmarkToSegment(landmark, a, b) > config.doorwayMeters) continue;
        found.set(landmark.id, { landmark, along: offset + Math.max(0, Math.min(1, t)) * length });
      }
      offset += length;
    }
    const passed = [...found.values()].filter(
      (entry) => entry.along >= 0.05 * offset && entry.along <= 0.95 * offset,
    );
    return { passed, length: offset };
  };

  // A dog-leg round one room is two turns beside the same place. Naming it
  // on the second reads as though there were two of them.
  let namedAtPreviousTurn: string | null = null;

  return steps.map((step, index) => {
    const anchor = anchors[index];
    const node = path[anchor];
    if (node === undefined) return step;

    if (TURNS.has(step.type)) {
      const landmark = nearestTo(node);
      const repeat = landmark !== null && landmark.id === namedAtPreviousTurn;
      namedAtPreviousTurn = landmark?.id ?? null;
      if (landmark === null || repeat) return step;
      const { head, corridor } = splitCorridor(step.instruction);
      return {
        ...step,
        instruction: `${head} at ${landmark.name}${corridor ? ` onto ${corridor}` : ''}`,
      };
    }
    namedAtPreviousTurn = null;

    if (step.type === STEP_TYPE.STRAIGHT || step.type === STEP_TYPE.START) {
      // The last stretch is the walk into the destination's own room; its
      // neighbours are not landmarks on the way.
      if (index === steps.length - 2 && steps[index + 1]?.type === STEP_TYPE.ARRIVE) return step;
      const end = anchors[index + 1] ?? path.length - 1;
      if (end <= anchor) return step;
      const { passed, length } = passedAlong(anchor, end);
      if (length < config.minimumStretchMeters || passed.length === 0) return step;
      // The next manoeuvre may already be described at the place nearest it;
      // that place is not also "passed" on the way there.
      const nextStep = steps[index + 1];
      const nextNode = path[end];
      const nextNamed =
        nextStep !== undefined && TURNS.has(nextStep.type) && nextNode !== undefined
          ? nearestTo(nextNode)
          : null;
      const candidates = passed.filter((entry) => entry.landmark.id !== nextNamed?.id);
      if (candidates.length === 0) return step;
      if (step.type === STEP_TYPE.START) {
        const towards = candidates.reduce((a, b) => (a.along <= b.along ? a : b));
        return { ...step, instruction: `${step.instruction}, towards ${towards.landmark.name}` };
      }
      const pastLast = candidates.reduce((a, b) => (a.along >= b.along ? a : b));
      return { ...step, instruction: `${step.instruction}, past ${pastLast.landmark.name}` };
    }

    if (step.type === STEP_TYPE.ARRIVE && index === steps.length - 1) {
      const side = arrivalSide(path, config.aheadMeters);
      if (side === null) return step;
      return { ...step, instruction: `${step.instruction}, on your ${side}` };
    }

    return step;
  });
}

/**
 * Which side of the corridor the destination is on, from the way it is
 * approached.
 *
 * The end of a route is usually a short hop or two off the corridor and
 * through a doorway. Those hops point at the door, so they say nothing about
 * its side; the corridor walked before them does. Walk back from the end past
 * any short hop that points at the destination, and read the side from the
 * first stretch that does not.
 */
function arrivalSide(path: readonly GraphNode[], aheadMeters: number): 'left' | 'right' | null {
  const destination = path[path.length - 1];
  if (destination === undefined) return null;
  for (let index = path.length - 2; index >= 1; index -= 1) {
    const end = path[index];
    const start = path[index - 1];
    if (
      String(start.floor) !== String(end.floor) ||
      String(end.floor) !== String(destination.floor)
    )
      return null;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-6) continue;
    const ox = destination.x - end.x;
    const oy = destination.y - end.y;
    const offset = Math.hypot(ox, oy);
    if (offset < aheadMeters) continue;
    // Plan +Y is down, so a positive cross product means the destination sits
    // clockwise of the direction of travel: on the right.
    const cross = dx * oy - dy * ox;
    const sine = Math.abs(cross) / (length * offset);
    if (sine < 0.5) {
      // Pointing at the door: a doorway hop to look past, or a corridor that
      // leads straight to it.
      if (length < DOORWAY_HOP_METERS) continue;
      return null;
    }
    return cross > 0 ? 'right' : 'left';
  }
  return null;
}
