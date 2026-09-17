import type { GraphNode, RouteStep } from '../engine/routingCore';

/**
 * Guidance as a function of distance travelled along the route.
 *
 * Every navigation product worth copying works this way: a position is matched
 * onto the route, and the instruction, the countdown and the camera all follow
 * from how far along it is. A step counter moved by a button cannot do any of
 * that - it has no idea where the person is between two instructions. With a
 * distance as the single input, the same code serves a walk-through today and
 * a real position source later; only the thing supplying the distance changes.
 */

/**
 * A storey change has no length on the plan, but it takes time to ride a lift
 * and a walk-through needs somewhere to pause. This is that allowance - not a
 * claim about the connector's real travel distance.
 */
export const VERTICAL_TRAVEL_METERS = 6;
/**
 * How close to the end of the route counts as being there. Live tracking
 * reports arrival from this far out, and a visitor who says they are at their
 * destination from within it is believed.
 */
export const ARRIVAL_METERS = 2.5;
/** Two distances along the route closer than this are the same place. */
export const PROGRESS_EPSILON = 0.05;

const EPSILON = PROGRESS_EPSILON;

export interface TrackPoint {
  id: string;
  x: number;
  y: number;
  floor: string;
}

export interface RouteTrack {
  points: TrackPoint[];
  /** Metres from the start at each point. */
  at: number[];
  length: number;
  /** Metres from the start at which each step's manoeuvre happens. */
  stepAt: number[];
}

export interface TrackPosition {
  x: number;
  y: number;
  floor: string;
  /** Unit direction of travel in plan coordinates (+Y is down the plan). */
  heading: [number, number];
  /** True while riding between storeys. */
  vertical: boolean;
}

export interface Guidance {
  /** The step whose stretch of route the position is on. */
  stepIndex: number;
  /** The manoeuvre coming up next. Equal to `stepIndex` only at the end. */
  nextIndex: number;
  metersToNext: number;
  remainingMeters: number;
  atEnd: boolean;
}

type PathNode = Pick<GraphNode, 'id' | 'x' | 'y' | 'floor'>;

/** Cumulative distance along points, counting a storey change as a fixed allowance. */
export function cumulativeDistances(points: ReadonlyArray<Omit<TrackPoint, 'id'>>): number[] {
  const at = [0];
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const leg =
      String(from.floor) === String(to.floor)
        ? Math.hypot(to.x - from.x, to.y - from.y)
        : VERTICAL_TRAVEL_METERS;
    at.push(at[index - 1] + leg);
  }
  return at;
}

export function buildRouteTrack(
  path: readonly PathNode[],
  steps: readonly RouteStep[],
): RouteTrack {
  const points = path.map((node) => ({
    id: node.id,
    x: node.x,
    y: node.y,
    floor: String(node.floor),
  }));
  const at = cumulativeDistances(points);
  const length = at[at.length - 1] ?? 0;

  // Steps are emitted in path order, so each one is looked for from where the
  // previous one was found. A route that passes the same node twice must not
  // send a later manoeuvre back to the first visit.
  let cursor = 0;
  let previous = 0;
  const stepAt = steps.map((step, index) => {
    let meters: number;
    if (index === steps.length - 1 && step.type === 'arrive') {
      meters = length;
    } else {
      const found = points.findIndex((point, i) => i >= cursor && point.id === step.nodeId);
      if (found >= 0) cursor = found;
      meters = at[cursor] ?? 0;
    }
    previous = Math.max(previous, meters);
    return previous;
  });

  return { points, at, length, stepAt };
}

function segmentIndexAt(track: RouteTrack, meters: number) {
  let low = 0;
  let high = track.at.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (track.at[middle] <= meters) low = middle;
    else high = middle - 1;
  }
  return low;
}

