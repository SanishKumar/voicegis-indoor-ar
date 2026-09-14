import { describe, expect, it } from 'vitest';
import { DeadReckoningIntegrator, type ImuSample } from './deadReckoning';
import { deriveRecording, SessionRecorder, buildEvidenceReport } from './recorder';
import type { LifecycleEvent } from './captureStream';
import type { LocalizationObservation } from './types';
import { LocalizationFilter } from './filter';
import { LocalizationRuntimeController } from './runtimeState';

const sample = (
  timeMs: number,
  accelerationMagnitude = 9.81,
  headingRateDegreesPerSecond: number | null = 0,
): ImuSample => ({ timeMs, accelerationMagnitude, headingRateDegreesPerSecond });
const steps = (values: LocalizationObservation[]) =>
  values.filter((value) => value.kind === 'step');

describe('inertial continuity boundaries', () => {
  it('invalidates heading immediately, before a stride from the same sample', () => {
    const integrator = new DeadReckoningIntegrator({}, 0, 90);
    integrator.push(sample(0));
    integrator.push(sample(20, 13));
    const lost = integrator.push(sample(40, 9.81, null));
    expect(lost[0]?.kind).toBe('heading-unavailable');
    expect(steps(lost)).toHaveLength(1); // Acceleration is still continuous.
    expect(integrator.heading).toBeNull();
    integrator.push(sample(60, 9.81, 30));
    expect(integrator.heading).toBeNull();
  });

  it.each([1000, 1001, 10_000])(
    'does not integrate yaw or finish a peak across a %d ms gap',
    (gap) => {
      const integrator = new DeadReckoningIntegrator({}, 0, 90);
      integrator.push(sample(0));
      integrator.push(sample(20, 13));
      const after = integrator.push(sample(20 + gap, 9.81, 80));
      expect(integrator.heading).toBeNull();
      expect(steps(after)).toEqual([]);
      expect(after[0]?.kind).toBe('heading-unavailable');
    },
  );

  it('does not finish a peak from two samples with the same timestamp', () => {
    const integrator = new DeadReckoningIntegrator({}, 0, 90);
    integrator.push(sample(0));
    integrator.push(sample(20, 13));
    expect(steps(integrator.push(sample(20)))).toEqual([]);
    expect(integrator.heading).toBeNull();
  });

  it.each([NaN, Infinity, -Infinity])(
    'turns an unusable rate %s into unknown, not a poisoned heading',
    (rate) => {
      const integrator = new DeadReckoningIntegrator({}, 0, 90);
      integrator.push(sample(0));
      expect(integrator.push(sample(20, 9.81, rate))[0]?.kind).toBe('heading-unavailable');
      expect(integrator.heading).toBeNull();
    },
  );

  it('recalibration never applies a new rate to time or peaks before calibration', () => {
    const integrator = new DeadReckoningIntegrator({}, 0, 90);
    integrator.push(sample(0));
    integrator.push(sample(20, 13));
    integrator.syncHeading(180);
    expect(steps(integrator.push(sample(500, 9.81, 90)))).toEqual([]);
    expect(integrator.heading).toBe(180);
    integrator.push(sample(520, 9.81, 90));
    expect(integrator.heading).toBeCloseTo(181.8);
  });

  it('invalid acceleration clears the baseline so a later full stride can recover', () => {
    const integrator = new DeadReckoningIntegrator({}, 0, 90);
    integrator.push(sample(0));
    integrator.push(sample(20, NaN));
    integrator.push(sample(40));
    integrator.push(sample(60, 13));
    const after = integrator.push(sample(80));
    expect(integrator.heading).toBeNull();
    expect(steps(after)).toHaveLength(1);
  });

  it('rejects a regressed clock before changing sequence or detector state', () => {
    const integrator = new DeadReckoningIntegrator({}, 0, 90);
    integrator.push(sample(100));
    const sequence = integrator.nextSequence;
    expect(() => integrator.push(sample(90))).toThrow(/time/i);
    expect(integrator.nextSequence).toBe(sequence);
    expect(integrator.heading).toBe(90);
  });

  it.each([0, -1, NaN, Infinity])(
    'rejects an invalid sample-gap configuration %s',
    (maximumSampleGapMs) => {
      expect(() => new DeadReckoningIntegrator({ maximumSampleGapMs })).toThrow(
        /maximumSampleGapMs/,
      );
    },
  );

  it('uses a separate configurable continuity limit, inclusive at the boundary', () => {
    const integrator = new DeadReckoningIntegrator(
      { maximumSampleGapMs: 100, maximumStepIntervalMs: 2_000 },
      0,
      90,
    );
    integrator.push(sample(0));
    integrator.push(sample(99, 9.81, 10));
    expect(integrator.heading).toBeCloseTo(90.99);
    integrator.push(sample(199, 9.81, 10));
    expect(integrator.heading).toBeNull();
  });

  it.each([NaN, Infinity, -1])('rejects invalid time %s without changing state', (timeMs) => {
    const integrator = new DeadReckoningIntegrator({}, 0, 90);
    integrator.push(sample(0));
    const sequence = integrator.nextSequence;
    expect(() => integrator.push(sample(timeMs))).toThrow(/time/i);
    expect(() => integrator.interrupt(timeMs)).toThrow(/time/i);
    expect(integrator.nextSequence).toBe(sequence);
    expect(integrator.heading).toBe(90);
  });

  it('preserves totals and chronology across interruption, with fresh stride duration after resume', () => {
    const integrator = new DeadReckoningIntegrator({}, 7, 90);
    const observations = [sample(0), sample(20, 13), sample(40, 9.81, null)].flatMap((value) =>
      integrator.push(value),
    );
    observations.push(...integrator.interrupt(100));
    expect(integrator.steps).toBe(1);
    expect(integrator.unresolvedHeadingSamples).toBe(1);
    expect(() => integrator.push(sample(90))).toThrow(/time/i);
    integrator.syncHeading(180);
    for (const value of [sample(10_000), sample(10_020, 13), sample(10_040)])
      observations.push(...integrator.push(value));
    expect(integrator.steps).toBe(2);
    expect(steps(observations).at(-1)).toMatchObject({ durationMs: 260, timeMs: 10_040 });
    expect(observations.map((value) => value.sequence)).toEqual(observations.map((_, i) => i + 7));
  });

  it('a failed calibration does not erase a valid detector or heading', () => {
    const integrator = new DeadReckoningIntegrator({}, 0, 90);
    integrator.push(sample(0));
    integrator.push(sample(20, 13));
    expect(() => integrator.syncHeading(NaN)).toThrow(/Heading/);
    expect(integrator.heading).toBe(90);
    expect(steps(integrator.push(sample(40)))).toHaveLength(1);
  });

  it('the real filter cannot displace a same-sample stride after heading loss, and guidance freezes', () => {
    const frame = { buildingId: 'synthetic', packageHash: 'synthetic-continuity-test' };
    const filter = new LocalizationFilter({}, frame);
    const runtime = new LocalizationRuntimeController();
    filter.apply({
      kind: 'initial-fix',
      sequence: 0,
      timeMs: 0,
      source: 'manual-anchor',
      position: [2, 3],
      floorId: 'g',
      elevationMeters: 0,
      headingDegrees: null,
      headingAccuracyDegrees: null,
      accuracyMeters: 0.2,
    });
    const calibrated = filter.apply({
      kind: 'heading-calibration',
      sequence: 1,
      timeMs: 0,
      source: 'replay',
      headingDegrees: 90,
      accuracyDegrees: 10,
      reference: 'filter-local',
      axis: 'travel',
      ...frame,
      provenanceId: 'constructed-axis',
    });
    expect(runtime.update(calibrated).guidanceState).toBe('active');
    const integrator = new DeadReckoningIntegrator({}, 2, 90);
    const estimates = [sample(0), sample(20, 13), sample(40, 9.81, null), sample(60, 9.81, 30)]
      .flatMap((value) => integrator.push(value))
      .map((value) => filter.apply(value));
    const final = estimates.at(-1)!;
    expect(integrator.steps).toBe(1);
    expect(final.position).toEqual([2, 3, 0]);
    expect(final.velocity).toEqual([0, 0, 0]);
    expect(final.headingDegrees).toBeNull();
    expect(final.positionSigmaMeters).toBeGreaterThan(calibrated.positionSigmaMeters);
    expect(runtime.update(final).guidanceState).toBe('frozen');
  });
});

