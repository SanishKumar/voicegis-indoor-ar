/** @vitest-environment jsdom */
import { act, cleanup, render } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ASTERION_RUNTIME, ASTERION_PACKAGE } from '../test/venueFixtures';
import { calculateCompiledRoute } from '../engine/compiledRoutePolicy';
import type { RouteResult } from '../engine/routingCore';
import type { VisitorJourneyState } from '../navigation/visitorJourney';
import type { CheckIn, CheckInRecord } from '../capture/anchorCheckIn';
import type { QrFrameObservation } from '../capture/qrDecoder';
import type { VisualCheckInCandidate } from '../capture/visualCheckIn';
import { resetSharedOrientation, sharedOrientation } from '../ar/sharedOrientation';
import type { SignHeading } from '../ar/signHeading';
import closureFixture from '../../buildings/asterion-medical-center/operations/all-public-lifts-closed.overlay.json';
import type { OperationalFreshness } from '../navigation/operationalLease';

const mocks = vi.hoisted(() => ({ findRoute: vi.fn(), shutdownRoutingWorker: vi.fn() }));
vi.mock('../engine/routingEngine', () => mocks);
vi.mock('./VenueContext.jsx', () => ({
  useVenue: () => ({ packageCacheStatus: { state: 'verified' } }),
}));
import { NavigationProvider, useNavigation } from './NavigationContext.jsx';

