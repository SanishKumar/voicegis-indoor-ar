import { describe, expect, it } from 'vitest';
import type { CheckpointAnchor } from './checkpoints';
import type { ImuSample } from './deadReckoning';
import { replayRecording } from './replay';
import { SessionRecorder, rebuildRecording, type SessionRecorderOptions } from './recorder';

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

const baseOptions: SessionRecorderOptions = {
  sessionId: 'field-walk-001',
  buildingId: 'reference-medical-centre',
  packageHash: 'a'.repeat(64),
  device: {
    label: 'field handset',
    platform: 'android',
    model: 'Pixel 8',
    osVersion: '15',
    appVersion: '0.1.0',
    imuSampleRateHz: 50,
  },
  anchors,
  startedAtIso: '2026-08-07T09:00:00.000Z',
};

function walk(startTimeMs: number, durationMs: number, sampleMs = 20): ImuSample[] {
  const samples: ImuSample[] = [];
  for (let elapsed = 0; elapsed <= durationMs; elapsed += sampleMs) {
    samples.push({
      timeMs: startTimeMs + elapsed,
      accelerationMagnitude: 9.81 + 3 * Math.sin((2 * Math.PI * elapsed) / 500),
      yawRateDegreesPerSecond: 0,
    });
  }
  return samples;
}

/** A corridor walk: sensors warm up, scan, walk, scan again. */
function recordCorridorWalk(options: Partial<SessionRecorderOptions> = {}) {
  const recorder = new SessionRecorder({ ...baseOptions, ...options });
  // Sensors run before the first scan, as they do on a real handset.
  for (const sample of walk(0, 600)) recorder.pushImuSample(sample);
  recorder.pushScan({ timeMs: 1_000, kind: 'qr', payload: 'vg:corridor-start' });
  for (const sample of walk(1_020, 5_000)) recorder.pushImuSample(sample);
  recorder.pushScan({ timeMs: 6_100, kind: 'qr', payload: 'vg:corridor-end' });
  recorder.markGroundTruth({ id: 'floor-mark-1', timeMs: 6_100, position: [6, 9], floorId: 'g' });
  return recorder;
}

describe('field session recorder', () => {
  it('keeps every raw sample and scan, including refused ones', () => {
    const recorder = new SessionRecorder(baseOptions);
    for (const sample of walk(0, 200)) recorder.pushImuSample(sample);
    recorder.pushScan({ timeMs: 300, kind: 'qr', payload: 'vg:not-a-real-marker' });
    recorder.pushScan({ timeMs: 400, kind: 'qr', payload: 'vg:corridor-start' });

    const recording = recorder.build();

    expect(recording.capture.imuSamples).toHaveLength(11);
    // A refused scan is evidence too: it tells you a marker was unreadable.
    expect(recording.capture.scans).toEqual([
      expect.objectContaining({ accepted: false, reason: 'unknown-payload', anchorId: null }),
      expect.objectContaining({ accepted: true, reason: 'resolved', anchorId: 'corridor-start' }),
    ]);
  });

  it('records the provenance needed to defend a number later', () => {
    const recording = recordCorridorWalk().build();

    expect(recording.device).toMatchObject({
      model: 'Pixel 8',
      osVersion: '15',
      imuSampleRateHz: 50,
    });
    expect(recording.capture.startedAtIso).toBe('2026-08-07T09:00:00.000Z');
    // The tuning that produced the derived observations travels with the walk.
    expect(recording.capture.deadReckoningConfig.strideLengthMeters).toBeGreaterThan(0);
    expect(recording.capture.anchors).toHaveLength(2);
    expect(recording.privacy.cameraFramesStored).toBe(false);
  });

  it('drops pre-fix observations from the stream but keeps their raw samples', () => {
    const recording = recordCorridorWalk().build();

    expect(recording.observations[0].kind).toBe('initial-fix');
    expect(recording.observations.every((o) => o.timeMs >= 1_000)).toBe(true);
    // Nothing can be localized before the first fix, but the samples are still
    // evidence about how the device behaves.
    expect(recording.capture.imuSamples.some((sample) => sample.timeMs < 1_000)).toBe(true);
  });

  it('emits a recording the existing replay pipeline accepts unchanged', () => {
    const recording = recordCorridorWalk().build();
    const { report } = replayRecording(recording);

    expect(report.sessionId).toBe('field-walk-001');
    expect(report.observationCount).toBe(recording.observations.length);
    expect(report.checkpointCount).toBe(1);
    expect(Number.isFinite(report.medianHorizontalErrorMeters)).toBe(true);
    expect(Number.isFinite(report.p95HorizontalErrorMeters)).toBe(true);
  });

  it('numbers observations strictly increasing and ordered by time', () => {
    const recording = recordCorridorWalk().build();
    const sequences = recording.observations.map((o) => o.sequence);
    const times = recording.observations.map((o) => o.timeMs);

    expect(sequences).toEqual(sequences.map((_, index) => index));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('re-analyses a stored walk under different tuning without a second visit', () => {
    const original = recordCorridorWalk().build();
    const retuned = rebuildRecording(original, {
      deadReckoningConfig: { strideLengthMeters: 0.9 },
    });

    // Same raw walk, different derived motion.
    expect(retuned.capture.imuSamples).toEqual(original.capture.imuSamples);
    expect(retuned.capture.scans).toEqual(original.capture.scans);
    expect(retuned.capture.deadReckoningConfig.strideLengthMeters).toBe(0.9);
    const steps = (recording: typeof original) =>
      recording.observations.filter((o) => o.kind === 'step');
    expect(steps(retuned)[0]).toMatchObject({ distanceMeters: 0.9 });
    expect(steps(original)[0]).not.toMatchObject({ distanceMeters: 0.9 });
    expect(replayRecording(retuned).report.checkpointCount).toBe(1);
  });

  it('rebuilds identically when nothing is overridden', () => {
    const original = recordCorridorWalk().build();

    expect(rebuildRecording(original)).toEqual(original);
  });
});
