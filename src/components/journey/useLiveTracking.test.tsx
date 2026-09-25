/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphNode, RouteStep } from '../../engine/routingCore';
import type { RouteTracker, TrackerSnapshot } from '../../navigation/liveTracker';
import { buildRouteTrack } from '../../navigation/routeProgress';
import { useLiveTracking } from './useLiveTracking.js';

/*
 * Only the motion subscription is replaced, so a test can say what the
 * browser did with the permission. The hook, the tracker and the publishing
 * are the real ones.
 */
type State = 'requesting' | 'listening' | 'denied' | 'unsupported' | 'insecure' | 'hidden';
const subscription = vi.hoisted(() => ({
  onState: null as null | ((state: State) => void),
  dispose: () => {},
}));
vi.mock('../../sensors/handsetSubscription', () => ({
  startHandsetSubscription: (callbacks: { onState: (state: State) => void }) => {
    subscription.onState = callbacks.onState;
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
  subscription.onState = null;
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
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

  it('lets stopping tracking release an attached pose too', () => {
    const { hook } = tracking();
    act(() => hook.result.current.start());
    act(() => hook.result.current.attachPose());
    act(() => hook.result.current.stop());
    expect(hook.result.current.status).toBe('off');
  });
});
