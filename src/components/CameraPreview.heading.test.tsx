/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CameraPreview from './CameraPreview.jsx';

vi.mock('../context/NavigationContext.jsx', () => ({
  VIEW_TYPE: { MAP: 'map', CAMERA_PREVIEW: 'camera-preview' },
  NAV_STATUS: { NAVIGATING: 'navigating', ARRIVED: 'arrived' },
  useNavigation: () => ({
    state: {
      activeView: 'camera-preview',
      navStatus: 'navigating',
      previewStepIndex: 0,
      venueKey: 'synthetic-venue',
      locationBasis: 'qr',
      route: {
        steps: [{ type: 'start', bearing: 90, instruction: 'Go along the corridor', distance: 5 }],
      },
    },
    // Deliberately tempting anchor data. It must never become phone heading.
    checkIn: { anchorId: 'test-anchor', headingDegrees: 90 },
    venue: { buildingPackage: { building: { coordinateSystem: { northOffsetDegrees: -12 } } } },
    actions: { setView: vi.fn(), prevStep: vi.fn(), nextStep: vi.fn() },
  }),
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('DeviceOrientationEvent', class {});
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function mountAndEnable() {
  const view = render(<CameraPreview />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Enable heading' })));
  return view;
}

function orientation(values: Record<string, unknown>, type = 'deviceorientation') {
  const event = new Event(type);
  Object.entries({ timeStamp: performance.now(), ...values }).forEach(([key, value]) =>
    Object.defineProperty(event, key, { value }),
  );
  act(() => window.dispatchEvent(event));
}

describe('camera preview never invents route alignment', () => {
  it('starts with heading unknown even after a QR check-in', () => {
    render(<CameraPreview />);
    expect(screen.getByText('Not enabled')).toBeTruthy();
    expect(screen.queryByText('90°')).toBeNull();
  });
  it('does not promote relative alpha to a north-referenced heading', async () => {
    const view = await mountAndEnable();
    orientation({ alpha: 270, absolute: false });
    expect(view.container.querySelector('.camera-preview-step-kicker')!.textContent).not.toContain(
      'Aligned',
    );
    expect(screen.getByText('Relative only')).toBeTruthy();
  });

  it('does not compare magnetic heading directly with the plan or a QR anchor heading', async () => {
    const view = await mountAndEnable();
    orientation({ webkitCompassHeading: 90, webkitCompassAccuracy: 5, alpha: 270 });
    expect(view.container.querySelector('.camera-preview-step-kicker')!.textContent).not.toContain(
      'Aligned',
    );
    expect(screen.getByText('Uncalibrated')).toBeTruthy();
  });

  it('clears a previous compass reading when the device reports it invalid', async () => {
    await mountAndEnable();
    orientation({ webkitCompassHeading: 90, webkitCompassAccuracy: 5 });
    orientation({ webkitCompassHeading: -1, webkitCompassAccuracy: -1, alpha: 270 });
    expect(screen.getByText('Unavailable')).toBeTruthy();
    expect(screen.queryByText('90°')).toBeNull();
  });

  it('does not infer camera-forward heading from the absolute event channel either', async () => {
    const view = await mountAndEnable();
    orientation({ alpha: 270, absolute: true }, 'deviceorientationabsolute');
    expect(screen.getByText('Uncalibrated')).toBeTruthy();
    expect(view.container.querySelector('.camera-preview-step-kicker span')).toBeNull();
  });

  it.each([false, true])(
    'expires telemetry with no new events (initial reading %s)',
    async (withReading) => {
      await mountAndEnable();
      if (withReading) orientation({ webkitCompassHeading: 90, webkitCompassAccuracy: 5 });
      act(() => vi.advanceTimersByTime(2_250));
      expect(screen.getByText('Stale')).toBeTruthy();
      orientation({ alpha: 200, absolute: false });
      expect(screen.getByText('Relative only')).toBeTruthy();
    },
  );

  it('lets the visitor disable listeners and clears the watchdog on exit', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const view = await mountAndEnable();
    expect(vi.getTimerCount()).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Disable heading' }));
    expect(vi.getTimerCount()).toBe(0);
    orientation({ webkitCompassHeading: 90, webkitCompassAccuracy: 5 });
    expect(screen.getByText('Not enabled')).toBeTruthy();
    for (const [name, callback, capture] of add.mock.calls.filter(([name]) =>
      name.startsWith('deviceorientation'),
    )) {
      expect(remove).toHaveBeenCalledWith(name, callback, capture);
    }
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Enable heading' })));
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('pauses on background and requires a new opt-in on return', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    await mountAndEnable();
    orientation({ webkitCompassHeading: 90, webkitCompassAccuracy: 5 });
    visibility.mockReturnValue('hidden');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(screen.getByText('Paused')).toBeTruthy();
    expect(vi.getTimerCount()).toBe(0);
    visibility.mockReturnValue('visible');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    orientation({ alpha: 270, absolute: false });
    expect(screen.getByText('Paused')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Enable heading' })).toBeTruthy();
  });

  it.each(['denied', 'rejected'])(
    'handles permission %s without starting sensors',
    async (result) => {
      const requestPermission = vi.fn(() =>
        result === 'denied' ? Promise.resolve('denied') : Promise.reject(new Error('refused')),
      );
      vi.stubGlobal('DeviceOrientationEvent', { requestPermission });
      await mountAndEnable();
      expect(requestPermission).toHaveBeenCalledWith(true);
      expect(screen.getByText('Denied')).toBeTruthy();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(['unmount', 'background'])('ignores a permission grant after %s', async (exit) => {
    let grant!: (permission: string) => void;
    vi.stubGlobal('DeviceOrientationEvent', {
      requestPermission: () =>
        new Promise<string>((resolve) => {
          grant = resolve;
        }),
    });
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const add = vi.spyOn(window, 'addEventListener');
    const view = await mountAndEnable();
    if (exit === 'unmount') view.unmount();
    else {
      visibility.mockReturnValue('hidden');
      act(() => document.dispatchEvent(new Event('visibilitychange')));
    }
    await act(async () => grant('granted'));
    expect(vi.getTimerCount()).toBe(0);
    expect(add.mock.calls.filter(([name]) => name.startsWith('deviceorientation'))).toHaveLength(0);
    if (exit === 'background') expect(screen.getByText('Paused')).toBeTruthy();
  });
});
