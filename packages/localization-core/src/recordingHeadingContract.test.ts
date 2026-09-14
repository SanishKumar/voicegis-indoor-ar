import { describe, expect, it } from 'vitest';
import { CheckpointAdapter } from './checkpoints';
import { DeadReckoningIntegrator } from './deadReckoning';
import { LocalizationFilter } from './filter';
import { replayRecording, validateRecording } from './replay';
import { LocalizationRuntimeController } from './runtimeState';
import type {
  HeadingCalibrationObservation,
  LocalizationObservation,
  LocalizationRecording,
} from './types';

const anchor = {
  id: 'entry',
  floorId: 'g',
  kind: 'qr' as const,
  position: [2, 3] as [number, number],
  headingDegrees: 270,
  payload: 'test:entry',
};
const initial = () =>
  new CheckpointAdapter([anchor]).resolve({ timeMs: 0, kind: 'qr', payload: anchor.payload })
    .observations[0];
const calibration = (timeMs = 0): HeadingCalibrationObservation => ({
  kind: 'heading-calibration',
  timeMs,
  sequence: 1,
  source: 'replay',
  headingDegrees: 90,
  accuracyDegrees: 5,
  reference: 'filter-local',
  axis: 'travel',
  buildingId: 'test',
  packageHash: 'a'.repeat(64),
  provenanceId: 'synthetic-travel-axis',
});
const step = (timeMs: number): LocalizationObservation => ({
  kind: 'step',
  timeMs,
  sequence: 2,
  source: 'pedometer',
  distanceMeters: 1,
  durationMs: 100,
  varianceMeters2: 0.04,
});
const unavailable = (timeMs: number): LocalizationObservation => ({
  kind: 'heading-unavailable',
  timeMs,
  sequence: 2,
  source: 'inertial',
});
function recording(
  events: LocalizationObservation[] = [initial(), calibration(), step(100)],
): LocalizationRecording {
  return {
    schemaVersion: '0.2.0',
    sessionId: 'heading-contract',
    buildingId: 'test',
    packageHash: 'a'.repeat(64),
    device: { label: 'constructed fixture', platform: 'simulation' },
    privacy: { cameraFramesStored: false },
    checkpoints: [],
    observations: events.map((event, sequence) => ({ ...event, sequence })),
  };
}

