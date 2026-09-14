import type { LocalizationEstimate, MapMatchResult, RouteMatchSegment } from './types';
import { isBuildingFrameCoordinate } from './captureStream';

export interface MapMatchOptions {
  baseGateMeters: number;
  sigmaMultiplier: number;
  maximumGateMeters: number;
  maximumBackwardMeters: number;
  /** Per accepted update, not a speed or a field-validated navigation guarantee. */
  maximumForwardMeters: number;
  ambiguityMarginMeters: number;
  previousProgressMeters: number | null;
  previousFloorId: string | null;
  previousTimeMs: number | null;
  previousSegmentId: string | null;
}

export type MapMatchTuning = Omit<
  MapMatchOptions,
  'previousProgressMeters' | 'previousFloorId' | 'previousTimeMs' | 'previousSegmentId'
>;

const DEFAULT_OPTIONS: Readonly<MapMatchOptions> = Object.freeze({
  baseGateMeters: 1.25,
  sigmaMultiplier: 2.5,
  maximumGateMeters: 6,
  maximumBackwardMeters: 1,
  maximumForwardMeters: 2,
  ambiguityMarginMeters: 0.5,
  previousProgressMeters: null,
  previousFloorId: null,
  previousTimeMs: null,
  previousSegmentId: null,
});

const EPSILON = 1e-6;

function nonNegative(value: number) {
  return Number.isFinite(value) && value >= 0;
}

function validOptions(options: MapMatchOptions) {
  return (
    [
      options.baseGateMeters,
      options.sigmaMultiplier,
      options.maximumGateMeters,
      options.maximumBackwardMeters,
      options.ambiguityMarginMeters,
    ].every(nonNegative) &&
    Number.isFinite(options.maximumForwardMeters) &&
    options.maximumForwardMeters > 0 &&
    options.maximumGateMeters >= options.baseGateMeters &&
    (options.previousProgressMeters === null || nonNegative(options.previousProgressMeters)) &&
    (options.previousTimeMs === null || nonNegative(options.previousTimeMs)) &&
    (options.previousFloorId === null ||
      (typeof options.previousFloorId === 'string' && options.previousFloorId.length > 0)) &&
    (options.previousSegmentId === null ||
      (typeof options.previousSegmentId === 'string' && options.previousSegmentId.length > 0))
  );
}

function validSegment(segment: RouteMatchSegment) {
  const length = Math.hypot(segment.to[0] - segment.from[0], segment.to[1] - segment.from[1]);
  return (
    typeof segment.id === 'string' &&
    segment.id.length > 0 &&
    typeof segment.floorId === 'string' &&
    segment.floorId.length > 0 &&
    segment.from.length === 2 &&
    segment.to.length === 2 &&
    [...segment.from, ...segment.to].every(isBuildingFrameCoordinate) &&
    nonNegative(segment.startProgressMeters) &&
    Number.isFinite(segment.lengthMeters) &&
    segment.lengthMeters > 0 &&
    Math.abs(length - segment.lengthMeters) <= EPSILON &&
    Number.isFinite(segment.startProgressMeters + segment.lengthMeters)
  );
}

interface Projection {
  segment: RouteMatchSegment;
  position: [number, number];
  distanceMeters: number;
  progressMeters: number;
}

function contiguous(first: RouteMatchSegment, second: RouteMatchSegment) {
  return (
    first.floorId === second.floorId &&
    Math.hypot(first.to[0] - second.from[0], first.to[1] - second.from[1]) <= EPSILON &&
    Math.abs(first.startProgressMeters + first.lengthMeters - second.startProgressMeters) <= EPSILON
  );
}

/** Connectivity must come from geometry and cumulative distance, not array order. */
function connected(
  left: RouteMatchSegment,
  right: RouteMatchSegment,
  segments: RouteMatchSegment[],
) {
  if (left.id === right.id) return true;
  const [first, last] =
    left.startProgressMeters < right.startProgressMeters ? [left, right] : [right, left];
  const pending = [first];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current.id === last.id) return true;
    if (visited.has(current.id)) continue;
    visited.add(current.id);
    for (const next of segments) {
      if (
        !visited.has(next.id) &&
        next.startProgressMeters <= last.startProgressMeters + EPSILON &&
        contiguous(current, next)
      )
        pending.push(next);
    }
  }
  return false;
}

