import { describe, expect, it } from 'vitest';
import type { GraphNode, RouteStep } from '../engine/routingCore';
import { ANCHOR_SIGMA, RouteTracker } from './liveTracker';
import { VERTICAL_TRAVEL_METERS, buildRouteTrack } from './routeProgress';

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

/*
 * An L on one floor: 20 m east, a right turn, 12 m south. Plan +Y is down, so
 * east is bearing 90 and south is 180: east-then-south is a +90 turn, which
 * is clockwise, which is what the gyroscope reports as a positive rate.
 */
const corner = buildRouteTrack(
  [node('a', 0, 0), node('b', 20, 0), node('c', 20, 12)],
  [step('start', 'a'), step('turn_right', 'b'), step('arrive', 'c')],
);

/* 10 m east to a lift, one storey up, then 8 m east on the floor above. */
const lifted = buildRouteTrack(
  [node('a', 0, 0), node('lift-g', 10, 0), node('lift-1', 10, 0, 'l1'), node('d', 18, 0, 'l1')],
  [step('start', 'a'), step('elevator', 'lift-g'), step('arrive', 'd')],
);

const GRAVITY = 9.81;
const SAMPLE_MS = 20;

/**
 * A phone in the hand of someone walking, reduced to what the integrator
 * reads: acceleration magnitude and heading rate. A footfall is a short rise
 * well above the gravity baseline that then drops back; a turn is a rate held
 * for as long as it takes.
 */
class Walker {
  t = 0;
  constructor(
    private readonly tracker: RouteTracker,
    private readonly gyro: boolean = true,
  ) {}

  private sample(magnitude: number, rate: number) {
    this.tracker.motion({
      timeMs: this.t,
      accelerationMagnitude: magnitude,
      headingRateDegreesPerSecond: this.gyro ? rate : null,
    });
    this.t += SAMPLE_MS;
  }

  still(ms: number) {
    for (let elapsed = 0; elapsed < ms; elapsed += SAMPLE_MS) this.sample(GRAVITY, 0);
  }

  steps(count: number, cadenceMs = 500) {
    for (let index = 0; index < count; index += 1) {
      for (let pulse = 0; pulse < 4; pulse += 1) this.sample(GRAVITY + 3, 0);
      this.still(cadenceMs - 4 * SAMPLE_MS);
    }
  }

  /** Positive is clockwise, as heading increases. */
  turn(degrees: number, durationMs = 1000) {
    const rate = degrees / (durationMs / 1000);
    for (let elapsed = 0; elapsed < durationMs; elapsed += SAMPLE_MS) this.sample(GRAVITY, rate);
  }

  read() {
    return this.tracker.read(this.t);
  }
}

function anchored(track = corner, options = {}) {
  const tracker = new RouteTracker(track, options);
  const walker = new Walker(tracker);
  walker.still(400);
  tracker.anchor({ progressMeters: 0, sigmaMeters: ANCHOR_SIGMA.scan, timeMs: walker.t });
  walker.still(400);
  return { tracker, walker };
}