function planarHeading(track: RouteTrack, segment: number): [number, number] {
  const direction = (index: number): [number, number] | null => {
    const from = track.points[index];
    const to = track.points[index + 1];
    if (from === undefined || to === undefined || from.floor !== to.floor) return null;
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    return length > 1e-6 ? [(to.x - from.x) / length, (to.y - from.y) / length] : null;
  };
  for (let offset = 0; offset < track.points.length; offset += 1) {
    const behind = direction(segment - offset);
    if (behind) return behind;
    const ahead = direction(segment + offset);
    if (ahead) return ahead;
  }
  return [0, -1];
}

export function clampProgress(track: RouteTrack, meters: number) {
  if (!Number.isFinite(meters)) return 0;
  return Math.min(track.length, Math.max(0, meters));
}

export function positionAt(track: RouteTrack, meters: number): TrackPosition {
  const first = track.points[0];
  if (first === undefined) return { x: 0, y: 0, floor: '', heading: [0, -1], vertical: false };
  const progress = clampProgress(track, meters);
  const index = segmentIndexAt(track, progress);
  const from = track.points[index];
  const to = track.points[index + 1];
  if (to === undefined) {
    return {
      x: from.x,
      y: from.y,
      floor: from.floor,
      heading: planarHeading(track, index - 1),
      vertical: false,
    };
  }
  const span = track.at[index + 1] - track.at[index];
  const t = span > 0 ? (progress - track.at[index]) / span : 0;
  if (from.floor !== to.floor) {
    /*
     * A lift that passes other storeys is still one ride. The path lists each
     * storey it passes, so treating every hop on its own set the visitor down
     * on Level 1 halfway to Level 2. The whole run of storey changes is one
     * ride: on the boarding floor for the first half, on the alighting floor
     * for the second.
     */
    const changesFloor = (segment: number) =>
      track.points[segment + 1] !== undefined &&
      track.points[segment].floor !== track.points[segment + 1].floor;
    let boarding = index;
    while (boarding > 0 && changesFloor(boarding - 1)) boarding -= 1;
    let alighting = index + 1;
    while (changesFloor(alighting)) alighting += 1;
    const halfway = (track.at[boarding] + track.at[alighting]) / 2;
    const boarded = progress < halfway;
    const on = track.points[boarded ? boarding : alighting];
    return {
      x: on.x,
      y: on.y,
      floor: on.floor,
      heading: planarHeading(track, boarded ? boarding - 1 : alighting),
      vertical: true,
    };
  }
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    floor: from.floor,
    heading: planarHeading(track, index),
    vertical: false,
  };
}

/**
 * Where to draw the guidance marker on the floor being read. Inside a storey
 * change the visitor is at one end of the run or the other, and a map showing
 * the other storey should show them at that storey's end of the same lift or
 * stair rather than lose them. Anywhere else this is `positionAt`.
 */
export function positionShownOn(track: RouteTrack, meters: number, floorId: string): TrackPosition {
  const position = positionAt(track, meters);
  if (!position.vertical || position.floor === floorId) return position;
  const run = nextVerticalRun(track, meters);
  if (run === null) return position;
  if (run.toFloorId === floorId) {
    return { ...positionAt(track, run.alightingMeters), floor: floorId, vertical: true };
  }
  if (run.fromFloorId === floorId) {
    return { ...positionAt(track, run.boardingMeters), floor: floorId, vertical: true };
  }
  return position;
}

export function guidanceAt(track: RouteTrack, meters: number): Guidance {
  const count = track.stepAt.length;
  if (count === 0) {
    return { stepIndex: 0, nextIndex: 0, metersToNext: 0, remainingMeters: 0, atEnd: true };
  }
  const progress = clampProgress(track, meters);
  let stepIndex = 0;
  for (let index = 0; index < count; index += 1) {
    if (track.stepAt[index] <= progress + EPSILON) stepIndex = index;
    else break;
  }
  const nextIndex = Math.min(stepIndex + 1, count - 1);
  const remainingMeters = Math.max(0, track.length - progress);
  return {
    stepIndex,
    nextIndex,
    metersToNext: Math.max(0, track.stepAt[nextIndex] - progress),
    remainingMeters,
    atEnd: remainingMeters <= EPSILON,
  };
}

