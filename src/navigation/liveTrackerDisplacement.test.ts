import { describe, expect, it } from 'vitest';
import type { GraphNode, RouteStep } from '../engine/routingCore';
import { RouteTracker } from './liveTracker';
import { buildRouteTrack } from './routeProgress';

const node = (id: string, x: number, y: number, floor = 'g'): GraphNode => ({
  id,
  x,
  y,
  floor,
  type: 'junction',
});
const step = (type: RouteStep['type'], nodeId: string): RouteStep => ({
  type,
  instruction: type,
  distance: 0,
  nodeId,
  bearing: 0,
});

/* An L on one floor: 20 m east, a right turn, 12 m south. */
const corner = buildRouteTrack(
  [node('a', 0, 0), node('b', 20, 0), node('c', 20, 12)],
  [step('start', 'a'), step('turn_right', 'b'), step('arrive', 'c')],
);
/* 10 m east to a lift, one storey up, then 8 m east upstairs. */
const lifted = buildRouteTrack(
  [node('a', 0, 0), node('lift-g', 10, 0), node('lift-1', 10, 0, 'l1'), node('d', 18, 0, 'l1')],
  [step('start', 'a'), step('elevator', 'lift-g'), step('arrive', 'd')],
);

const GRAVITY = 9.81;
const SAMPLE_MS = 20;

/** A tracker anchored at the start of a route with a pose attached. */
function attached(track = corner) {
  const tracker = new RouteTracker(track);
  tracker.anchor({ progressMeters: 0, sigmaMeters: 1, timeMs: 0 });
  tracker.attachDisplacement(0);
  return tracker;
}

/** Pose movement in half-metre reports, `count` of them, in a plan direction. */
function move(
  tracker: RouteTracker,
  count: number,
  [dx, dy]: [number, number],
  fromMs = 0,
  everyMs = 200,
) {
  let t = fromMs;
  for (let index = 0; index < count; index += 1) {
    t += everyMs;
    tracker.displace({ dxMeters: dx, dyMeters: dy, timeMs: t });
  }
  return t;
}

/** Footfalls with the phone held level and not turning. */
function strides(tracker: RouteTracker, count: number, fromMs: number) {
  let t = fromMs;
  const sample = (magnitude: number) => {
    tracker.motion({ timeMs: t, accelerationMagnitude: magnitude, headingRateDegreesPerSecond: 0 });
    t += SAMPLE_MS;
  };
  // A quiet lead-in gives the first footfall a baseline to rise from.
  for (let quiet = 0; quiet < 5; quiet += 1) sample(GRAVITY);
  for (let index = 0; index < count; index += 1) {
    for (let pulse = 0; pulse < 4; pulse += 1) sample(GRAVITY + 3);
    for (let quiet = 0; quiet < 21; quiet += 1) sample(GRAVITY);
  }
  return t;
}

const EAST: [number, number] = [0.5, 0];
const WEST: [number, number] = [-0.5, 0];
const SOUTH: [number, number] = [0, 0.5];
const NORTH: [number, number] = [0, -0.5];

