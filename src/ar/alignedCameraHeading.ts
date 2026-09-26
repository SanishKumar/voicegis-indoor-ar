import { wrapDegrees } from '../navigation/coordinateFrames';
import type { FacingAnchor } from './facingFrom';

/**
 * Manual fallback only. An arbitrary yaw, authored sign heading, route bearing,
 * or walking direction is not a measured camera-to-building alignment.
 * The later visual-pose bridge must use its own synchronized, qualified source.
 * Thresholds here are provisional; synthetic tests do not qualify a handset.
 */
export function alignedCameraHeading(
  reading: { yawDegrees: number; pitchDegrees: number; epoch: number; timeMs: number } | null,
  anchor: FacingAnchor | null,
  nowMs: number,
): number | null {
  if (
    !reading ||
    !anchor ||
    (anchor.source !== 'visitor' && anchor.source !== 'sign') ||
    anchor.axis !== 'camera-forward' ||
    anchor.epoch !== reading.epoch ||
    ![
      reading.yawDegrees,
      reading.pitchDegrees,
      reading.timeMs,
      anchor.yawDegrees,
      anchor.planBearing,
      nowMs,
    ].every(Number.isFinite) ||
    nowMs < reading.timeMs ||
    nowMs - reading.timeMs > 100 ||
    // At vertical the feed substitutes device-top for camera yaw. That is not
    // the camera-forward axis used for this transfer. Wait for a usable pose.
    Math.abs(reading.pitchDegrees) >= 70
  )
    return null;
  return wrapDegrees(anchor.planBearing + reading.yawDegrees - anchor.yawDegrees);
}
