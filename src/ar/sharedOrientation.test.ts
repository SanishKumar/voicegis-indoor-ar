/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSharedOrientation, sharedOrientation } from './sharedOrientation';

let now = 1_000;
beforeEach(() => {
  now = 1_000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('DeviceOrientationEvent', class {});
  resetSharedOrientation();
});
afterEach(() => {
  resetSharedOrientation();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/**
 * A phone held upright, turned to this alpha, at the current time. Yaw runs
 * clockwise and alpha anticlockwise, so alpha 10 is a yaw of 350.
 */
function emit(alpha: number) {
  const event = new Event('deviceorientation');
  Object.entries({ alpha, beta: 90, gamma: 0, timeStamp: now, absolute: false }).forEach(
    ([key, value]) => Object.defineProperty(event, key, { value }),
  );
  window.dispatchEvent(event);
}

describe('the page’s one orientation feed', () => {
  it('is the same readings for every view, whoever started it', () => {
    sharedOrientation.start();
    const seen = vi.fn();
    const unsubscribe = sharedOrientation.subscribe({ onReading: seen });
    emit(10);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(sharedOrientation.read()?.yawDegrees).toBeCloseTo(350, 5);
    // A view leaving does not stop the readings another relies on.
    unsubscribe();
    now += 20;
    emit(20);
    expect(sharedOrientation.read()?.yawDegrees).toBeCloseTo(340, 5);
  });

  it('tells a new subscriber the state at once', () => {
    sharedOrientation.start();
    emit(0);
    const state = vi.fn();
    sharedOrientation.subscribe({ onState: state });
    expect(state).toHaveBeenCalledWith('listening');
  });

  it('finds the reading nearest a camera frame, within a tolerance', () => {
    sharedOrientation.start();
    for (const alpha of [0, 10, 20, 30]) {
      emit(alpha);
      now += 40;
    }
    // Readings at 1000, 1040, 1080 and 1120.
    expect(sharedOrientation.readNear(1_045, 30)?.yawDegrees).toBeCloseTo(350, 5);
    expect(sharedOrientation.readNear(1_300, 30)).toBeNull();
  });

  it('pairs a still sign frame after five seconds using quiet-motion corroboration', () => {
    sharedOrientation.start();
    emit(30);
    const epoch = sharedOrientation.read()!.epoch;
    for (let i = 0; i <= 250; i += 1) {
      const event = new Event('devicemotion');
      Object.defineProperties(event, {
        timeStamp: { value: now },
        rotationRate: { value: { alpha: 0, beta: 0, gamma: 0 } },
      });
      window.dispatchEvent(event);
      now += 20;
    }
    expect(sharedOrientation.readNear(now, 150)).toMatchObject({ epoch, observedTimeMs: 1000 });
    expect(sharedOrientation.readNear(now, 150)!.yawDegrees).toBeCloseTo(330);
  });

  it('forgets stale samples but keeps the reference until an explicit boundary', () => {
    sharedOrientation.start();
    emit(0);
    const before = sharedOrientation.read()!;
    // Silence hides the display and discards old sample-pairing history.
    now += 2_000;
    expect(sharedOrientation.read()).toBeNull();
    expect(sharedOrientation.readNear(before.timeMs, 50)).toBeNull();
    emit(5);
    expect(sharedOrientation.read()!.epoch).toBe(before.epoch);
    window.dispatchEvent(new Event('pagehide'));
    now += 20;
    window.dispatchEvent(new Event('pageshow'));
    emit(10);
    expect(sharedOrientation.read()!.epoch).not.toBe(before.epoch);
  });
});
