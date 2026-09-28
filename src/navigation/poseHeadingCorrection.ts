import { planBearing, signedHeadingDifference } from './coordinateFrames';
import { planarRouteLegs } from './routePlanarLegs';
import type { RouteTrack } from './routeProgress';

/**
 * Learning the error in an AR session's direction from walking along the route.
 *
 * A session is placed with an approximate direction - from a scanned sign, or
 * the visitor saying which way they face - and every metre walked after that
 * is turned by the same error. Walking straight down a corridor then shows up
 * as a path drifting off to one side, and a strict match against the route
 * would call that leaving it within a few metres.
 *
 * Assume the INITIAL straight walk follows the selected corridor, and estimate
 * the placement bias from it. This is not independent heading evidence: a
 * diagonal departure at startup is indistinguishable from a placement error.
 * Once a stretch has supplied an estimate (including zero bias) it is locked
 * against change of any size: a later stretch that disagrees with it by more
 * than a few degrees is never learned, so a genuine departure is not absorbed.
 *
 * A single three-metre stretch is a short baseline, though. A lane change in
 * the first metres, or the phone swaying with each step, leaves the estimate
 * a few degrees out, and a few degrees over a long corridor is enough to leave
 * the route. So later stretches that AGREE with the estimate join a baseline
 * along the same leg, and the estimate is taken again over that whole
 * baseline. Recompute the path under the bias, not by dropping it onto the
 * route. Large angles, crooked paths and stretches near corners teach nothing.
 *
 * Thresholds are provisional software guards, not surveyed corridor widths
 * or measured handset accuracy.
 */
export const POSE_HEADING_POLICY = Object.freeze({
  /** Metres of path along one leg before its direction is compared with the leg's. */
  windowMeters: 3,
  /** Straight-line distance over path length; below this the walk was not straight. */
  minimumStraightness: 0.9,
  /**
   * The two halves of a stretch may point this far apart at most. A stretch
   * across a turn averages the two directions and can look straight.
   */
  maximumBendDegrees: 8,
  /** Stretches this close to either end of a leg may be rounding a corner. */
  legEndMarginMeters: 1,
  /** A bigger angle than this over one stretch is not taken for direction error. */
  maximumFixDegrees: 30,
  /** How far off the direction may be before any stretch has confirmed it. */
  initialUncertaintyDegrees: 20,
  /** Cap on the temporary allowance while learning the initial placement. */
  maximumToleranceMeters: 4,
  /** After the initial estimate, a stretch must agree with it this closely to refine it. */
  refineAgreementDegrees: 10,
  /** How far the estimate may still be off once a stretch has confirmed it. */
  lockedUncertaintyDegrees: 4,
  /** And the most sideways room that leaves before the next agreeing stretch. */
  lockedMaximumToleranceMeters: 2.5,
});

const DEG = Math.PI / 180;

/** Turn a plan-frame vector clockwise, as a bearing turns, by this many degrees. */
export function rotatePlanVector(dx: number, dy: number, degrees: number): [number, number] {
  const cos = Math.cos(degrees * DEG);
  const sin = Math.sin(degrees * DEG);
  return [dx * cos - dy * sin, dy * cos + dx * sin];
}

interface Leg {
  index: number;
  bearing: number;
}

/** The planar leg this progress is on, away from its ends; null at a corner or a storey change. */
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
  sumX: number;
  sumY: number;
  path: number;
  /** The first half of the stretch, once walked. */
  half: { x: number; y: number } | null;
}

/** Stretches along one leg that agreed with the estimate, as the placement measured them. */
interface Baseline {
  index: number;
  bearing: number;
  rawX: number;
  rawY: number;
}

/** The bias a measured (uncorrected) direction implies, taking the leg either way along it. */
function biasAlong(legBearing: number, rawBearing: number) {
  const forward = signedHeadingDifference(rawBearing, legBearing);
  return Math.abs(forward) <= 90 ? forward : signedHeadingDifference(rawBearing, legBearing + 180);
}

export class PoseHeadingCorrector {
  private biasDegrees = 0;
  private fixes = 0;
  /** Progress along the route since the direction was last confirmed. */
  private progressSinceFix = 0;
  private lastProgress: number | null = null;
  /**
   * Where the pose stood when the direction was last set or confirmed, and
   * every step since: all of it was walked with the same error, so all of it
   * is recomputed when the error is learned.
   */
  private origin: { x: number; y: number } | null = null;
  private sinceX = 0;
  private sinceY = 0;
  private stretch: Stretch | null = null;
  private baseline: Baseline | null = null;
  /**
   * An agreeing stretch waits for the next one to agree too before it refines
   * the estimate: the first stretch into a departure can still look like the
   * corridor, and the one after it shows that it was not.
   */
  private pending: Baseline | null = null;
  private epochValue = 0;

  /** Degrees subtracted from each measured step's bearing. */
  get bias() {
    return this.biasDegrees;
  }

  /** Changes whenever the correction does, so a drawing of the route knows to follow. */
  get epoch() {
    return this.epochValue;
  }

  /** A locked estimate still rests on the initial-corridor assumption. */
  get state(): 'learning' | 'locked' {
    return this.fixes === 0 ? 'learning' : 'locked';
  }

  /** A new placement: whatever was learned about the old one's direction no longer applies. */
  reset(from: { x: number; y: number } | null = null) {
    this.origin = from === null ? null : { x: from.x, y: from.y };
    this.sinceX = 0;
    this.sinceY = 0;
    this.biasDegrees = 0;
    this.fixes = 0;
    this.progressSinceFix = 0;
    this.lastProgress = null;
    this.stretch = null;
    this.baseline = null;
    this.pending = null;
    this.epochValue += 1;
  }

