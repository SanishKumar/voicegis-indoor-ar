import { describe, expect, it } from 'vitest';
import {
  CAPTURE_STREAM_VERSION,
  exportCaptureSession,
  importCaptureSession,
  sortCaptureEvents,
  summarizeSampling,
  validateCaptureSession,
  type CaptureDeviceProfile,
  type CaptureEvent,
  type CaptureSession,
} from './captureStream';
import type { CheckpointAnchor } from './checkpoints';
import { replayRecording } from './replay';
import {
  CaptureValidationError,
  SessionRecorder,
  buildEvidenceReport,
  deriveRecording,
  type SessionRecorderOptions,
} from './recorder';

const anchors: CheckpointAnchor[] = [
  {
    id: 'corridor-start',
    floorId: 'g',
    kind: 'qr',
    position: [1, 9],
    headingDegrees: 90,
    payload: 'vg:corridor-start',
  },
  {
    id: 'corridor-end',
    floorId: 'g',
    kind: 'qr',
    position: [6, 9],
    headingDegrees: 90,
    payload: 'vg:corridor-end',
  },
];

const device: CaptureDeviceProfile = {
  label: 'field handset',
  platform: 'android',
  model: 'Pixel 8',
  osVersion: '15',
  browser: 'Chrome',
  browserVersion: '141',
  appVersion: '0.1.0',
  timezone: 'Asia/Kolkata',
  sensors: {
    accelerometerHz: 50,
    gyroscopeHz: 50,
    orientationHz: 25,
    api: 'devicemotion',
    gyroscopeUnits: 'deg/s',
    frame: 'device',
  },
};

const baseOptions: SessionRecorderOptions = {
  sessionId: 'field-walk-001',
  buildingId: 'reference-medical-centre',
  packageHash: 'a'.repeat(64),
  device,
  anchors,
  startedAtIso: '2026-08-07T09:00:00.000Z',
};

function recordWalk(options: Partial<SessionRecorderOptions> = {}) {
  const recorder = new SessionRecorder({ ...baseOptions, ...options });
  for (let elapsed = 0; elapsed <= 600; elapsed += 20) {
    recorder.recordImu({
      timeMs: elapsed,
      accelerometer: [0, 0, 9.81 + 3 * Math.sin((2 * Math.PI * elapsed) / 500)],
      gyroscope: [0, 0, 0],
    });
  }
  recorder.recordScan({ timeMs: 1_000, transport: 'qr', payload: 'vg:corridor-start' });
  for (let elapsed = 1_020; elapsed <= 6_000; elapsed += 20) {
    recorder.recordImu({
      timeMs: elapsed,
      accelerometer: [0, 0, 9.81 + 3 * Math.sin((2 * Math.PI * elapsed) / 500)],
      gyroscope: [0, 0, 0],
      orientation: { alphaDegrees: 90, betaDegrees: 0, gammaDegrees: 0, absolute: true },
    });
  }
  // A mid-corridor mark the system was never told about.
  recorder.recordGroundTruth({
    timeMs: 3_500,
    checkpointId: 'floor-mark-mid',
    position: [3.5, 9],
    floorId: 'g',
    surveyMethod: 'tape-measure',
    expectedAccuracyMeters: 0.03,
    independentOfAnchors: true,
  });
  recorder.recordScan({ timeMs: 6_100, transport: 'qr', payload: 'vg:corridor-end' });
  recorder.recordLifecycle('session-end', 6_200);
  return recorder;
}

