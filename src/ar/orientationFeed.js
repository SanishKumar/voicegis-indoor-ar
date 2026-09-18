import { attitudeFromEvent } from './deviceAttitude';

/**
 * The phone's orientation, for as long as the camera view is open.
 *
 * This is the camera view's own subscription rather than the tracker's. The
 * two want different things: the tracker wants turn rates while a walk is
 * being followed, and only while the visitor has asked for that; the camera
 * wants to know where the phone is pointing from the moment it opens,
 * whether or not anything is being tracked, because otherwise the route is
 * drawn in a fixed place on the glass.
 *
 * Nothing here is a position and nothing here is evidence. The yaw's zero is
 * arbitrary; only differences in it are used.
 */

/** 'listening' | 'needs-permission' | 'denied' | 'unsupported' | 'insecure' | 'error' */
export function startOrientationFeed({ onReading, onState }) {
  let disposed = false;
  let listening = false;
  let epoch = 0;

  const report = (state) => {
    if (!disposed) onState?.(state);
  };

  if (typeof window === 'undefined' || typeof window.DeviceOrientationEvent === 'undefined') {
    report('unsupported');
    return { dispose() {}, request() {} };
  }
  if (globalThis.isSecureContext !== true) {
    report('insecure');
    return { dispose() {}, request() {} };
  }

  const screenAngle = () => {
    const angle = window.screen?.orientation?.angle;
    return typeof angle === 'number' && Number.isFinite(angle) ? angle : 0;
  };

  const handle = (event) => {
    if (disposed) return;
    const attitude = attitudeFromEvent(event, screenAngle());
    if (attitude === null) return;
    onReading?.({ ...attitude, epoch, absolute: event.absolute === true });
  };

  const listen = () => {
    if (disposed || listening) return;
    listening = true;
    epoch += 1;
    // Absolute events are preferred where a platform sends both, but the yaw
    // is used relatively either way, so either will do.
    window.addEventListener('deviceorientationabsolute', handle, true);
    window.addEventListener('deviceorientation', handle, true);
    report('listening');
  };

  const stop = () => {
    if (!listening) return;
    listening = false;
    window.removeEventListener('deviceorientationabsolute', handle, true);
    window.removeEventListener('deviceorientation', handle, true);
  };

  // iOS grants orientation only from a real gesture, so the view has to ask.
  const needsPermission = typeof window.DeviceOrientationEvent.requestPermission === 'function';
  if (needsPermission) report('needs-permission');
  else listen();

  const request = () => {
    if (disposed || !needsPermission) return;
    try {
      Promise.resolve(window.DeviceOrientationEvent.requestPermission()).then(
        (permission) => {
          if (disposed) return;
          if (permission === 'granted') listen();
          else report('denied');
        },
        () => report('denied'),
      );
    } catch {
      report('error');
    }
  };

  // A page in the background is sent nothing useful; it picks up on return.
  const visibility = () => {
    if (document.visibilityState === 'hidden') stop();
    else if (!needsPermission) listen();
  };
  document.addEventListener('visibilitychange', visibility);

  return {
    request,
    dispose() {
      disposed = true;
      stop();
      document.removeEventListener('visibilitychange', visibility);
    },
  };
}
