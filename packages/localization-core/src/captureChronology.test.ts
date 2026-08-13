import { describe, expect, it } from 'vitest';
import {
  CaptureAuthoringError,
  CaptureValidationError,
  SessionRecorder,
  buildEvidenceReport,
  summarizeSampling,
  validateCaptureSession,
  type CaptureDeviceProfile,
  type CaptureEvent,
  type CaptureSession,
  type CheckpointAnchor,
} from './index';
import { MIN_SAMPLE_INTERVAL_MS } from './captureStream';

/**
 * What the stored stream is allowed to claim about time and about itself.
 *
 * Two different erasures. A capture is stored in time order, so sorting is what
 * hides a clock that jumped backwards: the sample is moved earlier and the
 * array reads as a flawless chronology. And a session was only shallowly
 * copied, so the objects a caller still held were the objects the evidence path
 * would later read.
 */

const anchors: CheckpointAnchor[] = [
  {
    id: 'corridor-start',
    floorId: 'g',
    kind: 'qr',
    position: [1, 9],
    headingDegrees: 90,
    payload: 'vg:corridor-start',
  },
];

const device: CaptureDeviceProfile = {
  label: 'field handset',
  platform: 'android',
  sensors: { api: 'native', gyroscopeUnits: 'deg/s', frame: 'world' },
};

function recorder(sessionId: string) {
  return new SessionRecorder({
    sessionId,
    buildingId: 'reference-medical-centre',
    packageHash: 'a'.repeat(64),
    device,
    anchors,
    startedAtIso: '2026-08-07T09:00:00.000Z',
  });
}

const codesFor = (session: CaptureSession) =>
  validateCaptureSession(session).map((issue) => issue.code);

/** A walk that localizes, keeps continuous coverage, and ends on a surveyed mark. */
function completeWalk() {
  const walk = recorder('chronology-walk');
  walk.recordScan({ timeMs: 100, transport: 'qr', payload: 'vg:corridor-start' });
  for (let timeMs = 100; timeMs <= 3_000; timeMs += 20) {
    walk.recordImu({
      timeMs,
      accelerometer: [0, 0, 9.81 + 3 * Math.sin((2 * Math.PI * timeMs) / 500)],
      gyroscope: [0, 0, 0],
    });
  }
  return walk;
}

describe('a regressing device clock is reported rather than sorted away', () => {
  it('reports the sample that arrived late carrying an earlier time', () => {
    const walk = recorder('regressing');
    walk.recordImu({ timeMs: 1_000, accelerometer: [0, 0, 9.81], gyroscope: [0, 0, 0] });
    walk.recordImu({ timeMs: 400, accelerometer: [0, 0, 9.81], gyroscope: [0, 0, 0] });
    walk.recordImu({ timeMs: 1_020, accelerometer: [0, 0, 9.81], gyroscope: [0, 0, 0] });
    const session = walk.buildSession();

    // The stored stream reads as a flawless chronology — this is the erasure.
    const storedTimes = session.events.map((event) => event.timeMs);
    expect([...storedTimes].sort((a, b) => a - b)).toEqual(storedTimes);
    // And the capture sequence proves the reordering happened.
    expect(session.events.map((event) => event.sequence)).not.toEqual(
      [...session.events.map((event) => event.sequence)].sort((a, b) => a - b),
    );

    const issues = validateCaptureSession(session);
    expect(issues.map((issue) => issue.code)).toEqual(['regressing-capture-clock']);
    expect(issues[0].message).toMatch(/clock went backwards/);
  });

  it('reports a backdated scan, which moved the anchor reset a mark was scored against', () => {
    const walk = completeWalk();
    walk.recordGroundTruth({
      timeMs: 2_000,
      checkpointId: 'mark',
      position: [3.5, 9],
      floorId: 'g',
      surveyMethod: 'tape-measure',
      expectedAccuracyMeters: 0.03,
      independentOfAnchors: true,
    });
    // Recorded last, timed before samples already recorded.
    walk.recordScan({ timeMs: 1_900, transport: 'qr', payload: 'vg:corridor-start' });

    expect(codesFor(walk.buildSession())).toEqual(['regressing-capture-clock']);
  });

  it('reports a backdated lifecycle event', () => {
    const walk = completeWalk();
    walk.recordLifecycle('backgrounded', 500, 'screen locked');

    expect(codesFor(walk.buildSession())).toEqual(['regressing-capture-clock']);
  });

  it('leaves a back-dated ground-truth mark alone', () => {
    // A floor mark is hand-annotated and often noted a moment after it was
    // stood on, so its capture order and its time legitimately disagree.
    const walk = recorder('backdated');
    for (let timeMs = 0; timeMs <= 200; timeMs += 20) {
      walk.recordImu({ timeMs, accelerometer: [0, 0, 9.81], gyroscope: [0, 0, 0] });
    }
    walk.recordGroundTruth({
      timeMs: 50,
      checkpointId: 'noted-late',
      position: [30, 30],
      floorId: 'g',
      surveyMethod: 'tape-measure',
      expectedAccuracyMeters: 0.03,
      independentOfAnchors: true,
    });

    expect(validateCaptureSession(walk.buildSession())).toEqual([]);
  });

  it('accepts an ordinary ascending sample stream', () => {
    expect(validateCaptureSession(completeWalk().buildSession())).toEqual([]);
  });
});

