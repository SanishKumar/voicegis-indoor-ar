/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphNode, RouteStep } from '../engine/routingCore';
import type { TrackerSnapshot } from '../navigation/liveTracker';
import { RouteTracker } from '../navigation/liveTracker';
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

/* Twenty metres east along a corridor: plan bearing 90 the whole way. */
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
      destinationNodeId: 'poi:desk',
      route,
    },
    // Deliberately tempting anchor data. It must never become the drawn facing.
    checkIn: { anchorId: 'test-anchor', headingDegrees: 90 },
    venue: {
      getFloorById: () => ({ name: 'Ground' }),
      getNodeById: () => ({ poi: { name: 'The Desk' } }),
      config: { walkSpeedMps: 1.2 },
      buildingPackage: {
        building: { coordinateSystem: { northOffsetDegrees: -12 } },
        floors: [{ id: 'g', outline: [] }],
        spaces: [],
        pois: [{ id: 'shop', name: 'Shop', floorId: 'g', position: [6, 3], public: true }],
      },
    },
    actions: { setView, prevStep: vi.fn(), nextStep: vi.fn() },
  }),
}));

/** A snapshot as the tracker would publish it at the check-in point. */
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
/*
 * The view's whole job is what it paints each frame, so the canvas answers
 * like a real one and frames are run by hand. Mocking the context away, as
 * this suite used to, let a crash inside the draw loop pass every test.
 */
const painted: string[] = [];
let frames: FrameRequestCallback[] = [];
let clock = 1_000;

function stubContext() {
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      painted.push(`${name}(${args.length})`);
    };
  return new Proxy(
    {
      canvas: null,
      createLinearGradient: () => ({ addColorStop: () => {} }),
      measureText: () => ({ width: 10 }),
    } as Record<string, unknown>,
    {
      get(target, property) {
        if (property in target) return target[property as string];
        return record(String(property));
      },
      set() {
        return true;
      },
    },
  );
}

/**
 * Run the animation callbacks queued so far, as a browser would, with time
 * passing between them: the view publishes what it drew a few times a second
 * rather than on every frame, so frames that all happen at once publish once.
 */
function runFrames(count = 2) {
  for (let index = 0; index < count; index += 1) {
    clock += 250;
    const queued = frames;
    frames = [];
    act(() => {
      for (const callback of queued) callback(performance.now());
    });
  }
}

beforeEach(() => {
  painted.length = 0;
  frames = [];
  clock = 1_000;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('DeviceOrientationEvent', class {});
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal('isSecureContext', true);
  // jsdom lays nothing out, and a canvas of no size projects nothing.
  for (const [name, value] of [
    ['clientWidth', 360],
    ['clientHeight', 720],
  ] as const) {
    vi.spyOn(HTMLCanvasElement.prototype, name, 'get').mockReturnValue(value);
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => stubContext() as unknown as CanvasRenderingContext2D,
  );
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: stopTrack }] }) },
    permissions: { query: async () => ({ state: 'granted' }) },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

/** An orientation event as a phone held upright, turned this far from alpha's zero. */
function orientation(values: Record<string, unknown>, type = 'deviceorientation') {
  const event = new Event(type);
  Object.entries({ timeStamp: performance.now(), ...values }).forEach(([key, value]) =>
    Object.defineProperty(event, key, { value }),
  );
  act(() => {
    window.dispatchEvent(event);
  });
}
const upright = (alpha: number) => orientation({ alpha, beta: 90, gamma: 0 });

const panel = () => screen.getByRole('complementary', { name: 'Guidance readiness' });
const view = () => document.querySelector('.camera-preview')!;
const facing = () => Number(view().getAttribute('data-facing'));
const note = () => document.querySelector('.camera-preview-note')?.textContent ?? '';

