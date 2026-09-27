import { planBearing, signedHeadingDifference } from './coordinateFrames';
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
 * A corridor constrains walking. A steady angle between a straight stretch of
 * measured path and the leg it runs along is almost certainly the direction
 * being off, not a walk into the wall, so it is taken as a correction to the
 * direction - never to the position: the stretch is recomputed with the
 * corrected direction, not dropped onto the route line. Large angles, crooked
 * paths and stretches near corners teach nothing, and a genuine departure
 * still grows until the route matcher refuses it.
 *
 * Thresholds are provisional software guards, not surveyed corridor widths
 * or measured handset accuracy.
 */
export const POSE_HEADING_POLICY = Object.freeze({
  /** Metres of path along one leg before its direction is compared with the leg's. */
  windowMeters: 3,
  /** Straight-line distance over path length; below this the walk was not straight. */
  minimumStraightness: 0.9,
  /** Stretches this close to either end of a leg may be rounding a corner. */
  legEndMarginMeters: 1,
  /** A bigger angle than this over one stretch is not taken for direction error. */
  maximumFixDegrees: 30,
  /** Nor is a total correction bigger than this. */
  maximumTotalDegrees: 35,
  /** How far off the direction may be before any stretch has confirmed it. */
  initialUncertaintyDegrees: 20,
  /** And after one has. */
  fixedUncertaintyDegrees: 6,
  /** However far walked, the route matcher never looks further to the side than this. */
  maximumToleranceMeters: 4,
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
  for (let index = 0; index + 1 < track.points.length; index += 1) {
    const from = track.points[index];
    const to = track.points[index + 1];
    if (progress < track.at[index] || progress > track.at[index + 1]) continue;
    if (from.floor !== to.floor) return null;
    if (progress < track.at[index] + margin || progress > track.at[index + 1] - margin) return null;
    const bearing = planBearing([from.x, from.y], [to.x, to.y]);
    return bearing === null ? null : { index, bearing };
  }
  return null;
}

interface Stretch extends Leg {
  sumX: number;
  sumY: number;
  path: number;
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
  private epochValue = 0;

  /** Degrees subtracted from each measured step's bearing. */
  get bias() {
    return this.biasDegrees;
  }

  /** Changes whenever the correction does, so a drawing of the route knows to follow. */
  get epoch() {
    return this.epochValue;
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
    this.epochValue += 1;
  }

  /** A measured step, turned by the correction learned so far. */
  correct(dx: number, dy: number): [number, number] {
    return this.biasDegrees === 0 ? [dx, dy] : rotatePlanVector(dx, dy, -this.biasDegrees);
  }

  /**
   * How far to the side of the route the matcher should still look: the
   * sideways drift the remaining direction uncertainty could have caused
   * since the direction was last confirmed. It grows with progress along the
   * route, not with distance walked: a wrong direction drifts sideways only
   * as the walk goes forward, so a walk straight off to the side gets no more
   * room than the fixed guard.
   */
  tolerance(baseMeters: number) {
    const uncertainty =
      this.fixes === 0
        ? POSE_HEADING_POLICY.initialUncertaintyDegrees
        : POSE_HEADING_POLICY.fixedUncertaintyDegrees;
    return Math.min(
      POSE_HEADING_POLICY.maximumToleranceMeters,
      baseMeters + this.progressSinceFix * Math.tan(uncertainty * DEG),
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
      this.stretch = leg === null ? null : { ...leg, sumX: 0, sumY: 0, path: 0 };
    };
    const stretch = this.stretch;
    if (leg === null || stretch === null || stretch.index !== leg.index) {
      begin();
      return null;
    }
    stretch.sumX += step.dx;
    stretch.sumY += step.dy;
    stretch.path += step.meters;
    if (stretch.path < POSE_HEADING_POLICY.windowMeters) return null;

    const travel = planBearing([0, 0], [stretch.sumX, stretch.sumY]);
    if (
      travel === null ||
      Math.hypot(stretch.sumX, stretch.sumY) / stretch.path <
        POSE_HEADING_POLICY.minimumStraightness
    ) {
      begin();
      return null;
    }
    // Along the leg either way: walking back down it is still walking along it.
    const forward = signedHeadingDifference(stretch.bearing, travel);
    const along =
      Math.abs(forward) <= 90 ? forward : signedHeadingDifference(stretch.bearing + 180, travel);
    const next = this.biasDegrees - along;
    if (
      Math.abs(along) > POSE_HEADING_POLICY.maximumFixDegrees ||
      Math.abs(next) > POSE_HEADING_POLICY.maximumTotalDegrees
    ) {
      begin();
      return null;
    }
    this.biasDegrees = next;
    this.fixes += 1;
    this.progressSinceFix = 0;
    this.epochValue += 1;
    const [dx, dy] = rotatePlanVector(this.sinceX, this.sinceY, along);
    const corrected = { x: this.origin.x + dx, y: this.origin.y + dy };
    this.origin = corrected;
    this.sinceX = 0;
    this.sinceY = 0;
    begin();
    return corrected;
  }
}
