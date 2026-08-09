import { describe, expect, it } from 'vitest';
import referenceRecording from '../../../recordings/reference-corridor-walk.json';
import { replayRecording } from './replay';
import type { LocalizationRecording } from './types';

const recording = referenceRecording as LocalizationRecording;

describe('localization replay', () => {
  it('replays the same observation stream to identical estimates and metrics', () => {
    const first = replayRecording(recording);
    const second = replayRecording(recording);

    expect(second).toEqual(first);
    expect(first.report).toMatchObject({
      sessionId: 'synthetic-reference-corridor-001',
      observationCount: 7,
      checkpointCount: 3,
      mapMatching: {
        acceptedCount: 7,
        rejectedCount: 0,
      },
      runtime: {
        guidanceFrozenFrames: 0,
      },
    });
  });

  it('never reports accuracy from a bare recording', () => {
    // A recording can be hand-written, so anything computed from one describes
    // a computation rather than a measurement.
    const { report } = replayRecording(recording);

    expect(report.evidenceStatus).toBe('unofficial-recording');
    expect(report.medianHorizontalErrorMeters).toBeNull();
    expect(report.p95HorizontalErrorMeters).toBeNull();
    expect(report.floorAccuracy).toBeNull();
    // Individual errors would let the aggregate be reconstructed.
    expect(report.checkpointErrors).toEqual([]);
  });

  it('refuses a checkpoint whose observation index is out of range', () => {
    const forged = structuredClone(recording) as LocalizationRecording;
    forged.checkpoints[0].observationIndex = 9_999;

    expect(() => replayRecording(forged)).toThrow('out of range');
  });

  it('rejects recordings that claim to retain camera frames', () => {
    const invalid = structuredClone(recording) as unknown as {
      privacy: { cameraFramesStored: boolean };
    };
    invalid.privacy.cameraFramesStored = true;

    expect(() => replayRecording(invalid as unknown as LocalizationRecording)).toThrow(
      'must not contain camera frames',
    );
  });
});
