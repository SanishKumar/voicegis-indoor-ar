/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphNode, RouteStep } from '../engine/routingCore';
import { RouteTracker, type TrackerSnapshot } from '../navigation/liveTracker';
import { trackForRoute } from '../navigation/routeProgress';
import CameraPreview from './CameraPreview.jsx';

const node = (id: string, x: number, y: number): GraphNode => ({
  id,
  x,
  y,
  floor: 'g',
  type: 'junction',
});
const step = (type: RouteStep['type'], nodeId: string, instruction: string): RouteStep => ({
  type,
  instruction,
  distance: 0,
  nodeId,
  bearing: 90,
  floorId: 'g',
});

/* Twenty metres east along a corridor. */
const route = {
  found: true as const,
  path: [node('a', 0, 0), node('b', 20, 0)],
  steps: [step('start', 'a', 'Go along the corridor'), step('arrive', 'b', 'Arrive at the desk')],
  totalDistance: 20,
};

const setView = vi.fn();
vi.mock('../context/NavigationContext.jsx', () => ({
  VIEW_TYPE: { MAP: 'map', CAMERA_PREVIEW: 'camera-preview' },
  NAV_STATUS: { NAVIGATING: 'navigating', ARRIVED: 'arrived' },
  useNavigation: () => ({
    state: {
      activeView: 'camera-preview',
      navStatus: 'navigating',
      progressMeters: 0,
      previewStepIndex: 0,
      venueKey: 'synthetic-venue',
      locationBasis: 'qr',
      route,
    },
    // Deliberately tempting anchor data. It must never become the drawn facing.
    checkIn: { anchorId: 'test-anchor', headingDegrees: 90 },
    venue: {
      getFloorById: () => ({ name: 'Ground' }),
      buildingPackage: { building: { coordinateSystem: { northOffsetDegrees: -12 } } },
    },
    actions: { setView, prevStep: vi.fn(), nextStep: vi.fn() },
  }),
}));

/** A snapshot as the tracker would publish it at the check-in point, before any stride. */
function anchored(overrides: Partial<TrackerSnapshot> = {}): TrackerSnapshot {
  return {
    tier: 'anchored',
    reason: 'awaiting-departure',
    progressMeters: 0,
    sigmaMeters: 1,
    floorId: 'g',
    headingDegrees: null,
    relativeHeadingDegrees: 0,
    headingEpoch: 1,
    displacementAttached: false,
    walkedSinceAnchorMeters: 0,
    stridesSinceAnchor: 0,
    strideMeters: 0.72,
    lastMotionMs: 0,
    pendingFloor: null,
    moving: true,
    ...overrides,
  };
}

/** The tracking hook's surface, with a snapshot the test controls. */
function trackingLike(status: string, snapshot: TrackerSnapshot | null = null) {
  const tracker = new RouteTracker(trackForRoute(route));
  if (snapshot) tracker.anchor({ progressMeters: 0, sigmaMeters: 1, timeMs: 0 });
  return {
    status,
    snapshot,
    plausible: true,
    start: vi.fn(),
    stop: vi.fn(),
    confirmFloor: vi.fn(),
    peek: () => ({ gravity: null, snapshot }),
    tracker: () => tracker,
  };
}

const stopTrack = vi.fn();

beforeEach(() => {
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
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: stopTrack }] }) },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function orientation(values: Record<string, unknown>, type = 'deviceorientation') {
  const event = new Event(type);
  Object.entries({ timeStamp: performance.now(), ...values }).forEach(([key, value]) =>
    Object.defineProperty(event, key, { value }),
  );
  act(() => window.dispatchEvent(event));
}

const panel = () => screen.getByRole('complementary', { name: 'Guidance readiness' });
const view = () => document.querySelector('.camera-preview')!;

