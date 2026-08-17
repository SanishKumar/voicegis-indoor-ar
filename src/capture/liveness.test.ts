import { describe, expect, it } from 'vitest';
import { liveness, type LiveStats } from './liveness';

/**
 * The first version of this page reported a running clock and nothing else, so
 * a session that captured precisely zero samples was indistinguishable from one
 * that was working. These cover the four answers it now has to be able to give,
 * because the difference between them is the whole value of the surface.
 */

function stats(overrides: Partial<LiveStats> = {}): LiveStats {
  return {
    elapsedMs: 10_000,
    eventCount: 1,
    recordedSamples: 0,
    pairing: {
      pairedCount: 0,
      unpairedCount: 0,
      medianStalenessMs: null,
      p95StalenessMs: null,
      worstStalenessMs: null,
    },
    rejections: { incomplete: 0, regressed: 0, refused: 0 },
    ...overrides,
  };
}

describe('what the recorder reports about itself', () => {
  it('reports the windowed rate while samples are arriving', () => {
    expect(liveness(stats({ recordedSamples: 500 }), 48.4)).toEqual({
      kind: 'receiving',
      hz: 48.4,
    });
  });

  it('calls it stalled when samples stop, rather than coasting on an average', () => {
    // A session average only decays when delivery stops, so a phone
    // backgrounded mid-walk would keep reporting a healthy rate for minutes —
    // exactly when the operator most needs to be told otherwise.
    expect(liveness(stats({ recordedSamples: 500, elapsedMs: 600_000 }), 0)).toEqual({
      kind: 'stalled',
    });
  });

  it('distinguishes a device with no sensors from one that has not started', () => {
    // A browser with no motion hardware still fires devicemotion on schedule
    // with every field null. Events arriving and data arriving are different
    // questions, and only the second one matters.
    expect(liveness(stats({ rejections: { incomplete: 12, regressed: 0, refused: 0 } }), null))
      .toEqual({ kind: 'sensorless' });

    expect(liveness(stats(), null)).toEqual({ kind: 'waiting' });
  });

  it('does not call zero samples stalled, however long it has been waiting', () => {
    // Stalled means delivery stopped. Nothing has ever been delivered here, so
    // the honest answer is still that it is waiting.
    expect(liveness(stats({ elapsedMs: 600_000 }), 0)).toEqual({ kind: 'waiting' });
  });
});