describe('capture stream integrity', () => {
  it('stores full sensor vectors rather than reduced scalars', () => {
    const session = recordWalk().buildSession();
    const imu = session.events.find((event) => event.type === 'imu');

    expect(imu).toMatchObject({
      accelerometer: expect.any(Array),
      gyroscope: expect.any(Array),
    });
    expect((imu as { accelerometer: number[] }).accelerometer).toHaveLength(3);
    // Orientation is captured when the platform supplies it.
    expect(session.events.some((e) => e.type === 'imu' && e.orientation !== null)).toBe(true);
  });

  it('records refused and failed acquisitions, not only successful ones', () => {
    const recorder = new SessionRecorder(baseOptions);
    recorder.recordScan({ timeMs: 10, transport: 'qr', payload: 'vg:not-a-marker' });
    recorder.recordScan({ timeMs: 20, transport: 'qr', payload: null, failure: 'decode-failed' });
    recorder.recordScan({ timeMs: 30, transport: 'nfc', payload: null, failure: 'permission-denied' });
    recorder.recordScan({ timeMs: 40, transport: 'nfc', payload: 'vg:corridor-start' });

    const outcomes = recorder
      .buildSession()
      .events.filter((event) => event.type === 'scan')
      .map((event) => (event as { outcome: string }).outcome);

    expect(outcomes).toEqual([
      'unknown-payload',
      'decode-failed',
      'permission-denied',
      // A printed QR anchor must not be satisfied by an NFC tap.
      'anchor-kind-mismatch',
    ]);
  });

  it('carries device, browser, and sensor provenance', () => {
    const session = recordWalk().buildSession();

    expect(session.device).toMatchObject({
      model: 'Pixel 8',
      osVersion: '15',
      browser: 'Chrome',
      timezone: 'Asia/Kolkata',
    });
    expect(session.device.sensors.gyroscopeHz).toBe(50);
    expect(session.captureVersion).toBe(CAPTURE_STREAM_VERSION);
  });

  it('orders events by time then sequence so equal timestamps cannot swap', () => {
    const recorder = new SessionRecorder(baseOptions);
    // A scan and a sample landing in the same millisecond.
    recorder.recordScan({ timeMs: 500, transport: 'qr', payload: 'vg:corridor-start' });
    recorder.recordImu({ timeMs: 500, accelerometer: [0, 0, 9.81], gyroscope: [0, 0, 0] });
    const session = recorder.buildSession();

    const atSameMs = session.events.filter((event) => event.timeMs === 500);
    expect(atSameMs.map((event) => event.type)).toEqual(['scan', 'imu']);
    // Re-sorting a shuffled copy must restore the identical order.
    const shuffled = [...session.events].reverse();
    expect(sortCaptureEvents(shuffled)).toEqual(session.events);
  });

  it('rejects a capture whose start clock was never set', () => {
    const epoch = validateCaptureSession({
      ...recordWalk().buildSession(),
      startedAtIso: new Date(0).toISOString(),
    });
    const missing = validateCaptureSession({
      ...recordWalk().buildSession(),
      startedAtIso: 'not-a-date',
    });

    expect(epoch.map((issue) => issue.code)).toContain('implausible-capture-start');
    expect(missing.map((issue) => issue.code)).toContain('invalid-capture-start');
    expect(validateCaptureSession(recordWalk().buildSession())).toEqual([]);
  });

  it('refuses a ground-truth mark that would measure the anchor that reset it', () => {
    const recorder = new SessionRecorder(baseOptions);
    recorder.recordGroundTruth({
      timeMs: 100,
      checkpointId: 'on-top-of-anchor',
      position: [1, 9],
      floorId: 'g',
      surveyMethod: 'tape-measure',
      expectedAccuracyMeters: 0.03,
      independentOfAnchors: true,
    });

    const issues = validateCaptureSession(recorder.buildSession());

    expect(issues.map((issue) => issue.code)).toContain('ground-truth-not-independent');
    expect(issues.find((i) => i.code === 'ground-truth-not-independent')?.message).toContain(
      'corridor-start',
    );
  });

  it('accepts the same mark when it is honestly declared dependent', () => {
    const recorder = new SessionRecorder(baseOptions);
    recorder.recordGroundTruth({
      timeMs: 100,
      checkpointId: 'at-anchor',
      position: [1, 9],
      floorId: 'g',
      surveyMethod: 'tape-measure',
      expectedAccuracyMeters: 0.03,
      independentOfAnchors: false,
    });

    expect(validateCaptureSession(recorder.buildSession())).toEqual([]);
  });

  it('flags backwards time and mis-ordered ties in a stored stream', () => {
    const session = recordWalk().buildSession();

    const backwards: CaptureSession = {
      ...session,
      events: [session.events[5], session.events[1]] as CaptureEvent[],
    };
    expect(validateCaptureSession(backwards).map((issue) => issue.code)).toContain(
      'non-monotonic-time',
    );

    // Two events in the same millisecond stored against capture order.
    const tied: CaptureSession = {
      ...session,
      events: [
        { ...session.events[1], sequence: 9, timeMs: 500 },
        { ...session.events[2], sequence: 4, timeMs: 500 },
      ] as CaptureEvent[],
    };
    expect(validateCaptureSession(tied).map((issue) => issue.code)).toContain(
      'non-monotonic-sequence',
    );

    const duplicated: CaptureSession = {
      ...session,
      events: [
        { ...session.events[1], sequence: 7, timeMs: 100 },
        { ...session.events[2], sequence: 7, timeMs: 200 },
      ] as CaptureEvent[],
    };
    expect(validateCaptureSession(duplicated).map((issue) => issue.code)).toContain(
      'duplicate-event-sequence',
    );
  });

  it('rejects malformed events instead of importing them', () => {
    const session = recordWalk().buildSession();
    const malformed = JSON.stringify({
      ...session,
      events: [{ type: 'imu', sequence: 0, timeMs: 0, accelerometer: [1, 2], gyroscope: null }],
    });

    const result = importCaptureSession(malformed);
    expect(result.valid).toBe(false);
    expect(result.session).toBeNull();
    expect(result.issues.map((issue) => issue.code)).toContain('malformed-imu-event');
    expect(importCaptureSession('{ broken').issues[0].code).toBe('invalid-capture-json');
  });

  it('survives an interrupted session and records the interruption', () => {
    const recorder = new SessionRecorder(baseOptions);
    recorder.recordScan({ timeMs: 100, transport: 'qr', payload: 'vg:corridor-start' });
    recorder.recordImu({ timeMs: 200, accelerometer: [0, 0, 12.8], gyroscope: [0, 0, 0] });
    recorder.recordLifecycle('backgrounded', 300, 'screen locked');
    // No samples arrive while backgrounded.
    recorder.recordLifecycle('foregrounded', 9_000);
    recorder.recordImu({ timeMs: 9_100, accelerometer: [0, 0, 12.8], gyroscope: [0, 0, 0] });

    const session = recorder.buildSession();
    expect(validateCaptureSession(session)).toEqual([]);
    expect(
      session.events.filter((e) => e.type === 'lifecycle').map((e) => (e as { event: string }).event),
    ).toEqual(['session-start', 'backgrounded', 'foregrounded']);
    // The gap must not break derivation.
    expect(deriveRecording(session).observations.length).toBeGreaterThan(0);
  });
});

