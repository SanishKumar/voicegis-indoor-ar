import {
  resolvePlanHeading,
  type HeadingReading,
  type PlanHeading,
} from '../navigation/coordinateFrames';

/** UI freshness guard, not a field-validated navigation tolerance. */
export const PREVIEW_HEADING_MAX_AGE_MS = 2_000;

export interface PreviewOrientationEvent {
  timeStamp: number;
  alpha?: number | null;
  absolute?: boolean;
  webkitCompassHeading?: number | null;
  webkitCompassAccuracy?: number | null;
}

export interface PreviewHeading {
  label: string;
  planHeading: PlanHeading;
}

/**
 * Browser diagnostic boundary, deliberately stricter than an orientation dial.
 * W3C relative alpha has an arbitrary zero. Absolute alpha alone does not define
 * the camera-forward azimuth (tilt/axis/reference/accuracy are also needed).
 * WebKit explicitly reports magnetic north, not the venue's plan-up direction.
 * Neither a route bearing nor an anchor's authored heading calibrates a phone.
 *
 * Existing VenuePackages contain no verified heading-alignment provenance. Do
 * not reinterpret their northOffsetDegrees as a surveyed camera calibration.
 */
export function readPreviewHeading(
  event: PreviewOrientationEvent,
  nowMs: number,
  venueKey: string,
): PreviewHeading {
  const refused = (
    label: string,
    reason: 'invalid-reading' | 'relative-only' | 'stale' | 'axis-unverified',
  ): PreviewHeading => ({
    label,
    planHeading: { status: 'unknown', reason },
  });
  if (
    !Number.isFinite(nowMs) ||
    nowMs < 0 ||
    !Number.isFinite(event.timeStamp) ||
    event.timeStamp < 0 ||
    event.timeStamp > nowMs
  )
    return refused('Unavailable', 'invalid-reading');
  if (nowMs - event.timeStamp > PREVIEW_HEADING_MAX_AGE_MS) return refused('Stale', 'stale');

  if (event.webkitCompassHeading !== undefined) {
    const degrees = event.webkitCompassHeading;
    const accuracy = event.webkitCompassAccuracy;
    // A negative WebKit heading/accuracy is an invalid reading, not an angle
    // to wrap, and must not fall through to the arbitrary alpha channel.
    if (
      degrees === null ||
      !Number.isFinite(degrees) ||
      degrees < 0 ||
      degrees > 360 ||
      (accuracy !== undefined &&
        accuracy !== null &&
        (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 180))
    ) {
      return refused('Unavailable', 'invalid-reading');
    }
    const reading: HeadingReading = {
      degrees,
      accuracyDegrees: accuracy ?? null,
      timeMs: event.timeStamp,
      reference: { kind: 'magnetic-north' },
      axis: 'unspecified',
      source: 'browser-compass',
    };
    return {
      label: 'Uncalibrated',
      planHeading: resolvePlanHeading(reading, {
        venueKey,
        axis: 'camera-forward',
        nowMs,
        maximumAgeMs: PREVIEW_HEADING_MAX_AGE_MS,
        maximumAccuracyDegrees: 25,
        northAlignment: null,
        magneticCorrection: null,
      }),
    };
  }
  if (
    event.alpha === null ||
    event.alpha === undefined ||
    !Number.isFinite(event.alpha) ||
    event.alpha < 0 ||
    event.alpha >= 360
  )
    return refused('Unavailable', 'invalid-reading');
  return event.absolute === true
    ? refused('Uncalibrated', 'axis-unverified')
    : refused('Relative only', 'relative-only');
}