describe('distinct samples must be far enough apart to be two samples', () => {
  function twoSamples(secondTimeMs: number) {
    const walk = recorder('resolution');
    walk.recordImu({ timeMs: 0, accelerometer: [0, 0, 9.81], gyroscope: [0, 0, 0] });
    walk.recordImu({ timeMs: secondTimeMs, accelerometer: [0, 0, 9.81], gyroscope: [0, 0, 0] });
    return walk.buildSession();
  }

  it('refuses the denormal interval that made observedHz non-finite', () => {
    expect(codesFor(twoSamples(5e-324))).toContain('unresolvable-sample-interval');
  });

  it('refuses an interval below the minimum and accepts one exactly at it', () => {
    expect(codesFor(twoSamples(MIN_SAMPLE_INTERVAL_MS / 2))).toContain(
      'unresolvable-sample-interval',
    );
    expect(codesFor(twoSamples(MIN_SAMPLE_INTERVAL_MS))).toEqual([]);
  });

  it('still allows coalesced samples that share a timestamp', () => {
    const walk = recorder('coalesced');
    for (const timeMs of [0, 20, 20, 40]) {
      walk.recordImu({ timeMs, accelerometer: [0, 0, 9.81], gyroscope: [0, 0, 0] });
    }

    expect(validateCaptureSession(walk.buildSession())).toEqual([]);
  });

  it('never reports a sampling rate no clock could produce', () => {
    // summarizeSampling is exported and runs on unvalidated sessions, so the
    // guard has to hold independently of validation. Infinity here previously
    // serialised to null, turning a recorded rate into a hole.
    const summary = summarizeSampling(twoSamples(5e-324));

    expect(Number.isFinite(summary.observedHz)).toBe(true);
    expect(summary.observedHz).toBe(0);
    expect(summarizeSampling(completeWalk().buildSession()).observedHz).toBeCloseTo(50, 3);
  });
});

describe('what the session claims about itself is fixed at construction', () => {
  it('does not read the caller options object again after construction', () => {
    // Reaching through the options turned a refused capture into a published
    // one and rewrote the venue the recording claimed to be about.
    const mutableDevice: CaptureDeviceProfile = {
      label: 'field handset',
      platform: 'android',
      sensors: { api: 'devicemotion', gyroscopeUnits: 'deg/s', frame: 'device' },
    };
    const options = {
      sessionId: 'aliased',
      buildingId: 'reference-medical-centre',
      packageHash: 'a'.repeat(64),
      device: mutableDevice,
      anchors,
      startedAtIso: '2026-08-07T09:00:00.000Z',
    };
    const walk = new SessionRecorder(options);
    walk.recordScan({ timeMs: 100, transport: 'qr', payload: 'vg:corridor-start' });
    for (let timeMs = 100; timeMs <= 3_000; timeMs += 20) {
      walk.recordImu({
        timeMs,
        accelerometer: [0, 0, 9.81 + 3 * Math.sin((2 * Math.PI * timeMs) / 500)],
        gyroscope: [0, 0, 0],
      });
    }
    walk.recordGroundTruth({
      timeMs: 3_000,
      checkpointId: 'mark',
      position: [3.5, 9],
      floorId: 'g',
      surveyMethod: 'tape-measure',
      expectedAccuracyMeters: 0.03,
      independentOfAnchors: true,
    });
    const before = buildEvidenceReport(walk.buildSession()).report;
    expect(before.evidenceStatus).toBe('unsupported-sensor-model');

    mutableDevice.sensors.api = 'native';
    mutableDevice.sensors.frame = 'world';
    options.packageHash = 'b'.repeat(64);
    options.sessionId = 'rewritten';

    const after = buildEvidenceReport(walk.buildSession()).report;
    expect(after.evidenceStatus).toBe('unsupported-sensor-model');
    expect(after.medianHorizontalErrorMeters).toBeNull();
    expect(after.packageHash).toBe('a'.repeat(64));
    expect(after.sessionId).toBe('aliased');
  });

  it('gives every built session its own device and sensor profile', () => {
    const walk = completeWalk();
    const first = walk.buildSession();
    const second = walk.buildSession();

    expect(first.device).not.toBe(second.device);
    expect(first.device.sensors).not.toBe(second.device.sensors);

    first.device.sensors.frame = 'device';
    expect(second.device.sensors.frame).toBe('world');
  });
});

