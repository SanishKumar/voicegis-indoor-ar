import { describe, expect, it } from 'vitest';
import { matchEstimateToRoute } from './mapMatching';
import type { LocalizationEstimate, RouteMatchSegment } from './types';

const route: RouteMatchSegment[] = [
  {
    id: 'ground-east',
    floorId: 'g',
    from: [0, 0],
    to: [10, 0],
    startProgressMeters: 0,
    lengthMeters: 10,
  },
];

function estimate(overrides: Partial<LocalizationEstimate> = {}): LocalizationEstimate {
  return {
    timeMs: 1_000,
    position: [2, 0.5, 0],
    velocity: [1, 0, 0],
    headingDegrees: 90,
    floorId: 'g',
    covariance: [],
    positionSigmaMeters: 0.4,
    headingSigmaDegrees: 5,
    lastCorrectionTimeMs: 0,
    observationSources: ['pedometer'],
    quality: 'high',
    ...overrides,
  };
}

describe('route-constrained map matching', () => {
  it('projects a same-floor estimate and records raw and matched positions', () => {
    expect(matchEstimateToRoute(estimate(), route)).toMatchObject({
      accepted: true,
      reason: 'matched',
      rawPosition: [2, 0.5],
      matchedPosition: [2, 0],
      progressMeters: 2,
      distanceFromRouteMeters: 0.5,
    });
  });

  it('never uses geometry to rescue a lost estimate', () => {
    expect(
      matchEstimateToRoute(estimate({ quality: 'lost', position: [2, 0, 0] }), route),
    ).toMatchObject({
      accepted: false,
      reason: 'quality-lost',
      matchedPosition: null,
    });
  });

  it('rejects wrong-floor and outside-gate candidates with explicit reasons', () => {
    expect(matchEstimateToRoute(estimate({ floorId: 'l1' }), route).reason).toBe('wrong-floor');
    expect(
      matchEstimateToRoute(estimate({ position: [2, 8, 0], positionSigmaMeters: 0.2 }), route)
        .reason,
    ).toBe('outside-gate');
  });

  it('rejects implausible backward progress while allowing bounded jitter', () => {
    expect(
      matchEstimateToRoute(estimate({ position: [2, 0, 0] }), route, {
        previousProgressMeters: 6,
        maximumBackwardMeters: 1,
      }).reason,
    ).toBe('backward-progress');
    expect(
      matchEstimateToRoute(estimate({ position: [5.4, 0, 0] }), route, {
        previousProgressMeters: 6,
        maximumBackwardMeters: 1,
      }).accepted,
    ).toBe(true);
  });
});
