import { describe, expect, it } from 'vitest';
import {
  CAPTURE_STREAM_VERSION,
  exportCaptureSession,
  importCaptureSession,
  sortCaptureEvents,
  validateCaptureSession,
  type CaptureDeviceProfile,
  type CaptureEvent,
  type CaptureSession,
} from './captureStream';
import type { CheckpointAnchor } from './checkpoints';
import { replayRecording } from './replay';
import { SessionRecorder, deriveRecording, type SessionRecorderOptions } from './recorder';

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
  sensors: { accelerometerHz: 50, gyroscopeHz: 50, orientationHz: 25 },
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
    const recording = deriveRecording(recordWalk().buildSession());
    const { report } = replayRecording(recording);

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