describe('recorder inputs are read exactly once', () => {
  it('refuses a required field supplied as a getter rather than a value', () => {
    let reads = 0;
    const walk = recorder('repeating-getter');
    const attempt = {
      transport: 'qr' as const,
      timeMs: 100,
      get payload() {
        reads += 1;
        return reads === 1 ? 'vg:corridor-start' : 'vg:something-else';
      },
    };

    // Degrading was itself a bypass: an accessor payload became a valid
    // decode-failed carrying nothing, which suppressed a genuine reset and
    // moved a published figure from 1.288 m to 2.449 m while reporting ok.
    expect(() => walk.recordScan(attempt)).toThrow(CaptureAuthoringError);
    expect(() => walk.recordScan(attempt)).toThrow(/own enumerable value/);
    expect(reads).toBe(0);
  });

  it('refuses a required field that is inherited or non-enumerable', () => {
    const walk = recorder('hidden-fields');

    const inherited = Object.create({ payload: 'vg:corridor-start' }) as never;
    Object.assign(inherited, { timeMs: 100, transport: 'qr' });
    expect(() => walk.recordScan(inherited)).toThrow(CaptureAuthoringError);

    const hidden = { timeMs: 100, transport: 'qr' as const };
    Object.defineProperty(hidden, 'payload', {
      value: 'vg:corridor-start',
      enumerable: false,
    });
    expect(() => walk.recordScan(hidden as never)).toThrow(CaptureAuthoringError);

    // An explicit null is a real value and stays acceptable.
    expect(() => walk.recordScan({ timeMs: 100, transport: 'qr', payload: null })).not.toThrow();
  });

  it('stores the vector the caller indexed, never one an iterator yielded', () => {
    // Spreading went through the caller's iterator, so indices [1, 2, 3] were
    // recorded as [99, 98, 97]. An ordinary vector is still read by index...
    const walk = recorder('hostile-iterator');
    walk.recordImu({ timeMs: 200, accelerometer: [1, 2, 3], gyroscope: [0, 0, 0] });
    const stored = walk.buildSession().events.find((event) => event.type === 'imu');
    expect(stored).toMatchObject({ accelerometer: [1, 2, 3] });

    // ...and a vector carrying its own iterator is refused outright, because a
    // tuple that owns anything the schema does not define is not a tuple.
    const hostile = [1, 2, 3];
    Object.defineProperty(hostile, Symbol.iterator, {
      value: function* () {
        yield 99;
        yield 98;
        yield 97;
      },
    });

    expect(() =>
      walk.recordImu({ timeMs: 220, accelerometer: hostile as never, gyroscope: [0, 0, 0] }),
    ).toThrow(/does not define/);
  });

  it('refuses an anchor position supplied as a getter rather than a value', () => {
    let reads = 0;
    const shifting = {
      id: 'corridor-start',
      floorId: 'g',
      kind: 'qr' as const,
      get position(): [number, number] {
        reads += 1;
        return reads === 1 ? [1, 9] : [500, 500];
      },
      headingDegrees: 90,
      payload: 'vg:corridor-start',
    };

    // Reading `position` twice stored [1, 500] — a coordinate that existed in
    // neither read, and one that validated cleanly because it is still two
    // finite in-frame numbers. An accessor is not a value the capture will
    // carry at all, so the anchor is refused rather than invented.
    expect(
      () =>
        new SessionRecorder({
          sessionId: 'shifting-anchor',
          buildingId: 'reference-medical-centre',
          packageHash: 'a'.repeat(64),
          device,
          anchors: [shifting],
          startedAtIso: '2026-08-07T09:00:00.000Z',
        }),
    ).toThrow(CaptureAuthoringError);
    expect(reads).toBe(0);
  });

  it('refuses a coordinate array whose elements are accessors', () => {
    // The own-data rule stopped at the property holding the array, so an object
    // the schema's own plain-array check would reject was copied element by
    // element into a real one, moving a published median from 3.688 m to
    // 22.688 m with nothing reported.
    const accessorPair = {
      length: 2,
      get 0() {
        return 20;
      },
      get 1() {
        return 9;
      },
    } as unknown as [number, number];

    expect(
      () =>
        new SessionRecorder({
          sessionId: 'accessor-pair',
          buildingId: 'reference-medical-centre',
          packageHash: 'a'.repeat(64),
          device,
          anchors: [{ ...anchors[0], position: accessorPair }],
          startedAtIso: '2026-08-07T09:00:00.000Z',
        }),
    ).toThrow(/plain array/);

    // A real array carrying an accessor element is refused for the same reason.
    const spiked: number[] = [1, 2];
    Object.defineProperty(spiked, '2', { get: () => 9.81, enumerable: true, configurable: true });
    expect(() =>
      recorder('spiked-vector').recordImu({
        timeMs: 10,
        accelerometer: [0, 0, 9.81],
        gyroscope: spiked as never,
      }),
    ).toThrow(CaptureAuthoringError);
  });

  it('separates an absent optional field from a malformed one', () => {
    const proto = {
      get model() {
        return { cameraFrames: ['leak'] };
      },
      get failure() {
        return 'permission-denied';
      },
    };

    // Omitted entirely is a legitimate omission.
    const walk = recorder('optional-absent');
    expect(() =>
      walk.recordScan({ timeMs: 100, transport: 'qr', payload: 'vg:corridor-start' }),
    ).not.toThrow();
    expect(walk.buildSession().device).not.toHaveProperty('model');

    // Inherited is not. Treating it as absent fixed a prototype injecting
    // device.model, but created the mirror-image bug: a scan declaring
    // permission-denied had its failure discarded, resolved against the anchors
    // instead, and published ok at 2 m from a reset the device never made.
    const inheritedDevice = Object.create(proto) as CaptureDeviceProfile;
    inheritedDevice.label = 'field handset';
    inheritedDevice.platform = 'android';
    inheritedDevice.sensors = { api: 'native', gyroscopeUnits: 'deg/s', frame: 'world' };

    expect(
      () =>
        new SessionRecorder({
          sessionId: 'inherited-optional',
          buildingId: 'reference-medical-centre',
          packageHash: 'a'.repeat(64),
          device: inheritedDevice,
          anchors,
          startedAtIso: '2026-08-07T09:00:00.000Z',
        }),
    ).toThrow(/model is inherited/);

    const inheritedFailure = Object.create(proto) as never;
    Object.assign(inheritedFailure, {
      timeMs: 100,
      transport: 'qr',
      payload: 'vg:corridor-start',
    });
    expect(() => recorder('inherited-failure').recordScan(inheritedFailure)).toThrow(
      /failure is inherited/,
    );
  });

  it('refuses an own failure supplied as a getter', () => {
    // The declared permission-denied was discarded, the scan resolved against
    // the anchors, and the walk published ok at 2 m — a reset invented from a
    // scan the device had reported it never completed.
    const attempt = {
      timeMs: 100,
      transport: 'qr' as const,
      payload: 'vg:corridor-start',
      get failure() {
        return 'permission-denied' as const;
      },
    };

    expect(() => recorder('computed-failure').recordScan(attempt)).toThrow(CaptureAuthoringError);
    expect(() => recorder('computed-failure').recordScan(attempt)).toThrow(
      /failure is present but hidden or computed/,
    );
  });

  it('refuses orientation components that are inherited or computed', () => {
    const walk = recorder('orientation-subfields');
    const proto = { alphaDegrees: 999, betaDegrees: 888, gammaDegrees: 777, absolute: true };

    // Raw orientation is the part of the stream a better processor is meant to
    // re-derive from, so a component the caller never owned must not enter it.
    expect(() =>
      walk.recordImu({
        timeMs: 10,
        accelerometer: [0, 0, 9.81],
        gyroscope: [0, 0, 0],
        orientation: Object.create(proto) as never,
      }),
    ).toThrow(/orientation\.alphaDegrees/);

    expect(() =>
      walk.recordImu({
        timeMs: 10,
        accelerometer: [0, 0, 9.81],
        gyroscope: [0, 0, 0],
        orientation: {
          get alphaDegrees() {
            return 123;
          },
          betaDegrees: 0,
          gammaDegrees: 0,
          absolute: true,
        },
      }),
    ).toThrow(CaptureAuthoringError);

    // A fully owned orientation is still accepted.
    expect(() =>
      walk.recordImu({
        timeMs: 10,
        accelerometer: [0, 0, 9.81],
        gyroscope: [0, 0, 0],
        orientation: { alphaDegrees: 90, betaDegrees: 0, gammaDegrees: 0, absolute: true },
      }),
    ).not.toThrow();
  });

  it('stores the mark position the caller indexed', () => {
    const walk = recorder('hostile-mark');
    const mark = (position: [number, number]) => ({
      timeMs: 3_000,
      checkpointId: 'mark',
      position,
      floorId: 'g',
      surveyMethod: 'tape-measure' as const,
      expectedAccuracyMeters: 0.03,
      independentOfAnchors: true,
    });

    walk.recordGroundTruth(mark([4, 5]));
    const stored = walk.buildSession().events.find((event) => event.type === 'ground-truth');
    expect(stored).toMatchObject({ position: [4, 5] });

    const hostile = [4, 5];
    Object.defineProperty(hostile, Symbol.iterator, {
      value: function* () {
        yield 88;
        yield 87;
      },
    });

    expect(() => walk.recordGroundTruth(mark(hostile as never))).toThrow(/does not define/);
  });
});

