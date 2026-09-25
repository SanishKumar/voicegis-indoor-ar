/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startOrientationFeed } from './orientationFeed';

let now = 1000;
const disposers: Array<() => void> = [];
beforeEach(() => {
  now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('DeviceOrientationEvent', class {});
});
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function emit(alpha = 0, type = 'deviceorientation', at = now, absolute = false) {
  const event = new Event(type);
  Object.entries({ alpha, beta: 90, gamma: 0, timeStamp: at, absolute }).forEach(([key, value]) =>
    Object.defineProperty(event, key, { value }),
  );
  window.dispatchEvent(event);
}
function setup() {
  const readings = vi.fn();
  const state = vi.fn();
  const feed = startOrientationFeed({ onReading: readings, onState: state });
  disposers.push(feed.dispose);
  return { feed, readings, state };
}

/** A platform that advertises the permission gate, as iOS does. */
function gatedBy(permission: string | Promise<string>) {
  const requestPermission = vi.fn(() => Promise.resolve(permission));
  vi.stubGlobal(
    'DeviceOrientationEvent',
    class {
      static requestPermission = requestPermission;
    },
  );
  return requestPermission;
}

describe('a platform that asks before it reports orientation', () => {
  it('still reads the events it sends without waiting to be asked', () => {
    // Some Android browsers advertise requestPermission and then deliver
    // orientation anyway. Inferring from the API alone left the camera
    // switched off, waiting for a tap that was never needed.
    gatedBy('granted');
    const { feed, state } = setup();
    expect(state).toHaveBeenLastCalledWith('needs-permission');
    emit(40);
    expect(feed.read()?.yawDegrees).toBeCloseTo(320, 5);
    expect(state).toHaveBeenLastCalledWith('listening');
  });

  it('lets a refusal be retried rather than latching on the first tap', async () => {
    const request = gatedBy('denied');
    const { feed, state } = setup();
    feed.request();
    await Promise.resolve();
    await Promise.resolve();
    expect(state).toHaveBeenLastCalledWith('denied');
    // The latch this guards against left every later tap doing nothing.
    feed.request();
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('says a granted permission is waiting for readings rather than still asking', async () => {
    // Listeners are attached at startup, so a grant that arrives later must
    // move the state on by itself; it used to sit at 'requesting' for good.
    gatedBy('granted');
    const { feed, state } = setup();
    feed.request();
    expect(state).toHaveBeenLastCalledWith('requesting');
    await Promise.resolve();
    await Promise.resolve();
    expect(state).toHaveBeenLastCalledWith('waiting');
    emit(10);
    expect(state).toHaveBeenLastCalledWith('listening');
  });

  it('clears a request that settled while the camera was in the background', async () => {
    // A refusal, so that a retry is meaningful: a grant would rightly not be asked twice.
    const request = gatedBy('denied');
    const { feed } = setup();
    feed.request();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    await Promise.resolve();
    await Promise.resolve();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    feed.request();
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(2);
  });
});

describe('camera orientation ownership', () => {
  it('expires silence without sensor callbacks and starts a new alignment epoch', () => {
    const { feed, state } = setup();
    emit();
    const epoch = feed.read()?.epoch;
    now += 501;
    expect(feed.read()).toBeNull();
    expect(state).toHaveBeenLastCalledWith('stale');
    emit(30);
    expect(feed.read()?.epoch).toBeGreaterThan(epoch!);
  });

  it('ignores queued and duplicate events without renewing the occurrence clock', () => {
    const { feed } = setup();
    emit(90, 'deviceorientation', now - 1);
    expect(feed.read()).toBeNull();
    emit(20);
    now += 50;
    emit(80, 'deviceorientation', now - 50);
    expect(feed.read()?.yawDegrees).toBeCloseTo(340);
    now += 451;
    expect(feed.read()).toBeNull();
  });

  it('rejects old and future timestamps', () => {
    const { feed } = setup();
    emit(20, 'deviceorientation', now + 1);
    expect(feed.read()).toBeNull();
    emit(20, 'deviceorientation', now - 501);
    expect(feed.read()).toBeNull();
  });

  it('resumes a granted permission feed with a new epoch after visibility returns', async () => {
    const request = vi.fn(async () => 'granted');
    vi.stubGlobal('DeviceOrientationEvent', { requestPermission: request });
    const { feed, state } = setup();
    feed.request();
    feed.request();
    expect(request).toHaveBeenCalledOnce();
    await Promise.resolve();
    emit();
    const epoch = feed.read()?.epoch;
    window.dispatchEvent(new Event('pagehide'));
    expect(feed.read()).toBeNull();
    now += 100;
    window.dispatchEvent(new Event('pageshow'));
    expect(state).toHaveBeenLastCalledWith('waiting');
    emit();
    expect(feed.read()?.epoch).toBeGreaterThan(epoch!);
    expect(request).toHaveBeenCalledOnce();
  });

  it('never delivers after disposal', () => {
    const { feed, readings } = setup();
    feed.dispose();
    emit();
    window.dispatchEvent(new Event('pageshow'));
    emit();
    expect(readings).not.toHaveBeenCalled();
  });
  it('never mixes two orientation reference frames into one yaw', () => {
    const { feed, readings } = setup();
    emit(20);
    now += 10;
    emit(190, 'deviceorientationabsolute', now, true);
    expect(readings).toHaveBeenCalledTimes(1);
    now += 10;
    emit(30);
    expect(readings.mock.calls.at(-1)?.[0].yawDegrees).toBeCloseTo(330);
    feed.dispose();
  });

  it('invalidates the last orientation when the camera goes into the background', () => {
    const { feed, readings, state } = setup();
    emit();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(readings).toHaveBeenLastCalledWith(null);
    expect(state).toHaveBeenLastCalledWith('paused');
    feed.dispose();
  });

  it('does not enroll a late permission grant after pagehide', async () => {
    let grant!: (value: string) => void;
    vi.stubGlobal('DeviceOrientationEvent', {
      requestPermission: () =>
        new Promise<string>((resolve) => {
          grant = resolve;
        }),
    });
    const { feed, readings } = setup();
    feed.request();
    window.dispatchEvent(new Event('pagehide'));
    grant('granted');
    await Promise.resolve();
    emit();
    expect(readings.mock.calls.filter(([reading]) => reading !== null)).toHaveLength(0);
    feed.dispose();
  });
});