/** A shared endpoint, or a straight contiguous subdivision, is one route place.
 * Crossings, retraced legs and different progress values at the same point are not. */
function equivalentPlace(left: Projection, right: Projection, segments: RouteMatchSegment[]) {
  const [first, second] =
    left.segment.startProgressMeters < right.segment.startProgressMeters
      ? [left.segment, right.segment]
      : [right.segment, left.segment];
  if (!connected(first, second, segments)) return false;
  if (
    Math.hypot(left.position[0] - right.position[0], left.position[1] - right.position[1]) <=
      EPSILON &&
    Math.abs(left.progressMeters - right.progressMeters) <= EPSILON
  )
    return true;
  const dot =
    ((first.to[0] - first.from[0]) * (second.to[0] - second.from[0]) +
      (first.to[1] - first.from[1]) * (second.to[1] - second.from[1])) /
    (first.lengthMeters * second.lengthMeters);
  return (
    dot >= 1 - EPSILON &&
    Math.abs(
      Math.abs(left.progressMeters - right.progressMeters) -
        Math.hypot(left.position[0] - right.position[0], left.position[1] - right.position[1]),
    ) <= EPSILON
  );
}

function projectToSegment(position: [number, number], segment: RouteMatchSegment): Projection {
  const deltaX = segment.to[0] - segment.from[0];
  const deltaY = segment.to[1] - segment.from[1];
  const squaredLength = deltaX ** 2 + deltaY ** 2;
  const parameter =
    squaredLength === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((position[0] - segment.from[0]) * deltaX + (position[1] - segment.from[1]) * deltaY) /
              squaredLength,
          ),
        );
  const projected: [number, number] = [
    segment.from[0] + parameter * deltaX,
    segment.from[1] + parameter * deltaY,
  ];
  return {
    segment,
    position: projected,
    distanceMeters: Math.hypot(position[0] - projected[0], position[1] - projected[1]),
    progressMeters: segment.startProgressMeters + parameter * segment.lengthMeters,
  };
}