describe('the stream asserts its own completeness', () => {
  it('refuses a sequence gap left by a deleted event', () => {
    const walk = recorder('deleted-event');
    walk.recordScan({ timeMs: 100, transport: 'qr', payload: 'vg:corridor-start' });
    for (let timeMs = 100; timeMs <= 3_000; timeMs += 20) {
      if (timeMs === 1_500) walk.recordLifecycle('backgrounded', 1_500, 'screen locked');
      walk.recordImu({
        timeMs,
        accelerometer: [0, 0, 9.81 + 3 * Math.sin((2 * Math.PI * timeMs) / 500)],
        gyroscope: [0, 0, 0],
      });
    }
    walk.recordGroundTruth({
      timeMs: 3_000,
      checkpointId: 'mark',
      position: [3.5, 9],
      floorId: 'g',
      surveyMethod: 'tape-measure',
      expectedAccuracyMeters: 0.03,
      independentOfAnchors: true,
    });
    walk.recordLifecycle('session-end', 3_100);
    const session = walk.buildSession();
    expect(buildEvidenceReport(session).report.evidenceStatus).toBe('interrupted-capture');

    // Deleting the interruption previously produced a clean, publishable walk:
    // evidence suppressed by deletion rather than by argument.
    const pruned = {
      ...session,
      events: session.events.filter(
        (event) => !(event.type === 'lifecycle' && event.event === 'backgrounded'),
      ),
    };

    expect(codesFor(pruned)).toEqual(['non-contiguous-event-sequence']);
  });

  it('requires exactly one session-start, first and at time zero', () => {
    const walk = completeWalk();
    const session = walk.buildSession();
    expect(validateCaptureSession(session)).toEqual([]);

    const withoutStart = {
      ...session,
      events: session.events
        .filter((event) => !(event.type === 'lifecycle' && event.event === 'session-start'))
        .map((event, index) => ({ ...event, sequence: index })),
    };
    expect(codesFor(withoutStart)).toContain('invalid-session-boundary');

    const walkWithSecondStart = completeWalk();
    walkWithSecondStart.recordLifecycle('session-start', 3_100);
    expect(codesFor(walkWithSecondStart.buildSession())).toContain('invalid-session-boundary');
  });

  it('requires any session-end to be unique and terminal', () => {
    const twice = completeWalk();
    twice.recordLifecycle('session-end', 3_100);
    twice.recordLifecycle('session-end', 3_200);
    expect(codesFor(twice.buildSession())).toContain('invalid-session-boundary');

    // An event after the end still reached evaluation.
    const afterEnd = completeWalk();
    afterEnd.recordLifecycle('session-end', 3_100);
    afterEnd.recordImu({ timeMs: 4_000, accelerometer: [0, 0, 9.81], gyroscope: [0, 0, 0] });
    expect(codesFor(afterEnd.buildSession())).toContain('invalid-session-boundary');

    const wellFormed = completeWalk();
    wellFormed.recordLifecycle('session-end', 3_100);
    expect(validateCaptureSession(wellFormed.buildSession())).toEqual([]);
  });
});

