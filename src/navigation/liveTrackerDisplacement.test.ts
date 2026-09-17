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
    expect(snap).toMatchObject({ tier: 'caution', reason: 'off-route' });
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
