import type { DeviceAttitude } from './deviceAttitude';
import { startOrientationFeed } from './orientationFeed';

/**
 * One orientation feed for the whole page.
 *
 * A yaw's zero is the platform's, arbitrary but fixed only while its sensor
 * keeps running. A direction learned when a sign is scanned is a yaw at that
 * moment; for it to mean anything in the camera view or an AR session later,
 * the same readings have to be arriving the whole time in between. A feed
 * started and stopped by each view broke that, and two feeds each counting
 * their own epochs from 1 could not tell each other's readings apart. Here
 * there is one, its epoch changes whenever continuity is lost - the page is
 * hidden, readings go stale - and every view reads the same one.
 */

export interface OrientationReading extends DeviceAttitude {
  epoch: number;
  /** On the page clock, the event's own timestamp. */
  timeMs: number;
  absolute: boolean;
}

export type OrientationState =
  | 'starting'
  | 'waiting'
  | 'needs-permission'
  | 'requesting'
  | 'listening'
  | 'denied'
  | 'stale'
  | 'unavailable'
  | 'paused'
  | 'unsupported'
  | 'insecure';

interface Listener {
  onReading?: (reading: OrientationReading | null) => void;
  onState?: (state: OrientationState) => void;
}

interface Feed {
  read(): OrientationReading | null;
  request(): void;
  dispose(): void;
}

/** How far back a reading can be looked up, to pair one with a camera frame. */
const HISTORY_MS = 1_500;

let feed: Feed | null = null;
let state: OrientationState = 'starting';
let history: OrientationReading[] = [];
const listeners = new Set<Listener>();

function ensure(): Feed {
  if (feed !== null) return feed;
  feed = startOrientationFeed({
    onReading(reading: OrientationReading | null) {
      if (reading === null) {
        history = [];
      } else {
        // A new epoch is a new zero: nothing from the old one pairs with it.
        if (history.length > 0 && history[history.length - 1].epoch !== reading.epoch) history = [];
        history.push(reading);
        const oldest = reading.timeMs - HISTORY_MS;
        while (history.length > 0 && history[0].timeMs < oldest) history.shift();
      }
      for (const listener of listeners) listener.onReading?.(reading);
    },
    onState(next: OrientationState) {
      state = next;
      for (const listener of listeners) listener.onState?.(next);
    },
  }) as Feed;
  return feed;
}

export const sharedOrientation = {
  /** Start listening, if not already; safe to call from anywhere, any number of times. */
  start() {
    ensure();
  },
  read(): OrientationReading | null {
    return ensure().read();
  },
  /** Ask for permission where the platform wants it. Call from a tap. */
  request() {
    ensure().request();
  },
  state(): OrientationState {
    ensure();
    return state;
  },
  /**
   * The reading nearest a moment, if one within the tolerance was seen in the
   * current epoch - for pairing the phone's rotation with a camera frame.
   */
  readNear(timeMs: number, toleranceMs: number): OrientationReading | null {
    ensure().read(); // Lets a stale feed notice before its history is used.
    let best: OrientationReading | null = null;
    for (const reading of history) {
      const gap = Math.abs(reading.timeMs - timeMs);
      if (gap <= toleranceMs && (best === null || gap < Math.abs(best.timeMs - timeMs))) {
        best = reading;
      }
    }
    return best;
  },
  /** Readings and states as they come; the current state is reported at once. */
  subscribe(listener: Listener): () => void {
    ensure();
    listeners.add(listener);
    listener.onState?.(state);
    // A view opened between readings starts from the current one, not the next.
    const current = ensure().read();
    if (current !== null) listener.onReading?.(current);
    return () => {
      listeners.delete(listener);
    };
  },
};

/** For tests: forget the feed so the next use starts a fresh one. */
export function resetSharedOrientation() {
  feed?.dispose();
  feed = null;
  state = 'starting';
  history = [];
  listeners.clear();
}