describe('evidence requires a capture that records its own end', () => {
  /** A complete walk: localizes, keeps coverage, ends on a mark. */
  const walkWithMark = () => {
    const walk = completeWalk();
    walk.recordGroundTruth({
      timeMs: 3_000,
      checkpointId: 'mark',
      position: [3.5, 9],
      floorId: 'g',
      surveyMethod: 'tape-measure',
      expectedAccuracyMeters: 0.03,
      independentOfAnchors: true,
    });
    return walk;
  };

  it('refuses a walk with no terminal session-end, while still validating it', () => {
    const draft = walkWithMark().buildSession();

    // A draft stays diagnosable — validation is deliberately permissive.
    expect(validateCaptureSession(draft)).toEqual([]);
    // But it cannot be evidence, because a stream can lose its tail silently.
    const report = buildEvidenceReport(draft).report;
    expect(report.evidenceStatus).toBe('incomplete-capture');
    expect(report.medianHorizontalErrorMeters).toBeNull();
    expect(report.checkpointErrors).toEqual([]);

    const closed = walkWithMark();
    closed.recordLifecycle('session-end', 3_100);
    expect(buildEvidenceReport(closed.buildSession()).report.evidenceStatus).toBe('ok');
  });

  it('places incompleteness after sensor support and before localization', () => {
    // Precedence matters because an incomplete capture short-circuits: without
    // an explicit test, other status combinations can stop being exercised
    // while their assertions still pass.
    const unsupported = new SessionRecorder({
      sessionId: 'unsupported-and-open',
      buildingId: 'reference-medical-centre',
      packageHash: 'a'.repeat(64),
      device: { ...device, sensors: { ...device.sensors, frame: 'device' } },
      anchors,
      startedAtIso: '2026-08-07T09:00:00.000Z',
    });
    unsupported.recordImu({ timeMs: 10, accelerometer: [0, 0, 9.81], gyroscope: [0, 0, 0] });
    // Unsupported sensors outrank a missing end: the walk is uninterpretable
    // whether or not it finished.
    expect(buildEvidenceReport(unsupported.buildSession()).report.evidenceStatus).toBe(
      'unsupported-sensor-model',
    );

    const neverLocalized = recorder('open-and-unlocalized');
    neverLocalized.recordImu({ timeMs: 10, accelerometer: [0, 0, 9.81], gyroscope: [0, 0, 0] });
    // A missing end outranks a missing fix: a truncated stream may simply not
    // have reached the scan yet, so the absence of a fix proves nothing.
    expect(buildEvidenceReport(neverLocalized.buildSession()).report.evidenceStatus).toBe(
      'incomplete-capture',
    );

    neverLocalized.recordLifecycle('session-end', 20);
    expect(buildEvidenceReport(neverLocalized.buildSession()).report.evidenceStatus).toBe(
      'insufficient-localization',
    );
  });

  it('refuses a walk whose tail was deleted', () => {
    // Contiguity catches a hole in the middle but never a missing tail:
    // deleting a terminal interruption left 0..n-1 intact and turned
    // interrupted-capture into a publishable ok at 3.688 m.
    const walk = walkWithMark();
    walk.recordLifecycle('backgrounded', 3_100, 'screen locked');
    walk.recordLifecycle('session-end', 3_200);
    const session = walk.buildSession();
    expect(buildEvidenceReport(session).report.evidenceStatus).toBe('interrupted-capture');

    const tailRemoved = {
      ...session,
      events: session.events.filter(
        (event) =>
          !(
            event.type === 'lifecycle' &&
            (event.event === 'backgrounded' || event.event === 'session-end')
          ),
      ),
    };

    // Still contiguous, still valid — and now refused rather than published.
    expect(tailRemoved.events.map((event) => event.sequence)).toEqual(
      tailRemoved.events.map((_, index) => index),
    );
    expect(validateCaptureSession(tailRemoved)).toEqual([]);
    expect(buildEvidenceReport(tailRemoved).report.evidenceStatus).toBe('incomplete-capture');
  });
});

describe('a scan outcome is checked against the anchors it claims', () => {
  const closedWalkWith = (scanTimeMs: number, markTimeMs: number) => {
    const walk = recorder('scan-outcomes');
    walk.recordScan({ timeMs: 100, transport: 'qr', payload: 'vg:corridor-start' });
    for (let timeMs = 100; timeMs <= 3_000; timeMs += 20) {
      if (timeMs === scanTimeMs) {
        walk.recordScan({ timeMs, transport: 'qr', payload: 'vg:corridor-start' });
        walk.recordGroundTruth({
          timeMs: markTimeMs,
          checkpointId: 'mark',
          position: [3.5, 9],
          floorId: 'g',
          surveyMethod: 'tape-measure',
          expectedAccuracyMeters: 0.03,
          independentOfAnchors: true,
        });
      }
      walk.recordImu({
        timeMs,
        accelerometer: [0, 0, 9.81 + 3 * Math.sin((2 * Math.PI * timeMs) / 500)],
        gyroscope: [0, 0, 0],
      });
    }
    walk.recordLifecycle('session-end', 3_100);
    return walk.buildSession();
  };

  it('refuses a real reset relabelled as unresolvable', () => {
    const session = closedWalkWith(2_000, 2_000);
    // Honest: the mark ties with a genuine reset, so it cannot be scored.
    expect(buildEvidenceReport(session).report.evidenceStatus).toBe('insufficient-ground-truth');

    // Relabelling the reset made the tie disappear and published 1.211 m.
    const forged = {
      ...session,
      events: session.events.map((event) =>
        event.type === 'scan' && event.timeMs === 2_000
          ? { ...event, outcome: 'unknown-payload' as const, anchorId: null }
          : event,
      ),
    };

    const issues = validateCaptureSession(forged);
    expect(issues.map((issue) => issue.code)).toEqual(['scan-outcome-mismatch']);
    expect(issues[0].message).toMatch(/resolves to resolved against the captured anchors/);
    expect(() => buildEvidenceReport(forged)).toThrow(CaptureValidationError);
  });

  it('refuses a fabricated reset against an anchor that does not exist', () => {
    const session = closedWalkWith(2_500, 2_000);
    expect(buildEvidenceReport(session).report.evidenceStatus).toBe('ok');

    // An ordinary sample relabelled as a reset at the mark's instant wrongly
    // excluded a real mark as an ambiguous tie.
    const forged = {
      ...session,
      events: session.events.map((event) =>
        event.type === 'imu' && event.timeMs === 2_000
          ? ({
              type: 'scan',
              sequence: event.sequence,
              timeMs: 2_000,
              transport: 'qr',
              payload: 'vg:not-a-real-anchor',
              outcome: 'resolved',
              anchorId: 'ghost',
            } as CaptureEvent)
          : event,
      ),
    };

    const issues = validateCaptureSession(forged);
    expect(issues.map((issue) => issue.code)).toEqual(['scan-outcome-mismatch']);
    expect(issues[0].message).toMatch(/resolves to unknown-payload against the captured anchors/);
  });

  it('refuses an acquisition failure that also claims a payload', () => {
    const session = closedWalkWith(2_500, 2_000);
    const forged = {
      ...session,
      events: session.events.map((event) =>
        event.type === 'scan' && event.timeMs === 2_500
          ? { ...event, outcome: 'decode-failed' as const, anchorId: null }
          : event,
      ),
    };

    // Hiding a real payload behind a decode failure would suppress the reset
    // the same way a forged unknown-payload did.
    expect(codesFor(forged)).toEqual(['scan-outcome-mismatch']);
  });
});

