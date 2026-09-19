import {
  requestMotionPermission,
  type MotionEventLike,
  type OrientationEventLike,
} from '../capture/handsetCapture';

export type HandsetAccessState =
  'requesting' | 'listening' | 'denied' | 'unsupported' | 'insecure' | 'hidden' | 'error';
type PermissionConstructor = { requestPermission?: () => Promise<string> };
interface Callbacks {
  onMotion: (event: MotionEventLike, nowMs: number) => void;
  onOrientation: (event: OrientationEventLike, nowMs: number) => void;
  onState: (state: HandsetAccessState) => void;
}

/** Call synchronously from a user gesture, after creating the acquisition owner.
 * Both permission requests happen before any await. Disposer exists immediately,
 * so pending permission/query results cannot outlive stop, hide or replacement.
 * Permission absence is not hardware presence; sample/watchdog checks still apply. */
export function startHandsetSubscription(callbacks: Callbacks): () => void {
  let disposed = false;
  const cleanup: Array<() => void> = [];
  const dispose = () => {
    disposed = true;
    for (const release of cleanup.splice(0)) release();
  };
  const halt = (state: HandsetAccessState) => {
    if (disposed) return;
    dispose();
    callbacks.onState(state);
  };
  const constructors = globalThis as {
    DeviceMotionEvent?: PermissionConstructor;
    DeviceOrientationEvent?: PermissionConstructor;
  };
  if (globalThis.isSecureContext !== true) {
    halt('insecure');
    return dispose;
  }
  if (document.hidden) {
    halt('hidden');
    return dispose;
  }
  if (!constructors.DeviceMotionEvent || !constructors.DeviceOrientationEvent) {
    halt('unsupported');
    return dispose;
  }

  const listen = (target: EventTarget, type: string, callback: EventListener) => {
    target.addEventListener(type, callback);
    cleanup.push(() => target.removeEventListener(type, callback));
  };
  listen(document, 'visibilitychange', () => {
    if (document.hidden) halt('hidden');
  });
  listen(window, 'pagehide', () => halt('hidden'));
  callbacks.onState('requesting');
  const motion = requestMotionPermission(constructors.DeviceMotionEvent);
  const orientation = requestMotionPermission(constructors.DeviceOrientationEvent);

  // Implementations differ in which permission names they expose. Failed queries
  // mean revocation monitoring is unavailable, never "granted" or "denied".
  const watchPermission = async (name: 'accelerometer' | 'gyroscope') => {
    if (!navigator.permissions?.query) return;
    try {
      const status = await navigator.permissions.query({ name: name as PermissionName });
      if (disposed) return;
      const change = () => {
        if (status.state !== 'granted') halt('denied');
      };
      change();
      if (!disposed) listen(status, 'change', change);
    } catch {
      /* Optional API; delivery/freshness gates remain authoritative. */
    }
  };
  void Promise.all([motion, orientation]).then((permissions) => {
    if (disposed) return;
    if (document.hidden) {
      halt('hidden');
      return;
    }
    if (permissions.some((permission) => permission === 'denied' || permission === 'unsupported')) {
      halt('denied');
      return;
    }
    const receive = (event: Event, kind: 'motion' | 'orientation') => {
      if (disposed) return;
      if (document.hidden) {
        halt('hidden');
        return;
      }
      try {
        const now = performance.now();
        if (kind === 'motion') callbacks.onMotion(event as unknown as MotionEventLike, now);
        else callbacks.onOrientation(event as unknown as OrientationEventLike, now);
      } catch {
        halt('error');
      }
    };
    listen(window, 'devicemotion', (event) => receive(event, 'motion'));
    listen(window, 'deviceorientation', (event) => receive(event, 'orientation'));
    callbacks.onState('listening');
    void watchPermission('accelerometer');
    void watchPermission('gyroscope');
  });
  return dispose;
}
