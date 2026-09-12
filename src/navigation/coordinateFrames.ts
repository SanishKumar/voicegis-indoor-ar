/**
 * Visitor plan frame: metres, +X right, +Y down, elevation up. Bearings are
 * clockwise from plan-up (-Y), NOT compass headings. The replay filter's local
 * +Y-up frame is a different frame; reflect positions at that boundary.
 */
export type PlanPosition = readonly [number, number];

export function wrapDegrees(degrees: number): number {
  if (!Number.isFinite(degrees)) throw new Error('Angle must be finite.');
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped === 0 ? 0 : wrapped;
}

export function signedHeadingDifference(target: number, current: number): number {
  return ((wrapDegrees(target) - wrapDegrees(current) + 540) % 360) - 180;
}

export function planBearing(from: PlanPosition, to: PlanPosition): number | null {
  if (![...from, ...to].every(Number.isFinite)) return null;
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) return null;
  return wrapDegrees((Math.atan2(dx, -dy) * 180) / Math.PI);
}

export function planDisplacement(bearing: number, distanceMeters: number): [number, number] {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) {
    throw new Error('Distance must be finite and non-negative.');
  }
  const radians = (wrapDegrees(bearing) * Math.PI) / 180;
  return [Math.sin(radians) * distanceMeters, -Math.cos(radians) * distanceMeters];
}

/** An involution: use the same reflection to return from filter XY to plan XY. */
export function reflectPlanFilterPosition(position: PlanPosition): [number, number] {
  if (!position.every(Number.isFinite)) throw new Error('Position must be finite.');
  return [position[0] === 0 ? 0 : position[0], position[1] === 0 ? 0 : -position[1]];
}

export type HeadingAxis = 'camera-forward' | 'device-top' | 'travel' | 'unspecified';
export type HeadingReference =
  | { kind: 'venue-plan'; venueKey: string }
  | { kind: 'true-north' }
  | { kind: 'magnetic-north' }
  | { kind: 'relative' };

/** No anchor-payload source: a decoded QR supplies position, not this reading. */
export interface HeadingReading {
  degrees: number;
  reference: HeadingReference;
  axis: HeadingAxis;
  source: 'measured-pose' | 'explicit-calibration' | 'browser-compass' | 'device-orientation';
  /** Occurrence time in the consumer's monotonic millisecond clock, not Date.now(). */
  timeMs: number;
  /** Null means unreported, never perfect accuracy. */
  accuracyDegrees: number | null;
}

export interface NorthAlignment {
  venueKey: string;
  /** Clockwise angle from plan-up (-Y) to TRUE north. True heading + this = plan bearing. */
  northBearingInPlanDegrees: number;
  accuracyDegrees: number;
  provenanceId: string;
}

export interface MagneticCorrection {
  /** East-positive declination: true heading = magnetic heading + declination. */
  declinationDegrees: number;
  accuracyDegrees: number;
  provenanceId: string;
}

export interface HeadingContext {
  venueKey: string;
  axis: Exclude<HeadingAxis, 'unspecified'>;
  nowMs: number;
  maximumAgeMs: number;
  maximumAccuracyDegrees: number;
  northAlignment: NorthAlignment | null;
  magneticCorrection: MagneticCorrection | null;
}

export type UnknownHeadingReason =
  | 'no-reading'
  | 'invalid-reading'
  | 'stale'
  | 'relative-only'
  | 'axis-unverified'
  | 'accuracy-unknown'
  | 'too-uncertain'
  | 'venue-mismatch'
  | 'north-unverified'
  | 'magnetic-north-uncorrected';

export type PlanHeading =
  | { status: 'unknown'; reason: UnknownHeadingReason }
  | {
      status: 'known';
      degrees: number;
      accuracyDegrees: number;
      timeMs: number;
      venueKey: string;
      axis: HeadingContext['axis'];
      source: HeadingReading['source'];
      alignmentProvenanceIds: string[];
    };

function accuracyValid(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0 && value <= 180;
}

/** Pure, fail-closed conversion. This is not a pose estimator or an evidence seal. */
export function resolvePlanHeading(
  reading: HeadingReading | null,
  context: HeadingContext,
): PlanHeading {
  const unknown = (reason: UnknownHeadingReason): PlanHeading => ({ status: 'unknown', reason });
  if (reading === null) return unknown('no-reading');
  if (
    !Number.isFinite(context.nowMs) ||
    context.nowMs < 0 ||
    !Number.isFinite(context.maximumAgeMs) ||
    context.maximumAgeMs < 0 ||
    !accuracyValid(context.maximumAccuracyDegrees) ||
    !Number.isFinite(reading.degrees) ||
    !Number.isFinite(reading.timeMs) ||
    reading.timeMs < 0 ||
    reading.timeMs > context.nowMs
  )
    return unknown('invalid-reading');
  if (context.nowMs - reading.timeMs > context.maximumAgeMs) return unknown('stale');
  if (reading.reference.kind === 'relative') return unknown('relative-only');
  if (reading.axis !== context.axis) return unknown('axis-unverified');
  if (!accuracyValid(reading.accuracyDegrees)) return unknown('accuracy-unknown');

  let degrees = wrapDegrees(reading.degrees);
  let accuracyDegrees = reading.accuracyDegrees;
  const alignmentProvenanceIds: string[] = [];
  if (reading.reference.kind === 'venue-plan') {
    if (reading.reference.venueKey !== context.venueKey) return unknown('venue-mismatch');
    // A browser compass cannot become venue-relative just by changing its tag.
    if (reading.source !== 'measured-pose' && reading.source !== 'explicit-calibration') {
      return unknown('invalid-reading');
    }
  } else {
    if (reading.reference.kind === 'magnetic-north') {
      const correction = context.magneticCorrection;
      if (
        !correction ||
        !Number.isFinite(correction.declinationDegrees) ||
        !accuracyValid(correction.accuracyDegrees) ||
        !correction.provenanceId.trim()
      ) {
        return unknown('magnetic-north-uncorrected');
      }
      degrees = wrapDegrees(degrees + wrapDegrees(correction.declinationDegrees));
      accuracyDegrees += correction.accuracyDegrees;
      alignmentProvenanceIds.push(correction.provenanceId);
    } else if (reading.reference.kind !== 'true-north') {
      return unknown('invalid-reading');
    }
    const alignment = context.northAlignment;
    if (
      !alignment ||
      !Number.isFinite(alignment.northBearingInPlanDegrees) ||
      !accuracyValid(alignment.accuracyDegrees) ||
      !alignment.provenanceId.trim()
    ) {
      return unknown('north-unverified');
    }
    if (alignment.venueKey !== context.venueKey) return unknown('venue-mismatch');
    degrees = wrapDegrees(degrees + wrapDegrees(alignment.northBearingInPlanDegrees));
    // Conservative error bound; no independence/covariance assumption.
    accuracyDegrees += alignment.accuracyDegrees;
    alignmentProvenanceIds.push(alignment.provenanceId);
  }
  if (accuracyDegrees > context.maximumAccuracyDegrees) return unknown('too-uncertain');
  return {
    status: 'known',
    degrees,
    accuracyDegrees,
    timeMs: reading.timeMs,
    venueKey: context.venueKey,
    axis: context.axis,
    source: reading.source,
    alignmentProvenanceIds,
  };
}
