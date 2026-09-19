/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Matrix4, type Scene } from 'three';
import { RouteTracker } from '../navigation/liveTracker';
import { buildRouteTrack } from '../navigation/routeProgress';
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
async function setup() {
  const session = Object.assign(new EventTarget(), {
    requestReferenceSpace: async () => ({}),
    end: vi.fn(async () => {
      session.dispatchEvent(new Event('end'));
    }),
  });
  vi.stubGlobal('navigator', { xr: { requestSession: async () => session } });
  const tracker = new RouteTracker(track);
  tracker.anchor({ progressMeters: 0, sigmaMeters: 1, timeMs: now });
  const report = vi.fn();
  const handle = await startArGuidance({
    track,
    tracker,
    overlay: document.createElement('div'),
    facingDegrees: () => 90,
    onFrame: report,
  });
  return { tracker, handle, report };
}
function frame(z: number | null) {
  now += 50;
  gpu.loop?.(now, {
    getViewerPose: () =>
      z === null
        ? null
        : { transform: { matrix: new Matrix4().makeTranslation(0, 1.4, z).elements } },
  } as unknown as XRFrame);
}

describe('immersive route pose continuity', () => {
  it('does not count a relocalization jump across a missing pose as walking', async () => {
    const { tracker, handle } = await setup();
    frame(0);
    frame(null);
    frame(-8);
    expect(tracker.read(now).progressMeters).toBe(0);
    await handle.end();
  });
  it('removes the route immediately when the platform loses its viewer pose', async () => {
    const { handle, report } = await setup();
    frame(0);
    frame(null);
    expect(gpu.scene?.children[0].visible).toBe(false);
    expect(report).toHaveBeenLastCalledWith(
      expect.objectContaining({ aligned: false, recovery: 'pose-lost' }),
    );
    await handle.end();
  });
  it('resumes from a new pose baseline only after explicit re-alignment', async () => {
    const { tracker, handle } = await setup();
    frame(0);
    frame(null);
    frame(-8);
    handle.realign();
    frame(-8);
    expect(tracker.read(now).progressMeters).toBe(0);
    frame(-9);
    expect(tracker.read(now).progressMeters).toBeCloseTo(1);
    await handle.end();
  });
  it('keeps a genuinely observed stationary pose fresh without inventing movement', async () => {
    const { tracker, handle } = await setup();
    frame(0);
    for (let index = 0; index < 400; index += 1) frame(0);
    expect(tracker.read(now).lastMotionMs).toBe(now);
    expect(tracker.read(now).progressMeters).toBe(0);
    expect(gpu.scene?.children[0].visible).toBe(true);
    await handle.end();
  });
});