interface Binding {
  state: VisitorJourneyState;
  checkIn:
    | (CheckInRecord & {
        visualCandidate?: VisualCheckInCandidate | null;
        signHeading?: SignHeading | null;
      })
    | null;
  checkInToastVisible: boolean;
  accessibleRouting: boolean;
  toggleAccessibleRouting(): void;
  setOperationalOverlay(overlay: unknown, evaluatedAt?: string): void;
  operationalFreshness: OperationalFreshness;
  previewRoute(destination: string): RouteResult;
  actions: {
    navigateTo(destination: string, start?: string): Promise<void>;
    checkInWithPayload(payload: string, observation?: QrFrameObservation): CheckIn;
    dismissCheckIn(): void;
    clearRoute(): void;
    setStart(nodeId: string): void;
    setProgress(meters: number): void;
    isRouteCurrent(route?: RouteResult): boolean;
    setView(view: string): void;
  };
}
let current: Binding;
function Probe() {
  const value = useNavigation() as unknown as Binding;
  useEffect(() => {
    current = value;
  }, [value]);
  return null;
}
function mount() {
  render(
    <NavigationProvider venue={ASTERION_RUNTIME}>
      <Probe />
    </NavigationProvider>,
  );
}
const destination = 'poi:poi-cardiology';
const anchors = ASTERION_PACKAGE.localizationAnchors.filter((anchor) => anchor.kind === 'qr');
const validRoute = calculateCompiledRoute(
  ASTERION_RUNTIME,
  ASTERION_RUNTIME.config.defaultStartNode,
  destination,
);
const policyEpoch = Date.parse('2026-09-30T12:00:00Z');
function currentOverlay(lifetime = 5000, id = 'test-policy') {
  return {
    ...closureFixture,
    id,
    validFrom: new Date(policyEpoch - 1000).toISOString(),
    validUntil: new Date(policyEpoch + lifetime).toISOString(),
  };
}
function pendingRoute() {
  let resolve!: (route: RouteResult) => void;
  const promise = new Promise<RouteResult>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('theme', 'light');
  window.history.replaceState(null, '', '/');
  mocks.findRoute.mockReset().mockResolvedValue(validRoute);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('visitor closure expiry and recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'performance'] });
    vi.setSystemTime(policyEpoch);
  });
  async function elapse(ms: number) {
    await act(() => vi.advanceTimersByTimeAsync(ms));
  }
  async function startPolicyJourney() {
    mount();
    act(() => current.setOperationalOverlay(currentOverlay()));
    await act(() => current.actions.navigateTo(destination));
  }
  it('expires a journey without motion, preserving intent but hiding route and camera', async () => {
    await startPolicyJourney();
    act(() => {
      current.actions.setProgress(5);
      current.actions.setView('camera-preview');
      current.toggleAccessibleRouting();
    });
    await act(async () => {});
    await elapse(5000);
    expect(current.state).toMatchObject({
      route: null,
      destinationNodeId: destination,
      navStatus: 'paused',
      activeView: 'map',
      policyPause: { reason: 'overlay-expired' },
    });
    expect(current.accessibleRouting).toBe(true);
    expect(current.operationalFreshness.status).toBe('unavailable');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('checks expiry on foreground even if the periodic timer never fired', async () => {
    await startPolicyJourney();
    vi.setSystemTime(policyEpoch + 5000);
    act(() => window.dispatchEvent(new Event('pageshow')));
    expect(current.state.navStatus).toBe('paused');
    expect(current.state.route).toBeNull();
  });
  it('rejects a late worker result at expiry even before a timer fires', async () => {
    mount();
    act(() => current.setOperationalOverlay(currentOverlay()));
    const pending = pendingRoute();
    mocks.findRoute.mockReturnValueOnce(pending.promise);
    act(() => {
      void current.actions.navigateTo(destination);
    });
    vi.setSystemTime(policyEpoch + 5000);
    await act(async () => pending.resolve(validRoute));
    expect(current.state).toMatchObject({
      navStatus: 'paused',
      route: null,
      destinationNodeId: destination,
    });
  });
  it('a scan cannot refresh expired policy; a later policy cannot reuse that old scan', async () => {
    await startPolicyJourney();
    await elapse(5000);
    await act(async () => {
      current.actions.checkInWithPayload(anchors[1].payload);
    });
    expect(current.checkIn?.anchorId).toBe(anchors[1].id);
    expect(current.state.navStatus).toBe('paused');
    expect(mocks.findRoute).toHaveBeenCalledTimes(1);
    act(() => current.setOperationalOverlay(currentOverlay(20_000, 'replacement')));
    await act(() => current.actions.navigateTo(destination));
    expect(mocks.findRoute).toHaveBeenCalledTimes(1);
    await act(async () => {
      current.actions.checkInWithPayload(anchors[0].payload);
    });
    expect(mocks.findRoute).toHaveBeenCalledTimes(2);
    expect(current.state.navStatus).toBe('navigating');
    expect(current.state.locationBasis).toBe('qr');
    expect(current.state.progressMeters).toBe(0);
  });
  it('replacing a policy cancels a pending route and retains destination/profile until new selection', async () => {
    mount();
    act(() => {
      current.setOperationalOverlay(currentOverlay());
      current.toggleAccessibleRouting();
    });
    const pending = pendingRoute();
    mocks.findRoute.mockReturnValueOnce(pending.promise);
    act(() => {
      void current.actions.navigateTo(destination);
    });
    act(() => current.setOperationalOverlay(currentOverlay(20_000, 'replacement')));
    await act(async () => pending.resolve(validRoute));
    expect(current.state).toMatchObject({
      navStatus: 'paused',
      route: null,
      destinationNodeId: destination,
    });
    await act(async () => current.actions.setStart(ASTERION_RUNTIME.config.defaultStartNode));
    expect(mocks.findRoute).toHaveBeenLastCalledWith(
      ASTERION_RUNTIME,
      ASTERION_RUNTIME.config.defaultStartNode,
      destination,
      expect.objectContaining({
        profile: 'wheelchair',
        operationalOverlay: expect.objectContaining({ id: 'replacement' }),
      }),
    );
    expect(current.state.locationBasis).toBe('selected');
  });
  it('clearing policy is not an all-clear, and cancelling the trip cannot bypass reacquisition', async () => {
    await startPolicyJourney();
    act(() => current.setOperationalOverlay(null));
    expect(current.operationalFreshness.reason).toBe('overlay-removed');
    expect(current.state.navStatus).toBe('paused');
    act(() => current.actions.clearRoute());
    act(() => current.setOperationalOverlay(currentOverlay(20_000)));
    await act(() => current.actions.navigateTo(destination));
    expect(current.state.navStatus).toBe('paused');
    expect(mocks.findRoute).toHaveBeenCalledTimes(1);
    await act(async () => current.actions.setStart(ASTERION_RUNTIME.config.defaultStartNode));
    expect(current.state.navStatus).toBe('navigating');
  });
  it('a stale frame/progress callback synchronously rejects route ownership before React updates', async () => {
    await startPolicyJourney();
    const oldRoute = current.state.route!;
    vi.setSystemTime(policyEpoch + 5000);
    act(() => {
      expect(current.actions.isRouteCurrent(oldRoute)).toBe(false);
      current.actions.setProgress(30);
    });
    expect(current.state.progressMeters).toBe(0);
    expect(current.state.route).toBeNull();
  });
  it('previews evaluate their own clock instead of a frozen import timestamp', async () => {
    await startPolicyJourney();
    vi.setSystemTime(policyEpoch + 5000);
    expect(current.previewRoute(destination).found).toBe(false);
  });
  it('rejects invalid policies without invoking routing, rather than silently using no closures', async () => {
    mount();
    act(() => current.setOperationalOverlay({ ...currentOverlay(), packageHash: 'wrong' }));
    await act(() => current.actions.navigateTo(destination));
    expect(mocks.findRoute).not.toHaveBeenCalled();
    expect(current.state.navStatus).toBe('paused');
  });
  it('a future policy becoming current cannot resume from its earlier start automatically', async () => {
    mount();
    act(() =>
      current.setOperationalOverlay({
        ...currentOverlay(20_000),
        validFrom: new Date(policyEpoch + 2000).toISOString(),
      }),
    );
    await act(() => current.actions.navigateTo(destination));
    await elapse(2000);
    expect(current.operationalFreshness.status).toBe('current');
    expect(current.state.navStatus).toBe('paused');
    expect(mocks.findRoute).not.toHaveBeenCalled();
    await act(async () => current.actions.checkInWithPayload(anchors[0].payload));
    expect(current.state.navStatus).toBe('navigating');
  });
  it('invalid location recovery cannot qualify a paused trip or hide it in camera view', async () => {
    await startPolicyJourney();
    act(() => current.setOperationalOverlay(currentOverlay(20_000, 'replacement')));
    const paused = current.state;
    act(() => {
      current.actions.checkInWithPayload('unknown-code');
      current.actions.setStart('unknown-node');
      current.actions.setView('camera-preview');
    });
    expect(current.state).toBe(paused);
    expect(current.state.activeView).toBe('map');
    expect(mocks.findRoute).toHaveBeenCalledTimes(1);
  });
  it('retains a blocked step-free destination so an explicit fastest-route choice can replan', async () => {
    mocks.findRoute.mockImplementation((venue, start, end, options) =>
      Promise.resolve(calculateCompiledRoute(venue, start, end, options)),
    );
    mount();
    act(() => {
      current.setOperationalOverlay(currentOverlay());
      current.toggleAccessibleRouting();
    });
    await act(() => current.actions.navigateTo(destination));
    expect(current.state.route?.found).toBe(false);
    await act(async () => current.toggleAccessibleRouting());
    expect(mocks.findRoute).toHaveBeenCalledTimes(2);
    expect(current.state.route?.found).toBe(true);
    expect(current.state.destinationNodeId).toBe(destination);
  });
  it('can replace a saved destination while policy remains unavailable without using the old one', async () => {
    await startPolicyJourney();
    await elapse(5000);
    const replacement = 'poi:poi-pediatrics';
    await act(() => current.actions.navigateTo(replacement));
    expect(current.state).toMatchObject({
      destinationNodeId: replacement,
      navStatus: 'paused',
      route: null,
    });
    expect(mocks.findRoute).toHaveBeenCalledTimes(1);
    act(() => current.setOperationalOverlay(currentOverlay(20_000, 'replacement-policy')));
    await act(async () => current.actions.checkInWithPayload(anchors[1].payload));
    expect(mocks.findRoute).toHaveBeenLastCalledWith(
      ASTERION_RUNTIME,
      current.checkIn?.nodeId,
      replacement,
      expect.any(Object),
    );
  });
});

