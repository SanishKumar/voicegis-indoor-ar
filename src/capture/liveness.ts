import type { PairingSummary, RejectionSummary } from './handsetCapture';

export interface LiveStats {
  elapsedMs: number;
  eventCount: number;
  recordedSamples: number;
  pairing: PairingSummary;
  rejections: RejectionSummary;
}

export type Liveness =
  | { kind: 'receiving'; hz: number }
  | { kind: 'stalled' }
  | { kind: 'waiting' }
  | { kind: 'sensorless' };

/** How far back the delivery rate is measured, in milliseconds. */
export const RATE_WINDOW_MS = 2_000;

/**
 * Whether anything is arriving *now*.
 *
 * The first version of the recorder surface showed a running clock and nothing
 * else, so a session that captured precisely zero samples was indistinguishable
 * from one that was working. A recorder that cannot tell you it is recording
 * nothing is worse than no recorder, because it produces confident empty files.
 *
 * The rate is measured over a short trailing window rather than across the whole
 * session. A session average only decays once delivery stops, so a phone
 * backgrounded mid-walk would keep reporting a healthy rate for minutes — which
 * is the exact moment the operator most needs to be told otherwise. Windowed, it
 * falls to zero within seconds and says `stalled`.
 *
 * `sensorless` is a common state rather than a defensive branch: a browser with
 * no motion hardware still fires `devicemotion` on schedule with every field
 * null, so "events are arriving" and "data is arriving" are different questions
 * and only the second one matters.
 *
 * Lives in its own module because a component file that also exports helpers
 * loses Fast Refresh.
 */
export function liveness(stats: LiveStats, windowedHz: number | null): Liveness {
  if (windowedHz !== null && windowedHz > 0) return { kind: 'receiving', hz: windowedHz };
  // Stalled means delivery stopped. If nothing was ever delivered, the honest
  // answer is still that it is waiting, however long it has been.
  if (stats.recordedSamples > 0) return { kind: 'stalled' };
  return stats.rejections.incomplete > 0 ? { kind: 'sensorless' } : { kind: 'waiting' };
}
