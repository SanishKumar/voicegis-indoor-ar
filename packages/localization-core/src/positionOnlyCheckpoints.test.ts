import { describe, expect, it } from 'vitest';
import { CheckpointAdapter, type CheckpointAnchor } from './checkpoints';
import { LocalizationFilter } from './filter';
import { SessionRecorder, buildEvidenceReport, deriveRecording } from './recorder';

const anchor: CheckpointAnchor = {
  id: 'entry',
  floorId: 'g',
  kind: 'qr',
  position: [1, 9],
  headingDegrees: 90,
  payload: 'test:entry',
};

function capture(headingDegrees = 90) {
  const recorder = new SessionRecorder({
    sessionId: 'position-only',
    buildingId: 'test',
    packageHash: 'a'.repeat(64),
    startedAtIso: '2026-09-12T09:00:00.000Z',
    device: {
      label: 'synthetic fixture',
      platform: 'test',
      sensors: { api: 'native', frame: 'world', gyroscopeUnits: 'deg/s' },
    },
    anchors: [{ ...anchor, headingDegrees }],
  });
  recorder.recordScan({ timeMs: 0, transport: 'qr', payload: anchor.payload });
  for (let timeMs = 0; timeMs <= 2_000; timeMs += 20) {
    recorder.recordImu({
      timeMs,
      accelerometer: [0, 0, 9.81 + 3 * Math.sin((timeMs * Math.PI) / 250)],
      gyroscope: [0, 0, 0],
    });
  }
  recorder.recordGroundTruth({
    timeMs: 2_000,
    checkpointId: 'mark',
    position: [4, 9],
    floorId: 'g',
    surveyMethod: 'tape-measure',
    expectedAccuracyMeters: 0.03,
    independentOfAnchors: true,
  });
  recorder.recordScan({ timeMs: 2_100, transport: 'qr', payload: anchor.payload });
  recorder.recordLifecycle('session-end', 2_200);
  return recorder.buildSession();
}

describe('a decoded checkpoint is not a heading measurement', () => {
  it.each(['qr', 'nfc'] as const)('initial %s fix leaves direction unknown', (kind) => {
    const adapter = new CheckpointAdapter([{ ...anchor, kind }]);
    const [fix] = adapter.resolve({ timeMs: 0, kind, payload: anchor.payload }).observations;
    const estimate = new LocalizationFilter().apply(fix);
    expect(estimate.position).toEqual([1, 9, 0]);
    expect(estimate.headingDegrees).toBeNull();
    expect(estimate.headingSigmaDegrees).toBeNull();
  });

  it('later scans correct position and floor without emitting heading', () => {
    const adapter = new CheckpointAdapter([anchor]);
    adapter.resolve({ timeMs: 0, kind: 'qr', payload: anchor.payload });
    expect(
      adapter
        .resolve({ timeMs: 100, kind: 'qr', payload: anchor.payload })
        .observations.map((event) => event.kind),
    ).toEqual(['position-fix', 'floor']);
  });

  it('derivation never seeds inertial direction from marker orientation', () => {
    const first = deriveRecording(capture(90));
    const rotated = deriveRecording(capture(270));
    expect(first.observations).toEqual(rotated.observations);
    expect(first.observations.some((event) => event.kind === 'heading')).toBe(false);
  });

  it('withholds accuracy when the capture has no independent heading observation', () => {
    const { report } = buildEvidenceReport(capture());
    expect(report.evidenceStatus).toBe('unverified-heading');
    expect(report.medianHorizontalErrorMeters).toBeNull();
    expect(report.p95HorizontalErrorMeters).toBeNull();
    expect(report.floorAccuracy).toBeNull();
    expect(report.checkpointErrors).toEqual([]);
  });
});
