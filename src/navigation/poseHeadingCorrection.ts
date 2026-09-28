import { signedHeadingDifference } from './coordinateFrames';
import { planarRouteLegs } from './routePlanarLegs';
import { straightCourse, type WalkPoint } from './poseStraightWindow';
import type { RouteTrack } from './routeProgress';

/**
 * A bounded bootstrap under the INITIAL-CORRIDOR ASSUMPTION, not an independent
 * heading observation. First estimate from a straight window, then at most one
 * refinement from two consecutive agreeing windows. Once settled, never learn
 * later departures. A turn, disagreement or exhausted settling budget also
 * closes refinement. A new placement is required to open it again.
 *
 * Positions for the heading fit are unsmoothed measured positions in the
 * original placement frame. Only the heading fit tolerates bounded phone sway;
 * the route matcher continues to see every measured lateral displacement.
 */
export const POSE_HEADING_POLICY = Object.freeze({
  windowMeters: 3,
  legEndMarginMeters: 1,
  maximumFixDegrees: 30,
  initialUncertaintyDegrees: 20,
  maximumToleranceMeters: 4,
  refineAgreementDegrees: 10,
  /** Two later windows must agree with EACH OTHER, not merely with the first estimate. */
  settleAgreementDegrees: 5,
  /** Net route progress after the first estimate; no indefinite later adaptation. */
  maximumSettlingMeters: 12,
  lockedUncertaintyDegrees: 4,
  lockedMaximumToleranceMeters: 2.5,
  /** Bound memory and reject extended shuffling without a useful baseline. */
  maximumWindowPathMeters: 9,
  maximumWindowSpanMeters: 6,
  maximumWindowSamples: 256,
});
export type PoseHeadingState = 'learning' | 'settling' | 'locked';
const DEG = Math.PI / 180;

export function rotatePlanVector(dx: number, dy: number, degrees: number): [number, number] {
  const cos = Math.cos(degrees * DEG),
    sin = Math.sin(degrees * DEG);
  return [dx * cos - dy * sin, dy * cos + dx * sin];
}
interface Leg {
  index: number;
  bearing: number;
}
function straightLegAt(track: RouteTrack, progress: number): Leg | null {
  const margin = POSE_HEADING_POLICY.legEndMarginMeters;
  for (const { startIndex, endIndex, bearing } of planarRouteLegs(track)) {
    if (progress < track.at[startIndex] || progress > track.at[endIndex]) continue;
    if (progress < track.at[startIndex] + margin || progress > track.at[endIndex] - margin)
      return null;
    return { index: startIndex, bearing };
  }
  return null;
}
interface Stretch extends Leg {
  points: WalkPoint[];
  path: number;
}
interface Measured extends Leg {
  points: WalkPoint[];
  bias: number;
}
function biasAlong(legBearing: number, rawBearing: number) {
  const forward = signedHeadingDifference(rawBearing, legBearing);
  return Math.abs(forward) <= 90 ? forward : signedHeadingDifference(rawBearing, legBearing + 180);
}

export class PoseHeadingCorrector {
  private biasDegrees = 0;
  private stage: PoseHeadingState = 'learning';
  private progressSinceFix = 0;
  private settlingProgress = 0;
  private lastProgress: number | null = null;
  private origin: WalkPoint | null = null;
  private sinceX = 0;
  private sinceY = 0;
  private rawPoint: WalkPoint = { x: 0, y: 0 };
  private stretch: Stretch | null = null;
  private pending: Measured | null = null;
  private firstLeg: number | null = null;
  private epochValue = 0;

  get bias() {
    return this.biasDegrees;
  }
  get epoch() {
    return this.epochValue;
  }
  get state(): PoseHeadingState {
    return this.stage;
  }

  reset(from: WalkPoint | null = null) {
    this.origin = from === null ? null : { ...from };
    this.sinceX = 0;
    this.sinceY = 0;
    this.rawPoint = { x: 0, y: 0 };
    this.biasDegrees = 0;
    this.stage = 'learning';
    this.progressSinceFix = 0;
    this.settlingProgress = 0;
    this.lastProgress = null;
    this.stretch = null;
    this.pending = null;
    this.firstLeg = null;
    this.epochValue += 1;
  }

  correct(dx: number, dy: number): [number, number] {
    return this.biasDegrees === 0 ? [dx, dy] : rotatePlanVector(dx, dy, -this.biasDegrees);
  }

  tolerance(baseMeters: number) {
    const learning = this.stage === 'learning';
    return Math.min(
      learning
        ? POSE_HEADING_POLICY.maximumToleranceMeters
        : POSE_HEADING_POLICY.lockedMaximumToleranceMeters,
      baseMeters +
        this.progressSinceFix *
          Math.tan(
            (learning
              ? POSE_HEADING_POLICY.initialUncertaintyDegrees
              : POSE_HEADING_POLICY.lockedUncertaintyDegrees) * DEG,
          ),
    );
  }