export function matchEstimateToRoute(
  estimate: LocalizationEstimate,
  segments: RouteMatchSegment[],
  options: Partial<MapMatchOptions> = {},
): MapMatchResult {
  const resolved = { ...DEFAULT_OPTIONS, ...options };
  const valid =
    validOptions(resolved) &&
    nonNegative(estimate.timeMs) &&
    estimate.position.length === 3 &&
    estimate.position.every(isBuildingFrameCoordinate) &&
    nonNegative(estimate.positionSigmaMeters) &&
    typeof estimate.floorId === 'string' &&
    estimate.floorId.length > 0 &&
    ['high', 'degraded', 'lost'].includes(estimate.quality) &&
    (resolved.previousTimeMs === null || estimate.timeMs >= resolved.previousTimeMs) &&
    segments.every(validSegment) &&
    (resolved.previousSegmentId === null ||
      segments.some((segment) => segment.id === resolved.previousSegmentId)) &&
    new Set(segments.map((segment) => segment.id)).size === segments.length;
  const gateMeters = valid
    ? Math.min(
        resolved.maximumGateMeters,
        Math.max(resolved.baseGateMeters, estimate.positionSigmaMeters * resolved.sigmaMultiplier),
      )
    : 0;
  const rawPosition: [number, number] = [estimate.position[0], estimate.position[1]];
  const rejected = (
    reason: MapMatchResult['reason'],
    candidate: Projection | null = null,
  ): MapMatchResult => ({
    timeMs: estimate.timeMs,
    floorId: estimate.floorId,
    accepted: false,
    reason,
    rawPosition,
    matchedPosition: candidate?.position ?? null,
    segmentId: candidate?.segment.id ?? null,
    distanceFromRouteMeters: candidate?.distanceMeters ?? null,
    progressMeters: candidate?.progressMeters ?? null,
    gateMeters,
  });

  if (!valid) return rejected('invalid-input');
  if (segments.length === 0) return rejected('no-route');
  if (estimate.quality === 'lost') return rejected('quality-lost');
  if (
    estimate.floorTransitionPending ||
    (resolved.previousFloorId !== null && resolved.previousFloorId !== estimate.floorId)
  ) {
    return rejected('floor-transition-unverified');
  }
  const sameFloorSegments = segments.filter((segment) => segment.floorId === estimate.floorId);
  if (sameFloorSegments.length === 0) return rejected('wrong-floor');

  const candidates = sameFloorSegments
    .map((segment) => projectToSegment(rawPosition, segment))
    .sort(
      (a, b) =>
        a.distanceMeters - b.distanceMeters ||
        a.progressMeters - b.progressMeters ||
        (a.segment.id < b.segment.id ? -1 : a.segment.id > b.segment.id ? 1 : 0),
    );
  const candidate = candidates[0];
  if (candidate.distanceMeters > gateMeters) return rejected('outside-gate', candidate);
  const ambiguityMeters = Math.max(
    resolved.ambiguityMarginMeters,
    estimate.positionSigmaMeters * resolved.sigmaMultiplier,
  );
  if (
    candidates
      .slice(1)
      .some(
        (other) =>
          other.distanceMeters <= gateMeters &&
          other.distanceMeters - candidate.distanceMeters <= ambiguityMeters &&
          !equivalentPlace(candidate, other, sameFloorSegments),
      )
  ) {
    // Do not publish a preferred projection when the observations cannot choose.
    return rejected('ambiguous-route');
  }
  if (
    resolved.previousProgressMeters !== null &&
    candidate.progressMeters < resolved.previousProgressMeters - resolved.maximumBackwardMeters
  ) {
    return rejected('backward-progress', candidate);
  }
  if (
    resolved.previousProgressMeters !== null &&
    candidate.progressMeters >
      resolved.previousProgressMeters +
        (resolved.previousTimeMs === estimate.timeMs ? 0 : resolved.maximumForwardMeters) +
        EPSILON
  ) {
    return rejected('forward-progress', candidate);
  }
  if (resolved.previousSegmentId !== null) {
    const previous = segments.find((segment) => segment.id === resolved.previousSegmentId)!;
    if (!connected(previous, candidate.segment, sameFloorSegments)) {
      return rejected('route-discontinuity', candidate);
    }
  }

  return {
    timeMs: estimate.timeMs,
    floorId: estimate.floorId,
    accepted: true,
    reason: 'matched',
    rawPosition,
    matchedPosition: candidate.position,
    segmentId: candidate.segment.id,
    distanceFromRouteMeters: candidate.distanceMeters,
    progressMeters: candidate.progressMeters,
    gateMeters,
  };
}

/** A route-scoped diagnostic tracker. Rejections never advance its cursor, and
 * bounded backward jitter never ratchets the high-water mark backwards. A new
 * route/acquisition requires a new instance; there is no implicit floor reset. */
export class RouteMatchTracker {
  private readonly segments: RouteMatchSegment[];
  private readonly options: Partial<MapMatchTuning>;
  private progressMeters: number | null = null;
  private floorId: string | null = null;
  private lastInputTimeMs: number | null = null;
  private segmentId: string | null = null;

  constructor(segments: RouteMatchSegment[], options: Partial<MapMatchTuning> = {}) {
    this.segments = segments.map((segment) => ({
      ...segment,
      from: [...segment.from],
      to: [...segment.to],
    }));
    this.options = { ...options };
  }

  match(estimate: LocalizationEstimate): MapMatchResult {
    const result = matchEstimateToRoute(estimate, this.segments, {
      ...this.options,
      previousProgressMeters: this.progressMeters,
      previousFloorId: this.floorId,
      previousTimeMs: this.lastInputTimeMs,
      previousSegmentId: this.segmentId,
    });
    if (
      nonNegative(estimate.timeMs) &&
      (this.lastInputTimeMs === null || estimate.timeMs >= this.lastInputTimeMs)
    ) {
      this.lastInputTimeMs = estimate.timeMs;
    }
    if (result.accepted && result.progressMeters !== null) {
      if (this.progressMeters === null || result.progressMeters >= this.progressMeters) {
        this.segmentId = result.segmentId;
      }
      this.progressMeters = Math.max(
        this.progressMeters ?? result.progressMeters,
        result.progressMeters,
      );
      this.floorId = estimate.floorId;
    }
    return result;
  }
}
