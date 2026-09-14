import { describe, expect, it } from 'vitest';
import { DeadReckoningIntegrator } from './deadReckoning';
import { LocalizationFilter } from './filter';
import { replayRecording } from './replay';
import type {
  HeadingObservation,
  InitialFixObservation,
  LocalizationObservation,
  LocalizationRecording,
  StepObservation,
} from './types';

// Constructed inputs test motion accounting, not handset accuracy or the
// venue-to-compass transform. This is the existing filter's local +Y frame.
const initial: InitialFixObservation = {
  kind: 'initial-fix',
  sequence: 0,
  timeMs: 0,
  source: 'manual-anchor',
  position: [1, 9],
  floorId: 'g',
  elevationMeters: 0,
  headingDegrees: null,
  accuracyMeters: 0.25,
  headingAccuracyDegrees: null,
};

function step(sequence: number, timeMs: number, distanceMeters = 1): StepObservation {
  return {
    kind: 'step',
    sequence,
    timeMs,
    source: 'pedometer',
    distanceMeters,
    durationMs: 1_000,
    varianceMeters2: 0.04,
  };
}

function heading(sequence: number, timeMs: number, headingDegrees = 90): HeadingObservation {
  return {
    kind: 'heading',
    sequence,
    timeMs,
    source: 'inertial',
    headingDegrees,
    accuracyDegrees: 6,
  };
}

function initializedFilter() {
  const filter = new LocalizationFilter({}, { buildingId: 'synthetic', packageHash: 'synthetic-not-surveyed' });
  filter.apply(initial);
  filter.apply({ kind: 'heading-calibration', sequence: 1, timeMs: 0, source: 'replay',
    headingDegrees: 90, accuracyDegrees: 5, reference: 'filter-local', axis: 'travel',
    buildingId: 'synthetic', packageHash: 'synthetic-not-surveyed', provenanceId: 'constructed-eastbound-axis' });
  return filter;
}

describe('step-driven motion accounting', () => {
  it.each([0, 90, 180, 270])(
    'does not coast while standing or rotating (heading %i)',
    (degrees) => {
      const filter = initializedFilter();
      const walked = filter.apply(step(1, 1_000));
      const stopped = filter.apply(heading(2, 2_000, degrees));
      const stillStopped = filter.apply(heading(3, 3_000, degrees));

      expect(stopped.position).toEqual(walked.position);
      expect(stillStopped.position).toEqual(walked.position);
      expect(stopped.velocity).toEqual([0, 0, 0]);
      expect(stillStopped.lastCorrectionTimeMs).toBe(0);
      // Holding the mean is not evidence of stationary accuracy: uncertainty
      // and correction age must still grow while position goes unobserved.
      expect(stillStopped.positionSigmaMeters).toBeGreaterThan(walked.positionSigmaMeters);
    },
  );

  it('counts a stride once even when heading events arrive between strides', () => {
    const filter = initializedFilter();
    filter.apply(step(1, 1_000));
    filter.apply(heading(2, 1_250));
    filter.apply(heading(3, 1_750));
    const walked = filter.apply(step(4, 2_000));

    expect(walked.position).toEqual([3, 9, 0]);
    expect(walked.velocity[0]).toBeCloseTo(1, 12);
  });

  it('does not make distance depend on the heading emission cadence', () => {
    function walk(intervalMs: number) {
      const filter = initializedFilter();
      let sequence = 1;
      let estimate = filter.apply(step(sequence++, 1_000));
      for (let timeMs = 1_000 + intervalMs; timeMs <= 5_000; timeMs += intervalMs) {
        estimate = filter.apply(
          timeMs % 1_000 === 0 ? step(sequence++, timeMs) : heading(sequence++, timeMs),
        );
      }
      return estimate.position;
    }

    expect(walk(50)).toEqual(walk(250));
    expect(walk(250)).toEqual(walk(1_000));
    expect(walk(50)).toEqual([6, 9, 0]);
  });

  it('uses only the next observed stride after a turn, with no old-direction drift', () => {
    const filter = initializedFilter();
    const beforeTurn = filter.apply(step(1, 1_000));
    const turned = filter.apply(heading(2, 2_000, 180));
    const next = filter.apply(step(3, 3_000, 0.7));
    expect(turned.headingDegrees).not.toBeNull();
    const radians = (turned.headingDegrees! * Math.PI) / 180;

    expect(turned.position).toEqual(beforeTurn.position);
    expect(next.position[0]).toBeCloseTo(beforeTurn.position[0] + Math.sin(radians) * 0.7, 12);
    expect(next.position[1]).toBeCloseTo(beforeTurn.position[1] + Math.cos(radians) * 0.7, 12);
  });

  it.each([0.4, 0.99])(
    'does not translate on a floor observation (confidence %s)',
    (confidence) => {
      const filter = initializedFilter();
      const walked = filter.apply(step(1, 1_000));
      const floor = filter.apply({
        kind: 'floor',
        sequence: 2,
        timeMs: 2_000,
        source: 'barometer',
        floorId: 'l1',
        elevationMeters: 4,
        confidence,
      });

      expect(floor.position.slice(0, 2)).toEqual(walked.position.slice(0, 2));
      expect(floor.velocity).toEqual([0, 0, 0]);
      // Neither confidence alone nor the floor hint proves a connector transition.
      expect(floor.floorId).toBe('g');
      expect(floor.floorTransitionPending).toBe(true);
    },
  );

  it('does not carry step velocity through a same-time non-motion observation', () => {
    const filter = initializedFilter();
    const walked = filter.apply(step(1, 1_000));
    const still = filter.apply(heading(2, 1_000));

    expect(still.position).toEqual(walked.position);
    expect(still.velocity).toEqual([0, 0, 0]);
  });

  it('does not infer future travel from a position correction', () => {
    const filter = initializedFilter();
    filter.apply(step(1, 1_000));
    const corrected = filter.apply({
      kind: 'position-fix',
      sequence: 2,
      timeMs: 2_000,
      source: 'visual-anchor',
      position: [3.2, 9.3],
      accuracyMeters: 0.2,
    });
    const later = filter.apply(heading(3, 3_000));
    const walked = filter.apply(step(4, 4_000));

    expect(corrected.velocity).toEqual([0, 0, 0]);
    expect(later.position).toEqual(corrected.position);
    expect(walked.position[0]).toBeCloseTo(corrected.position[0] + 1, 12);
    expect(walked.position[1]).toBeCloseTo(corrected.position[1], 12);
    expect(walked.lastCorrectionTimeMs).toBe(2_000);
  });

  it('ages to lost without inventing travel across an observation gap', () => {
    const filter = initializedFilter();
    const walked = filter.apply(step(1, 1_000));
    const afterGap = filter.apply(heading(2, 31_000));

    expect(afterGap.position).toEqual(walked.position);
    expect(afterGap.velocity).toEqual([0, 0, 0]);
    expect(afterGap.timeMs).toBe(31_000);
    expect(afterGap.quality).toBe('lost');
    expect(afterGap.lastCorrectionTimeMs).toBe(0);
    // An explicitly supplied later stride is not a claim of continuous
    // coverage. Only that displacement is applied; quality remains lost.
    const next = filter.apply(step(3, 32_000));
    expect(next.position).toEqual([3, 9, 0]);
    expect(next.quality).toBe('lost');
  });

  it('does not translate a zero-distance step', () => {
    const filter = initializedFilter();
    const walked = filter.apply(step(1, 1_000));
    filter.apply(heading(2, 1_500, 0));
    const stopped = filter.apply(step(3, 2_000, 0));

    expect(stopped.position).toEqual(walked.position);
    expect(stopped.velocity.every((value) => value === 0)).toBe(true);
  });
});

