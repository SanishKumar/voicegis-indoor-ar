/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphNode, RouteStep } from '../../engine/routingCore';
import type { RouteTracker, TrackerSnapshot } from '../../navigation/liveTracker';
import { buildRouteTrack } from '../../navigation/routeProgress';
import { fieldEvents, resetFieldTest } from '../../fieldTest/fieldLog';
import { useLiveTracking } from './useLiveTracking.js';
import { sharedOrientation, resetSharedOrientation } from '../../ar/sharedOrientation';
import type { MotionEventLike, OrientationEventLike } from '../../capture/handsetCapture';

/*
 * Only the motion subscription is replaced, so a test can say what the
 * browser did with the permission. The hook, the tracker and the publishing
 * are the real ones.
 */
type State = 'requesting' | 'listening' | 'denied' | 'unsupported' | 'insecure' | 'hidden';
const subscription = vi.hoisted(() => ({
  onState: null as null | ((state: State) => void),
  onMotion: null as null | ((event: MotionEventLike) => void),
  onOrientation: null as null | ((event: OrientationEventLike) => void),
  dispose: () => {},
}));
vi.mock('../../sensors/handsetSubscription', () => ({
  startHandsetSubscription: (callbacks: {
    onState: (state: State) => void;
    onMotion: (event: MotionEventLike) => void;
    onOrientation: (event: OrientationEventLike) => void;
  }) => {
    subscription.onState = callbacks.onState;
    subscription.onMotion = callbacks.onMotion;
    subscription.onOrientation = callbacks.onOrientation;
    return subscription.dispose;
  },
}));

const node = (id: string, x: number, y: number): GraphNode => ({
  id,
  x,
  y,
  floor: 'g',
  type: 'junction',
});
const step = (type: RouteStep['type'], nodeId: string): RouteStep => ({
  type,
  instruction: type,
  distance: 0,
  nodeId,
  bearing: 90,
});
/* Twenty metres east. */
const track = buildRouteTrack(
  [node('a', 0, 0), node('b', 20, 0)],
  [step('start', 'a'), step('arrive', 'b')],
);

