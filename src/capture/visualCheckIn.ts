import type { QrFrameObservation } from './qrDecoder';

/**
 * A candidate for a calibrated visual-pose solve, NOT heading evidence.
 * Kept only in the current Visitor check-in, never persisted or sent to the
 * recorder. A payload, corners and an authored heading are insufficient:
 * camera intrinsics, surveyed mounting and synchronized attitude are missing.
 */
export interface VisualCheckInCandidate {
  status: 'unqualified';
  venueKey: string;
  anchorId: string;
  observation: QrFrameObservation;
}

/** Capture-age guard only; does not establish exposure/IMU synchronization. */
export const VISUAL_CHECKIN_MAX_COPY_AGE_MS = 500;

export function bindVisualCheckIn(
  observation: QrFrameObservation | null | undefined,
  anchor: { id: string; payload: string },
  venueKey: string,
  nowMs: number,
): VisualCheckInCandidate | null {
  if (
    !observation ||
    observation.payload !== anchor.payload ||
    !venueKey ||
    !Number.isFinite(nowMs) ||
    !Number.isFinite(observation.frame.copiedAtMs) ||
    observation.frame.copiedAtMs < 0 ||
    nowMs < observation.frame.copiedAtMs ||
    nowMs - observation.frame.copiedAtMs > VISUAL_CHECKIN_MAX_COPY_AGE_MS
  )
    return null;
  // Own a small value-only copy; retain no pixels, media stream or device identifier.
  const corners = observation.corners;
  return {
    status: 'unqualified',
    venueKey,
    anchorId: anchor.id,
    observation: {
      ...observation,
      frame: { ...observation.frame },
      corners: corners
        ? [{ ...corners[0] }, { ...corners[1] }, { ...corners[2] }, { ...corners[3] }]
        : null,
    },
  };
}