describe('synthetic motion replay regressions', () => {
  function recording(observations: LocalizationObservation[]): LocalizationRecording {
    return {
      schemaVersion: '0.2.0',
      sessionId: 'synthetic-motion-accounting',
      buildingId: 'synthetic',
      packageHash: 'synthetic-not-surveyed',
      device: { label: 'constructed regression', platform: 'simulation' },
      privacy: { cameraFramesStored: false },
      observations: [
        { ...initial, headingDegrees: null, headingAccuracyDegrees: null },
        { kind: 'heading-calibration', sequence: 1, timeMs: 0, source: 'replay',
          headingDegrees: 90, accuracyDegrees: 5, reference: 'filter-local', axis: 'travel',
          buildingId: 'synthetic', packageHash: 'synthetic-not-surveyed', provenanceId: 'constructed-eastbound-axis' },
        ...observations.slice(1).map((event) => ({ ...event, sequence: event.sequence + 1 })),
      ],
      checkpoints: [],
      routeSegments: [
        {
          id: 'corridor',
          floorId: 'g',
          from: [1, 9],
          to: [20, 9],
          startProgressMeters: 0,
          lengthMeters: 19,
        },
      ],
    };
  }

  it('holds raw position and matched route progress after a stop, then freezes on loss', () => {
    const input = recording([
      initial,
      step(1, 1_000),
      heading(2, 1_500),
      heading(3, 2_000),
      heading(4, 30_000),
    ]);
    const result = replayRecording(input);

    expect(result.estimates.slice(2).map((estimate) => estimate.position)).toEqual(
      Array.from({ length: 4 }, () => [2, 9, 0]),
    );
    expect(result.mapMatches.slice(2, 5).map((match) => match.progressMeters)).toEqual([1, 1, 1]);
    expect(result.mapMatches[5]).toMatchObject({ accepted: false, reason: 'quality-lost' });
    expect(result.runtimeSnapshots[5].guidanceState).toBe('frozen');
    expect(replayRecording(input)).toEqual(result);
    expect(result.report.evidenceStatus).toBe('unofficial-recording');
    expect(result.report.medianHorizontalErrorMeters).toBeNull();
  });

  it('advances exactly the detected displacement through the IMU-to-replay path', () => {
    const integrator = new DeadReckoningIntegrator({}, 1, 90);
    const observations: LocalizationObservation[] = [initial];
    for (let timeMs = 0; timeMs <= 7_000; timeMs += 20) {
      // Four seconds of constructed walking followed by three seconds still.
      observations.push(
        ...integrator.push({
          timeMs,
          accelerationMagnitude:
            timeMs < 4_000 ? 9.81 + 3 * Math.sin((2 * Math.PI * timeMs) / 500) : 9.81,
          headingRateDegreesPerSecond: 0,
        }),
      );
    }
    const result = replayRecording(recording(observations));
    let distance = 0;
    observations.forEach((observation, index) => {
      if (observation.kind === 'step') distance += observation.distanceMeters;
      expect(result.estimates[index + 1].position[0]).toBeCloseTo(1 + distance, 10);
      expect(result.estimates[index + 1].position[1]).toBeCloseTo(9, 10);
    });
    expect(integrator.steps).toBeGreaterThan(0);
    expect(result.estimates.at(-1)!.velocity).toEqual([0, 0, 0]);
  });
});
