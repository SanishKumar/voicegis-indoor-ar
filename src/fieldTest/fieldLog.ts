/**
 * An opt-in record of what happened on a test handset, for the person testing it.
 *
 * Nothing on a phone can be seen from the desk, and "the arrows never appeared"
 * cannot say whether the session never had a pose, never found the floor, or
 * placed the route and then lost the room. Opening the app with `?fieldtest=1`
 * keeps a short record of those transitions, which the tester copies out by
 * hand. `?fieldtest=0` turns it off again.
 *
 * It lives in memory and goes nowhere unless the tester copies it. It is a
 * diagnostic of the guidance, never evidence: nothing here reaches recording,
 * replay or the evidence pipeline, and nothing reads it back.
 */

export interface FieldEvent {
  /** On the page's clock, as `performance.now()` reported it. */
  atMs: number;
  kind: string;
  detail: Record<string, string | number | boolean | null>;
}

const FLAG = 'fieldtest';
const SESSION_KEY = 'voicegis_field_test';
/** Enough for a walk of several minutes; a walk that long keeps its most recent part. */
const MAX_EVENTS = 500;
/**
 * The same entry again this soon is one change seen twice, not two: React runs
 * each effect twice in development, which is how the app is served to a phone
 * on the desk (npm run dev:mobile).
 */
const REPEAT_MS = 100;

let enabled: boolean | null = null;
const events: FieldEvent[] = [];
const listeners = new Set<() => void>();

/**
 * Read once from the address, then held for the tab: the check-in link and
 * the app's own navigation both rewrite the address, and the record should
 * outlive that.
 */
export function fieldTestEnabled(): boolean {
  if (enabled !== null) return enabled;
  let on = false;
  try {
    const flag = new URLSearchParams(window.location.search).get(FLAG);
    if (flag !== null) {
      on = flag !== '0' && flag !== 'false';
      sessionStorage.setItem(SESSION_KEY, on ? '1' : '0');
    } else {
      on = sessionStorage.getItem(SESSION_KEY) === '1';
    }
  } catch {
    // No address or no session storage: a private window, a test. Off.
    on = false;
  }
  enabled = on;
  return on;
}

export function logField(kind: string, detail: FieldEvent['detail'] = {}) {
  if (!fieldTestEnabled()) return;
  const atMs = performance.now();
  const same = JSON.stringify(detail);
  for (
    let index = events.length - 1;
    index >= 0 && atMs - events[index].atMs < REPEAT_MS;
    index -= 1
  ) {
    const earlier = events[index];
    if (earlier.kind === kind && JSON.stringify(earlier.detail) === same) return;
  }
  events.push({ atMs, kind, detail });
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  for (const listener of listeners) listener();
}

export function fieldEvents(): readonly FieldEvent[] {
  return events;
}

export function clearFieldLog() {
  events.length = 0;
  for (const listener of listeners) listener();
}

export function subscribeFieldLog(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** For tests: force the switch, or null to read the address again. */
export function resetFieldTest(value: boolean | null) {
  enabled = value;
  events.length = 0;
}
