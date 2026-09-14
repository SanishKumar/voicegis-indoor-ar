/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionRecorder } from '@voicegis/localization-core';
import WalkRecorder from './WalkRecorder';

vi.mock('../context/VenueContext.jsx', () => ({
  useVenue: () => ({
    venue: {
      buildingPackage: {
        building: { id: 'test-venue' },
        manifest: { contentHash: 'a'.repeat(64) },
        localizationAnchors: [],
      },
    },
  }),
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('DeviceMotionEvent', class {});
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function event(type: string, fields: Record<string, unknown>) {
  const value = new Event(type);
  Object.entries({ timeStamp: performance.now(), ...fields }).forEach(([key, entry]) =>
    Object.defineProperty(value, key, { value: entry }),
  );
  act(() => window.dispatchEvent(value));
}
function motion() {
  event('devicemotion', {
    accelerationIncludingGravity: { x: 0, y: 0, z: 9.81 },
    rotationRate: { alpha: 0, beta: 0, gamma: 0 },
  });
}
function orientation() {
  event('deviceorientation', { alpha: 0, beta: 0, gamma: 0, absolute: false });
}
async function start() {
  const view = render(<WalkRecorder />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Start' })));
  return view;
}

describe('walk recorder continuity wiring', () => {
  it('records background/foreground boundaries and does not capture while hidden', async () => {
    const imu = vi.spyOn(SessionRecorder.prototype, 'recordImu');
    const lifecycle = vi.spyOn(SessionRecorder.prototype, 'recordLifecycle');
    await start();
    orientation();
    motion();
    const hidden = vi.spyOn(document, 'hidden', 'get');
    hidden.mockReturnValue(true);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    motion();
    orientation();
    expect(imu).toHaveBeenCalledTimes(1);
    expect(lifecycle.mock.calls.map(([kind]) => kind)).toContain('backgrounded');
    hidden.mockReturnValue(false);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    motion();
    expect(imu.mock.calls.at(-1)?.[0].orientation).toBeNull();
    expect(lifecycle.mock.calls.map(([kind]) => kind)).toContain('foregrounded');
    orientation();
    motion();
    expect(imu.mock.calls.at(-1)?.[0].orientation).not.toBeNull();
  });

  it('a null orientation event invalidates the previous tilt', async () => {
    const imu = vi.spyOn(SessionRecorder.prototype, 'recordImu');
    await start();
    orientation();
    motion();
    event('deviceorientation', { alpha: null, beta: null, gamma: null });
    motion();
    expect(imu.mock.calls.at(-1)?.[0].orientation).toBeNull();
  });

  it('does not accept queued pre-resume tilt as a fresh orientation', async () => {
    const imu = vi.spyOn(SessionRecorder.prototype, 'recordImu');
    await start();
    orientation();
    motion();
    const queuedAtMs = performance.now();
    act(() => vi.advanceTimersByTime(20));
    const hidden = vi.spyOn(document, 'hidden', 'get');
    hidden.mockReturnValue(true);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    act(() => vi.advanceTimersByTime(20));
    hidden.mockReturnValue(false);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    event('deviceorientation', { timeStamp: queuedAtMs, alpha: 0, beta: 0, gamma: 0 });
    motion();
    expect(imu.mock.calls.at(-1)?.[0].orientation).toBeNull();
    orientation();
    motion();
    expect(imu.mock.calls.at(-1)?.[0].orientation).not.toBeNull();
  });

  it('never starts a capture after unmount during permission', async () => {
    let grant: (value: string) => void = () => {};
    vi.stubGlobal('DeviceMotionEvent', {
      requestPermission: () =>
        new Promise<string>((resolve) => {
          grant = resolve;
        }),
    });
    const lifecycle = vi.spyOn(SessionRecorder.prototype, 'recordLifecycle');
    const view = render(<WalkRecorder />);
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    view.unmount();
    await act(async () => grant('granted'));
    motion();
    expect(lifecycle).not.toHaveBeenCalled();
  });

  it.each(['stop', 'unmount'])('detaches sensor and visibility listeners on %s', async (action) => {
    const imu = vi.spyOn(SessionRecorder.prototype, 'recordImu');
    const lifecycle = vi.spyOn(SessionRecorder.prototype, 'recordLifecycle');
    const view = await start();
    motion();
    if (action === 'stop') fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    else view.unmount();
    const calls = lifecycle.mock.calls.length;
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    orientation();
    motion();
    expect(imu).toHaveBeenCalledTimes(1);
    expect(lifecycle).toHaveBeenCalledTimes(calls);
  });

  it('coalesces repeated starts while a permission request is pending', async () => {
    let grant: (value: string) => void = () => {};
    const requestPermission = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          grant = resolve;
        }),
    );
    vi.stubGlobal('DeviceMotionEvent', { requestPermission });
    const lifecycle = vi.spyOn(SessionRecorder.prototype, 'recordLifecycle');
    render(<WalkRecorder />);
    const button = screen.getByRole('button', { name: 'Start' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(requestPermission).toHaveBeenCalledTimes(1);
    await act(async () => grant('granted'));
    expect(lifecycle.mock.calls.map(([kind]) => kind)).toEqual(['session-start']);
  });

  it('starts suspended if permission resolves while the page is hidden', async () => {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    const lifecycle = vi.spyOn(SessionRecorder.prototype, 'recordLifecycle');
    const imu = vi.spyOn(SessionRecorder.prototype, 'recordImu');
    await start();
    motion();
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(imu).not.toHaveBeenCalled();
    expect(lifecycle.mock.calls.map(([kind]) => kind)).toEqual(['session-start', 'backgrounded']);
  });
});