let clock = 1_000;
beforeEach(() => {
  clock = 1_000;
  resetSharedOrientation();
  subscription.onState = null;
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
});
afterEach(() => {
  cleanup();
  resetSharedOrientation();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function tracking(setProgress = vi.fn()) {
  const hook = renderHook(() =>
    useLiveTracking({
      track,
      locationBasis: 'qr',
      checkInDistanceMeters: 0,
      northOffsetDegrees: 0,
      setProgress,
      active: true,
    }),
  );
  return { hook, setProgress };
}

/** Let the hook's publishing tick run, with time passing as it does. */
function tick(ms = 250) {
  clock += ms;
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/** Half a metre east per report from an attached pose, every 200 ms. */
function walkInAr(tracker: RouteTracker, reports: number) {
  for (let index = 0; index < reports; index += 1) {
    clock += 200;
    tracker.displace({ dxMeters: 0.5, dyMeters: 0, timeMs: clock });
  }
}

describe('live position with an immersive session attached', () => {
  it('uses the scan direction for map steps and holds still orientation across a quiet walk', () => {
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('DeviceOrientationEvent', class {});
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    sharedOrientation.start();
    const orient = (alpha: number) => {
      const event = new Event('deviceorientation');
      Object.entries({ alpha, beta: 90, gamma: 0, timeStamp: clock, absolute: false }).forEach(
        ([key, value]) => Object.defineProperty(event, key, { value }),
      );
      window.dispatchEvent(event);
      subscription.onOrientation?.(event as unknown as OrientationEventLike);
    };
    orient(0);
    const scanned = sharedOrientation.read()!;
    const { result } = renderHook(() =>
      useLiveTracking({
        track,
        locationBasis: 'qr',
        setProgress: vi.fn(),
        active: true,
        signHeading: {
          source: 'sign',
          anchorId: 'east',
          venueKey: 'test',
          planBearing: 270,
          yawDegrees: scanned.yawDegrees,
          epoch: scanned.epoch,
          timeMs: scanned.timeMs,
        },
      }),
    );
    act(() => {
      result.current.start();
      subscription.onState?.('listening');
    });
    const sample = (magnitude: number) => {
      clock += 20;
      const fields = {
        timeStamp: clock,
        accelerationIncludingGravity: { x: 0, y: magnitude, z: 0 },
        rotationRate: { alpha: 0, beta: 0, gamma: 0 },
      };
      const event = new Event('devicemotion');
      Object.entries(fields).forEach(([key, value]) =>
        Object.defineProperty(event, key, { value }),
      );
      window.dispatchEvent(event);
      subscription.onMotion?.(fields);
    };
    const walk = (steps: number) => {
      for (let i = 0; i < steps; i += 1)
        for (let s = 0; s < 25; s += 1) sample(s < 4 ? 12.81 : 9.81);
    };
    for (let i = 0; i < 10; i += 1) sample(9.81);
    walk(3);
    const tracker = result.current.tracker() as unknown as RouteTracker;
    expect(tracker.read(clock)).toMatchObject({ progressMeters: 0, reason: 'wrong-way' });
    // One change event for a turnaround, not a continuous synthetic stream.
    orient(180);
    walk(12);
    expect(tracker.read(clock)).toMatchObject({ reason: 'following', headingDegrees: 90 });
    expect(tracker.read(clock).progressMeters).toBeCloseTo(8.64);
    expect(sharedOrientation.read()!.epoch).toBe(scanned.epoch);
    orient(0);
    walk(4);
    expect(tracker.read(clock)).toMatchObject({ reason: 'wrong-way', headingDegrees: 270 });
    expect(tracker.read(clock).progressMeters).toBeCloseTo(5.76);
  });

  it('keeps a lost-position snapshot after Stop tracking', () => {
    const { hook } = tracking();
    act(() => hook.result.current.start());
    const tracker = hook.result.current.tracker() as unknown as RouteTracker;
    tracker.anchor({ progressMeters: 5, sigmaMeters: 20, timeMs: clock });
    act(() => subscription.onState?.('listening'));
    act(() => hook.result.current.stop());
    expect(hook.result.current.snapshot).toMatchObject({
      canStartPose: false,
      reason: 'uncertain',
    });
  });

  it('keeps the scan instruction through restart and clears it on a new check-in route', () => {
    const { result, rerender } = renderHook(
      ({ currentTrack }) =>
        useLiveTracking({
          track: currentTrack,
          locationBasis: 'qr',
          setProgress: vi.fn(),
          active: true,
        }),
      { initialProps: { currentTrack: track } },
    );
    act(() => result.current.start());
    const tracker = result.current.tracker() as unknown as RouteTracker;
    tracker.motion({ timeMs: clock, accelerationMagnitude: 9.81, headingRateDegreesPerSecond: 0 });
    tracker.anchor({ progressMeters: 5, sigmaMeters: 20, timeMs: clock });
    act(() => subscription.onState?.('listening'));
    act(() => result.current.stop());
    tick(2_000);
    act(() => {
      result.current.start();
      subscription.onState?.('listening');
    });
    expect(result.current.snapshot).toMatchObject({
      reason: 'uncertain',
      canStartPose: false,
      progressMeters: 5,
    });
    act(() => subscription.onState?.('denied'));
    expect(result.current.snapshot).toMatchObject({ reason: 'uncertain', canStartPose: false });
    // The provider computes a new route after a physical rescan, even at the same sign.
    rerender({ currentTrack: { ...track } });
    expect(result.current.snapshot).toMatchObject({ progressMeters: 0, canStartPose: true });
  });
  it('uses the active venue graph, freezes progress and logs an ambiguous fork', () => {
    resetFieldTest(true);
    try {
      const setProgress = vi.fn();
      const a = node('a', 0, 0);
      const b = node('b', 20, 0);
      const c = node('c', 20, 7);
      const venue = {
        routingNodes: [a, b, c],
        routingEdges: [
          { from: 'a', to: 'b', distance: 20 },
          { from: 'a', to: 'c', distance: Math.hypot(20, 7) },
        ],
      };
      const { result, rerender } = renderHook(() =>
        useLiveTracking({
          track,
          venue,
          locationBasis: 'qr',
          setProgress,
          active: true,
        }),
      );
      act(() => result.current.start());
      const tracker = result.current.tracker() as unknown as RouteTracker;
      tracker.attachDisplacement(clock);
      act(() => result.current.attachPose());
      walkInAr(tracker, 1);
      tick();
      const published = setProgress.mock.calls.at(-1)?.[0];
      for (let i = 0; i < 10; i += 1) {
        clock += 250;
        tracker.displace({ dxMeters: 0.47, dyMeters: 0.17, timeMs: clock });
      }
      tick();
      expect(result.current.snapshot).toMatchObject({
        reason: 'ambiguous-position',
        poseGraph: 'ambiguous',
        moving: false,
      });
      expect(setProgress).toHaveBeenLastCalledWith(published);
      expect(
        fieldEvents()
          .filter(({ kind }) => kind === 'position')
          .at(-1)?.detail,
      ).toMatchObject({ reason: 'ambiguous-position', poseGraph: 'ambiguous' });
      // A render or start tap on the same venue must not manufacture a new anchor.
      rerender();
      act(() => result.current.start());
      tick();
      expect(result.current.snapshot).toMatchObject({ reason: 'ambiguous-position' });
    } finally {
      resetFieldTest(null);
    }
  });
  it('keeps publishing progress when motion access is refused mid-session', () => {
    const { hook, setProgress } = tracking();
    act(() => hook.result.current.start());
    // The hook is JavaScript; its typedef is what TypeScript cannot see.
    const tracker = hook.result.current.tracker() as unknown as RouteTracker;
    tracker.attachDisplacement(clock);
    act(() => hook.result.current.attachPose());
    // The browser refuses motion access after the session is already running.
    act(() => subscription.onState?.('denied'));
    expect(hook.result.current.status).toBe('on');
    walkInAr(tracker, 6);
    tick();
    // Three metres walked in AR reach the guidance, whatever motion access did.
    expect(setProgress).toHaveBeenLastCalledWith(expect.closeTo(3, 5));
    // And the refusal did not mark the position broken.
    const snapshot = hook.result.current.snapshot as TrackerSnapshot | null;
    expect(snapshot?.reason).not.toBe('sensors-unavailable');
  });

  it('reports the motion subscription again once the pose is released', () => {
    const { hook } = tracking();
    act(() => hook.result.current.start());
    act(() => subscription.onState?.('denied'));
    expect(hook.result.current.status).toBe('denied');
    act(() => hook.result.current.attachPose());
    expect(hook.result.current.status).toBe('on');
    act(() => hook.result.current.detachPose());
    expect(hook.result.current.status).toBe('denied');
  });

  it('records motion access refusal even while an attached pose keeps guidance live', () => {
    resetFieldTest(true);
    try {
      const { hook } = tracking();
      act(() => hook.result.current.start());
      act(() => subscription.onState?.('requesting'));
      act(() => hook.result.current.attachPose());
      act(() => subscription.onState?.('denied'));

      expect(hook.result.current.status).toBe('on');
      expect(
        fieldEvents()
          .filter(({ kind }) => kind === 'motion-access')
          .map(({ detail }) => detail.status),
      ).toEqual(['off', 'requesting', 'denied']);
      expect(
        fieldEvents()
          .filter(({ kind }) => kind === 'tracking')
          .at(-1)?.detail,
      ).toEqual({ status: 'on', pose: true });
    } finally {
      resetFieldTest(null);
    }
  });

  it('records each change of state and every five metres, for a field tester', () => {
    resetFieldTest(true);
    try {
      const { hook } = tracking();
      act(() => hook.result.current.start());
      const tracker = hook.result.current.tracker() as unknown as RouteTracker;
      tracker.attachDisplacement(clock);
      act(() => hook.result.current.attachPose());
      for (let walked = 0; walked < 3; walked += 1) {
        walkInAr(tracker, 8);
        tick();
      }
      const kinds = fieldEvents().map(({ kind, detail }) =>
        kind === 'tracking'
          ? `tracking:${String(detail.status)}`
          : `${kind}:${String(detail.reason)}`,
      );
      expect(kinds[0]).toBe('tracking:off');
      expect(kinds).toContain('tracking:on');
      // Twelve metres walked: logged as it set off, at five metres and at ten, not every tick.
      const positions = fieldEvents().filter(({ kind }) => kind === 'position');
      expect(positions.map(({ detail }) => Math.floor(Number(detail.progress) / 5))).toEqual([
        0, 1, 2,
      ]);
      expect(positions.at(-1)?.detail).toMatchObject({ pose: true, floor: 'g' });
    } finally {
      resetFieldTest(null);
    }
  });

  it('lets stopping tracking release an attached pose too', () => {
    const { hook } = tracking();
    act(() => hook.result.current.start());
    act(() => hook.result.current.attachPose());
    act(() => hook.result.current.stop());
    expect(hook.result.current.status).toBe('off');
  });
});
