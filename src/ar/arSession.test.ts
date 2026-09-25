/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Matrix4, type Scene } from 'three';
import { RouteTracker } from '../navigation/liveTracker';
import { buildRouteTrack, type RouteTrack } from '../navigation/routeProgress';
import { startArGuidance } from './arSession';

const gpu = vi.hoisted(() => ({
  loop: null as ((time: number, frame: XRFrame) => void) | null,
  scene: null as Scene | null,
}));
vi.mock('three', async (importOriginal) => ({
  ...(await importOriginal<typeof import('three')>()),
  WebGLRenderer: class {
    xr = {
      enabled: false,
      setReferenceSpaceType() {},
      setSession: async () => {},
      getReferenceSpace: () => ({}),
    };
    setPixelRatio() {}
    setAnimationLoop(loop: typeof gpu.loop) {
      gpu.loop = loop;
    }
    render(scene: Scene) {
      gpu.scene = scene;
    }
    dispose() {}
  },
}));
let now = 1000;
const track = buildRouteTrack(
  [
    { id: 'a', x: 0, y: 0, floor: 'g' },
    { id: 'b', x: 20, y: 0, floor: 'g' },
  ],
  [],
);
beforeEach(() => {
  now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  gpu.loop = null;
  gpu.scene = null;
});
/** Where the phone's ray meets the floor this frame; null when it finds nothing. */
let floorHit: number | null = null;
async function setup(options: { hitTest?: boolean; route?: RouteTrack } = {}) {
  floorHit = null;
  const session = Object.assign(new EventTarget(), {
    requestReferenceSpace: async () => ({}),
    end: vi.fn(async () => {
      session.dispatchEvent(new Event('end'));
    }),
    ...(options.hitTest ? { requestHitTestSource: async () => ({ cancel() {} }) } : {}),
  });
  vi.stubGlobal('navigator', { xr: { requestSession: async () => session } });
  if (options.hitTest) vi.stubGlobal('XRRay', class {});
  const tracker = new RouteTracker(options.route ?? track);
  tracker.anchor({ progressMeters: 0, sigmaMeters: 1, timeMs: now });
  const report = vi.fn();
  const handle = await startArGuidance({
    track: options.route ?? track,
    tracker,
    overlay: document.createElement('div'),
    facingDegrees: () => 90,
    onFrame: report,
  });
  return { tracker, handle, report };
}
function frame(z: number | null, y = 1.4) {
  now += 50;
  gpu.loop?.(now, {
    getViewerPose: () =>
      z === null
        ? null
        : { transform: { matrix: new Matrix4().makeTranslation(0, y, z).elements } },
    getHitTestResults: () =>
      floorHit === null ? [] : [{ getPose: () => ({ transform: { position: { y: floorHit } } }) }],
  } as unknown as XRFrame);
}
/** The phone held still long enough for the route to be placed from it. */
function place(z: number, y = 1.4) {
  for (let index = 0; index < 12; index += 1) frame(z, y);
}
const route = () => gpu.scene?.children[0];