describe('route tracker', () => {
  it('does nothing without an anchor', () => {
    const tracker = new RouteTracker(corner);
    const walker = new Walker(tracker);
    walker.still(400);
    walker.steps(6);
    expect(walker.read()).toMatchObject({ tier: 'frozen', reason: 'no-anchor', progressMeters: 0 });
  });

  it('waits at the anchor until the visitor sets off', () => {
    const { walker } = anchored();
    expect(walker.read()).toMatchObject({
      tier: 'anchored',
      reason: 'awaiting-departure',
      progressMeters: 0,
      headingDegrees: null,
    });
  });

  it('advances along the corridor by strides and establishes the direction of travel', () => {
    const { walker } = anchored();
    walker.steps(10);
    const snapshot = walker.read();
    expect(snapshot.tier).toBe('tracking');
    expect(snapshot.reason).toBe('following');
    expect(snapshot.stridesSinceAnchor).toBe(10);
    expect(snapshot.progressMeters).toBeCloseTo(10 * snapshot.strideMeters, 5);
    // Straight east, so the established heading is the corridor's.
    expect(snapshot.headingDegrees).toBeCloseTo(90, 5);
    expect(snapshot.sigmaMeters).toBeGreaterThan(ANCHOR_SIGMA.scan);
  });

  it('learns the direction of travel from the first strides, whichever way the sign faced', () => {
    // Scanned facing the wall, then turned to face along the corridor: the
    // gyroscope has already counted a quarter turn before the first stride.
    const { walker } = anchored();
    walker.turn(90);
    walker.still(300);
    walker.steps(10);
    const snapshot = walker.read();
    expect(snapshot.reason).toBe('following');
    expect(snapshot.progressMeters).toBeCloseTo(10 * snapshot.strideMeters, 5);
    expect(snapshot.headingDegrees).toBeCloseTo(90, 5);
    // The corner still reads as a corner from that alignment.
    walker.steps(17);
    walker.turn(90);
    walker.steps(4);
    expect(walker.read().reason).toBe('following');
    expect(walker.read().headingDegrees).toBeCloseTo(180, 5);
  });

  it('follows the turn when the visitor turns where the route does', () => {
    const { walker } = anchored();
    walker.steps(27); // 19.4 m: at the corner
    walker.turn(90);
    walker.steps(6);
    const snapshot = walker.read();
    expect(snapshot.reason).toBe('following');
    expect(snapshot.progressMeters).toBeGreaterThan(20);
    expect(snapshot.headingDegrees).toBeCloseTo(180, 5);
    expect(snapshot.floorId).toBe('g');
  });

  it('stops advancing and says so when the visitor walks off down a corridor the route does not use', () => {
    const { walker } = anchored();
    walker.steps(27);
    walker.turn(-90); // left at a right-hand corner: north, off the route
    walker.steps(5);
    const early = walker.read();
    expect(early.reason).toBe('following'); // not yet enough evidence
    walker.steps(2);
    const caution = walker.read();
    expect(caution).toMatchObject({ tier: 'caution', reason: 'off-route' });
    expect(caution.progressMeters).toBeCloseTo(early.progressMeters, 5);
    walker.steps(6);
    expect(walker.read()).toMatchObject({ tier: 'frozen', reason: 'off-route', moving: false });
  });

  it('walks the marker back when the visitor turns around', () => {
    const { walker } = anchored();
    walker.steps(12);
    const forward = walker.read().progressMeters;
    walker.turn(180);
    walker.steps(4);
    const back = walker.read();
    expect(back.progressMeters).toBeLessThan(forward);
    expect(back).toMatchObject({ tier: 'caution', reason: 'wrong-way' });
    // Turning back again recovers.
    walker.turn(-180);
    walker.steps(3);
    expect(walker.read().reason).toBe('following');
  });

  it('counts strides along the route with a warning when there is no gyroscope', () => {
    const tracker = new RouteTracker(corner);
    const walker = new Walker(tracker, false);
    walker.still(400);
    tracker.anchor({ progressMeters: 0, sigmaMeters: ANCHOR_SIGMA.scan, timeMs: walker.t });
    walker.still(600);
    walker.steps(8);
    const snapshot = walker.read();
    expect(snapshot).toMatchObject({ tier: 'caution', reason: 'no-heading', moving: true });
    expect(snapshot.progressMeters).toBeGreaterThan(4);
    expect(snapshot.headingDegrees).toBeNull();
  });

  it('freezes when the motion stream goes silent', () => {
    const { tracker, walker } = anchored();
    walker.steps(4);
    const before = walker.read().progressMeters;
    expect(tracker.read(walker.t + 1_400).reason).toBe('following');
    expect(tracker.read(walker.t + 1_600)).toMatchObject({
      tier: 'frozen',
      reason: 'sensors-silent',
      progressMeters: before,
    });
  });

  it('stops at a lift until the storey change is confirmed, then carries on upstairs', () => {
    const { tracker, walker } = anchored(lifted);
    walker.steps(20); // far more than the 10 m to the lift
    const waiting = walker.read();
    expect(waiting).toMatchObject({ tier: 'frozen', reason: 'floor-change', progressMeters: 10 });
    expect(waiting.pendingFloor).toEqual({
      toFloorId: 'l1',
      alightingMeters: 10 + VERTICAL_TRAVEL_METERS,
    });
    expect(waiting.floorId).toBe('g');

    tracker.confirmFloor(walker.t);
    const upstairs = walker.read();
    expect(upstairs.floorId).toBe('l1');
    expect(upstairs.progressMeters).toBe(10 + VERTICAL_TRAVEL_METERS);
    expect(upstairs.sigmaMeters).toBeGreaterThan(waiting.sigmaMeters);
    walker.still(400);
    walker.steps(6);
    const walking = walker.read();
    expect(walking.progressMeters).toBeGreaterThan(10 + VERTICAL_TRAVEL_METERS + 3);
    expect(walking.reason).toBe('following');
  });

  it('reports arrival near the end and not before', () => {
    const { walker } = anchored();
    walker.steps(27);
    walker.turn(90);
    walker.steps(8); // ~25.2 m of a 32 m route
    expect(walker.read().reason).toBe('following');
    walker.steps(8);
    expect(walker.read().reason).toBe('arrived');
  });

  it('grows uncertain with distance and asks for a scan before it freezes', () => {
    const long = buildRouteTrack(
      [node('a', 0, 0), node('b', 200, 0)],
      [step('start', 'a'), step('arrive', 'b')],
    );
    const { walker } = anchored(long);
    walker.steps(60); // 43 m: sigma 1 + 0.08 * 43 = 4.5, still tracking
    expect(walker.read()).toMatchObject({ tier: 'tracking', reason: 'following' });
    walker.steps(30); // 65 m: sigma 6.2
    expect(walker.read()).toMatchObject({ tier: 'caution', reason: 'uncertain', moving: true });
    walker.steps(110); // 144 m: sigma 12.5
    const frozen = walker.read();
    expect(frozen).toMatchObject({ tier: 'frozen', reason: 'uncertain', moving: false });
    walker.steps(10);
    expect(walker.read().progressMeters).toBe(frozen.progressMeters);
  });

  it('a scan resets uncertainty and measures the stride', () => {
    const long = buildRouteTrack(
      [node('a', 0, 0), node('b', 120, 0)],
      [step('start', 'a'), step('arrive', 'b')],
    );
    const { tracker, walker } = anchored(long);
    walker.steps(25);
    const before = walker.read();
    expect(before.strideMeters).toBe(0.72);
    // The second sign is 20 m along; 25 strides covered it, so a stride is 0.8.
    tracker.anchor({ progressMeters: 20, sigmaMeters: ANCHOR_SIGMA.scan, timeMs: walker.t });
    const after = walker.read();
    expect(after.progressMeters).toBe(20);
    expect(after.sigmaMeters).toBe(ANCHOR_SIGMA.scan);
    expect(after.strideMeters).toBeCloseTo((0.72 + 0.8) / 2, 5);
    expect(after.reason).toBe('awaiting-departure');
  });

  it('does not measure a stride from a walk the tracker could not follow', () => {
    const { tracker, walker } = anchored();
    walker.steps(4); // not enough strides to trust
    tracker.anchor({ progressMeters: 15, sigmaMeters: ANCHOR_SIGMA.scan, timeMs: walker.t });
    expect(walker.read().strideMeters).toBe(0.72);
  });

  it('holds the visitor at the anchor while the compass says they face away from the route', () => {
    const { tracker, walker } = anchored();
    tracker.compassPlanBearing(270, walker.t); // facing west; the route goes east
    walker.steps(3);
    expect(walker.read()).toMatchObject({
      tier: 'caution',
      reason: 'wrong-way',
      progressMeters: 0,
    });
    tracker.compassPlanBearing(95, walker.t);
    walker.steps(3);
    expect(walker.read().progressMeters).toBeGreaterThan(1);
    expect(walker.read().reason).toBe('following');
  });

  it('ignores a compass that has gone stale', () => {
    const { tracker, walker } = anchored();
    tracker.compassPlanBearing(270, walker.t);
    walker.still(3_500);
    walker.steps(3);
    expect(walker.read().progressMeters).toBeGreaterThan(1);
  });

  it('skips a sample whose clock went backwards instead of failing', () => {
    const { tracker, walker } = anchored();
    walker.steps(3);
    const before = walker.read().progressMeters;
    expect(() =>
      tracker.motion({ timeMs: 5, accelerationMagnitude: GRAVITY, headingRateDegreesPerSecond: 0 }),
    ).not.toThrow();
    walker.steps(3);
    expect(walker.read().progressMeters).toBeGreaterThan(before);
  });

  it('a new route needs a new anchor but keeps the measured stride', () => {
    const long = buildRouteTrack(
      [node('a', 0, 0), node('b', 120, 0)],
      [step('start', 'a'), step('arrive', 'b')],
    );
    const { tracker, walker } = anchored(long);
    walker.steps(25);
    tracker.anchor({ progressMeters: 20, sigmaMeters: ANCHOR_SIGMA.scan, timeMs: walker.t });
    const stride = walker.read().strideMeters;
    tracker.rebind(corner);
    expect(tracker.currentTrack).toBe(corner);
    walker.steps(4);
    expect(walker.read()).toMatchObject({
      tier: 'frozen',
      reason: 'no-anchor',
      strideMeters: stride,
    });
  });

  it('a selected landmark anchors with less certainty than a scan', () => {
    const tracker = new RouteTracker(corner);
    const walker = new Walker(tracker);
    walker.still(400);
    tracker.anchor({ progressMeters: 0, sigmaMeters: ANCHOR_SIGMA.selected, timeMs: walker.t });
    expect(walker.read().sigmaMeters).toBe(ANCHOR_SIGMA.selected);
  });

  it('resumes after a stop from where it was, re-learning the direction of travel', () => {
    const { tracker, walker } = anchored();
    walker.steps(12);
    const before = walker.read();
    expect(before.reason).toBe('following');
    expect(tracker.isAnchored).toBe(true);
    // Stopped for a while, and turned round in the meantime.
    walker.t += 20_000;
    tracker.resume(walker.t);
    walker.turn(180);
    walker.still(400);
    const resumed = walker.read();
    expect(resumed.progressMeters).toBe(before.progressMeters);
    expect(resumed.sigmaMeters).toBeCloseTo(before.sigmaMeters, 5);
    expect(resumed.headingDegrees).toBeNull();
    // Whichever way they now face, the first strides define the route direction again.
    walker.steps(6);
    expect(walker.read().reason).toBe('following');
    expect(walker.read().progressMeters).toBeGreaterThan(before.progressMeters);
    expect(new RouteTracker(corner).isAnchored).toBe(false);
  });

  it('reports unavailable sensors above everything else', () => {
    const { tracker, walker } = anchored();
    walker.steps(3);
    tracker.sensorsLost('sensors-unavailable');
    expect(walker.read()).toMatchObject({ tier: 'frozen', reason: 'sensors-unavailable' });
    walker.steps(1);
    expect(walker.read().reason).not.toBe('sensors-unavailable');
  });
});