  private lock() {
    this.stage = 'locked';
    this.pending = null;
    this.stretch = null;
  }

  observe(
    track: RouteTrack,
    step: { dx: number; dy: number; meters: number },
    progress: number,
    point: WalkPoint,
  ): WalkPoint | null {
    const progressed = this.lastProgress === null ? 0 : Math.abs(progress - this.lastProgress);
    this.progressSinceFix += progressed;
    this.lastProgress = progress;
    if (this.stage === 'locked') return null;
    if (this.stage === 'settling') {
      this.settlingProgress += progressed;
      if (this.settlingProgress > POSE_HEADING_POLICY.maximumSettlingMeters) {
        this.lock();
        return null;
      }
    }
    if (this.origin === null) this.origin = { x: point.x - step.dx, y: point.y - step.dy };
    this.sinceX += step.dx;
    this.sinceY += step.dy;
    const [rawX, rawY] = rotatePlanVector(step.dx, step.dy, this.biasDegrees);
    this.rawPoint = { x: this.rawPoint.x + rawX, y: this.rawPoint.y + rawY };
    const leg = straightLegAt(track, progress);
    if (this.stage === 'settling' && (leg === null || leg.index !== this.firstLeg)) {
      this.lock();
      return null;
    }
    const begin = () => {
      this.stretch = leg === null ? null : { ...leg, points: [{ ...this.rawPoint }], path: 0 };
    };
    const stretch = this.stretch;
    if (leg === null || stretch === null || stretch.index !== leg.index) {
      this.pending = null;
      begin();
      return null;
    }
    if (step.meters <= 0) return null;
    stretch.points.push({ ...this.rawPoint });
    stretch.path += step.meters;
    if (
      stretch.path > POSE_HEADING_POLICY.maximumWindowPathMeters ||
      stretch.points.length > POSE_HEADING_POLICY.maximumWindowSamples
    ) {
      this.pending = null;
      begin();
      return null;
    }
    const start = stretch.points[0];
    if (
      Math.hypot(this.rawPoint.x - start.x, this.rawPoint.y - start.y) <
      POSE_HEADING_POLICY.windowMeters
    )
      return null;
    // Endpoint sway can make chord length reach 3 m just before fitted forward
    // span does. Keep collecting that valid short fit instead of rejecting the
    // entire window at a sample-rate-dependent boundary.
    const course = straightCourse(stretch.points, POSE_HEADING_POLICY.windowMeters * 0.9);
    if (course !== null && course.spanMeters < POSE_HEADING_POLICY.windowMeters) return null;
    if (course === null) {
      // A sparse/noisy window can need a longer baseline. This is bounded, and
      // does not suppress any displacement from the route/venue checks.
      if (
        Math.hypot(this.rawPoint.x - start.x, this.rawPoint.y - start.y) >=
        POSE_HEADING_POLICY.maximumWindowSpanMeters
      ) {
        // A failed completed window breaks consecutiveness. While it is still
        // growing, all its observations remain in the eventual combined fit.
        this.pending = null;
        begin();
      }
      return null;
    }
    const implied = biasAlong(stretch.bearing, course.bearing);
    const first = this.stage === 'learning';
    if (
      first
        ? Math.abs(implied) > POSE_HEADING_POLICY.maximumFixDegrees
        : Math.abs(signedHeadingDifference(implied, this.biasDegrees)) >
          POSE_HEADING_POLICY.refineAgreementDegrees
    ) {
      if (!first) this.lock();
      else begin();
      return null;
    }
    let next = implied;
    if (!first) {
      const previous = this.pending;
      this.pending = { ...leg, points: stretch.points, bias: implied };
      if (
        previous === null ||
        Math.abs(signedHeadingDifference(previous.bias, implied)) >
          POSE_HEADING_POLICY.settleAgreementDegrees
      ) {
        begin();
        return null;
      }
      const combined = straightCourse(
        [...previous.points, ...stretch.points.slice(1)],
        POSE_HEADING_POLICY.windowMeters * 2,
      );
      if (combined === null) {
        this.pending = null;
        begin();
        return null;
      }
      next = biasAlong(stretch.bearing, combined.bearing);
      if (
        Math.abs(signedHeadingDifference(next, this.biasDegrees)) >
        POSE_HEADING_POLICY.refineAgreementDegrees
      ) {
        this.lock();
        return null;
      }
      this.lock();
    } else {
      this.stage = 'settling';
      this.firstLeg = leg.index;
      begin();
    }
    const change = signedHeadingDifference(next, this.biasDegrees);
    this.biasDegrees = next;
    this.progressSinceFix = 0;
    this.epochValue += 1;
    // Recompute measured travel under the estimate, never use a route projection as a fix.
    const [dx, dy] = rotatePlanVector(this.sinceX, this.sinceY, -change);
    const corrected = { x: this.origin.x + dx, y: this.origin.y + dy };
    this.origin = corrected;
    this.sinceX = 0;
    this.sinceY = 0;
    return corrected;
  }
}