describe('immersive route pose continuity', () => {
  it('does not count a relocalization jump across a missing pose as walking', async () => {
    const { tracker, handle } = await setup();
    place(0);
    frame(null);
    frame(-8);
    expect(tracker.read(now).progressMeters).toBe(0);
    await handle.end();
  });
  it('removes the route immediately when the platform loses its viewer pose', async () => {
    const { handle, report } = await setup();
    place(0);
    frame(null);
    expect(gpu.scene?.children[0].visible).toBe(false);
    expect(report).toHaveBeenLastCalledWith(
      expect.objectContaining({ aligned: false, recovery: 'pose-lost' }),
    );
    await handle.end();
  });
  it('resumes from a new pose baseline only after explicit re-alignment', async () => {
    const { tracker, handle } = await setup();
    place(0);
    frame(null);
    frame(-8);
    handle.realign();
    place(-8);
    expect(tracker.read(now).progressMeters).toBe(0);
    // A metre at walking pace, a frame at a time; a metre in one frame is a jump.
    for (let z = -8.05; z >= -9.001; z -= 0.05) frame(z);
    expect(tracker.read(now).progressMeters).toBeCloseTo(1, 1);
    await handle.end();
  });

  it('does not count a jump the platform never flagged as walking', async () => {
    // Eight metres in fifty milliseconds with a valid pose either side of it.
    const { tracker, handle, report } = await setup();
    place(0);
    frame(-8);
    expect(tracker.read(now).progressMeters).toBe(0);
    expect(gpu.scene?.children[0].visible).toBe(false);
    expect(report).toHaveBeenLastCalledWith(
      expect.objectContaining({ aligned: false, recovery: 'pose-lost' }),
    );
    await handle.end();
  });

  it('does not count a slow-looking jump across a long gap in frames', async () => {
    const { tracker, handle } = await setup();
    place(0);
    now += 10_000; // the session stalled; eight metres over ten seconds is not a walk seen
    frame(-8);
    expect(tracker.read(now).progressMeters).toBe(0);
    expect(gpu.scene?.children[0].visible).toBe(false);
    await handle.end();
  });

  it('offers pose recovery when the tracker rejects small but implausibly fast movements', async () => {
    const { tracker, handle, report } = await setup();
    place(0);
    // Each change is below the session's large-jump threshold, but the
    // tracker's independent speed check must still reach the recovery UI.
    frame(-0.4);
    frame(-0.8);
    const heldProgress = tracker.read(now).progressMeters;
    expect(gpu.scene?.children[0].visible).toBe(false);
    expect(report).toHaveBeenLastCalledWith(
      expect.objectContaining({ aligned: false, recovery: 'pose-lost' }),
    );
    frame(-2);
    expect(tracker.read(now).progressMeters).toBe(heldProgress);
    handle.realign();
    place(-2);
    for (let index = 1; index <= 20; index += 1) frame(-2 - index * 0.05);
    expect(tracker.read(now).progressMeters).toBeCloseTo(heldProgress + 1, 1);
    expect(gpu.scene?.children[0].visible).toBe(true);
    await handle.end();
  });
  it('waits for the platform to find the room without calling it lost', async () => {
    const { handle, report } = await setup();
    // Every session starts like this: no pose while the platform finds its bearings.
    frame(null);
    frame(null);
    expect(report).toHaveBeenLastCalledWith(
      expect.objectContaining({ aligned: false, recovery: null, placement: 'tracking' }),
    );
    place(0);
    // No re-align was needed: nothing had been placed, so nothing was lost.
    expect(report).toHaveBeenLastCalledWith(
      expect.objectContaining({ aligned: true, recovery: null, placement: null }),
    );
    expect(route()?.visible).toBe(true);
    await handle.end();
  });

  it('places the route only from a phone held still', async () => {
    const { tracker, handle, report } = await setup();
    // Swung about while the session starts: each pose is somewhere new.
    for (let index = 0; index < 20; index += 1) frame(index * 0.2);
    expect(report).toHaveBeenLastCalledWith(
      expect.objectContaining({ aligned: false, placement: 'steady' }),
    );
    expect(route()?.visible).toBe(false);
    place(4);
    expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ aligned: true }));
    // Placed where it was held, and none of the swinging counted as walking.
    expect(tracker.read(now).progressMeters).toBe(0);
    await handle.end();
  });

  it('waits for the floor to be found, then lays the route on it', async () => {
    const { handle, report } = await setup({ hitTest: true });
    place(0);
    expect(report).toHaveBeenLastCalledWith(
      expect.objectContaining({ aligned: false, placement: 'floor', floorHits: 0 }),
    );
    floorHit = -0.12;
    frame(0);
    expect(report).toHaveBeenLastCalledWith(
      expect.objectContaining({ aligned: true, floorY: -0.12, floorHits: 1 }),
    );
    expect(route()?.position.y).toBeCloseTo(-0.12, 5);
    await handle.end();
  });

  it('uses the platform’s own floor where none is found in fair time', async () => {
    const { handle, report } = await setup({ hitTest: true });
    for (let index = 0; index < 100; index += 1) frame(0);
    expect(report).toHaveBeenLastCalledWith(
      expect.objectContaining({ aligned: true, floorY: 0, floorHits: 0 }),
    );
    await handle.end();
  });

  it('finds the floor again on the storey a lift reaches', async () => {
    // Ten metres east on the ground floor, a lift, then ten more upstairs.
    const upstairs = buildRouteTrack(
      [
        { id: 'a', x: 0, y: 0, floor: 'g' },
        { id: 'lift-g', x: 10, y: 0, floor: 'g' },
        { id: 'lift-1', x: 10, y: 0, floor: '1' },
        { id: 'c', x: 20, y: 0, floor: '1' },
      ],
      [],
    );
    const { tracker, handle, report } = await setup({ hitTest: true, route: upstairs });
    floorHit = 0;
    place(0);
    // Walk to the lift at walking pace: plan east is the way the phone faced.
    for (let z = -0.05; z >= -10.4; z -= 0.05) frame(z);
    expect(tracker.read(now).reason).toBe('floor-change');
    expect(route()?.visible).toBe(false);
    // Four metres up; the platform kept tracking through the ride.
    tracker.confirmFloor(now);
    handle.realign();
    floorHit = 4;
    place(-10.4, 5.4);
    expect(report).toHaveBeenLastCalledWith(
      // Every hit on the new floor was accepted, from the first.
      expect.objectContaining({ aligned: true, floorY: 4 }),
    );
    expect(route()?.visible).toBe(true);
    await handle.end();
  });

  it('keeps a genuinely observed stationary pose fresh without inventing movement', async () => {
    const { tracker, handle } = await setup();
    place(0);
    for (let index = 0; index < 400; index += 1) frame(0);
    expect(tracker.read(now).lastMotionMs).toBe(now);
    expect(tracker.read(now).progressMeters).toBe(0);
    expect(gpu.scene?.children[0].visible).toBe(true);
    await handle.end();
  });
});
