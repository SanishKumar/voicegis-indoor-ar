import { attitudeFromEvent } from './deviceAttitude';

/** Experimental display freshness policy, not a measured handset tolerance. */
export const CAMERA_ORIENTATION_MAX_AGE_MS = 500;
// Orientation is change-driven, not a heartbeat. A continuous, near-stationary
// gyroscope can corroborate an unchanged attitude, but cannot invent a turn.
const QUIET_RATE_DPS = 1;
const QUIET_ANGLE_BUDGET_DEGREES = 1;
const MOTION_GAP_MS = 250;

/** Camera attitude only, never position or an independent venue alignment.
 * A read checks silence even when no sensor callbacks arrive. One epoch uses
 * one event/reference frame: alternating absolute and relative yaw is not a turn.
 * @param {{
 * onReading: (reading: import('./sharedOrientation').OrientationReading | null) => void,
 * onState: (state: import('./sharedOrientation').OrientationState) => void,
 * onDiagnostic?: (detail: Record<string, string | number | boolean | null>) => void
 * }} callbacks
 */
export function startOrientationFeed({ onReading, onState, onDiagnostic }) {
  let disposed = false;
  let listening = false;
  let epoch = 0;
  let requestId = 0;
  let requesting = false;
  let paused = document.hidden;
  let reading = null;
  let source = null;
  let lastTime = -Infinity;
  let lastMotionTime = null;
  let quietAngle = 0;
  let boundary = performance.now();
  let state = '';
  const constructor = globalThis.DeviceOrientationEvent;
  const needsPermission = typeof constructor?.requestPermission === 'function';
  let granted = !needsPermission;
  const capability = !constructor
    ? 'unsupported'
    : globalThis.isSecureContext !== true
      ? 'insecure'
      : null;

  const report = (next) => {
    if (disposed || state === next) return;
    state = next;
    onState?.(next);
  };
  const invalidate = (next, why = next) => {
    if (state !== next)
      onDiagnostic?.({
        state: next,
        why,
        source,
        ageMs: reading === null ? null : performance.now() - reading.timeMs,
      });
    // Delivery freshness and reference-frame identity are different. A quiet
    // sensor or a busy main thread does not redefine the orientation zero.
    // Still hide stale attitude, but allow a fresh event on this same source
    // to use the sign calibration again. Lifecycle/unavailable boundaries do
    // break that identity, even if the attitude had already gone stale.
    if (next !== 'stale' && state !== next) epoch += 1;
    if (reading !== null) {
      reading = null;
      onReading?.(null);
    }
    report(next);
  };
  const read = () => {
    if (reading !== null && performance.now() - reading.timeMs > CAMERA_ORIENTATION_MAX_AGE_MS)
      invalidate('stale');
    return reading;
  };
  const screenAngle = () => {
    const angle = window.screen?.orientation?.angle ?? window.orientation;
    return typeof angle === 'number' && Number.isFinite(angle) ? angle : 0;
  };
  const handle = (event) => {
    if (disposed || !listening || paused || document.hidden) return;
    const frame = `${event.type}:${event.absolute === true}`;
    if (source !== null && source !== frame) return;
    const now = performance.now();
    const at = event.timeStamp;
    // Bad/queued events do not erase a newer valid reading. read() still
    // expires genuine silence using the accepted occurrence clock.
    if (!Number.isFinite(at) || at > now || now - at > CAMERA_ORIENTATION_MAX_AGE_MS) return;
    // Queued, duplicate and regressing readings must not move or renew the view.
    if (at < boundary || at <= lastTime) return;
    const attitude = attitudeFromEvent(event, screenAngle());
    if (attitude === null) {
      invalidate('unavailable');
      return;
    }
    read(); // Hide expired attitude before accepting a fresh reading on this reference frame.
    // Whatever the permission API implied, readings are arriving.
    granted = true;
    source = frame;
    lastTime = at;
    if (lastMotionTime !== null && at - lastMotionTime > MOTION_GAP_MS) lastMotionTime = null;
    quietAngle = 0;
    reading = {
      ...attitude,
      epoch,
      timeMs: at,
      observedTimeMs: at,
      betaDegrees: event.beta,
      gammaDegrees: event.gamma,
      absolute: event.absolute === true,
    };
    onReading?.(reading);
    report('listening');
  };
  const motion = (event) => {
    if (disposed || !listening || paused || document.hidden) return;
    const at = event.timeStamp;
    const now = performance.now();
    if (!Number.isFinite(at) || at > now || now - at > MOTION_GAP_MS) return;
    if (lastMotionTime !== null && at <= lastMotionTime) return;
    const previous = lastMotionTime;
    lastMotionTime = at;
    if (reading === null || at < reading.timeMs) return;
    const rates = [event.rotationRate?.alpha, event.rotationRate?.beta, event.rotationRate?.gamma];
    if (rates.some((rate) => typeof rate !== 'number' || !Number.isFinite(rate))) {
      quietAngle = Infinity;
      return;
    }
    const speed = Math.hypot(...rates);
    const gap = previous === null ? Infinity : at - previous;
    quietAngle += speed * (Math.max(0, at - reading.timeMs) / 1000);
    if ((previous !== null && gap > MOTION_GAP_MS) || speed > QUIET_RATE_DPS) quietAngle = Infinity;
    if (gap > MOTION_GAP_MS || quietAngle > QUIET_ANGLE_BUDGET_DEGREES) return;
    // Never revive expired orientation or bridge a missing stretch of motion.
    if (at - reading.timeMs > MOTION_GAP_MS) return;
    reading = { ...reading, timeMs: at };
    onReading?.(reading);
  };
  const stop = () => {
    listening = false;
    window.removeEventListener('deviceorientationabsolute', handle, true);
    window.removeEventListener('deviceorientation', handle, true);
    window.removeEventListener('devicemotion', motion, true);
  };
  /*
   * Listeners go on whether or not a permission has been granted. Platforms
   * that gate orientation behind a gesture send nothing until it is given, so
   * attaching early costs nothing; platforms that advertise the gate and then
   * send events regardless - which is what happens on some Android browsers -
   * work without the visitor having to find a button. The state still says a
   * permission is outstanding, so the button is there for the ones that need it.
   */
  const listen = () => {
    if (disposed || listening || paused || document.hidden || capability) return;
    listening = true;
    epoch += 1;
    boundary = performance.now();
    source = null;
    lastTime = -Infinity;
    lastMotionTime = null;
    quietAngle = 0;
    window.addEventListener('deviceorientationabsolute', handle, true);
    window.addEventListener('deviceorientation', handle, true);
    window.addEventListener('devicemotion', motion, true);
    report(needsPermission && !granted ? 'needs-permission' : 'waiting');
  };
  const request = () => {
    if (disposed || capability || paused || document.hidden || requesting) return;
    // Where separately gated, quiet-motion corroboration also needs a gesture.
    // Its refusal must not prevent ordinary orientation from working.
    try {
      const permission = globalThis.DeviceMotionEvent?.requestPermission?.();
      if (permission) Promise.resolve(permission).catch(() => undefined);
    } catch {
      /* Orientation can still work without motion corroboration. */
    }
    if (granted) {
      listen();
      return;
    }
    const owner = ++requestId;
    requesting = true;
    report('requesting');
    const complete = (permission) => {
      if (disposed || owner !== requestId) return;
      requesting = false;
      granted = permission === 'granted';
      if (paused || document.hidden) return;
      if (!granted) report('denied');
      // The listeners usually went on at startup, so listen() would change
      // nothing and the state would sit at 'requesting' for good. Say what is
      // true now: granted, and either reading or still waiting for a reading.
      else if (listening) report(reading !== null ? 'listening' : 'waiting');
      else listen();
    };
    try {
      Promise.resolve(constructor.requestPermission()).then(complete, () => complete('denied'));
    } catch {
      complete('denied');
    }
  };
  const suspend = () => {
    paused = true;
    requestId += 1;
    requesting = false;
    stop();
    invalidate('paused');
  };
  const resume = () => {
    if (disposed || document.hidden) return;
    paused = false;
    if (capability) report(capability);
    else listen();
  };
  const visibility = () => (document.hidden ? suspend() : resume());
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pagehide', suspend);
  window.addEventListener('pageshow', resume);
  if (capability) report(capability);
  else if (paused) report('paused');
  else listen();

  return {
    read,
    request,
    dispose() {
      disposed = true;
      requestId += 1;
      stop();
      reading = null;
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', suspend);
      window.removeEventListener('pageshow', resume);
    },
  };
}