describe('the camera view follows where the phone points', () => {
  it('paints the route on the floor rather than a fixed picture on the glass', () => {
    render(<CameraPreview tracking={trackingLike('off')} />);
    upright(0);
    runFrames();
    // A ribbon of floor points, drawn - the crash this guards against left none.
    expect(Number(view().getAttribute('data-ribbon'))).toBeGreaterThan(5);
    expect(painted.some((call) => call.startsWith('fill('))).toBe(true);
    expect(painted.some((call) => call.startsWith('stroke('))).toBe(true);
  });

  it('turns the drawn route by exactly the angle the phone was turned', () => {
    render(<CameraPreview tracking={trackingLike('off')} />);
    upright(0);
    runFrames();
    expect(view().getAttribute('data-heading-source')).toBe('assumed');
    // The zero is assumed to be the route's own bearing where the visitor stands.
    expect(facing()).toBe(90);
    upright(40);
    runFrames();
    expect(facing()).toBe(50);
    upright(330);
    runFrames();
    expect(facing()).toBe(120);
  });

  it('knows nothing of the facing until the phone says, and admits it', () => {
    render(<CameraPreview tracking={trackingLike('off')} />);
    runFrames();
    expect(view().getAttribute('data-heading-source')).toBe('off');
    expect(panel().textContent).toContain('Not known');
    expect(note()).toContain('not saying which way it is pointing');
  });

  it('never takes a compass reading for the facing', () => {
    render(<CameraPreview tracking={trackingLike('off')} />);
    upright(0);
    runFrames();
    const before = facing();
    // A reading with a heading but no orientation angles describes no attitude.
    orientation({ webkitCompassHeading: 270, webkitCompassAccuracy: 5 });
    orientation({ alpha: 200, absolute: true }, 'deviceorientationabsolute');
    runFrames();
    expect(facing()).toBe(before);
    expect(view().getAttribute('data-heading-source')).toBe('assumed');
  });

  it('lets the visitor fix the zero, and offers to set it again', () => {
    render(<CameraPreview tracking={trackingLike('off')} />);
    upright(60);
    runFrames();
    expect(view().getAttribute('data-heading-source')).toBe('assumed');
    fireEvent.click(screen.getByRole('button', { name: 'I’m facing the corridor' }));
    upright(60);
    runFrames();
    expect(view().getAttribute('data-heading-source')).toBe('aligned');
    expect(facing()).toBe(90);
    expect(panel().textContent).toContain('Set by you');
    // A quarter turn still turns the route, from the zero the visitor set.
    upright(330);
    runFrames();
    expect(facing()).toBe(180);
    fireEvent.click(screen.getByRole('button', { name: 'Re-align' }));
    upright(330);
    runFrames();
    expect(view().getAttribute('data-heading-source')).toBe('assumed');
  });

  it('prefers the direction of travel the tracker learned by watching a walk', () => {
    render(
      <CameraPreview
        tracking={trackingLike(
          'on',
          anchored({ tier: 'tracking', reason: 'following', headingDegrees: 123 }),
        )}
      />,
    );
    upright(0);
    runFrames();
    expect(view().getAttribute('data-heading-source')).toBe('tracker');
    expect(facing()).toBe(123);
    expect(panel().textContent).toContain('From your walk');
    expect(screen.queryByRole('button', { name: 'I’m facing the corridor' })).toBeNull();
  });

  it('asks before reading the orientation where the platform requires it', () => {
    const request = vi.fn().mockResolvedValue('granted');
    vi.stubGlobal(
      'DeviceOrientationEvent',
      class {
        static requestPermission = request;
      },
    );
    render(<CameraPreview tracking={trackingLike('off')} />);
    runFrames();
    expect(note()).toContain('Turn the AR view on');
    fireEvent.click(screen.getByRole('button', { name: 'Turn on AR view' }));
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('says nothing is tracked or anchored before tracking starts, and offers to track', async () => {
    const tracking = trackingLike('off');
    render(<CameraPreview tracking={tracking} />);
    await waitFor(() => expect(view().getAttribute('data-ar')).toBe('no'));
    expect(panel().textContent).toContain('Not tracked');
    expect(panel().textContent).toContain('Not anchored');
    expect(document.querySelector('.camera-preview-status')!.textContent).toContain(
      'Not world-anchored',
    );
    expect(screen.queryByRole('button', { name: 'Start AR' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Track my walk' }));
    expect(tracking.start).toHaveBeenCalledTimes(1);
    // The instruction is the banner's, word for word.
    expect(screen.getByText('Go along the corridor')).toBeTruthy();
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
    render(<CameraPreview tracking={trackingLike('on', anchored())} />);
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