describe('camera guidance never invents a facing', () => {
  it('says nothing is tracked or anchored before tracking starts, and offers to track', async () => {
    const tracking = trackingLike('off');
    render(<CameraPreview tracking={tracking} />);
    await waitFor(() => expect(view().getAttribute('data-ar')).toBe('no'));
    expect(panel().textContent).toContain('Not tracked');
    expect(panel().textContent).toContain('Off');
    expect(panel().textContent).toContain('Not anchored');
    expect(screen.getByRole('status', { name: '' }).textContent).toContain('Not world-anchored');
    expect(view().getAttribute('data-heading-source')).toBe('off');
    expect(screen.queryByRole('button', { name: 'Start AR' })).toBeNull();
    expect(screen.queryByText('90°')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Track my walk' }));
    expect(tracking.start).toHaveBeenCalledTimes(1);
    // The instruction is the banner's, word for word.
    expect(screen.getByText('Go along the corridor')).toBeTruthy();
  });

  it('assumes the visitor looks along the route until they say so, whatever a compass says', () => {
    const tracking = trackingLike('on', anchored());
    render(<CameraPreview tracking={tracking} />);
    expect(panel().textContent).toContain('Assumed along route');
    expect(view().getAttribute('data-heading-source')).toBe('assumed');
    orientation({ webkitCompassHeading: 90, webkitCompassAccuracy: 5, alpha: 270 });
    orientation({ alpha: 270, absolute: true }, 'deviceorientationabsolute');
    expect(view().getAttribute('data-heading-source')).toBe('assumed');
    expect(panel().textContent).not.toContain('aligned');
    fireEvent.click(screen.getByRole('button', { name: 'I’m facing the corridor' }));
    expect(view().getAttribute('data-heading-source')).toBe('aligned');
    expect(panel().textContent).toContain('Gyroscope, aligned by you');
    expect(screen.queryByRole('button', { name: 'I’m facing the corridor' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Re-align' }));
    expect(view().getAttribute('data-heading-source')).toBe('assumed');
  });

  it('drops the visitor’s word once the gyroscope’s zero has been reset', () => {
    const tracking = trackingLike('on', anchored());
    const { rerender } = render(<CameraPreview tracking={tracking} />);
    fireEvent.click(screen.getByRole('button', { name: 'I’m facing the corridor' }));
    expect(view().getAttribute('data-heading-source')).toBe('aligned');
    rerender(<CameraPreview tracking={trackingLike('on', anchored({ headingEpoch: 2 }))} />);
    expect(view().getAttribute('data-heading-source')).toBe('assumed');
    expect(screen.getByRole('button', { name: 'I’m facing the corridor' })).toBeTruthy();
  });

  it('prefers the direction of travel the tracker established by walking', () => {
    render(
      <CameraPreview
        tracking={trackingLike(
          'on',
          anchored({ tier: 'tracking', reason: 'following', headingDegrees: 90 }),
        )}
      />,
    );
    expect(view().getAttribute('data-heading-source')).toBe('tracker');
    expect(panel().textContent).toContain('Gyroscope, aligned by your walk');
    expect(panel().textContent).toContain('Tracking');
    expect(screen.queryByRole('button', { name: 'I’m facing the corridor' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Track my walk' })).toBeNull();
  });

  it('reports a refused sensor permission and offers to try again', () => {
    const tracking = trackingLike('denied');
    render(<CameraPreview tracking={tracking} />);
    expect(panel().textContent).toContain('Off');
    fireEvent.click(screen.getByRole('button', { name: 'Try tracking again' }));
    expect(tracking.start).toHaveBeenCalledTimes(1);
  });

  it('offers an immersive session only where the browser has one, and explains a refusal', async () => {
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) },
      xr: {
        isSessionSupported: async (mode: string) => mode === 'immersive-ar',
        requestSession: async () => {
          throw new DOMException('not here', 'NotAllowedError');
        },
      },
    });
    const tracking = trackingLike('on', anchored());
    render(<CameraPreview tracking={tracking} />);
    const start = await screen.findByRole('button', { name: 'Start AR' });
    expect(view().getAttribute('data-ar')).toBe('available');
    await act(async () => fireEvent.click(start));
    expect(await screen.findByText('The immersive session was not allowed.')).toBeTruthy();
    expect(view().getAttribute('data-ar')).toBe('available');
    // The overlay an immersive session would show holds nothing until one runs.
    expect(document.querySelectorAll('.camera-preview-instruction-text')).toHaveLength(1);
    expect(document.querySelector('.camera-ar-overlay')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('releases the camera on exit and leaves tracking to the map', async () => {
    const tracking = trackingLike('on', anchored());
    const rendered = render(<CameraPreview tracking={tracking} />);
    await act(async () => Promise.resolve());
    fireEvent.click(screen.getByRole('button', { name: 'Exit to plan' }));
    expect(setView).toHaveBeenCalledWith('map');
    rendered.unmount();
    expect(stopTrack).toHaveBeenCalled();
    expect(tracking.stop).not.toHaveBeenCalled();
  });
});
