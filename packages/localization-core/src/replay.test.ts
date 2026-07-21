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
      floorAccuracy: 1,
      mapMatching: {
        acceptedCount: 7,
        rejectedCount: 0,
      },
      runtime: {
        guidanceFrozenFrames: 0,
      },
    });
    expect(first.report.p95HorizontalErrorMeters).toBeLessThan(0.25);
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