describe('fail-closed evaluation boundary', () => {
  const anchoredSession = (): CaptureSession => ({
    captureVersion: CAPTURE_STREAM_VERSION,
    sessionId: 's',
    buildingId: 'b',
    packageHash: 'a'.repeat(64),
    startedAtIso: '2026-08-07T09:00:00.000Z',
    device,
    anchors,
    events: [
      {
        type: 'scan',
        sequence: 0,
        timeMs: 100,
        transport: 'qr',
        payload: 'vg:corridor-start',
        outcome: 'resolved',
        anchorId: 'corridor-start',
      },
      {
        type: 'ground-truth',
        sequence: 1,
        timeMs: 100,
        checkpointId: 'on-anchor',
        position: [1, 9],
        floorId: 'g',
        surveyMethod: 'tape-measure',
        expectedAccuracyMeters: 0.03,
        independentOfAnchors: false,
      },
    ],
  });

  it('keeps a dependent checkpoint out of the published metric entirely', () => {
    const derived = deriveRecording(anchoredSession());

    // The evaluator only ever reads `checkpoints`, so a dependent mark cannot
    // reach the reported accuracy.
    expect(derived.checkpoints).toEqual([]);
    expect(derived.diagnosticCheckpoints.map((c) => [c.id, c.exclusionReason])).toEqual([
      ['on-anchor', 'dependent-on-anchor'],
    ]);
    expect(replayRecording(derived).report.checkpointCount).toBe(0);
  });

  it('retains full provenance for excluded marks rather than dropping them', () => {
    const [excluded] = deriveRecording(anchoredSession()).diagnosticCheckpoints;

    expect(excluded).toMatchObject({
      id: 'on-anchor',
      recordedTimeMs: 100,
      surveyMethod: 'tape-measure',
      expectedAccuracyMeters: 0.03,
      independentOfAnchors: false,
      publishable: false,
    });
  });

  it('never overwrites the surveyed time with the aligned time', () => {
    const derived = deriveRecording(recordWalk().buildSession());
    const mark = derived.evaluationCheckpoints.find((c) => c.id === 'floor-mark-mid')!;

    expect(mark.recordedTimeMs).toBe(3_500);
    expect(mark.alignedTimeMs).not.toBe(undefined);
    expect(mark.alignmentDeltaMs).toBe(mark.alignedTimeMs - mark.recordedTimeMs);
    expect(Math.abs(mark.alignmentDeltaMs)).toBeLessThanOrEqual(1_000);
    expect(mark.publishable).toBe(true);
  });

  /**
   * Two scans and one mark, all at the same millisecond. Only the sequence
   * distinguishes a mark taken before the second reset from one taken after.
   */
  const sameMillisecondSession = (markSequence: number): CaptureSession => ({
    captureVersion: CAPTURE_STREAM_VERSION,
    sessionId: 's',
    buildingId: 'b',
    packageHash: 'a'.repeat(64),
    startedAtIso: '2026-08-07T09:00:00.000Z',
    device,
    anchors,
    events: (
      [
        {
          type: 'scan',
          sequence: 0,
          timeMs: 100,
          transport: 'qr',
          payload: 'vg:corridor-start',
          outcome: 'resolved',
          anchorId: 'corridor-start',
        },
        {
          type: 'ground-truth',
          sequence: markSequence,
          timeMs: 500,
          checkpointId: 'tie-mark',
          position: [40, 40],
          floorId: 'g',
          surveyMethod: 'tape-measure',
          expectedAccuracyMeters: 0.03,
          independentOfAnchors: true,
        },
        {
          type: 'scan',
          sequence: 2,
          timeMs: 500,
          transport: 'qr',
          payload: 'vg:corridor-end',
          outcome: 'resolved',
          anchorId: 'corridor-end',
        },
      ] as CaptureEvent[]
    ).sort((left, right) => left.timeMs - right.timeMs || left.sequence - right.sequence),
  });

  /**
   * The reproduction that defeated key-less alignment: a step, a mark, and a
   * reset all in one millisecond. Scoring by time alone selects whichever
   * estimate was written last, which is the reset.
   */
  const tieBreakSession = (markSequence: number): CaptureSession => ({
    captureVersion: CAPTURE_STREAM_VERSION,
    sessionId: 's',
    buildingId: 'b',
    packageHash: 'a'.repeat(64),
    startedAtIso: '2026-08-07T09:00:00.000Z',
    device,
    anchors: [
      { id: 'origin', floorId: 'g', kind: 'qr', position: [0, 0], headingDegrees: 0, payload: 'p:origin' },
      { id: 'far', floorId: 'g', kind: 'qr', position: [80, 80], headingDegrees: 0, payload: 'p:far' },
    ],
    events: (
      [
        {
          type: 'scan',
          sequence: 0,
          timeMs: 0,
          transport: 'qr',
          payload: 'p:origin',
          outcome: 'resolved',
          anchorId: 'origin',
        },
        // A real footfall: baseline, then a peak above threshold, then the
        // falling edge that completes the step at (500 ms, sequence 3).
        {
          type: 'imu',
          sequence: 1,
          timeMs: 300,
          accelerometer: [0, 0, 9.81],
          gyroscope: [0, 0, 0],
          orientation: null,
        },
        {
          type: 'imu',
          sequence: 2,
          timeMs: 400,
          accelerometer: [0, 0, 13.5],
          gyroscope: [0, 0, 0],
          orientation: null,
        },
        {
          type: 'imu',
          sequence: 3,
          timeMs: 500,
          accelerometer: [0, 0, 9.0],
          gyroscope: [0, 0, 0],
          orientation: null,
        },
        {
          type: 'ground-truth',
          sequence: markSequence,
          timeMs: 500,
          checkpointId: 'tie-mark',
          position: [0, 2],
          floorId: 'g',
          surveyMethod: 'tape-measure',
          expectedAccuracyMeters: 0.03,
          independentOfAnchors: true,
        },
        {
          type: 'scan',
          sequence: 5,
          timeMs: 500,
          transport: 'qr',
          payload: 'p:far',
          outcome: 'resolved',
          anchorId: 'far',
        },
      ] as CaptureEvent[]
    ).sort((left, right) => left.timeMs - right.timeMs || left.sequence - right.sequence),
  });

  it('scores a mark before a same-millisecond reset against the pre-reset estimate', () => {
    const session = tieBreakSession(4);
    const derived = deriveRecording(session);
    const mark = derived.evaluationCheckpoints.find((c) => c.id === 'tie-mark')!;
    const { estimates } = replayRecording(derived);
    const { report } = buildEvidenceReport(session);

    expect(mark.publishable).toBe(true);
    expect(mark.observationIndex).not.toBeNull();
    // The chosen estimate must come from the step at sequence 3, not the reset
    // at sequence 5.
    expect(mark.estimateKey!.sequence).toBe(3);

    // The completed step advances one 0.72 m stride from the origin anchor, so
    // the estimate is exactly [0, 0.72] and the mark at [0, 2] is exactly
    // 1.28 m away. Scoring by time alone chose the far anchor instead.
    const scored = estimates[mark.observationIndex!];
    expect(scored.position[0]).toBeCloseTo(0, 9);
    expect(scored.position[1]).toBeCloseTo(0.72, 9);
    expect(report.medianHorizontalErrorMeters).toBe(1.28);
    expect(report.p95HorizontalErrorMeters).toBe(1.28);
  });

  it('scores a mark after a same-millisecond reset against the post-reset estimate', () => {
    const session = tieBreakSession(6);
    const derived = deriveRecording(session);
    const mark = derived.evaluationCheckpoints.find((c) => c.id === 'tie-mark')!;
    const { estimates } = replayRecording(derived);

    expect(mark.publishable).toBe(true);
    // The mark now follows the reset, so the reset is legitimately causal.
    // Ordinal 2 is the third observation the scan emits (position, heading,
    // floor); the mark follows all three, so the last is causal.
    expect(mark.estimateKey).toEqual({ timeMs: 500, sequence: 5, ordinal: 2 });
    // A fix corrects toward the anchor in proportion to relative uncertainty
    // rather than snapping onto it, so the estimate lands short of [80, 80].
    const scored = estimates[mark.observationIndex!];
    expect(scored.position[0]).toBeCloseTo(63.282728403721265, 9);
    expect(scored.position[1]).toBeCloseTo(63.43318384808777, 9);
    expect(buildEvidenceReport(tieBreakSession(6)).report.medianHorizontalErrorMeters).toBe(88.197);
  });

  it('never scores a mark against a first fix captured after it', () => {
    const session: CaptureSession = {
      ...tieBreakSession(4),
      events: (
        [
          {
            type: 'ground-truth',
            sequence: 0,
            timeMs: 500,
            checkpointId: 'before-fix',
            position: [0, 2],
            floorId: 'g',
            surveyMethod: 'tape-measure',
            expectedAccuracyMeters: 0.03,
            independentOfAnchors: true,
          },
          {
            type: 'scan',
            sequence: 1,
            timeMs: 500,
            transport: 'qr',
            payload: 'p:far',
            outcome: 'resolved',
            anchorId: 'far',
          },
        ] as CaptureEvent[]
      ).sort((left, right) => left.timeMs - right.timeMs || left.sequence - right.sequence),
    };

    const derived = deriveRecording(session);
    const mark = derived.evaluationCheckpoints.find((c) => c.id === 'before-fix')!;

    expect(mark.publishable).toBe(false);
    expect(mark.exclusionReason).toBe('no-causal-estimate-in-range');
    expect(mark.observationIndex).toBeNull();
    expect(derived.checkpoints).toEqual([]);
    expect(buildEvidenceReport(session).report.evidenceStatus).toBe('insufficient-ground-truth');
  });

  it('distinguishes the several observations one scan emits at a single instant', () => {
    const session = tieBreakSession(6);
    const derived = deriveRecording(session);
    const mark = derived.evaluationCheckpoints.find((c) => c.id === 'tie-mark')!;

    // A resolved scan after the first fix emits position, heading, and floor.
    const fromReset = derived.observations.filter((o) => o.timeMs === 500);
    expect(fromReset.length).toBeGreaterThan(1);
    // The key must name which of them was used, not merely the millisecond.
    // The key names which of them was used, not merely the millisecond.
    expect(mark.estimateKey).toEqual({ timeMs: 500, sequence: 5, ordinal: 2 });
    expect(derived.checkpoints[0].observationIndex).toBe(mark.observationIndex);
  });

  it('scores a mark captured before a same-millisecond reset against pre-reset state', () => {
    // sequence 1 puts the mark ahead of the reset at sequence 2.
    const derived = deriveRecording(sameMillisecondSession(1));
    const mark = derived.evaluationCheckpoints.find((c) => c.id === 'tie-mark')!;

    expect(mark.alignedTimeMs).toBeLessThanOrEqual(mark.recordedTimeMs);
    expect(mark.alignmentDeltaMs).toBeLessThanOrEqual(0);
    // The estimate used must predate the second reset, never follow it.
    expect(mark.exclusionReason).not.toBe('alignment-crosses-anchor-reset');
  });

  it('never scores any mark against a future estimate', () => {
    for (const markSequence of [1, 3]) {
      const derived = deriveRecording(sameMillisecondSession(markSequence));
      for (const mark of derived.evaluationCheckpoints) {
        expect(mark.alignedTimeMs).toBeLessThanOrEqual(mark.recordedTimeMs);
        expect(mark.alignmentDeltaMs).toBeLessThanOrEqual(0);
      }
    }
  });

  it('excludes a mark with no causal estimate behind it', () => {
    const session = sameMillisecondSession(1);
    // Move the mark before any observation exists.
    session.events = sortCaptureEvents(
      session.events.map((event) =>
        event.type === 'ground-truth' ? { ...event, timeMs: 1, sequence: 5 } : event,
      ),
    );

    const derived = deriveRecording(session);
    const mark = derived.evaluationCheckpoints.find((c) => c.id === 'tie-mark')!;

    expect(mark.publishable).toBe(false);
    expect(mark.exclusionReason).toBe('no-causal-estimate-in-range');
    expect(derived.checkpoints).toEqual([]);
  });

  it('keeps estimated and coarse survey marks diagnostic only', () => {
    const build = (surveyMethod: string, expectedAccuracyMeters: number) => {
      const session = sameMillisecondSession(1);
      session.events = session.events.map((event) =>
        event.type === 'ground-truth'
          ? ({ ...event, surveyMethod, expectedAccuracyMeters } as CaptureEvent)
          : event,
      );
      return deriveRecording(session).evaluationCheckpoints[0];
    };

    expect(build('estimated', 0.03)).toMatchObject({
      publishable: false,
      exclusionReason: 'survey-method-not-publishable',
    });
    expect(build('tape-measure', 0.9)).toMatchObject({
      publishable: false,
      exclusionReason: 'survey-accuracy-out-of-policy',
    });
    expect(build('tape-measure', 0.03).publishable).toBe(true);
  });

  it('reports no evidence rather than zero error when nothing is eligible', () => {
    const evidence = buildEvidenceReport(anchoredSession());

    expect(evidence.report.evidenceStatus).toBe('insufficient-ground-truth');
    expect(evidence.report.medianHorizontalErrorMeters).toBeNull();
    expect(evidence.report.p95HorizontalErrorMeters).toBeNull();
    expect(evidence.report.floorAccuracy).toBeNull();
    expect(evidence.eligibility).toMatchObject({ surveyed: 1, publishable: 0, excluded: 1 });
    expect(evidence.eligibility.exclusionCounts['dependent-on-anchor']).toBe(1);
  });

  it('publishes eligibility, survey and alignment provenance alongside the figure', () => {
    const evidence = buildEvidenceReport(recordWalk().buildSession());

    expect(evidence.report.evidenceStatus).toBe('ok');
    expect(evidence.eligibility.publishable).toBeGreaterThan(0);
    expect(evidence.survey.methods['tape-measure']).toBeGreaterThan(0);
    expect(evidence.survey.worstExpectedAccuracyMeters).toBeLessThanOrEqual(0.25);
    expect(evidence.alignment.worstAlignmentDeltaMs).toBeLessThanOrEqual(0);
    expect(evidence.alignment.toleranceMs).toBeGreaterThan(0);
    expect(evidence.sampling.observedHz).toBeCloseTo(50, 1);
  });

  it('reports insufficient localization when a walk never obtains a fix', () => {
    const recorder = new SessionRecorder(baseOptions);
    // Sensors run, but no marker is ever read, so nothing is ever localized.
    for (let elapsed = 0; elapsed <= 2_000; elapsed += 20) {
      recorder.recordImu({
        timeMs: elapsed,
        accelerometer: [0, 0, 9.81 + 3 * Math.sin((2 * Math.PI * elapsed) / 500)],
        gyroscope: [0, 0, 0],
      });
    }
    recorder.recordGroundTruth({
      timeMs: 1_000,
      checkpointId: 'mark',
      position: [3.5, 9],
      floorId: 'g',
      surveyMethod: 'tape-measure',
      expectedAccuracyMeters: 0.03,
      independentOfAnchors: true,
    });
    const session = recorder.buildSession();

    // A walk that never localized is an expected field outcome, not a defect.
    expect(() => buildEvidenceReport(session)).not.toThrow();
    const { report } = buildEvidenceReport(session);
    expect(report.evidenceStatus).toBe('insufficient-localization');
    expect(report.medianHorizontalErrorMeters).toBeNull();
    expect(report.p95HorizontalErrorMeters).toBeNull();
    expect(report.checkpointErrors).toEqual([]);
  });

  it('refuses to publish a capture that was interrupted', () => {
    const recorder = recordWalk();
    recorder.recordLifecycle('backgrounded', 4_000, 'screen locked');
    const session = recorder.buildSession();

    expect(() => buildEvidenceReport(session)).not.toThrow();
    const { report } = buildEvidenceReport(session);
    // Inertial integration across the gap invents heading, so any figure from
    // this walk is untrustworthy regardless of how good it looks.
    expect(report.evidenceStatus).toBe('interrupted-capture');
    expect(report.medianHorizontalErrorMeters).toBeNull();
    expect(report.checkpointErrors).toEqual([]);
  });

  it('refuses to publish sensor units or frames it cannot interpret', () => {
    const radians = recordWalk({
      device: { ...device, sensors: { ...device.sensors, gyroscopeUnits: 'rad/s' } },
    }).buildSession();
    const world = recordWalk({
      device: { ...device, sensors: { ...device.sensors, frame: 'world' } },
    }).buildSession();

    expect(buildEvidenceReport(radians).report.evidenceStatus).toBe('unsupported-sensor-model');
    expect(buildEvidenceReport(world).report.evidenceStatus).toBe('unsupported-sensor-model');
    expect(buildEvidenceReport(radians).report.medianHorizontalErrorMeters).toBeNull();
  });

  it('refuses to export an invalid capture', () => {
    const invalid = { ...recordWalk().buildSession(), startedAtIso: new Date(0).toISOString() };

    expect(() => exportCaptureSession(invalid)).toThrow('Refusing to export');
  });

  it('refuses to derive anything from a session that does not validate', () => {
    const broken = { ...recordWalk().buildSession(), startedAtIso: new Date(0).toISOString() };

    expect(() => deriveRecording(broken)).toThrow(CaptureValidationError);
    try {
      deriveRecording(broken);
    } catch (error) {
      expect((error as CaptureValidationError).issues.map((i) => i.code)).toContain(
        'implausible-capture-start',
      );
    }
  });
});

