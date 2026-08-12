import { describe, expect, it } from 'vitest';
import {
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
    const scan = walk.recordScan({
      transport: 'qr',
      timeMs: 100,
      get payload() {
        reads += 1;
        return reads === 1 ? 'vg:corridor-start' : 'vg:something-else';
      },
    });

    // A repeating getter previously resolved one payload and recorded another.
    // A required field must now be a plain own value, so it cannot differ
    // between reads at all — the accessor is never invoked.
    expect(reads).toBe(0);
    // What is stored is neither of the values the getter would have produced,
    // and no reset is invented: an unreadable payload is simply nothing read.
    expect(scan.payload).toBeNull();
    expect(scan.outcome).not.toBe('resolved');
    expect(scan.anchorId).toBeNull();
    expect(validateCaptureSession(walk.buildSession())).toEqual([]);
  });

  it('stores the vector the caller indexed, not one its iterator yielded', () => {
    const hostile = [1, 2, 3];
    Object.defineProperty(hostile, Symbol.iterator, {
      value: function* () {
        yield 99;
        yield 98;
        yield 97;
      },
    });

    const walk = recorder('hostile-iterator');
    walk.recordImu({ timeMs: 200, accelerometer: hostile as never, gyroscope: [0, 0, 0] });
    const stored = walk.buildSession().events.find((event) => event.type === 'imu');

    expect(stored).toMatchObject({ accelerometer: [1, 2, 3] });
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

    const session = new SessionRecorder({
      sessionId: 'shifting-anchor',
      buildingId: 'reference-medical-centre',
      packageHash: 'a'.repeat(64),
      device,
      anchors: [shifting],
      startedAtIso: '2026-08-07T09:00:00.000Z',
    }).buildSession();

    // Reading `position` twice stored [1, 500] — a coordinate that existed in
    // neither read, and one that validated cleanly because it is still two
    // finite in-frame numbers. An accessor is now not a value the capture will
    // carry, so the anchor is reported instead of invented.
    expect(reads).toBe(0);
    expect(codesFor(session)).toContain('malformed-anchor');
  });

  it('ignores optional fields the caller does not own', () => {
    const proto = {
      get model() {
        return { cameraFrames: ['leak'] };
      },
      get failure() {
        return 'permission-denied';
      },
    };
    const inheritedDevice = Object.create(proto) as CaptureDeviceProfile;
    inheritedDevice.label = 'field handset';
    inheritedDevice.platform = 'android';
    inheritedDevice.sensors = { api: 'native', gyroscopeUnits: 'deg/s', frame: 'world' };

    const walk = new SessionRecorder({
      sessionId: 'inherited',
      buildingId: 'reference-medical-centre',
      packageHash: 'a'.repeat(64),
      device: inheritedDevice,
      anchors,
      startedAtIso: '2026-08-07T09:00:00.000Z',
    });

    const attempt = Object.create(proto) as never;
    Object.assign(attempt, { timeMs: 100, transport: 'qr', payload: 'vg:corridor-start' });
    const scan = walk.recordScan(attempt);
    const session = walk.buildSession();

    // A prototype getter injected device.model into a recorded session, and an
    // inherited `failure` turned a scan that had resolved into permission-denied.
    expect(session.device).not.toHaveProperty('model');
    expect(scan.outcome).toBe('resolved');
    expect(scan.anchorId).toBe('corridor-start');
    expect(validateCaptureSession(session)).toEqual([]);
  });

  it('stores the mark position the caller indexed', () => {
    const hostile = [4, 5];
    Object.defineProperty(hostile, Symbol.iterator, {
      value: function* () {
        yield 88;
        yield 87;
      },
    });

    const walk = recorder('hostile-mark');
    walk.recordGroundTruth({
      timeMs: 3_000,
      checkpointId: 'mark',
      position: hostile as never,
      floorId: 'g',
      surveyMethod: 'tape-measure',
      expectedAccuracyMeters: 0.03,
      independentOfAnchors: true,
    });
    const stored = walk.buildSession().events.find((event) => event.type === 'ground-truth');

    expect(stored).toMatchObject({ position: [4, 5] });
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

    const walk = new SessionRecorder(options);
    const scan = walk.recordScan(Object.create(proto) as never);
    const session = walk.buildSession();

    // Every one of these previously became persisted evidence and validated
    // cleanly: an inherited packageHash claimed a different venue, an inherited
    // label and platform described a different handset, and an inherited
    // payload resolved a scan the caller never presented.
    expect(session.packageHash).toBeUndefined();
    expect(session.device.label).toBeUndefined();
    expect(session.device.platform).toBeUndefined();
    expect(scan.payload).toBeNull();
    expect(scan.outcome).not.toBe('resolved');

    // And the capture is refused, naming the fields rather than carrying them.
    const codes = codesFor(session);
    expect(codes).toContain('malformed-capture');
    expect(codes).toContain('malformed-device');
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

    const walk = new SessionRecorder({
      sessionId: 'inherited-anchor',
      buildingId: 'reference-medical-centre',
      packageHash: 'a'.repeat(64),
      device,
      anchors: [inheritedAnchor],
      startedAtIso: '2026-08-07T09:00:00.000Z',
    });

    const markProto = { surveyMethod: 'tape-measure', independentOfAnchors: true };
    const inheritedMark = Object.create(markProto) as never;
    Object.assign(inheritedMark, {
      timeMs: 3_000,
      checkpointId: 'mark',
      position: [30, 30],
      floorId: 'g',
      expectedAccuracyMeters: 0.03,
    });
    walk.recordGroundTruth(inheritedMark);
    const session = walk.buildSession();

    expect(session.anchors[0].payload).toBeUndefined();
    const mark = session.events.find((event) => event.type === 'ground-truth');
    expect(mark).toMatchObject({ surveyMethod: undefined, independentOfAnchors: undefined });

    const codes = codesFor(session);
    expect(codes).toContain('malformed-anchor');
    expect(codes).toContain('malformed-ground-truth-event');
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