describe('movement from an attached pose', () => {
  it('projects diagonal movement instead of spending sideways travel as route progress', () => {
    const tracker = attached();
    tracker.displace({ dxMeters: 0.3, dyMeters: 0.4, timeMs: 500 });
    expect(tracker.read(500).progressMeters).toBeCloseTo(0.3, 6);
    expect(tracker.read(500).walkedSinceAnchorMeters).toBeCloseTo(0.5, 6);
  });

  it('never rounds a corner when the visitor walks straight past it', () => {
    const tracker = attached();
    const t = move(tracker, 46, EAST);
    expect(tracker.read(t).progressMeters).toBeCloseTo(20, 6);
    expect(tracker.read(t)).toMatchObject({ tier: 'frozen', reason: 'off-route' });
  });

  it('retains lateral departure when later motion runs parallel to the route', () => {
    const tracker = attached();
    let t = move(tracker, 6, NORTH);
    t = move(tracker, 10, EAST, t);
    expect(tracker.read(t).progressMeters).toBe(0);
    expect(tracker.read(t)).toMatchObject({
      tier: 'frozen',
      reason: 'off-route',
      canStartPose: false,
    });
    // Changing source or re-aligning a camera is not a new position observation.
    tracker.detachDisplacement(t);
    tracker.resume(t);
    t = strides(tracker, 5, t);
    expect(tracker.read(t)).toMatchObject({
      progressMeters: 0,
      reason: 'off-route',
      canStartPose: false,
    });
    // Even a later missing sensor must not conceal the required re-anchor.
    tracker.sensorsLost('sensors-unavailable');
    expect(tracker.read(t + 3000).reason).toBe('off-route');
    t += 3000;
    tracker.attachDisplacement(t);
    tracker.poseRestored(t);
    t = move(tracker, 4, EAST, t);
    expect(tracker.read(t)).toMatchObject({
      progressMeters: 0,
      reason: 'off-route',
      canStartPose: false,
    });
    tracker.anchor({ progressMeters: 5, sigmaMeters: 1, timeMs: t });
    t = move(tracker, 2, EAST, t);
    expect(tracker.read(t).progressMeters).toBeCloseTo(6, 6);
  });
  it('moves the marker by the metres the pose reports along the corridor', () => {
    const tracker = attached();
    const t = move(tracker, 10, EAST);
    const snap = tracker.read(t);
    expect(snap.progressMeters).toBeCloseTo(5, 6);
    expect(snap).toMatchObject({
      tier: 'tracking',
      reason: 'following',
      displacementAttached: true,
      moving: true,
    });
    expect(snap.walkedSinceAnchorMeters).toBeCloseTo(5, 6);
  });

  it('follows the pose round the corner', () => {
    const tracker = attached();
    let t = move(tracker, 40, EAST);
    t = move(tracker, 10, SOUTH, t);
    expect(tracker.read(t).progressMeters).toBeCloseTo(25, 6);
    expect(tracker.read(t).reason).toBe('following');
  });

  it('allows a turn one metre inside the centreline without inventing a departure', () => {
    const tracker = attached();
    let t = move(tracker, 38, EAST); // x=19: turn just before the mapped x=20 corner.
    t = move(tracker, 6, SOUTH, t);
    expect(tracker.read(t)).toMatchObject({ progressMeters: 23, reason: 'following' });
  });

  it('ignores a phone being held still, and lets strides count for nothing', () => {
    const tracker = attached();
    let t = 0;
    for (let index = 0; index < 50; index += 1) {
      t += 100;
      tracker.displace({ dxMeters: 0.02, dyMeters: 0.01, timeMs: t });
    }
    expect(tracker.read(t).progressMeters).toBe(0);
    t = strides(tracker, 8, t);
    const snap = tracker.read(t);
    expect(snap.progressMeters).toBe(0);
    expect(snap.stridesSinceAnchor).toBe(8);
    expect(snap.walkedSinceAnchorMeters).toBe(0);
  });

  it('reports the camera facing as the heading while the pose is attached', () => {
    const tracker = attached();
    expect(tracker.read(0).headingDegrees).toBeNull();
    tracker.facing(135, 10);
    expect(tracker.read(10).headingDegrees).toBe(135);
    tracker.facing(-90, 20);
    expect(tracker.read(20).headingDegrees).toBe(270);
    tracker.facing(null, 30);
    expect(tracker.read(30).headingDegrees).toBeNull();
  });

  it('holds the marker and says off-route when the pose walks off the corridor', () => {
    const tracker = attached();
    let t = move(tracker, 10, NORTH);
    let snap = tracker.read(t);
    expect(snap.progressMeters).toBe(0);
    // Spatial inconsistency now holds immediately, rather than waiting for a
    // stride-equivalent angle tally to accumulate after a five-metre departure.
    expect(snap).toMatchObject({ tier: 'frozen', reason: 'off-route' });
    t = move(tracker, 10, NORTH, t);
    snap = tracker.read(t);
    expect(snap.progressMeters).toBe(0);
    expect(snap).toMatchObject({ tier: 'frozen', reason: 'off-route' });
    // Frozen is frozen: movement along the corridor no longer moves it either.
    t = move(tracker, 4, EAST, t);
    expect(tracker.read(t).progressMeters).toBe(0);
  });

  it('walks the marker back when the pose retreats, then calls it the wrong way', () => {
    const tracker = attached();
    let t = move(tracker, 10, EAST);
    t = move(tracker, 4, WEST, t);
    expect(tracker.read(t).progressMeters).toBeCloseTo(3, 6);
    t = move(tracker, 2, WEST, t);
    expect(tracker.read(t)).toMatchObject({ tier: 'caution', reason: 'wrong-way' });
    expect(tracker.read(t).progressMeters).toBeCloseTo(2, 6);
  });

  it('stops at the lift until the storey change is confirmed', () => {
    const tracker = attached(lifted);
    let t = move(tracker, 30, EAST);
    const snap = tracker.read(t);
    expect(snap.progressMeters).toBe(10);
    expect(snap).toMatchObject({ tier: 'frozen', reason: 'floor-change' });
    expect(snap.pendingFloor?.toFloorId).toBe('l1');
    t = move(tracker, 4, EAST, t);
    expect(tracker.read(t).progressMeters).toBe(10);
    tracker.confirmFloor(t);
    const alighted = tracker.read(t).progressMeters;
    expect(alighted).toBeGreaterThan(10);
    expect(tracker.read(t).displacementAttached).toBe(true);
    t = move(tracker, 4, EAST, t);
    expect(tracker.read(t).progressMeters).toBeCloseTo(alighted + 2, 6);
    expect(tracker.read(t).floorId).toBe('l1');
  });

  it('refuses a movement no one walks, and waits to be re-aligned', () => {
    const tracker = attached();
    let t = move(tracker, 4, EAST); // two metres, walked
    // Eight metres in fifty milliseconds: the platform re-placed its world.
    tracker.displace({ dxMeters: 8, dyMeters: 0, timeMs: t + 50 });
    t += 50;
    let snap = tracker.read(t);
    expect(snap.progressMeters).toBeCloseTo(2, 6);
    expect(snap).toMatchObject({ tier: 'frozen', reason: 'pose-jump', moving: false });
    // Nothing moves it until the visitor re-aligns.
    t = move(tracker, 4, EAST, t);
    expect(tracker.read(t).progressMeters).toBeCloseTo(2, 6);
    tracker.poseRestored(t);
    t = move(tracker, 2, EAST, t);
    snap = tracker.read(t);
    expect(snap.reason).toBe('following');
    expect(snap.progressMeters).toBeCloseTo(3, 6);
  });

  it('refuses a run of small pieces that add up to a sprint', () => {
    const tracker = attached();
    // Half a metre every fifty milliseconds is ten metres a second.
    const t = move(tracker, 6, EAST, 0, 50);
    expect(tracker.read(t).reason).toBe('pose-jump');
    expect(tracker.read(t).progressMeters).toBeLessThan(1);
  });

  it('checks speed on the first piece after alignment too', () => {
    const tracker = attached();
    tracker.displace({ dxMeters: 0.4, dyMeters: 0, timeMs: 50 });
    expect(tracker.read(50)).toMatchObject({ progressMeters: 0, reason: 'pose-jump' });
  });

  it('does not accept movement reported twice at the same time', () => {
    const tracker = attached();
    tracker.displace({ dxMeters: 0.2, dyMeters: 0, timeMs: 200 });
    tracker.displace({ dxMeters: 0.2, dyMeters: 0, timeMs: 200 });
    expect(tracker.read(200)).toMatchObject({ progressMeters: 0.2, reason: 'pose-jump' });
  });

  it('grows uncertainty far more slowly than strides would', () => {
    const tracker = attached();
    const t = move(tracker, 40, EAST);
    expect(tracker.read(t).sigmaMeters).toBeCloseTo(1 + 0.03 * 20, 6);
  });

  it('goes back to strides when the pose is gone, once direction of travel is re-established', () => {
    const tracker = attached();
    let t = move(tracker, 10, EAST);
    tracker.detachDisplacement(t);
    let snap = tracker.read(t);
    expect(snap.displacementAttached).toBe(false);
    expect(snap.progressMeters).toBeCloseTo(5, 6);
    expect(snap.reason).toBe('awaiting-departure');
    t = strides(tracker, 5, t);
    snap = tracker.read(t);
    expect(snap.reason).toBe('following');
    expect(snap.progressMeters).toBeCloseTo(5 + 5 * snap.strideMeters, 6);
    expect(snap.headingDegrees).toBeCloseTo(90, 6);
  });

  it('keeps the pose through a new anchor and starts the distance moved again', () => {
    const tracker = attached();
    let t = move(tracker, 40, EAST);
    tracker.anchor({ progressMeters: 8, sigmaMeters: 1, timeMs: t });
    let snap = tracker.read(t);
    expect(snap).toMatchObject({
      progressMeters: 8,
      sigmaMeters: 1,
      displacementAttached: true,
      moving: true,
    });
    t = move(tracker, 2, EAST, t);
    snap = tracker.read(t);
    expect(snap.progressMeters).toBeCloseTo(9, 6);
  });

  it('counts the resets of the gyroscope zero so a reading against it can be told stale', () => {
    const tracker = new RouteTracker(corner);
    const first = tracker.read(0).headingEpoch;
    tracker.anchor({ progressMeters: 0, sigmaMeters: 1, timeMs: 0 });
    expect(tracker.read(0).headingEpoch).toBeGreaterThan(first);
    const t = strides(tracker, 3, 0);
    const following = tracker.read(t);
    expect(following.reason).toBe('following');
    expect(following.relativeHeadingDegrees).toBeCloseTo(0, 6);
    tracker.resume(t + 1);
    expect(tracker.read(t + 1).headingEpoch).toBeGreaterThan(following.headingEpoch);
  });
});