  /** A measured step, turned by the correction learned so far. */
  correct(dx: number, dy: number): [number, number] {
    return this.biasDegrees === 0 ? [dx, dy] : rotatePlanVector(dx, dy, -this.biasDegrees);
  }

  /**
   * How far to the side of the route the matcher should still look: the
   * sideways drift the remaining direction uncertainty could have caused
   * before the initial estimate is locked. It grows with progress along the
   * route, not with distance walked: a wrong direction drifts sideways only
   * as the walk goes forward, so a walk straight off to the side gets no more
   * room than the fixed guard.
   */
  tolerance(baseMeters: number) {
    // Once the initial error has been estimated, the room left is small and
    // renewed only by agreeing stretches. It grows with progress, so walking
    // on past a missed corner - which makes none - gets no more of it.
    if (this.fixes > 0)
      return Math.min(
        POSE_HEADING_POLICY.lockedMaximumToleranceMeters,
        baseMeters +
          this.progressSinceFix * Math.tan(POSE_HEADING_POLICY.lockedUncertaintyDegrees * DEG),
      );
    return Math.min(
      POSE_HEADING_POLICY.maximumToleranceMeters,
      baseMeters +
        this.progressSinceFix * Math.tan(POSE_HEADING_POLICY.initialUncertaintyDegrees * DEG),
    );
  }

  /**
   * One corrected step, already matched to this progress, ending at this
   * point. Returns the point recomputed under a new correction, or null.
   */
  observe(
    track: RouteTrack,
    step: { dx: number; dy: number; meters: number },
    progress: number,
    point: { x: number; y: number },
  ): { x: number; y: number } | null {
    if (this.lastProgress !== null) this.progressSinceFix += Math.abs(progress - this.lastProgress);
    this.lastProgress = progress;
    if (this.origin === null) this.origin = { x: point.x - step.dx, y: point.y - step.dy };
    this.sinceX += step.dx;
    this.sinceY += step.dy;
    const leg = straightLegAt(track, progress);
    // A stretch is measured from here on; what came before it is still in the path since the last fix.
    const begin = () => {
      this.stretch = leg === null ? null : { ...leg, sumX: 0, sumY: 0, path: 0, half: null };
    };
    const stretch = this.stretch;
    if (leg === null || stretch === null || stretch.index !== leg.index) {
      if (leg === null || this.pending?.index !== leg.index) this.pending = null;
      begin();
      return null;
    }
    stretch.sumX += step.dx;
    stretch.sumY += step.dy;
    stretch.path += step.meters;
    if (stretch.half === null && stretch.path >= POSE_HEADING_POLICY.windowMeters / 2)
      stretch.half = { x: stretch.sumX, y: stretch.sumY };
    if (stretch.path < POSE_HEADING_POLICY.windowMeters) return null;

    // As the placement measured it, before any correction: what the bias is estimated from.
    const [rawX, rawY] = rotatePlanVector(stretch.sumX, stretch.sumY, this.biasDegrees);
    const raw = planBearing([0, 0], [rawX, rawY]);
    const firstHalf =
      stretch.half === null ? null : planBearing([0, 0], [stretch.half.x, stretch.half.y]);
    const secondHalf =
      stretch.half === null
        ? null
        : planBearing([0, 0], [stretch.sumX - stretch.half.x, stretch.sumY - stretch.half.y]);
    if (
      raw === null ||
      firstHalf === null ||
      secondHalf === null ||
      Math.abs(signedHeadingDifference(firstHalf, secondHalf)) >
        POSE_HEADING_POLICY.maximumBendDegrees ||
      Math.hypot(stretch.sumX, stretch.sumY) / stretch.path <
        POSE_HEADING_POLICY.minimumStraightness
    ) {
      begin();
      return null;
    }
    const implied = biasAlong(stretch.bearing, raw);
    const first = this.fixes === 0;
    const agrees = first
      ? Math.abs(implied) <= POSE_HEADING_POLICY.maximumFixDegrees
      : Math.abs(signedHeadingDifference(implied, this.biasDegrees)) <=
        POSE_HEADING_POLICY.refineAgreementDegrees;
    if (!agrees) {
      // Not direction error - or not one this estimate can take: a departure, a
      // different corridor. Leave it to the route matcher, and drop what led into it.
      this.pending = null;
      begin();
      return null;
    }
    const measured: Baseline = { index: stretch.index, bearing: stretch.bearing, rawX, rawY };
    // The first estimate is taken at once; a refinement is the stretch before this one.
    const confirmed = first ? measured : this.pending;
    this.pending = first ? null : measured;
    if (confirmed === null) {
      begin();
      return null;
    }
    const baseline: Baseline =
      this.baseline !== null && this.baseline.index === confirmed.index
        ? this.baseline
        : { index: confirmed.index, bearing: confirmed.bearing, rawX: 0, rawY: 0 };
    baseline.rawX += confirmed.rawX;
    baseline.rawY += confirmed.rawY;
    this.baseline = baseline;
    const overall = planBearing([0, 0], [baseline.rawX, baseline.rawY]);
    const next = overall === null ? implied : biasAlong(baseline.bearing, overall);
    const change = signedHeadingDifference(next, this.biasDegrees);
    this.fixes += 1;
    this.progressSinceFix = 0;
    begin();
    if (!first && Math.abs(change) < 0.05) return null;
    this.biasDegrees = next;
    this.epochValue += 1;
    // Every step since the path was last recomputed was turned by the old
    // estimate; turn it by the difference, from the same starting point.
    const [dx, dy] = rotatePlanVector(this.sinceX, this.sinceY, -change);
    const corrected = { x: this.origin.x + dx, y: this.origin.y + dy };
    this.origin = corrected;
    this.sinceX = 0;
    this.sinceY = 0;
    return corrected;
  }
}
