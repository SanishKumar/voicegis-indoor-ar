/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveLocalizationSession, type LiveSessionOptions } from '@voicegis/localization-core';
import { ASTERION_RUNTIME } from '../test/venueFixtures';
import { calculateCompiledRoute } from '../engine/compiledRoutePolicy';
import { prepareDiagnosticSession } from '../navigation/prepareDiagnosticSession';
import SessionHarness, { RouteSessionHarness } from './SessionHarness';
import liftClosure from '../../buildings/asterion-medical-center/operations/all-public-lifts-closed.overlay.json';
import type { OperationalOverlay } from '../engine/operationalOverlay';
import { LiveHandsetInput } from '../capture/liveHandsetInput';

const navigation = vi.hoisted(() => vi.fn<() => unknown>());
vi.mock('../context/NavigationContext.jsx', () => ({ useNavigation: navigation }));
vi.mock('../navigation/prepareDiagnosticSession', () => ({ prepareDiagnosticSession: vi.fn() }));

// UI lifecycle tests use the real session, with a small synthetic verified-input
// substitute. Package integrity and canonical routing are tested in the factory suite.
function options(): LiveSessionOptions {
  return {
    identity: { sessionId: 'test', buildingId: 'venue', packageHash: 'hash', routeRevision: 1 },
    anchors: [
      {
        id: 'start',
        kind: 'qr',
        floorId: 'g',
        position: [0, 0],
        headingDegrees: 90,
        payload: 'start',
      },
    ],
    elevationByFloorId: { g: 0 },
    routeSegments: [
      {
        id: 'hall',
        floorId: 'g',
        from: [0, 0],
        to: [20, 0],
        lengthMeters: 20,
        startProgressMeters: 0,
      },
    ],
  };
}
function request() {
  return {
    buildingPackage: ASTERION_RUNTIME.buildingPackage,
    route: calculateCompiledRoute(ASTERION_RUNTIME, 'poi:poi-main-entrance', 'poi:poi-cardiology'),
    policy: { profile: 'standard' as const },
  };
}
async function start() {
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'Start checkpoint diagnostic' })),
  );
}
function checkpoint(payload = 'start') {
  fireEvent.change(screen.getByLabelText('Checkpoint payload (manual test)'), {
    target: { value: payload },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Test checkpoint / reacquire' }));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.mocked(prepareDiagnosticSession).mockReset().mockResolvedValue(options());
  navigation.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function sensors(permission?: () => Promise<string>) {
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('DeviceMotionEvent', permission ? { requestPermission: permission } : class {});
  vi.stubGlobal('DeviceOrientationEvent', class {});
}
async function enableInput() {
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'Enable motion diagnostics' })),
  );
}
function sampleEvent(type: string, fields: Record<string, unknown>) {
  const event = new Event(type);
  for (const [key, value] of Object.entries({ timeStamp: performance.now(), ...fields }))
    Object.defineProperty(event, key, { value });
  act(() => window.dispatchEvent(event));
}