function recorder() {
  const capture = new SessionRecorder({
    sessionId: 'continuity-test',
    buildingId: 'test',
    packageHash: 'a'.repeat(64),
    startedAtIso: '2026-09-12T09:00:00.000Z',
    device: {
      label: 'constructed samples',
      platform: 'test',
      sensors: { api: 'native', frame: 'world', gyroscopeUnits: 'deg/s' },
    },
    anchors: [
      {
        id: 'entry',
        floorId: 'g',
        kind: 'qr',
        position: [1, 9],
        headingDegrees: 90,
        payload: 'test:entry',
      },
    ],
  });
  capture.recordScan({ timeMs: 0, transport: 'qr', payload: 'test:entry' });
  return capture;
}
function imu(capture: SessionRecorder, timeMs: number, z = 9.81) {
  capture.recordImu({ timeMs, accelerometer: [0, 0, z], gyroscope: [0, 0, 0] });
}

describe('capture lifecycle is a real integration boundary', () => {
  it.each([true, false])(
    'preserves capture order for same-millisecond interruption (boundary first: %s)',
    (boundaryFirst) => {
      const capture = recorder();
      imu(capture, 10);
      imu(capture, 30, 13);
      if (boundaryFirst) capture.recordLifecycle('backgrounded', 50);
      imu(capture, 50);
      if (!boundaryFirst) capture.recordLifecycle('backgrounded', 50);
      capture.recordLifecycle('session-end', 60);
      const atBoundary = deriveRecording(capture.buildSession())
        .observations.filter((value) => value.timeMs === 50)
        .map((value) => value.kind);
      expect(atBoundary).toEqual(
        boundaryFirst ? ['heading-unavailable'] : ['step', 'heading-unavailable'],
      );
    },
  );

  it('a position-only rescan cannot reopen a suspended stream', () => {
    const capture = recorder();
    capture.recordLifecycle('backgrounded', 40);
    capture.recordScan({ timeMs: 50, transport: 'qr', payload: 'test:entry' });
    imu(capture, 60);
    imu(capture, 80, 13);
    imu(capture, 100);
    capture.recordLifecycle('foregrounded', 120);
    imu(capture, 130);
    imu(capture, 150, 13);
    imu(capture, 170);
    capture.recordLifecycle('session-end', 180);
    const observations = deriveRecording(capture.buildSession()).observations;
    expect(observations.some((value) => value.kind === 'position-fix' && value.timeMs === 50)).toBe(
      true,
    );
    expect(steps(observations).map((value) => value.timeMs)).toEqual([170]);
    expect(
      observations.some(
        (value) => value.kind === 'heading' || value.kind === 'heading-calibration',
      ),
    ).toBe(false);
  });

  it.each<LifecycleEvent>([
    'backgrounded',
    'foregrounded',
    'sensor-interrupted',
    'sensor-resumed',
    'permission-denied',
    'permission-granted',
  ])('does not carry an unfinished step across %s', (event) => {
    const capture = recorder();
    imu(capture, 10);
    imu(capture, 30, 13);
    capture.recordLifecycle(event, 40);
    imu(capture, 50);
    capture.recordLifecycle('session-end', 60);
    const derived = deriveRecording(capture.buildSession());
    expect(steps(derived.observations)).toEqual([]);
    expect(
      derived.observations.some(
        (value) => value.kind === 'heading-unavailable' && value.timeMs === 40,
      ),
    ).toBe(true);
  });

  it('keeps independent background, sensor and permission gates closed until each resumes', () => {
    const capture = recorder();
    capture.recordLifecycle('backgrounded', 1);
    capture.recordLifecycle('sensor-interrupted', 2);
    capture.recordLifecycle('permission-denied', 3);
    capture.recordLifecycle('foregrounded', 4);
    for (const start of [10, 400]) {
      if (start === 400) capture.recordLifecycle('sensor-resumed', 390);
      imu(capture, start);
      imu(capture, start + 20, 13);
      imu(capture, start + 40);
    }
    capture.recordLifecycle('permission-granted', 790);
    imu(capture, 800);
    imu(capture, 820, 13);
    imu(capture, 840);
    capture.recordLifecycle('session-end', 850);
    const session = capture.buildSession();
    const before = JSON.stringify(session);
    const derived = deriveRecording(session);
    expect(steps(derived.observations).map((value) => value.timeMs)).toEqual([840]);
    expect(derived.observations.map((value) => value.sequence)).toEqual(
      derived.observations.map((_, index) => index),
    );
    expect(JSON.stringify(session)).toBe(before);
  });

  it('treats a recorded permission loss as interrupted evidence', () => {
    const capture = recorder();
    imu(capture, 10);
    capture.recordLifecycle('permission-denied', 20);
    capture.recordLifecycle('session-end', 30);
    expect(buildEvidenceReport(capture.buildSession()).report.evidenceStatus).toBe(
      'interrupted-capture',
    );
  });
});