/**
 * Storeys the route walks on. A lift that passes a storey lists it in the
 * path, but nobody gets out there, so it is not one of the route's floors.
 */
export function walkedFloors(track: RouteTrack): string[] {
  const floors: string[] = [];
  track.points.forEach((point, index) => {
    const next = track.points[index + 1];
    if (next !== undefined && next.floor === point.floor && !floors.includes(point.floor)) {
      floors.push(point.floor);
    }
  });
  const last = track.points[track.points.length - 1];
  if (floors.length === 0 && last !== undefined) floors.push(last.floor);
  return floors;
}

/** The step a manual "next" or "previous" lands on, as a distance. */
export function progressForStep(track: RouteTrack, stepIndex: number) {
  const index = Math.min(track.stepAt.length - 1, Math.max(0, Math.trunc(stepIndex)));
  return track.stepAt[index] ?? 0;
}

/*
 * Tracks are derived from a route object that never changes once computed, so
 * each is built once. A WeakMap lets a replaced route and its track be
 * collected together.
 */
const tracks = new WeakMap<object, RouteTrack>();

export function trackForRoute(route: { path: readonly PathNode[]; steps: readonly RouteStep[] }) {
  let track = tracks.get(route);
  if (track === undefined) {
    track = buildRouteTrack(route.path, route.steps);
    tracks.set(route, track);
  }
  return track;
}

/** Plan bearing of travel at a point: clockwise degrees from plan-up (-Y). */
export function bearingAt(track: RouteTrack, meters: number): number {
  const [dx, dy] = positionAt(track, meters).heading;
  const degrees = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return degrees < 0 ? degrees + 360 : degrees;
}

function bearingOfSegment(track: RouteTrack, index: number): number | null {
  const from = track.points[index];
  const to = track.points[index + 1];
  if (from === undefined || to === undefined || from.floor !== to.floor) return null;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.hypot(dx, dy) < 1e-6) return null;
  const degrees = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return degrees < 0 ? degrees + 360 : degrees;
}

/**
 * Every direction of travel the route takes within a window of a point. A
 * person turns somewhere near a corner, not on it, so anything they could
 * legitimately be facing between the corner's approach and its exit counts.
 */
export function bearingsNear(track: RouteTrack, meters: number, windowMeters: number): number[] {
  const bearings: number[] = [];
  const low = meters - windowMeters;
  const high = meters + windowMeters;
  for (let index = 0; index < track.points.length - 1; index += 1) {
    const start = track.at[index];
    const end = track.at[index + 1];
    if (end < low || start > high) continue;
    const bearing = bearingOfSegment(track, index);
    if (bearing !== null && !bearings.some((known) => Math.abs(known - bearing) < 1e-6)) {
      bearings.push(bearing);
    }
  }
  return bearings;
}

export interface VerticalRun {
  /** Progress at which the connector is boarded. */
  boardingMeters: number;
  /** Progress at which the connector is left. */
  alightingMeters: number;
  fromFloorId: string;
  toFloorId: string;
}

/**
 * The next storey change at or after a point, if any. A lift that passes
 * storeys is one run from boarding to alighting.
 */
export function nextVerticalRun(track: RouteTrack, meters: number): VerticalRun | null {
  for (let index = 0; index < track.points.length - 1; index += 1) {
    const from = track.points[index];
    const to = track.points[index + 1];
    if (from.floor === to.floor) continue;
    let end = index + 1;
    while (end < track.points.length - 1 && track.points[end].floor !== track.points[end + 1].floor)
      end += 1;
    // A run already alighted from is behind, even when standing exactly at its exit.
    if (track.at[end] <= meters + EPSILON) continue;
    return {
      boardingMeters: track.at[index],
      alightingMeters: track.at[end],
      fromFloorId: from.floor,
      toFloorId: track.points[end].floor,
    };
  }
  return null;
}