describe('required fields must be owned by the caller', () => {
  it('never persists an inherited session, device, or scan field', () => {
    const proto = {
      packageHash: 'f'.repeat(64),
      label: 'inherited handset',
      platform: 'inherited-os',
      payload: 'vg:corridor-start',
      transport: 'qr' as const,
      timeMs: 100,
    };
    const inheritedDevice = Object.create(proto) as CaptureDeviceProfile;
    inheritedDevice.sensors = { api: 'native', gyroscopeUnits: 'deg/s', frame: 'world' };

    const options = Object.create(proto) as never;
    Object.assign(options, {
      sessionId: 'inherited-required',
      buildingId: 'reference-medical-centre',
      device: inheritedDevice,
      anchors,
      startedAtIso: '2026-08-07T09:00:00.000Z',
    });

    // Each of these previously became persisted evidence and validated cleanly:
    // an inherited packageHash claimed a different venue, an inherited label and
    // platform described a different handset, and an inherited payload resolved
    // a scan the caller never presented.
    let thrown: unknown;
    try {
      new SessionRecorder(options);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CaptureAuthoringError);
    expect((thrown as CaptureAuthoringError).field).toBe('packageHash');

    // With the session's own fields owned, the inherited device is still caught.
    Object.assign(options, { packageHash: 'a'.repeat(64) });
    expect(() => new SessionRecorder(options)).toThrow(/label/);

    // And so is an inherited scan payload.
    const walk = recorder('inherited-scan');
    expect(() => walk.recordScan(Object.create(proto) as never)).toThrow(CaptureAuthoringError);
  });

  it('never persists an inherited anchor or ground-truth field', () => {
    const anchorProto = { payload: 'vg:corridor-start', headingDegrees: 90 };
    const inheritedAnchor = Object.create(anchorProto) as CheckpointAnchor;
    Object.assign(inheritedAnchor, {
      id: 'corridor-start',
      floorId: 'g',
      kind: 'qr',
      position: [1, 9],
    });

    expect(
      () =>
        new SessionRecorder({
          sessionId: 'inherited-anchor',
          buildingId: 'reference-medical-centre',
          packageHash: 'a'.repeat(64),
          device,
          anchors: [inheritedAnchor],
          startedAtIso: '2026-08-07T09:00:00.000Z',
        }),
    ).toThrow(/headingDegrees|payload/);

    const markProto = { surveyMethod: 'tape-measure', independentOfAnchors: true };
    const inheritedMark = Object.create(markProto) as never;
    Object.assign(inheritedMark, {
      timeMs: 3_000,
      checkpointId: 'mark',
      position: [30, 30],
      floorId: 'g',
      expectedAccuracyMeters: 0.03,
    });

    expect(() => recorder('inherited-mark').recordGroundTruth(inheritedMark)).toThrow(
      /surveyMethod|independentOfAnchors/,
    );
  });

  it('refuses an anchors collection that is not a plain dense array', () => {
    const anchorsFrom = (collection: unknown) =>
      new SessionRecorder({
        sessionId: 'anchor-collection',
        buildingId: 'reference-medical-centre',
        packageHash: 'a'.repeat(64),
        device,
        anchors: collection as CheckpointAnchor[],
        startedAtIso: '2026-08-07T09:00:00.000Z',
      });

    // An accessor-backed element was laundered into a valid anchor and moved a
    // published median from 3.688 m to 18.688 m, with nothing reported.
    const arrayLike = {
      length: 1,
      get 0(): CheckpointAnchor {
        return { ...anchors[0], position: [16, 9] };
      },
    };
    expect(() => anchorsFrom(arrayLike)).toThrow(/plain array/);

    const accessorElement: CheckpointAnchor[] = [];
    Object.defineProperty(accessorElement, '0', {
      get: () => ({ ...anchors[0], position: [16, 9] }),
      enumerable: true,
      configurable: true,
    });
    Object.defineProperty(accessorElement, 'length', { value: 1 });
    expect(() => anchorsFrom(accessorElement)).toThrow(CaptureAuthoringError);

    // A hole is not an anchor either, and a named property is not an element.
    expect(() => anchorsFrom([, anchors[0]] as CheckpointAnchor[])).toThrow(CaptureAuthoringError);
    const withNamed = [anchors[0]] as CheckpointAnchor[] & { smuggled?: string };
    withNamed.smuggled = 'x';
    expect(() => anchorsFrom(withNamed)).toThrow(/dense/);

    expect(() => anchorsFrom([anchors[0]])).not.toThrow();
  });

  it('does not spend a sequence number on a mark it refuses', () => {
    const walk = recorder('refused-mark');
    walk.recordImu({ timeMs: 10, accelerometer: [0, 0, 9.81], gyroscope: [0, 0, 0] });
    const before = walk.eventCount;

    expect(() =>
      walk.recordGroundTruth({
        position: [1, 2],
        get timeMs() {
          return 100;
        },
        checkpointId: 'mark',
        floorId: 'g',
        surveyMethod: 'tape-measure',
        expectedAccuracyMeters: 0.03,
        independentOfAnchors: true,
      } as never),
    ).toThrow(CaptureAuthoringError);

    // The sequence was allocated before the fields were read, so a refused mark
    // consumed one and left the recorder permanently unable to produce a
    // contiguous stream — every later capture from it was non-evidence.
    expect(walk.eventCount).toBe(before);
    walk.recordImu({ timeMs: 20, accelerometer: [0, 0, 9.81], gyroscope: [0, 0, 0] });
    const session = walk.buildSession();

    expect(session.events.map((event) => event.sequence)).toEqual([0, 1, 2]);
    expect(validateCaptureSession(session)).toEqual([]);
  });

  it('stays usable after refusing a call', () => {
    // A refusal must cost nothing. Both of these allocated a sequence before
    // reading the fields that refused them, so one bad call left the recorder
    // permanently unable to produce a contiguous stream.
    const walk = recorder('reuse-after-refusal');

    expect(() =>
      walk.recordImu({
        timeMs: 10,
        accelerometer: [0, 0, 9.81],
        gyroscope: [0, 0, 0],
        orientation: Object.create({
          alphaDegrees: 90,
          betaDegrees: 0,
          gammaDegrees: 0,
          absolute: true,
        }) as never,
      }),
    ).toThrow(CaptureAuthoringError);

    expect(() =>
      walk.recordGroundTruth({
        position: [1, 2],
        get timeMs() {
          return 100;
        },
        checkpointId: 'mark',
        floorId: 'g',
        surveyMethod: 'tape-measure',
        expectedAccuracyMeters: 0.03,
        independentOfAnchors: true,
      } as never),
    ).toThrow(CaptureAuthoringError);

    expect(() => walk.recordScan({ timeMs: 20, transport: 'qr', payload: null })).not.toThrow();

    walk.recordImu({ timeMs: 30, accelerometer: [0, 0, 9.81], gyroscope: [0, 0, 0] });
    const session = walk.buildSession();

    expect(session.events.map((event) => event.sequence)).toEqual([0, 1, 2]);
    expect(validateCaptureSession(session)).toEqual([]);
  });

  it('refuses a falsy optional rather than reading it as absent', () => {
    // `failure ?? …` and `orientation ? … : null` both treat a malformed value
    // as an omission. Each of these produced a valid resolved scan naming an
    // anchor, so a declared acquisition failure published ok.
    for (const failure of [false, 0, '', null, 'nope']) {
      expect(() =>
        recorder('falsy-failure').recordScan({
          timeMs: 100,
          transport: 'qr',
          payload: 'vg:corridor-start',
          failure: failure as never,
        }),
      ).toThrow(/failure must be one of/);
    }

    // A declared failure still works, and still refuses to name an anchor.
    const declared = recorder('declared-failure').recordScan({
      timeMs: 100,
      transport: 'qr',
      payload: null,
      failure: 'permission-denied',
    });
    expect(declared.outcome).toBe('permission-denied');
    expect(declared.anchorId).toBeNull();

    // And each of these became a valid `orientation: null`, quietly discarding
    // a sample the caller believed carried orientation.
    for (const orientation of [false, 0, '']) {
      expect(() =>
        recorder('falsy-orientation').recordImu({
          timeMs: 10,
          accelerometer: [0, 0, 9.81],
          gyroscope: [0, 0, 0],
          orientation: orientation as never,
        }),
      ).toThrow(/orientation must be an object, null, or omitted/);
    }

    // Explicit null and omission both remain legitimate.
    const walk = recorder('honest-orientation');
    expect(() =>
      walk.recordImu({
        timeMs: 10,
        accelerometer: [0, 0, 9.81],
        gyroscope: [0, 0, 0],
        orientation: null,
      }),
    ).not.toThrow();
    expect(() =>
      walk.recordImu({ timeMs: 20, accelerometer: [0, 0, 9.81], gyroscope: [0, 0, 0] }),
    ).not.toThrow();
  });

  it('reads a collection length once, so it cannot change under the copy', () => {
    // Two anchors sharing a payload are an ambiguity that refuses to resolve.
    // A proxy that reported its true length while the shape was checked and a
    // shorter one while it was copied dropped the twin, so the payload
    // resolved cleanly and `insufficient-localization` became a publishable ok.
    const ambiguous: CheckpointAnchor[] = [
      anchors[0],
      {
        id: 'corridor-twin',
        floorId: 'g',
        kind: 'qr',
        position: [40, 40],
        headingDegrees: 90,
        payload: 'vg:corridor-start',
      },
    ];

    let lengthReads = 0;
    const shrinking = new Proxy(ambiguous, {
      get(target, property, receiver) {
        if (property === 'length') {
          lengthReads += 1;
          return lengthReads <= 1 ? 2 : 1;
        }
        return Reflect.get(target, property, receiver);
      },
    });

    const walk = new SessionRecorder({
      sessionId: 'shrinking-anchors',
      buildingId: 'reference-medical-centre',
      packageHash: 'a'.repeat(64),
      device,
      anchors: shrinking,
      startedAtIso: '2026-08-07T09:00:00.000Z',
    });

    // Both anchors are carried, so the ambiguity survives into the capture.
    const session = walk.buildSession();
    expect(session.anchors).toHaveLength(2);
    expect(session.anchors.map((anchor) => anchor.id)).toEqual([
      'corridor-start',
      'corridor-twin',
    ]);
    // The length trap is never consulted; the descriptor is read instead.
    expect(lengthReads).toBe(0);
  });

  it('refuses a declared failure that also carries a payload, at the call', () => {
    // Validation refuses this pairing in a stored stream. Refusing it here
    // names the conflict at the call that made it rather than at the end of a
    // walk, when the fix is a re-walk.
    expect(() =>
      recorder('failure-with-payload').recordScan({
        timeMs: 100,
        transport: 'qr',
        payload: 'vg:corridor-start',
        failure: 'permission-denied',
      }),
    ).toThrow(/cannot also carry a payload/);
  });

  it('refuses tuple and orientation properties the schema does not define', () => {
    const walk = recorder('undeclared-properties');

    const taggedPosition = [1, 9] as [number, number] & { note?: string };
    taggedPosition.note = 'smuggled';
    expect(() =>
      walk.recordGroundTruth({
        timeMs: 3_000,
        checkpointId: 'mark',
        position: taggedPosition,
        floorId: 'g',
        surveyMethod: 'tape-measure',
        expectedAccuracyMeters: 0.03,
        independentOfAnchors: true,
      }),
    ).toThrow(/does not define/);

    expect(() =>
      walk.recordImu({
        timeMs: 10,
        accelerometer: [0, 0, 9.81],
        gyroscope: [0, 0, 0],
        orientation: {
          alphaDegrees: 90,
          betaDegrees: 0,
          gammaDegrees: 0,
          absolute: true,
          cameraFrame: 'smuggled',
        } as never,
      }),
    ).toThrow(/does not define/);
  });

  it('is unaffected by later Object.prototype pollution', () => {
    // `key in source` made the recorder hostage to the ambient realm: setting
    // Object.prototype.failure made every honest scan look like it inherited
    // one, and authoring refused every capture. That fails closed, but a
    // recorder that cannot record is still broken.
    const polluted = Object.prototype as unknown as Record<string, unknown>;
    try {
      polluted.failure = 'permission-denied';
      polluted.model = 'ghost handset';
      polluted.orientation = { alphaDegrees: 1, betaDegrees: 2, gammaDegrees: 3, absolute: true };

      const walk = recorder('polluted-realm');
      const scan = walk.recordScan({ timeMs: 100, transport: 'qr', payload: 'vg:corridor-start' });
      expect(scan.outcome).toBe('resolved');

      walk.recordImu({ timeMs: 120, accelerometer: [0, 0, 9.81], gyroscope: [0, 0, 0] });
      const session = walk.buildSession();

      // Nothing ambient reached the capture, and nothing honest was refused.
      // Own keys are what the capture carries: `toHaveProperty` walks the
      // prototype chain and would be measuring the pollution, not the session.
      expect(Object.keys(session.device).sort()).toEqual(['label', 'platform', 'sensors']);
      const imu = session.events.find((event) => event.type === 'imu');
      expect(Object.prototype.hasOwnProperty.call(imu, 'orientation')).toBe(true);
      expect((imu as { orientation: unknown }).orientation).toBeNull();
      // And validation, which reads own keys only, still sees a clean capture.
      expect(validateCaptureSession(session)).toEqual([]);
    } finally {
      delete polluted.failure;
      delete polluted.model;
      delete polluted.orientation;
    }
  });

  it('names the duplicate anchor at its position in the capture', () => {
    // Indexing the surviving anchors pointed the diagnostic at the wrong
    // element whenever a malformed anchor sat earlier in the list.
    const session = {
      captureVersion: '0.2.0',
      sessionId: 's',
      buildingId: 'b',
      packageHash: 'a'.repeat(64),
      startedAtIso: '2026-08-07T09:00:00.000Z',
      device,
      anchors: [
        { id: 'broken', floorId: 'g', kind: 'qr', position: [1, 9], headingDegrees: 999, payload: 'p' },
        anchors[0],
        { ...anchors[0], payload: 'vg:elsewhere' },
      ],
      events: [{ type: 'lifecycle', sequence: 0, timeMs: 0, event: 'session-start' }],
    } as unknown as CaptureSession;

    const issues = validateCaptureSession(session);
    const duplicate = issues.find((issue) => issue.code === 'duplicate-anchor-id');

    // The duplicate is at index 2 of the capture, not index 1 of the survivors.
    expect(duplicate?.path).toBe('/anchors/2/id');
  });

  it('refuses duplicate anchor ids, which silently replace one another', () => {
    // Derivation looks anchors up by id, so a duplicate supplied its own
    // heading to a reset and moved a published median from 3.688 m to 8.591 m.
    const duplicated = new SessionRecorder({
      sessionId: 'duplicate-ids',
      buildingId: 'reference-medical-centre',
      packageHash: 'a'.repeat(64),
      device,
      anchors: [
        anchors[0],
        {
          id: 'corridor-start',
          floorId: 'g',
          kind: 'qr',
          position: [60, 60],
          headingDegrees: 270,
          payload: 'vg:elsewhere',
        },
      ],
      startedAtIso: '2026-08-07T09:00:00.000Z',
    });

    expect(validateCaptureSession(recorder('unique-ids').buildSession())).toEqual([]);
    const issues = validateCaptureSession(duplicated.buildSession());
    expect(issues.map((issue) => issue.code)).toEqual(['duplicate-anchor-id']);
    expect(issues[0].path).toBe('/anchors/1/id');
  });
});