describe('visitor journey check-in lifecycle', () => {
  it('takes an approximate direction from a sign scanned on live orientation readings', () => {
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('DeviceOrientationEvent', class {});
    resetSharedOrientation();
    sharedOrientation.start();
    try {
      mount();
      const frameAt = performance.now();
      // The phone upright and level, as it is held to read a sign on a wall.
      const event = new Event('deviceorientation');
      Object.entries({
        alpha: 30,
        beta: 90,
        gamma: 0,
        timeStamp: frameAt,
        absolute: false,
      }).forEach(([key, value]) => Object.defineProperty(event, key, { value }));
      act(() => {
        window.dispatchEvent(event);
      });
      const frame = {
        width: 640,
        height: 480,
        decodeWidth: 640,
        decodeHeight: 480,
        copiedAtMs: frameAt,
        mediaTimeSeconds: 1,
      };
      act(() => {
        current.actions.checkInWithPayload(anchors[0].payload, {
          payload: anchors[0].payload,
          engine: 'jsqr',
          cornerOrder: 'qr-clockwise',
          corners: null,
          frame,
        });
      });
      expect(current.checkIn?.signHeading).toMatchObject({
        source: 'sign',
        anchorId: anchors[0].id,
        venueKey: current.state.venueKey,
        planBearing: (anchors[0].headingDegrees + 180) % 360,
      });
      // A link has no frame to pair a reading with, and sets no direction.
      act(() => {
        current.actions.checkInWithPayload(anchors[1].payload);
      });
      expect(current.checkIn?.signHeading).toBeNull();
    } finally {
      resetSharedOrientation();
      vi.unstubAllGlobals();
    }
  });

  it('retains camera geometry only for its accepted sign, separately from heading and links', () => {
    mount();
    const observation: QrFrameObservation = {
      payload: anchors[0].payload,
      engine: 'jsqr',
      cornerOrder: 'qr-clockwise',
      corners: null,
      frame: {
        width: 640,
        height: 480,
        decodeWidth: 640,
        decodeHeight: 480,
        copiedAtMs: performance.now(),
        mediaTimeSeconds: 1,
      },
    };
    act(() => {
      current.actions.checkInWithPayload(anchors[0].payload, observation);
    });
    expect(current.checkIn?.visualCandidate).toMatchObject({
      anchorId: anchors[0].id,
      venueKey: current.state.venueKey,
      status: 'unqualified',
    });
    expect(current.checkIn).not.toHaveProperty('headingDegrees');
    const retained = current.checkIn;
    act(() => {
      current.actions.checkInWithPayload('unknown', observation);
    });
    expect(current.checkIn).toBe(retained);
    // A valid position with geometry from a different sign never inherits it.
    act(() => {
      current.actions.checkInWithPayload(anchors[1].payload, observation);
    });
    expect(current.checkIn?.visualCandidate).toBeNull();
    act(() => {
      current.actions.checkInWithPayload(anchors[0].payload);
    });
    expect(current.checkIn?.visualCandidate).toBeNull();
    act(() => {
      current.actions.setStart(ASTERION_RUNTIME.config.defaultStartNode);
    });
    expect(current.checkIn).toBeNull();
  });
  it('preserves QR provenance when onboarding scans and starts a route in one event', async () => {
    mount();
    await act(async () => {
      const result = current.actions.checkInWithPayload(anchors[1].payload);
      if (!result.ok) throw new Error('Fixture check-in must resolve');
      await current.actions.navigateTo(destination, result.nodeId);
    });
    expect(current.checkIn?.anchorId).toBe(anchors[1].id);
    expect(current.state.locationBasis).toBe('qr');
  });

  it('a scan immediately after a profile change uses the latest policy and start', async () => {
    mount();
    await act(() => current.actions.navigateTo(destination));
    await act(async () => {
      current.toggleAccessibleRouting();
      current.actions.checkInWithPayload(anchors[1].payload);
    });
    expect(mocks.findRoute).toHaveBeenLastCalledWith(
      ASTERION_RUNTIME,
      current.checkIn?.nodeId,
      destination,
      { profile: 'wheelchair' },
    );
  });
  it('clearing a never-imported policy is a no-op for an authored baseline route', async () => {
    mount();
    await act(() => current.actions.navigateTo(destination));
    const route = current.state.route;
    act(() => current.setOperationalOverlay(null));
    expect(current.state.route).toBe(route);
    expect(current.operationalFreshness.status).toBe('none');
    expect(current.state.navStatus).toBe('navigating');
  });

  it('seeds a URL checkpoint and keeps it when its toast is dismissed', () => {
    window.history.replaceState(null, '', `/?checkin=${encodeURIComponent(anchors[0].payload)}`);
    mount();
    const record = current.checkIn;
    expect(record?.anchorId).toBe(anchors[0].id);
    expect(current.state.locationBasis).toBe('qr');
    expect(current.checkInToastVisible).toBe(true);
    act(() => current.actions.dismissCheckIn());
    expect(current.checkIn).toBe(record);
    expect(current.checkInToastVisible).toBe(false);
    expect(window.location.search).toBe('');
  });

  it('a scan replans an active destination with the selected accessibility profile', async () => {
    mount();
    act(() => current.toggleAccessibleRouting());
    await act(() => current.actions.navigateTo(destination));
    await act(async () => {
      current.actions.checkInWithPayload(anchors[1].payload);
    });
    expect(current.state).toMatchObject({
      destinationNodeId: destination,
      locationBasis: 'qr',
      locationFloorId: anchors[1].floorId,
      previewStepIndex: 0,
      navStatus: 'navigating',
    });
    expect(mocks.findRoute).toHaveBeenLastCalledWith(
      ASTERION_RUNTIME,
      current.checkIn?.nodeId,
      destination,
      { profile: 'wheelchair' },
    );
  });

  it('preserves operational routing constraints when a scan replans', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-22T12:00:00Z'));
    mount();
    const overlay = closureFixture;
    // The historical import time must never be reused for live decisions.
    act(() => current.setOperationalOverlay(overlay, '2026-07-22T11:00:00Z'));
    await act(() => current.actions.navigateTo(destination));
    vi.setSystemTime(new Date('2026-07-22T12:00:01Z'));
    await act(async () => {
      current.actions.checkInWithPayload(anchors[1].payload);
    });
    expect(mocks.findRoute).toHaveBeenLastCalledWith(
      ASTERION_RUNTIME,
      current.checkIn?.nodeId,
      destination,
      { profile: 'standard', operationalOverlay: overlay, evaluatedAt: '2026-07-22T12:00:01.000Z' },
    );
  });

  it('a scan can replace a pending request before React has rendered it', async () => {
    mount();
    const first = pendingRoute();
    const second = pendingRoute();
    mocks.findRoute.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    act(() => {
      void current.actions.navigateTo(destination);
      current.actions.checkInWithPayload(anchors[1].payload);
    });
    expect(mocks.findRoute).toHaveBeenCalledTimes(2);
    await act(async () => {
      second.resolve(validRoute);
    });
    await act(async () => {
      first.resolve({ found: false, error: 'obsolete' });
    });
    expect(current.state.route).toBe(validRoute);
    expect(current.state.destinationNodeId).toBe(destination);
    expect(current.state.locationBasis).toBe('qr');
  });

  it('cancel invalidates an in-flight scan replan and later scans do not resurrect it', async () => {
    mount();
    await act(() => current.actions.navigateTo(destination));
    const pending = pendingRoute();
    mocks.findRoute.mockReturnValueOnce(pending.promise);
    act(() => {
      current.actions.checkInWithPayload(anchors[1].payload);
    });
    act(() => current.actions.clearRoute());
    await act(async () => {
      pending.resolve(validRoute);
    });
    act(() => {
      current.actions.checkInWithPayload(anchors[0].payload);
    });
    expect(current.state).toMatchObject({
      route: null,
      destinationNodeId: null,
      navStatus: 'idle',
    });
    expect(mocks.findRoute).toHaveBeenCalledTimes(2);
  });

  it('an invalid scan leaves an active journey and its checkpoint unchanged', async () => {
    mount();
    act(() => {
      current.actions.checkInWithPayload(anchors[0].payload);
    });
    await act(() => current.actions.navigateTo(destination));
    const state = current.state;
    const record = current.checkIn;
    act(() => {
      expect(current.actions.checkInWithPayload('foreign-code').ok).toBe(false);
    });
    expect(current.state).toBe(state);
    expect(current.checkIn).toBe(record);
  });

  it('a manually selected start clears QR provenance', () => {
    mount();
    act(() => {
      current.actions.checkInWithPayload(anchors[0].payload);
    });
    act(() => current.actions.setStart(ASTERION_RUNTIME.config.defaultStartNode));
    expect(current.state.locationBasis).toBe('selected');
    expect(current.checkIn).toBeNull();
  });
});
