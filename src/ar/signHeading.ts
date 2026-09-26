import { wrapDegrees } from '../navigation/coordinateFrames';
import type { OrientationReading } from './sharedOrientation';

/**
 * An approximate camera direction from scanning a check-in sign.
 *
 * A sign's `headingDegrees` is the plan bearing its printed face points - its
 * outward normal, away from the wall it is mounted on. Someone scanning it is
 * looking at it, so at that moment the camera points roughly the opposite
 * way. Roughly: nobody proves they scanned square-on, and a scan from an
 * angle still decodes. The visitor is asked to face the sign squarely, and
 * the result is treated as approximate wherever it is used - good for which
 * way to turn, not a claim of precise alignment. A calibrated pose from the
 * code's corners is the separate, precise path (docs/localization/visual-marker-heading.md).
 *
 * It is the platform's yaw at the scan paired with that bearing, so it means
 * something only while the same orientation readings keep arriving: every
 * use checks its epoch against the live feed's.
 */
export interface SignHeading {
  source: 'sign';
  anchorId: string;
  venueKey: string;
  /** The camera's plan bearing at the scan: the sign's facing, reversed. */
  planBearing: number;
  yawDegrees: number;
  epoch: number;
  timeMs: number;
}

export type SignHeadingRefusal = 'no-frame' | 'no-sign-heading' | 'no-orientation' | 'not-level';

/** An orientation reading this far from the decoded frame did not describe that frame. */
export const SIGN_READING_MAX_SKEW_MS = 150;
/**
 * Wall signs are scanned with the camera near level. Much steeper, and the
 * camera's yaw no longer says which way the visitor is facing.
 */
export const SIGN_MAX_PITCH_DEGREES = 40;

export function signHeadingFrom(input: {
  anchor: { id: string; headingDegrees?: number | null };
  venueKey: string;
  /** When the decoded frame was taken from the camera; null for a link. */
  frameTimeMs: number | null;
  reading: OrientationReading | null;
}): { heading: SignHeading; refusal: null } | { heading: null; refusal: SignHeadingRefusal } {
  const { anchor, venueKey, frameTimeMs, reading } = input;
  if (frameTimeMs === null || !Number.isFinite(frameTimeMs))
    return { heading: null, refusal: 'no-frame' };
  const facing = anchor.headingDegrees;
  if (typeof facing !== 'number' || !Number.isFinite(facing))
    return { heading: null, refusal: 'no-sign-heading' };
  if (
    reading === null ||
    !Number.isFinite(reading.yawDegrees) ||
    !Number.isFinite(reading.timeMs) ||
    Math.abs(reading.timeMs - frameTimeMs) > SIGN_READING_MAX_SKEW_MS
  )
    return { heading: null, refusal: 'no-orientation' };
  if (
    !Number.isFinite(reading.pitchDegrees) ||
    Math.abs(reading.pitchDegrees) > SIGN_MAX_PITCH_DEGREES
  )
    return { heading: null, refusal: 'not-level' };
  return {
    heading: {
      source: 'sign',
      anchorId: anchor.id,
      venueKey,
      planBearing: wrapDegrees(facing + 180),
      yawDegrees: reading.yawDegrees,
      epoch: reading.epoch,
      timeMs: reading.timeMs,
    },
    refusal: null,
  };
}
