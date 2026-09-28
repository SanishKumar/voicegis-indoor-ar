import { describe, expect, it } from 'vitest';
import { planBearing } from './coordinateFrames';
import {
  PoseHeadingCorrector,
  POSE_HEADING_POLICY,
  rotatePlanVector,
} from './poseHeadingCorrection';
import { buildRouteTrack } from './routeProgress';

/* Forty metres east. */
const track = buildRouteTrack(
  [
    { id: 'a', x: 0, y: 0, floor: 'g' },
    { id: 'b', x: 40, y: 0, floor: 'g' },
  ],
  [],
);

/** Walk along a bearing, feeding the corrector as the tracker would, progress projected east. */
function walk(
  corrector: PoseHeadingCorrector,
  bearing: number,
  meters: number,
  from = { x: 1, y: 0 },
) {
  const point = { ...from };
  let fix: { x: number; y: number } | null = null;
  for (let walked = 0; walked < meters - 1e-9; walked += 0.25) {
    const [rawX, rawY] = rotatePlanVector(0, -0.25, bearing);
    const [dx, dy] = corrector.correct(rawX, rawY);
    point.x += dx;
    point.y += dy;
    const next = corrector.observe(track, { dx, dy, meters: 0.25 }, Math.max(0, point.x), point);
    if (next !== null) {
      fix = next;
      point.x = next.x;
      point.y = next.y;
    }
  }
  return { point, fix };
}

describe('turning a plan vector as a bearing turns', () => {
  it('turns clockwise from plan-up', () => {
    const [x, y] = rotatePlanVector(0, -1, 90);
    expect(x).toBeCloseTo(1, 10);
    expect(y).toBeCloseTo(0, 10);
    expect(planBearing([0, 0], rotatePlanVector(3, 4, -30))).toBeCloseTo(
      (planBearing([0, 0], [3, 4])! - 30 + 360) % 360,
      8,
    );
  });
});

describe('learning the direction error from walking along a leg', () => {
  it.each([0, 15])(
    'rejects a large turn during settling from a %s degree initial estimate',
    (initial) => {
      const corrector = new PoseHeadingCorrector();
      const first = walk(corrector, 90 + initial, 5);
      const epoch = corrector.epoch;
      expect(corrector.state).toBe('settling');
      expect(corrector.bias).toBeCloseTo(initial, 6);
      walk(corrector, 110 + initial, 8, first.point);
      expect(corrector.bias).toBeCloseTo(initial, 6);
      expect(corrector.epoch).toBe(epoch);
      expect(corrector.state).toBe('locked');
      // Locked: a little room for the estimate's remaining error, never the learning allowance.
      expect(corrector.tolerance(1.5)).toBeLessThanOrEqual(
        POSE_HEADING_POLICY.lockedMaximumToleranceMeters,
      );
      corrector.reset();
      expect(corrector.state).toBe('learning');
      walk(corrector, 100, 5);
      expect(corrector.bias).toBeCloseTo(10, 6);
    },
  );

  it('settles once, then keeps its heading fixed even through small later turns', () => {
    const corrector = new PoseHeadingCorrector();
    const settled = walk(corrector, 105, 12);
    expect(corrector.state).toBe('locked');
    const epoch = corrector.epoch;
    walk(corrector, 108, 16, settled.point);
    expect(corrector.bias).toBeCloseTo(15, 6);
    expect(corrector.epoch).toBe(epoch);
  });

  it('closes settling when later windows cannot agree within the finite budget', () => {
    const corrector = new PoseHeadingCorrector();
    let { point } = walk(corrector, 90, 5);
    for (let i = 0; i < 6; i += 1) ({ point } = walk(corrector, i % 2 === 0 ? 97 : 83, 3.5, point));
    expect(corrector.state).toBe('locked');
    expect(corrector.bias).toBeCloseTo(0, 6);
  });
  it('takes a steady angle along a straight stretch as the direction being off', () => {
    const corrector = new PoseHeadingCorrector();
    // Truly walking east; the placement thinks it is 12° further round.
    const { point, fix } = walk(corrector, 102, 4);
    expect(corrector.bias).toBeCloseTo(12, 6);
    // The stretch is recomputed with the corrected direction: back on the line
    // it was actually walked along, not dropped onto the route by projection.
    expect(fix).not.toBeNull();
    expect(point.y).toBeCloseTo(0, 6);
    // Later steps come out along the leg.
    const [dx, dy] = corrector.correct(...rotatePlanVector(0, -1, 102));
    expect(planBearing([0, 0], [dx, dy])).toBeCloseTo(90, 6);
  });

  it('learns nothing from a walk that is not straight', () => {
    const corrector = new PoseHeadingCorrector();
    for (let turn = 0; turn < 6; turn += 1) walk(corrector, turn % 2 === 0 ? 50 : 130, 1);
    expect(corrector.bias).toBe(0);
  });

  it('does not take a large angle for direction error', () => {
    const corrector = new PoseHeadingCorrector();
    walk(corrector, 90 + POSE_HEADING_POLICY.maximumFixDegrees + 10, 6);
    expect(corrector.bias).toBe(0);
  });

  it('learns from walking back down a leg as well as forward', () => {
    const corrector = new PoseHeadingCorrector();
    walk(corrector, 270 + 10, 5, { x: 30, y: 0 });
    expect(corrector.bias).toBeCloseTo(10, 6);
  });

  it('forgets what it learned when the route is placed again', () => {
    const corrector = new PoseHeadingCorrector();
    walk(corrector, 100, 4);
    const epoch = corrector.epoch;
    corrector.reset();
    expect(corrector.bias).toBe(0);
    expect(corrector.epoch).not.toBe(epoch);
  });

  it('allows sideways drift in proportion to progress along the route, within a cap', () => {
    const corrector = new PoseHeadingCorrector();
    expect(corrector.tolerance(1.5)).toBe(1.5);
    const point = { x: 1, y: 0 };
    corrector.observe(track, { dx: 0, dy: 0, meters: 0 }, 1, point);
    // Crooked enough to teach nothing, so the allowance keeps growing with progress.
    corrector.observe(track, { dx: 1, dy: 1, meters: 5 }, 3, point);
    const grown =
      1.5 + 2 * Math.tan((POSE_HEADING_POLICY.initialUncertaintyDegrees * Math.PI) / 180);
    expect(corrector.tolerance(1.5)).toBeCloseTo(grown, 6);
    corrector.observe(track, { dx: 0, dy: 0, meters: 0 }, 39, point);
    expect(corrector.tolerance(1.5)).toBe(POSE_HEADING_POLICY.maximumToleranceMeters);
  });
});
