/** @vitest-environment jsdom */
import { act, cleanup, render } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ASTERION_RUNTIME, ASTERION_PACKAGE } from '../test/venueFixtures';
import { calculateCompiledRoute } from '../engine/compiledRoutePolicy';
import type { RouteResult } from '../engine/routingCore';
import type { VisitorJourneyState } from '../navigation/visitorJourney';
import type { CheckIn, CheckInRecord } from '../capture/anchorCheckIn';

const mocks = vi.hoisted(() => ({ findRoute: vi.fn(), shutdownRoutingWorker: vi.fn() }));
vi.mock('../engine/routingEngine', () => mocks);
vi.mock('./VenueContext.jsx', () => ({
  useVenue: () => ({ packageCacheStatus: { state: 'verified' } }),
}));
import { NavigationProvider, useNavigation } from './NavigationContext.jsx';

interface Binding {
  state: VisitorJourneyState;
  checkIn: CheckInRecord | null;
  checkInToastVisible: boolean;
  accessibleRouting: boolean;
  toggleAccessibleRouting(): void;
  setOperationalOverlay(overlay: unknown, evaluatedAt: string): void;
  actions: {
    navigateTo(destination: string, start?: string): Promise<void>;
    checkInWithPayload(payload: string): CheckIn;
    dismissCheckIn(): void;
    clearRoute(): void;
    setStart(nodeId: string): void;
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
afterEach(cleanup);

describe('visitor journey check-in lifecycle', () => {
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
    mount();
    const overlay = { id: 'test-closure' };
    const evaluatedAt = '2026-09-11T00:00:00Z';
    act(() => current.setOperationalOverlay(overlay, evaluatedAt));
    await act(() => current.actions.navigateTo(destination));
    await act(async () => {
      current.actions.checkInWithPayload(anchors[1].payload);
    });
    expect(mocks.findRoute).toHaveBeenLastCalledWith(
      ASTERION_RUNTIME,
      current.checkIn?.nodeId,
      destination,
      { profile: 'standard', operationalOverlay: overlay, evaluatedAt },
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