describe('never-throw runtime validation', () => {
  const base = () => recordWalk().buildSession();

  it('reports malformed events instead of dereferencing them', () => {
    expect(() =>
      validateCaptureSession({ ...base(), events: [null, undefined, 7, 'x'] }),
    ).not.toThrow();
    expect(
      validateCaptureSession({ ...base(), events: [null] }).map((i) => i.code),
    ).toContain('malformed-event');
  });

  it('rejects a session with no device or sensor profile', () => {
    expect(validateCaptureSession({ ...base(), device: undefined }).map((i) => i.code)).toContain(
      'malformed-device',
    );
    expect(
      validateCaptureSession({ ...base(), device: { label: 'd', platform: 'p' } }).map((i) => i.code),
    ).toContain('malformed-device');
    expect(
      validateCaptureSession({
        ...base(),
        device: { label: 'd', platform: 'p', sensors: { gyroscopeUnits: 'furlongs' } },
      }).map((i) => i.code),
    ).toContain('malformed-sensor-profile');
  });

  it('rejects malformed anchors rather than trusting them', () => {
    expect(validateCaptureSession({ ...base(), anchors: [{ id: 1 }] }).map((i) => i.code)).toContain(
      'malformed-anchor',
    );
    expect(validateCaptureSession({ ...base(), anchors: 'nope' }).map((i) => i.code)).toContain(
      'malformed-anchors',
    );
    expect(
      validateCaptureSession({
        ...base(),
        anchors: [{ ...anchors[0], headingDegrees: 361 }],
      }).map((i) => i.code),
    ).toContain('malformed-anchor');
  });

  it('rejects every malformed event variant', () => {
    const variant = (event: unknown) =>
      validateCaptureSession({ ...base(), events: [event] }).map((i) => i.code);

    expect(variant({ type: 'imu', sequence: 0, timeMs: 0, accelerometer: [1, 2], gyroscope: null })).toContain(
      'malformed-imu-event',
    );
    expect(
      variant({ type: 'scan', sequence: 0, timeMs: 0, transport: 'qr', outcome: 'resolved', payload: null, anchorId: null }),
    ).toContain('malformed-scan-event');
    expect(
      variant({ type: 'ground-truth', sequence: 0, timeMs: 0, checkpointId: 'a', position: [0, 0], floorId: 'g', surveyMethod: 'vibes', expectedAccuracyMeters: 1, independentOfAnchors: true }),
    ).toContain('malformed-ground-truth-event');
    expect(variant({ type: 'lifecycle', sequence: 0, timeMs: 0, event: 'exploded' })).toContain(
      'malformed-lifecycle-event',
    );
    expect(variant({ type: 'telepathy', sequence: 0, timeMs: 0 })).toContain('unknown-event-type');
  });

  it('handles hostile top-level input without throwing', () => {
    for (const hostile of [null, undefined, 42, 'x', [], { events: null }]) {
      expect(() => validateCaptureSession(hostile)).not.toThrow();
      expect(validateCaptureSession(hostile).length).toBeGreaterThan(0);
    }
    expect(importCaptureSession('null').valid).toBe(false);
  });

  it('recovers real sampling behaviour instead of trusting the declared rate', () => {
    const summary = summarizeSampling(recordWalk().buildSession());

    expect(summary.sampleCount).toBeGreaterThan(100);
    expect(summary.medianIntervalMs).toBe(20);
    expect(summary.observedHz).toBeCloseTo(50, 1);
    // The walk has a deliberate gap between the warm-up and the corridor.
    expect(summary.gaps.length).toBeGreaterThan(0);
  });
});

