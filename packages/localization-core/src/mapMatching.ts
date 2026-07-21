import type { LocalizationEstimate, MapMatchResult, RouteMatchSegment } from './types';

export interface MapMatchOptions {
  baseGateMeters: number;
  sigmaMultiplier: number;
  maximumGateMeters: number;
  maximumBackwardMeters: number;
  previousProgressMeters: number | null;
}

const DEFAULT_OPTIONS: MapMatchOptions = {
  baseGateMeters: 1.25,
  sigmaMultiplier: 2.5,
  maximumGateMeters: 6,
  maximumBackwardMeters: 1,
  previousProgressMeters: null,
};

interface Projection {
  segment: RouteMatchSegment;
  position: [number, number];
  distanceMeters: number;
  progressMeters: number;
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
  const gateMeters = Math.min(
    resolved.maximumGateMeters,
    Math.max(resolved.baseGateMeters, estimate.positionSigmaMeters * resolved.sigmaMultiplier),
  );
  const rawPosition: [number, number] = [estimate.position[0], estimate.position[1]];
  const rejected = (
    reason: MapMatchResult['reason'],
    candidate: Projection | null = null,
  ): MapMatchResult => ({
    timeMs: estimate.timeMs,
    accepted: false,
    reason,
    rawPosition,
    matchedPosition: candidate?.position ?? null,
    segmentId: candidate?.segment.id ?? null,
    distanceFromRouteMeters: candidate?.distanceMeters ?? null,
    progressMeters: candidate?.progressMeters ?? null,
    gateMeters,
  });

  if (segments.length === 0) return rejected('no-route');
  if (estimate.quality === 'lost') return rejected('quality-lost');
  const sameFloorSegments = segments.filter((segment) => segment.floorId === estimate.floorId);
  if (sameFloorSegments.length === 0) return rejected('wrong-floor');

  const candidate = sameFloorSegments
    .map((segment) => projectToSegment(rawPosition, segment))
    .sort((a, b) => a.distanceMeters - b.distanceMeters || b.progressMeters - a.progressMeters)[0];
  if (candidate.distanceMeters > gateMeters) return rejected('outside-gate', candidate);
  if (
    resolved.previousProgressMeters !== null &&
    candidate.progressMeters < resolved.previousProgressMeters - resolved.maximumBackwardMeters
  ) {
    return rejected('backward-progress', candidate);
  }

  return {
    timeMs: estimate.timeMs,
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