describe('a built session cannot be rewritten through a reference the caller kept', () => {
  it('detaches a returned ground-truth mark from the session', () => {
    const walk = completeWalk();
    const mark = walk.recordGroundTruth({
      timeMs: 3_000,
      checkpointId: 'mark',
      position: [3.5, 9],
      floorId: 'g',
      surveyMethod: 'tape-measure',
      expectedAccuracyMeters: 0.03,
      independentOfAnchors: true,
    });
    const session = walk.buildSession();

    expect(session.events).not.toContain(mark);

    (mark as { position: [number, number] }).position = [999, 999];
    (mark as { surveyMethod: string }).surveyMethod = 'estimated';

    const stored = session.events.find((event) => event.type === 'ground-truth');
    expect(stored).toMatchObject({ position: [3.5, 9], surveyMethod: 'tape-measure' });
  });

  it('detaches a returned scan from the session', () => {
    const walk = recorder('scan-detach');
    const scan = walk.recordScan({ timeMs: 100, transport: 'qr', payload: 'vg:corridor-start' });
    const session = walk.buildSession();

    expect(scan.outcome).toBe('resolved');
    (scan as { outcome: string }).outcome = 'decode-failed';
    (scan as { anchorId: string | null }).anchorId = null;

    const stored = session.events.find((event) => event.type === 'scan');
    expect(stored).toMatchObject({ outcome: 'resolved', anchorId: 'corridor-start' });
  });

  it('gives every built session its own events', () => {
    const walk = completeWalk();
    const first = walk.buildSession();
    const second = walk.buildSession();

    expect(first.events[0]).not.toBe(second.events[0]);

    (first.events[0] as { timeMs: number }).timeMs = 777;

    expect(second.events[0].timeMs).not.toBe(777);
    expect(walk.buildSession().events[0].timeMs).not.toBe(777);
  });

  it('cannot move a published figure after the report was built', () => {
    // The fields reachable this way were exactly the ones that decide the
    // figure and whether it may be published at all.
    const walk = completeWalk();
    const mark = walk.recordGroundTruth({
      timeMs: 3_000,
      checkpointId: 'mark',
      position: [3.5, 9],
      floorId: 'g',
      surveyMethod: 'tape-measure',
      expectedAccuracyMeters: 0.03,
      independentOfAnchors: true,
    });
    const session = walk.buildSession();
    const before = buildEvidenceReport(session).report;

    (mark as { position: [number, number] }).position = [0, 0];
    (mark as { surveyMethod: string }).surveyMethod = 'estimated';

    const after = buildEvidenceReport(session).report;
    expect(after.evidenceStatus).toBe(before.evidenceStatus);
    expect(after.medianHorizontalErrorMeters).toBe(before.medianHorizontalErrorMeters);
  });
});