/** Steps of half a metre along a bearing turned by a placement error, as a session measures them. */
function heading(bearing: number, errorDegrees: number): [number, number] {
  const radians = ((bearing + errorDegrees) * Math.PI) / 180;
  return [0.5 * Math.sin(radians), -0.5 * Math.cos(radians)];
}

describe('a placement direction learned from walking the route', () => {
  it.each([-20, 20])(
    'does not learn a later %s degree departure as another placement correction',
    (turn) => {
      const long = buildRouteTrack([node('a', 0, 0), node('b', 100, 0)], []);
      const tracker = attached(long);
      let t = move(tracker, 16, EAST); // Eight straight metres establish the initial direction.
      t = move(tracker, 30, heading(90 + turn, 0), t);
      expect(tracker.read(t)).toMatchObject({ tier: 'frozen', reason: 'off-route' });
      expect(tracker.poseCorrection().biasDegrees).toBeCloseTo(0, 6);
    },
  );

  it.each([0.25, 2])('corrects the same straight corridor split into %s metre edges', (spacing) => {
    const split = buildRouteTrack(
      Array.from({ length: 40 / spacing + 1 }, (_, i) => node(`p${i}`, i * spacing, 0)),
      [],
    );
    const tracker = attached(split);
    const t = move(tracker, 60, heading(90, 20));
    expect(tracker.read(t)).toMatchObject({ tier: 'tracking', reason: 'following' });
    expect(tracker.read(t).progressMeters).toBeGreaterThan(29.5);
    expect(tracker.poseCorrection().biasDegrees).toBeCloseTo(20, 6);
  });

  it('keeps an initial correction but rejects a later shallow departure', () => {
    const long = buildRouteTrack([node('a', 0, 0), node('b', 100, 0)], []);
    const tracker = attached(long);
    let t = move(tracker, 16, heading(90, 15));
    expect(tracker.poseCorrection().biasDegrees).toBeCloseTo(15, 6);
    t = move(tracker, 24, heading(105, 15), t); // A genuine extra 15 degree turn.
    expect(tracker.read(t)).toMatchObject({ tier: 'frozen', reason: 'off-route' });
    expect(tracker.poseCorrection().biasDegrees).toBeCloseTo(15, 6);
    expect(tracker.poseRestored(t)).toBe(false);
  });

  it.each([5, 10, 20, 30, -15])(
    'keeps guiding down a corridor when the placement was %s degrees off',
    (error) => {
      // The corner route's first leg is 20 m east; walk 18 m straight down it.
      const tracker = attached();
      const t = move(tracker, 36, heading(90, error));
      expect(tracker.read(t)).toMatchObject({ tier: 'tracking', reason: 'following' });
      expect(tracker.read(t).progressMeters).toBeGreaterThan(17.5);
      expect(tracker.poseCorrection().biasDegrees).toBeCloseTo(error, 0);
    },
  );

  it('carries the learned direction round the corner and down the next leg', () => {
    const tracker = attached();
    let t = move(tracker, 40, heading(90, 15));
    // Eight metres down the 12 m second leg: short of arriving.
    t = move(tracker, 16, heading(180, 15), t);
    expect(tracker.read(t)).toMatchObject({ reason: 'following' });
    expect(tracker.read(t).progressMeters).toBeGreaterThan(27);
  });

  it('still stops a walk that leaves the corridor at an angle no placement error explains', () => {
    const tracker = attached();
    const t = move(tracker, 16, heading(135, 0));
    expect(tracker.read(t)).toMatchObject({ tier: 'frozen', reason: 'off-route' });
    expect(tracker.poseCorrection().biasDegrees).toBe(0);
  });

  it('reports the facing corrected the same way as the steps', () => {
    const tracker = attached();
    const t = move(tracker, 16, heading(90, 20));
    tracker.facing(110, t);
    expect(tracker.read(t).headingDegrees).toBeCloseTo(90, 0);
  });

  it('forgets the correction when the route is placed again', () => {
    const tracker = attached();
    const t = move(tracker, 16, heading(90, 20));
    expect(tracker.poseCorrection().biasDegrees).not.toBe(0);
    tracker.poseRestored(t);
    expect(tracker.poseCorrection().biasDegrees).toBe(0);
  });
});

