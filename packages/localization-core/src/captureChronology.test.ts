import { describe, expect, it } from 'vitest';
import {
  SessionRecorder,
  buildEvidenceReport,
  summarizeSampling,
  validateCaptureSession,
  type CaptureDeviceProfile,
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
    expect(issues.map((issue) => issue.code)).toEqual(['regressing-sensor-clock']);
    expect(issues[0].message).toMatch(/clock went backwards/);
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