describe('capture export and derivation', () => {
  it('round-trips through canonical JSON byte for byte', () => {
    const session = recordWalk().buildSession();
    const exported = exportCaptureSession(session);
    const imported = importCaptureSession(exported);

    expect(imported.valid).toBe(true);
    expect(exportCaptureSession(imported.session!)).toBe(exported);
  });

  it('derives an identical recording after export and import', () => {
    const session = recordWalk().buildSession();
    const reimported = importCaptureSession(exportCaptureSession(session)).session!;

    expect(deriveRecording(reimported)).toEqual(deriveRecording(session));
  });

  it('replays a derived recording through the existing pipeline', () => {
    const session = recordWalk().buildSession();
    const recording = deriveRecording(session);
    const { report } = buildEvidenceReport(session);

    expect(recording.observations[0].kind).toBe('initial-fix');
    expect(report.checkpointCount).toBe(1);
    expect(Number.isFinite(report.medianHorizontalErrorMeters)).toBe(true);
    expect(Number.isFinite(report.p95HorizontalErrorMeters)).toBe(true);
  });

  it('re-derives a stored walk under different tuning without touching the capture', () => {
    const session = recordWalk().buildSession();
    const retuned = deriveRecording(session, {
      deadReckoningConfig: { strideLengthMeters: 0.9 },
    });

    expect(retuned.deadReckoningConfig.strideLengthMeters).toBe(0.9);
    expect(retuned.observations.find((o) => o.kind === 'step')).toMatchObject({
      distanceMeters: 0.9,
    });
    // The raw stream is untouched by re-analysis.
    expect(session).toEqual(recordWalk().buildSession());
  });
});