describe('handset diagnostic ownership', () => {
  it('never requests sensors from Start, and enabled raw input never moves or calibrates the route', async () => {
    const permission = vi.fn(async () => 'granted');
    sensors(permission);
    const calibrate = vi.spyOn(LiveLocalizationSession.prototype, 'calibrate');
    const motion = vi.spyOn(LiveLocalizationSession.prototype, 'motion');
    render(<RouteSessionHarness request={request()} />);
    await start();
    expect(permission).not.toHaveBeenCalled();
    await enableInput();
    expect(permission).toHaveBeenCalledOnce();
    checkpoint();
    sampleEvent('deviceorientation', { alpha: 90, beta: 0, gamma: 0, absolute: true });
    sampleEvent('devicemotion', {
      accelerationIncludingGravity: { x: 0, y: 0, z: 9.81 },
      rotationRate: { alpha: 0, beta: 0, gamma: 0 },
    });
    act(() => vi.advanceTimersByTime(250));
    const count = screen.getByText('Complete paired samples').nextElementSibling;
    expect(count?.textContent).toBe('1');
    expect(calibrate).not.toHaveBeenCalled();
    expect(motion).not.toHaveBeenCalled();
    expect(screen.getByText('Guidance frozen')).toBeTruthy();
  });

  it.each(['disable', 'stop', 'unmount', 'hidden', 'pagehide'] as const)(
    'detaches live input on %s',
    async (action) => {
      sensors();
      const receive = vi.spyOn(LiveHandsetInput.prototype, 'motion');
      const view = render(<RouteSessionHarness request={request()} />);
      await start();
      await enableInput();
      if (action === 'disable')
        fireEvent.click(screen.getByRole('button', { name: 'Disable motion diagnostics' }));
      if (action === 'stop')
        fireEvent.click(screen.getByRole('button', { name: 'Stop diagnostic' }));
      if (action === 'unmount') view.unmount();
      if (action === 'pagehide') act(() => window.dispatchEvent(new Event('pagehide')));
      if (action === 'hidden') {
        vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
        act(() => document.dispatchEvent(new Event('visibilitychange')));
      }
      vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
      act(() => document.dispatchEvent(new Event('visibilitychange')));
      sampleEvent('devicemotion', {});
      expect(receive).not.toHaveBeenCalled();
      if (action !== 'disable') expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(['disable', 'stop', 'unmount', 'hidden'] as const)(
    'cannot attach after a late grant following %s',
    async (action) => {
      let grant!: (value: string) => void;
      sensors(
        () =>
          new Promise<string>((resolve) => {
            grant = resolve;
          }),
      );
      const receive = vi.spyOn(LiveHandsetInput.prototype, 'motion');
      const view = render(<RouteSessionHarness request={request()} />);
      await start();
      await enableInput();
      if (action === 'disable')
        fireEvent.click(screen.getByRole('button', { name: 'Disable motion diagnostics' }));
      if (action === 'stop')
        fireEvent.click(screen.getByRole('button', { name: 'Stop diagnostic' }));
      if (action === 'unmount') view.unmount();
      if (action === 'hidden') {
        vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
        act(() => document.dispatchEvent(new Event('visibilitychange')));
      }
      await act(async () => grant('granted'));
      sampleEvent('devicemotion', {});
      expect(receive).not.toHaveBeenCalled();
    },
  );

  it('does not reacquire while a permission request is pending', async () => {
    let grant!: (value: string) => void;
    sensors(
      () =>
        new Promise<string>((resolve) => {
          grant = resolve;
        }),
    );
    const acquire = vi.spyOn(LiveLocalizationSession.prototype, 'beginAcquisition');
    render(<RouteSessionHarness request={request()} />);
    await start();
    await enableInput();
    checkpoint();
    expect(acquire).toHaveBeenCalledTimes(2);
    await act(async () => grant('granted'));
    checkpoint();
    expect(acquire).toHaveBeenCalledTimes(3);
  });

  it('replaces the reducer and clears cached tilt on checkpoint recovery', async () => {
    sensors();
    const dispose = vi.spyOn(LiveHandsetInput.prototype, 'dispose');
    render(<RouteSessionHarness request={request()} />);
    await start();
    await enableInput();
    sampleEvent('deviceorientation', { alpha: 0, beta: 0, gamma: 0 });
    act(() => vi.advanceTimersByTime(10));
    checkpoint();
    sampleEvent('devicemotion', {
      accelerationIncludingGravity: { x: 0, y: 0, z: 9.81 },
      rotationRate: { alpha: 0, beta: 0, gamma: 0 },
    });
    act(() => vi.advanceTimersByTime(250));
    expect(dispose).toHaveBeenCalledOnce();
    expect(screen.getByText(/Fresh tilt required/)).toBeTruthy();
  });
});

describe('operator checkpoint session UI', () => {
  it('stays frozen after a checkpoint, expires without input and explicitly reacquires', async () => {
    const motion = vi.spyOn(LiveLocalizationSession.prototype, 'motion');
    const calibrate = vi.spyOn(LiveLocalizationSession.prototype, 'calibrate');
    const acquire = vi.spyOn(LiveLocalizationSession.prototype, 'beginAcquisition');
    render(<RouteSessionHarness request={request()} />);
    await start();
    checkpoint();
    expect(screen.getByText('Checkpoint resolved · independent heading unavailable')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('not a physical scan');
    expect(screen.getByText('Guidance frozen')).toBeTruthy();
    act(() => vi.advanceTimersByTime(1500));
    expect(screen.getByText('Expired · no qualified motion received')).toBeTruthy();
    checkpoint();
    expect(screen.getByText('Checkpoint resolved · independent heading unavailable')).toBeTruthy();
    expect(acquire).toHaveBeenCalledTimes(3);
    expect(motion).not.toHaveBeenCalled();
    expect(calibrate).not.toHaveBeenCalled();
  });

  it('refuses an unknown checkpoint without a location or guidance claim', async () => {
    render(<RouteSessionHarness request={request()} />);
    await start();
    checkpoint('foreign');
    expect(screen.getByRole('status').textContent).toContain('Checkpoint refused');
    expect(screen.getByText('None')).toBeTruthy();
    expect(screen.getByText('Guidance frozen')).toBeTruthy();
  });

  it.each(['stop', 'unmount'] as const)(
    'retires the running session and watchdog on %s',
    async (action) => {
      const stop = vi.spyOn(LiveLocalizationSession.prototype, 'stop');
      const view = render(<RouteSessionHarness request={request()} />);
      await start();
      expect(vi.getTimerCount()).toBe(1);
      if (action === 'unmount') view.unmount();
      else fireEvent.click(screen.getByRole('button', { name: 'Stop diagnostic' }));
      expect(stop).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
      expect(stop.mock.results[0].value.reason).toBe('stopped');
    },
  );

  it.each(['hidden', 'pagehide'] as const)(
    'pauses on %s and requires an explicit restart and checkpoint',
    async (kind) => {
      const begin = vi.spyOn(LiveLocalizationSession.prototype, 'beginAcquisition');
      render(<RouteSessionHarness request={request()} />);
      await start();
      checkpoint();
      if (kind === 'hidden') {
        vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
        act(() => document.dispatchEvent(new Event('visibilitychange')));
      } else act(() => window.dispatchEvent(new Event('pagehide')));
      expect(screen.getByText('Paused · page hidden')).toBeTruthy();
      expect(vi.getTimerCount()).toBe(0);
      vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
      act(() => document.dispatchEvent(new Event('visibilitychange')));
      checkpoint();
      expect(begin).toHaveBeenCalledTimes(2);
      await start();
      expect(screen.getByText('Waiting for a checkpoint test')).toBeTruthy();
      expect(screen.getByText('None')).toBeTruthy();
      checkpoint();
      expect(
        screen.getByText('Checkpoint resolved · independent heading unavailable'),
      ).toBeTruthy();
      expect(vi.getTimerCount()).toBe(1);
    },
  );

  it.each(['stop', 'unmount', 'hidden'] as const)(
    'cannot enroll after %s while package verification is pending',
    async (action) => {
      let finish!: (value: LiveSessionOptions) => void;
      vi.mocked(prepareDiagnosticSession).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const begin = vi.spyOn(LiveLocalizationSession.prototype, 'beginAcquisition');
      const view = render(<RouteSessionHarness request={request()} />);
      await start();
      if (action === 'unmount') view.unmount();
      else if (action === 'stop')
        fireEvent.click(screen.getByRole('button', { name: 'Stop diagnostic' }));
      else {
        vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
        act(() => document.dispatchEvent(new Event('visibilitychange')));
      }
      await act(async () => finish(options()));
      expect(begin).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      if (action === 'stop') expect(screen.getByText('Stopped', { exact: true })).toBeTruthy();
    },
  );

  it('reports package verification failure without enrolling', async () => {
    vi.mocked(prepareDiagnosticSession).mockRejectedValueOnce(new Error('SHA-256 mismatch'));
    render(<RouteSessionHarness request={request()} />);
    await start();
    expect(screen.getByRole('status').textContent).toContain('SHA-256 mismatch');
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['package', 'route', 'profile', 'policy'] as const)(
    'a changed %s binding stops its owner and does not enroll the replacement',
    async (kind) => {
      const first = {
        venue: ASTERION_RUNTIME,
        state: { route: request().route },
        accessibleRouting: false,
        operationalOverlay: null as OperationalOverlay | null,
        operationalEvaluatedAt: null as string | null,
      };
      navigation.mockReturnValue(first);
      const stop = vi.spyOn(LiveLocalizationSession.prototype, 'stop');
      const view = render(<SessionHarness />);
      await start();
      const next = { ...first, state: structuredClone(first.state) };
      if (kind === 'package') next.venue = { ...ASTERION_RUNTIME, key: 'replacement' };
      if (kind === 'route' && next.state.route.found) next.state.route.pathIds.reverse();
      if (kind === 'profile') next.accessibleRouting = true;
      if (kind === 'policy') {
        next.operationalOverlay = liftClosure as OperationalOverlay;
        next.operationalEvaluatedAt = '2026-07-22T12:00:00.000Z';
      }
      navigation.mockReturnValue(next);
      view.rerender(<SessionHarness />);
      expect(stop).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
      expect(screen.getByText('Not started')).toBeTruthy();
      expect(prepareDiagnosticSession).toHaveBeenCalledTimes(1);
    },
  );

  it('requires a successful route before offering enrollment', () => {
    navigation.mockReturnValue({ state: { route: null }, venue: ASTERION_RUNTIME });
    render(<SessionHarness />);
    expect(screen.getByText(/Plan a route in Visitor view/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start checkpoint diagnostic' })).toBeNull();
    expect(prepareDiagnosticSession).not.toHaveBeenCalled();
  });
});