/** Walk a true path, as a session placed this many degrees off measures it, a quarter-metre at a time. */
function walkPath(
  tracker: RouteTracker,
  path: (walked: number) => [number, number],
  meters: number,
  errorDegrees: number,
) {
  const error = (errorDegrees * Math.PI) / 180;
  const seen = (walked: number): [number, number] => {
    const [x, y] = path(walked);
    return [x * Math.cos(error) - y * Math.sin(error), x * Math.sin(error) + y * Math.cos(error)];
  };
  let t = 0;
  let [lastX, lastY] = seen(0);
  for (let walked = 0.25; walked <= meters + 1e-9; walked += 0.25) {
    const [x, y] = seen(walked);
    t += 250;
    tracker.displace({ dxMeters: x - lastX, dyMeters: y - lastY, timeMs: t });
    lastX = x;
    lastY = y;
  }
  return t;
}

describe('a placement direction refined by walking that agrees with it', () => {
  const long = buildRouteTrack([node('a', 0, 0), node('b', 60, 0)], []);

  it.each([0.3, 0.6, 0.9])(
    'recovers from a %s m lane change in the first metres of a long corridor',
    (lane) => {
      // The lane change makes the first stretch look a few degrees further off than the placement was.
      const tracker = attached(long);
      const t = walkPath(tracker, (walked) => [walked, -lane * Math.min(1, walked / 3)], 55, 15);
      expect(tracker.read(t)).toMatchObject({ tier: 'tracking', reason: 'following' });
      expect(tracker.read(t).progressMeters).toBeGreaterThan(54);
      expect(tracker.poseCorrection().biasDegrees).toBeCloseTo(15, 0);
    },
  );

  it('keeps guiding with the phone swaying from side to side at each step', () => {
    const tracker = attached(long);
    const sway = (walked: number) => 0.1 * Math.sin((2 * Math.PI * walked) / 1.3);
    const t = walkPath(tracker, (walked) => [walked, sway(walked)], 55, 15);
    expect(tracker.read(t)).toMatchObject({ tier: 'tracking', reason: 'following' });
    expect(tracker.poseCorrection().biasDegrees).toBeCloseTo(15, 0);
  });
});
