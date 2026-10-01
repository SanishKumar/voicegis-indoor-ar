/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Matrix4, type Scene } from 'three';
import { RouteTracker } from '../navigation/liveTracker';
import { buildRouteTrack, type RouteTrack } from '../navigation/routeProgress';
import { VenuePoseGuard } from '../navigation/venuePoseGuard';
import { startArGuidance, type ArGuidanceOptions } from './arSession';

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
let confirmSurface: () => boolean;
let floorNormal = new Matrix4();
async function setup(
  options: {
    hitTest?: boolean;
    floor?: number | null;
    route?: RouteTrack;
    facing?: () => number | null;
    venueGuard?: VenuePoseGuard;
    isRouteCurrent?: () => boolean;
    graphicAllowed?: ArGuidanceOptions['graphicAllowed'];
  } = {},
) {
  floorHit = options.floor === undefined ? 0 : options.floor;
  floorNormal = new Matrix4();
  const hitTest = options.hitTest !== false;
  const session = Object.assign(new EventTarget(), {
    requestReferenceSpace: async () => ({}),
    end: vi.fn(async () => {
      session.dispatchEvent(new Event('end'));
    }),
    ...(hitTest ? { requestHitTestSource: async () => ({ cancel() {} }) } : {}),
  });
  const requestSession = vi.fn(async () => session);
  vi.stubGlobal('navigator', { xr: { requestSession } });
  if (hitTest) vi.stubGlobal('XRRay', class {});
  const tracker = new RouteTracker(options.route ?? track, {}, options.venueGuard);
  tracker.anchor({ progressMeters: 0, sigmaMeters: 1, timeMs: now });
  const report = vi.fn();
  const handle = await startArGuidance({
    track: options.route ?? track,
    tracker,
    overlay: document.createElement('div'),
    facingDegrees: options.facing ?? (() => 90),
    onFrame: report,
    isRouteCurrent: options.isRouteCurrent,
    graphicAllowed: options.graphicAllowed,
  });
  confirmSurface = handle.confirmSurface;
  return { tracker, handle, report, requestSession, session };
}
function frame(z: number | null, y = 1.4, x = 0) {
  now += 50;
  gpu.loop?.(now, {
    getViewerPose: () =>
      z === null
        ? null
        : { transform: { matrix: new Matrix4().makeTranslation(x, y, z).elements } },
    getHitTestResults: () =>
      floorHit === null
        ? []
        : [
            {
              getPose: () => ({
                transform: {
                  position: { y: floorHit },
                  matrix: floorNormal.clone().setPosition(0, floorHit ?? 0, (z ?? 0) - 1).elements,
                },
              }),
            },
          ],
  } as unknown as XRFrame);
}
/** The phone held still long enough for the route to be placed from it. */
function hold(z: number, y = 1.4) {
  for (let index = 0; index < 12; index += 1) frame(z, y);
}
function place(z: number, y = 1.4) {
  hold(z, y);
  expect(confirmSurface()).toBe(true);
  frame(z, y);
}
const route = () => gpu.scene?.children[0];

