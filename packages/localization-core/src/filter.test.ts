import { describe, expect, it } from 'vitest';
import { LocalizationFilter } from './filter';

const initial = {
  kind: 'initial-fix' as const,
  sequence: 0,
  timeMs: 0,
  source: 'manual-anchor' as const,
  position: [1, 9] as [number, number],
  floorId: 'g',
  elevationMeters: 0,
  headingDegrees: 90,
  accuracyMeters: 0.25,
  headingAccuracyDegrees: 5,
};

describe('localization filter', () => {
  it('advances pedestrian motion in heading direction with explicit covariance', () => {
    const filter = new LocalizationFilter();
    filter.apply(initial);
    const estimate = filter.apply({
      kind: 'step',
      sequence: 1,
      timeMs: 1_000,
      source: 'pedometer',
      distanceMeters: 1,
      durationMs: 1_000,
      varianceMeters2: 0.04,
    });

    expect(estimate.position[0]).toBeCloseTo(2, 6);
    expect(estimate.position[1]).toBeCloseTo(9, 6);
    expect(estimate.velocity[0]).toBeCloseTo(1, 6);
    expect(estimate.covariance).toHaveLength(5);
    expect(estimate.quality).toBe('degraded');
  });

  it('uses a position correction to reduce uncertainty', () => {
    const filter = new LocalizationFilter();
    filter.apply(initial);
    const predicted = filter.apply({
      kind: 'step',
      sequence: 1,
      timeMs: 1_000,
      source: 'pedometer',
      distanceMeters: 1,
      durationMs: 1_000,
      varianceMeters2: 0.25,
    });
    const corrected = filter.apply({
      kind: 'position-fix',
      sequence: 2,
      timeMs: 1_000,
      source: 'visual-anchor',
      position: [2.05, 9],
      accuracyMeters: 0.2,
    });

    expect(corrected.positionSigmaMeters).toBeLessThan(predicted.positionSigmaMeters);
    expect(corrected.lastCorrectionTimeMs).toBe(1_000);
    expect(corrected.observationSources).toContain('visual-anchor');
  });

  it('publishes lost quality when correction age and uncertainty exceed limits', () => {
    const filter = new LocalizationFilter();
    filter.apply(initial);
    const estimate = filter.apply({
      kind: 'heading',
      sequence: 1,
      timeMs: 20_000,
      source: 'inertial',
      headingDegrees: 90,
      accuracyDegrees: 20,
    });

    expect(estimate.quality).toBe('lost');
  });

  it('rejects observations before initialization and out-of-order time', () => {
    const filter = new LocalizationFilter();
    expect(() =>
      filter.apply({
        kind: 'heading',
        sequence: 0,
        timeMs: 0,
        source: 'inertial',
        headingDegrees: 0,
        accuracyDegrees: 10,
      }),
    ).toThrow('initial fix');

    filter.apply(initial);
    expect(() =>
      filter.apply({
        kind: 'heading',
        sequence: 1,
        timeMs: -1,
        source: 'inertial',
        headingDegrees: 0,
        accuracyDegrees: 10,
      }),
    ).toThrow('time ordered');
  });
});
