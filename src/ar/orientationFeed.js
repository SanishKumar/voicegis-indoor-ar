import { attitudeFromEvent } from './deviceAttitude';

/** Experimental display freshness policy, not a measured handset tolerance. */
export const CAMERA_ORIENTATION_MAX_AGE_MS = 500;

/** Camera attitude only, never position or an independent venue alignment.
 * A read checks silence even when no sensor callbacks arrive. One epoch uses
 * one event/reference frame: alternating absolute and relative yaw is not a turn.
 */
export function startOrientationFeed({ onReading, onState }) {
  let disposed = false;
  let listening = false;
  let epoch = 0;
  let requestId = 0;
  let requesting = false;
  let paused = document.hidden;
  let reading = null;
  let source = null;
  let lastTime = -Infinity;
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
  const invalidate = (next) => {
    if (reading !== null) {
      reading = null;
      epoch += 1;
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
    if (!Number.isFinite(at) || at > now || now - at > CAMERA_ORIENTATION_MAX_AGE_MS) {
      invalidate('stale');
      return;
    }
    // Queued, duplicate and regressing readings must not move or renew the view.
    if (at < boundary || at <= lastTime) return;
    const attitude = attitudeFromEvent(event, screenAngle());
    if (attitude === null) {
      invalidate('unavailable');
      return;
    }
    read(); // Notice a gap before accepting a new yaw under the previous alignment.
    // Whatever the permission API implied, readings are arriving.
    granted = true;
    source = frame;
    lastTime = at;
    reading = { ...attitude, epoch, timeMs: at, absolute: event.absolute === true };
    onReading?.(reading);
    report('listening');
  };
  const stop = () => {
    listening = false;
    window.removeEventListener('deviceorientationabsolute', handle, true);
    window.removeEventListener('deviceorientation', handle, true);
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
    window.addEventListener('deviceorientationabsolute', handle, true);
    window.addEventListener('deviceorientation', handle, true);
    report(needsPermission && !granted ? 'needs-permission' : 'waiting');
  };
  const request = () => {
    if (disposed || capability || paused || document.hidden || requesting) return;
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
      if (granted) listen();
      else report('denied');
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