describe('position-only recording 0.2', () => {
  it('also refuses legacy initial heading when the filter is called directly', () => {
    const legacy = { ...initial(), headingDegrees: 90, headingAccuracyDegrees: 22 };
    expect(() =>
      new LocalizationFilter(
        {},
        {
          buildingId: 'test',
          packageHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
      ).apply(legacy as LocalizationObservation),
    ).toThrow('position-only');
  });
  it('round-trips unknown heading without converting it into zero or NaN', () => {
    const result = replayRecording(recording([initial(), step(100)]));
    expect(result.estimates.map((estimate) => estimate.position)).toEqual([
      [2, 3, 0],
      [2, 3, 0],
    ]);
    for (const estimate of result.estimates) {
      expect(estimate.headingDegrees).toBeNull();
      expect(estimate.headingSigmaDegrees).toBeNull();
      expect(estimate.velocity).toEqual([0, 0, 0]);
    }
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(result.runtimeSnapshots.every((state) => state.guidanceState === 'frozen')).toBe(true);
  });

  it('adds uncertainty for an unlocated stride without inventing displacement', () => {
    const result = replayRecording(recording([initial(), step(0)]));
    expect(result.estimates[1].position).toEqual(result.estimates[0].position);
    expect(result.estimates[1].positionSigmaMeters).toBeGreaterThan(
      result.estimates[0].positionSigmaMeters,
    );
  });

  it('uses a later independent calibration only for later strides', () => {
    const input = recording([initial(), step(100), calibration(200), step(300)]);
    // Direction can resume guidance only when a route also has an accepted match.
    input.routeSegments = [{ id: 'east', floorId: 'g', from: [2, 3], to: [12, 3],
      startProgressMeters: 0, lengthMeters: 10 }];
    const result = replayRecording(input);
    expect(result.estimates.map((estimate) => estimate.position)).toEqual([
      [2, 3, 0],
      [2, 3, 0],
      [2, 3, 0],
      [3, 3, 0],
    ]);
    expect(result.estimates[2].headingDegrees).toBe(90);
    expect(result.runtimeSnapshots[2].guidanceState).not.toBe('frozen');
    expect(result.report.evidenceStatus).toBe('unofficial-recording');
    expect(result.report.checkpointErrors).toEqual([]);
  });

  it('does not let a later QR overwrite an independently established heading', () => {
    const adapter = new CheckpointAdapter([anchor]);
    const first = adapter.resolve({ timeMs: 0, kind: 'qr', payload: anchor.payload }).observations;
    const next = adapter.resolve({ timeMs: 100, kind: 'qr', payload: anchor.payload }).observations;
    const result = replayRecording(recording([...first, calibration(), ...next, step(200)]));
    expect(result.estimates.at(-1)!.headingDegrees).toBe(90);
    expect(result.estimates.at(-1)!.position).toEqual([3, 3, 0]);
  });

  it('freezes again after heading is invalidated and resumes only with new calibration', () => {
    const result = replayRecording(
      recording([
        initial(),
        calibration(),
        step(100),
        unavailable(200),
        step(300),
        calibration(400),
        step(500),
      ]),
    );
    expect(result.estimates[3].headingDegrees).toBeNull();
    expect(result.estimates[4].position).toEqual([3, 3, 0]);
    expect(result.estimates[6].position).toEqual([4, 3, 0]);
    expect(result.runtimeSnapshots[4].guidanceState).toBe('frozen');
  });

  it('never treats an unseeded gyro integrator as north-referenced', () => {
    const integrator = new DeadReckoningIntegrator();
    const outputs = [0, 500, 1_000].flatMap((timeMs) =>
      integrator.push({
        timeMs,
        accelerationMagnitude: 9.81,
        headingRateDegreesPerSecond: 90,
      }),
    );
    expect(integrator.heading).toBeNull();
    expect(outputs.map((event) => event.kind)).toEqual(Array(3).fill('heading-unavailable'));
  });

  it('requires an explicit migration instead of silently reinterpreting 0.1', () => {
    const legacy = { ...recording(), schemaVersion: '0.1.0' };
    expect(() => replayRecording(legacy as LocalizationRecording)).toThrow(
      'legacy headings cannot be relabelled',
    );
  });

  it('refuses relabelled legacy heading fields on a 0.2 initial fix', () => {
    expect(() =>
      validateRecording(
        recording([
          {
            ...initial(),
            headingDegrees: 90,
            headingAccuracyDegrees: 22,
          } as unknown as LocalizationObservation,
        ]),
      ),
    ).toThrow('must leave heading');
  });

  it.each([false, true])(
    'refuses inertial headings without calibration (invalidated %s)',
    (invalidated) => {
      const events = invalidated ? [initial(), calibration(), unavailable(0)] : [initial()];
      events.push({
        kind: 'heading',
        sequence: 3,
        timeMs: 100,
        source: 'inertial',
        headingDegrees: 90,
        accuracyDegrees: 10,
      });
      expect(() => validateRecording(recording(events))).toThrow('prior independent calibration');
    },
  );

  it.each([
    ['source', 'manual-anchor'],
    ['source', 'inertial'],
    ['reference', 'true-north'],
    ['axis', 'camera-forward'],
    ['buildingId', 'other'],
    ['packageHash', 'b'.repeat(64)],
    ['provenanceId', '   '],
    ['headingDegrees', -1],
    ['headingDegrees', 360],
    ['headingDegrees', NaN],
    ['accuracyDegrees', null],
    ['accuracyDegrees', 0],
    ['accuracyDegrees', 181],
    ['accuracyDegrees', Infinity],
  ])('refuses unqualified calibration %s=%s', (key, value) => {
    const forged = { ...calibration(), [key as string]: value } as HeadingCalibrationObservation;
    expect(() => validateRecording(recording([initial(), forged]))).toThrow();
    const filter = new LocalizationFilter(
      {},
      {
        buildingId: 'test',
        packageHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
    );
    filter.apply(initial());
    expect(() => filter.apply(forged)).toThrow();
  });

  it.each([NaN, Infinity, -1])('refuses a non-occurrence timestamp %s', (timeMs) => {
    expect(() => validateRecording(recording([initial(), calibration(timeMs)]))).toThrow(
      'finite non-negative times',
    );
  });

  it('keeps a lost session gated after heading becomes unknown and is recalibrated', () => {
    const filter = new LocalizationFilter(
      {},
      {
        buildingId: 'test',
        packageHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
    );
    const runtime = new LocalizationRuntimeController();
    runtime.update(filter.apply(initial()));
    runtime.update(filter.apply(calibration()));
    expect(runtime.update(filter.apply(step(30_000))).localizationState).toBe('lost');
    runtime.update(filter.apply(unavailable(30_000)));
    const fixed = filter.apply({
      kind: 'position-fix',
      source: 'manual-anchor',
      sequence: 5,
      timeMs: 30_000,
      position: [2, 3],
      accuracyMeters: 0.1,
    });
    expect(runtime.update(fixed).guidanceState).toBe('frozen');
    expect(runtime.update(filter.apply(calibration(30_000))).localizationState).toBe(
      'relocalizing',
    );
    expect(() => runtime.confirmRelocalization(fixed, anchor.id)).toThrow(
      'independently established heading',
    );
  });
});