describe('immersive route pose continuity', () => {
  it('withholds rejected full glyphs and the destination disc while preserving physical tracking', async () => {
    const allowed = vi.fn<NonNullable<ArGuidanceOptions['graphicAllowed']>>(
      (point, _bearing, kind) => kind === 'chevron' && point.x < 5,
    );
    const { tracker, report } = await setup({ graphicAllowed: allowed });
    place(0);
    expect(allowed).toHaveBeenCalledWith(
      expect.objectContaining({ x: 1.5, floor: 'g' }),
      90,
      'chevron',
    );
    expect(allowed).toHaveBeenCalledWith(expect.objectContaining({ x: 20 }), 90, 'destination');
    expect(route()?.children).toHaveLength(3);
    expect(report.mock.lastCall?.[0].withheldGraphics).toBeGreaterThan(0);
    expect(tracker.read(now).progressMeters).toBe(0);
    expect(tracker.read(now).displacementAttached).toBe(true);
    frame(-0.1);
    frame(-0.2);
    frame(-0.3);
    expect(tracker.read(now).progressMeters).toBeGreaterThan(0);
  });
  it('retires a stale policy before drawing or counting its next pose frame', async () => {
    let current = true;
    const { tracker, session } = await setup({ isRouteCurrent: () => current });
    place(0);
    const geometry = route();
    expect(geometry?.visible).toBe(true);
    const displacement = vi.spyOn(tracker, 'displace');
    const before = tracker.read(now).progressMeters;
    current = false;
    frame(-0.5);
    expect(geometry?.visible).toBe(false);
    expect(displacement).not.toHaveBeenCalled();
    expect(tracker.read(now).progressMeters).toBe(before);
    expect(session.end).toHaveBeenCalledOnce();
    expect(gpu.loop).toBeNull();
  });
  it('does not request an immersive session for an already stale route', async () => {
    const requestSession = vi.fn();
    vi.stubGlobal('navigator', { xr: { requestSession } });
    await expect(
      startArGuidance({
        track,
        tracker: new RouteTracker(track),
        overlay: document.createElement('div'),
        facingDegrees: () => 90,
        isRouteCurrent: () => false,
      }),
    ).rejects.toMatchObject({ reason: 'ended' });
    expect(requestSession).not.toHaveBeenCalled();
  });
  it('ends a session whose permission request resolves after route ownership was lost', async () => {
    let current = true;
    let grant!: (session: unknown) => void;
    const session = { end: vi.fn(async () => {}) };
    vi.stubGlobal('navigator', {
      xr: {
        requestSession: () =>
          new Promise((resolve) => {
            grant = resolve;
          }),
      },
    });
    const tracker = new RouteTracker(track);
    const attach = vi.spyOn(tracker, 'attachDisplacement');
    const pending = startArGuidance({
      track,
      tracker,
      overlay: document.createElement('div'),
      facingDegrees: () => 90,
      isRouteCurrent: () => current,
    });
    current = false;
    grant(session);
    await expect(pending).rejects.toMatchObject({ reason: 'ended' });
    expect(session.end).toHaveBeenCalledOnce();
    expect(attach).not.toHaveBeenCalled();
    expect(gpu.loop).toBeNull();
  });
  it('keeps the drawn route with 20 cm sway in real frame batching', async () => {
    const long = buildRouteTrack(
      [
        { id: 'a', x: 0, y: 0, floor: 'g' },
        { id: 'b', x: 100, y: 0, floor: 'g' },
      ],
      [],
    );
    const { tracker, handle, report } = await setup({ route: long, facing: () => 105 });
    place(0);
    for (let i = 1; i <= 1100; i += 1) {
      const d = i * 0.05;
      frame(-d, 1.4, 0.2 * Math.sin((d * 2 * Math.PI) / 1.3));
    }
    expect(tracker.read(now)).toMatchObject({ tier: 'tracking', reason: 'following' });
    expect(Math.abs(tracker.poseCorrection().biasDegrees - 15)).toBeLessThan(1);
    expect(report).toHaveBeenLastCalledWith(
      expect.objectContaining({ headingCorrectionState: 'locked' }),
    );
    expect(route()?.visible).toBe(true);
    await handle.end();
  });

  it.each([3, 8])(
    'does not redraw a settled route to absorb a %s degree departure',
    async (turn) => {
      const long = buildRouteTrack(
        [
          { id: 'a', x: 0, y: 0, floor: 'g' },
          { id: 'b', x: 100, y: 0, floor: 'g' },
        ],
        [],
      );
      const { tracker, handle } = await setup({ route: long });
      place(0);
      for (let i = 1; i <= 240; i += 1) frame(-i * 0.05);
      expect(tracker.poseCorrection().state).toBe('locked');
      const before = tracker.poseCorrection();
      const angle = (turn * Math.PI) / 180;
      for (let i = 1; i <= 1200; i += 1)
        frame(-12 - i * 0.05 * Math.cos(angle), 1.4, i * 0.05 * Math.sin(angle));
      expect(tracker.read(now)).toMatchObject({ tier: 'frozen', reason: 'off-route' });
      expect(tracker.poseCorrection()).toMatchObject({
        biasDegrees: before.biasDegrees,
        epoch: before.epoch,
      });
      expect(route()?.visible).toBe(false);
      await handle.end();
    },
  );
  it('hides a competing venue path and cannot recover it by replacing the floor', async () => {
    const nodes = [...track.points, { id: 'branch', x: 20, y: 7, floor: 'g' }].map((node) => ({
      ...node,
      type: 'junction',
    }));
    const venueGuard = new VenuePoseGuard(nodes, [
      { from: 'a', to: 'b', distance: 20 },
      { from: 'a', to: 'branch', distance: Math.hypot(20, 7) },
    ]);
    const { tracker, handle, report } = await setup({ venueGuard });
    place(0);
    for (let i = 1; i <= 80; i += 1) frame(-i * 0.047, 1.4, i * 0.01645);
    expect(tracker.read(now)).toMatchObject({ reason: 'ambiguous-position', canStartPose: false });
    expect(tracker.poseCorrection()).toMatchObject({ state: 'learning', biasDegrees: 0 });
    expect(route()?.visible).toBe(false);
    frame(null);
    handle.realign();
    place(0);
    expect(route()?.visible).toBe(false);
    expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ aligned: false }));
    expect(tracker.read(now).reason).toBe('ambiguous-position');
    await handle.end();
  });
  it('does not rotate the drawn route to follow a later shallow departure', async () => {
    const { tracker, handle, report } = await setup();
    place(0);
    expect(report).toHaveBeenLastCalledWith(
      expect.objectContaining({ headingCorrectionState: 'learning' }),
    );
    for (let i = 1; i <= 120; i += 1) frame(-i * 0.05); // Six metres straight.
    const bias = tracker.poseCorrection().biasDegrees;
    const epoch = tracker.poseCorrection().epoch;
    expect(report).toHaveBeenLastCalledWith(
      expect.objectContaining({ headingCorrectionState: 'settling', headingCorrectionDegrees: 0 }),
    );
    const angle = (20 * Math.PI) / 180;
    for (let i = 1; i <= 140; i += 1) {
      frame(-6 - i * 0.05 * Math.cos(angle), 1.4, i * 0.05 * Math.sin(angle));
    }
    expect(tracker.read(now)).toMatchObject({ tier: 'frozen', reason: 'off-route' });
    expect(tracker.poseCorrection().biasDegrees).toBeCloseTo(bias, 6);
    expect(tracker.poseCorrection().epoch).toBe(epoch);
    expect(route()?.visible).toBe(false);
    await handle.end();
  });
  it('straightens the drawn route as walking shows the placement direction was off', async () => {
    // Placed believing the camera looked 15 degrees further round than it did.
    const { tracker, handle } = await setup({ facing: () => 105 });
    place(0);
    const sideways = () =>
      Math.max(...(route()?.children ?? []).map((child) => Math.abs(child.position.x)));
    // The arrows ahead lean off the line the visitor is about to walk.
    expect(sideways()).toBeGreaterThan(1);
    // Straight down the corridor at walking pace.
    for (let z = -0.05; z >= -8.001; z -= 0.05) frame(z);
    expect(tracker.read(now)).toMatchObject({ reason: 'following' });
    expect(tracker.poseCorrection().biasDegrees).toBeCloseTo(15, 0);
    // Now drawn along the corridor actually walked, straight down -z.
    expect(sideways()).toBeLessThan(0.4);
    expect(route()?.visible).toBe(true);
    await handle.end();
  });

  it('hides an off-route walk and cannot re-place it by re-confirming the floor', async () => {
    const { tracker, handle, report } = await setup();
    place(0);
    // Facing east: camera-right is south on the plan. Walk two metres
    // sideways at 1 m/s; this is a valid pose stream, not a platform jump.
    for (let i = 1; i <= 40; i += 1) frame(0, 1.4, i * 0.05);
    expect(tracker.read(now)).toMatchObject({
      reason: 'off-route',
      progressMeters: 0,
      canStartPose: false,
    });
    expect(route()?.visible).toBe(false);
    frame(null);
    expect(tracker.read(now).reason).toBe('off-route');
    handle.realign();
    place(0);
    expect(route()?.visible).toBe(false);
    expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ aligned: false }));
    expect(tracker.read(now).reason).toBe('off-route');
    await handle.end();
  });
  it('reports a missing building heading after confirming a real floor', async () => {
    const { handle, report } = await setup({ facing: () => null });
    place(0);
    expect(route()?.visible).toBe(false);
    expect(report).toHaveBeenLastCalledWith(
      expect.objectContaining({
        aligned: false,
        placement: 'heading',
        floorY: 0,
      }),
    );
    await handle.end();
  });

  it('re-alignment never substitutes the route bearing for a missing heading', async () => {
    let facing: number | null = 270; // Looking opposite the eastbound route.
    const { handle, report, tracker } = await setup({ facing: () => facing });
    place(0);
    expect(tracker.read(now).headingDegrees).toBe(270);
    frame(null);
    facing = null;
    handle.realign();
    place(0);
    expect(route()?.visible).toBe(false);
    expect(report).toHaveBeenLastCalledWith(
      expect.objectContaining({
        aligned: false,
        placement: 'heading',
      }),
    );
    await handle.end();
  });
  it('requires the overlay that makes surface confirmation and exit reachable', async () => {
    const { handle, requestSession } = await setup();
    expect(requestSession).toHaveBeenCalledWith(
      'immersive-ar',
      expect.objectContaining({
        requiredFeatures: expect.arrayContaining(['dom-overlay']),
      }),
    );
    await handle.end();
  });
  it.each(['reference-space', 'hit-test'] as const)(
    'does not attach an already-ended session while waiting for %s setup',
    async (stage) => {
      const session = Object.assign(new EventTarget(), {
        requestReferenceSpace: async () => {
          if (stage === 'reference-space') session.dispatchEvent(new Event('end'));
          return {};
        },
        requestHitTestSource: async () => {
          if (stage === 'hit-test') session.dispatchEvent(new Event('end'));
          return { cancel: vi.fn() };
        },
        end: async () => session.dispatchEvent(new Event('end')),
      });
      vi.stubGlobal('navigator', { xr: { requestSession: async () => session } });
      vi.stubGlobal('XRRay', class {});
      const tracker = new RouteTracker(track);
      tracker.anchor({ progressMeters: 0, sigmaMeters: 1, timeMs: now });
      const onEnd = vi.fn();
      await expect(
        startArGuidance({
          track,
          tracker,
          overlay: document.createElement('div'),
          facingDegrees: () => 90,
          onEnd,
        }),
      ).rejects.toMatchObject({ reason: 'ended' });
      expect(tracker.read(now).displacementAttached).toBe(false);
      expect(gpu.loop).toBeNull();
      expect(onEnd).toHaveBeenCalledTimes(1);
    },
  );

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
    const { handle, report } = await setup({ floor: null });
    hold(0);
    expect(report).toHaveBeenLastCalledWith(
      expect.objectContaining({ aligned: false, placement: 'floor', floorHits: 0 }),
    );
    floorHit = -0.12;
    hold(0);
    expect(report).toHaveBeenLastCalledWith(
      expect.objectContaining({ aligned: false, placement: 'floor-confirm', floorY: null }),
    );
    expect(route()?.visible).toBe(false);
    expect(handle.confirmSurface()).toBe(true);
    frame(0);
    expect(report).toHaveBeenLastCalledWith(
      expect.objectContaining({ aligned: true, floorY: -0.12 }),
    );
    expect(route()?.position.y).toBeCloseTo(-0.12, 5);
    await handle.end();
  });

  it('never places the route on an estimated floor after waiting for hits', async () => {
    const { handle, report } = await setup({ floor: null });
    for (let index = 0; index < 100; index += 1) frame(0);
    expect(report).toHaveBeenLastCalledWith(
      expect.objectContaining({ aligned: false, placement: 'floor', floorHits: 0 }),
    );
    expect(route()?.visible).toBe(false);
    await handle.end();
  });

  it('withholds the route when surface detection is unavailable', async () => {
    const { handle, report } = await setup({ hitTest: false });
    for (let index = 0; index < 100; index += 1) frame(0);
    expect(report).toHaveBeenLastCalledWith(
      expect.objectContaining({ aligned: false, placement: 'floor-unavailable' }),
    );
    expect(route()?.visible).toBe(false);
    await handle.end();
  });

  it('does not call a single surface observation a confirmed floor', async () => {
    const { handle, report } = await setup({ floor: null });
    hold(0);
    floorHit = -0.12;
    frame(0);
    expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ aligned: false }));
    expect(route()?.visible).toBe(false);
    await handle.end();
  });

  it('rejects a wall even when its hit height looks like the floor', async () => {
    const { handle, report } = await setup();
    floorNormal.makeRotationX(Math.PI / 2);
    for (let index = 0; index < 100; index += 1) frame(0);
    expect(handle.confirmSurface()).toBe(false);
    expect(report).toHaveBeenLastCalledWith(
      expect.objectContaining({ aligned: false, placement: 'floor', floorHits: 0, floorY: null }),
    );
    expect(gpu.scene?.children[1].visible).toBe(false);
    await handle.end();
  });

  it('shows a surface target, requires confirmation, and never lifts the route onto later hits', async () => {
    const { handle, report } = await setup({ floor: -0.12 });
    hold(0);
    expect(route()?.visible).toBe(false);
    expect(gpu.scene?.children[1].visible).toBe(true);
    expect(handle.confirmSurface()).toBe(true);
    frame(0);
    expect(route()?.visible).toBe(true);
    expect(gpu.scene?.children[1].visible).toBe(false);
    floorHit = 0.65; // Looking at a table must not drag the floor upwards.
    hold(0);
    expect(route()?.position.y).toBeCloseTo(-0.12);
    expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ floorY: -0.12 }));
    await handle.end();
  });

  it('requires a new floor observation and confirmation after pose recovery', async () => {
    const { handle, report } = await setup();
    place(0);
    frame(null);
    handle.realign();
    floorHit = null;
    for (let index = 0; index < 100; index += 1) frame(0);
    expect(handle.confirmSurface()).toBe(false);
    expect(report).toHaveBeenLastCalledWith(
      expect.objectContaining({ aligned: false, placement: 'floor', floorY: null }),
    );
    floorHit = -0.2;
    place(0);
    expect(route()?.position.y).toBeCloseTo(-0.2);
    await handle.end();
  });

  it('rejects a stale confirmation and clears an unplaced confirmation across a frame gap', async () => {
    const { handle, report } = await setup();
    hold(0);
    now += 500;
    expect(handle.confirmSurface()).toBe(false);
    expect(report).toHaveBeenLastCalledWith(
      expect.objectContaining({ placement: 'floor', aligned: false }),
    );
    expect(gpu.scene?.children[1].visible).toBe(false);
    hold(0);
    expect(handle.confirmSurface()).toBe(true);
    now += 500;
    frame(0);
    expect(route()?.visible).toBe(false);
    expect(handle.confirmSurface()).toBe(false);
    await handle.end();
    expect(handle.confirmSurface()).toBe(false);
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
