import { wrapDegrees } from '../navigation/coordinateFrames';

/**
 * Which way the phone's rear camera is pointing, from the orientation angles
 * the browser reports.
 *
 * This is what makes a camera view augmented rather than decorated: the route
 * can only be drawn where the floor is if the view knows how far the phone is
 * tilted and which way it has been turned. Without it the overlay is a picture
 * painted on the glass that stays put however the phone moves.
 *
 * The W3C angles are three intrinsic rotations, Z-X'-Y'' by alpha, beta and
 * gamma, taking the device's frame to an Earth frame of x east, y north,
 * z up. Rebuilding that matrix and reading the camera's axes out of it avoids
 * the trap in the angles themselves: a phone held upright to look ahead sits
 * at beta = 90, which is exactly where the alpha/gamma decomposition is
 * degenerate. The matrix is not, so the answers here stay stable there.
 *
 * The yaw has no true zero. Alpha's zero is arbitrary unless the platform says
 * the reading is absolute, and even then it is magnetic north rather than the
 * building's. Only differences in yaw are meaningful, which is all this view
 * asks of it: turning the phone must turn the route by the same angle.
 */

export interface DeviceAttitude {
  /** The camera's optical axis above the horizon, in degrees; negative looks down. */
  pitchDegrees: number;
  /** Rotation of the image about that axis, in degrees, positive swinging the floor right. */
  rollDegrees: number;
  /** Which way the camera looks across the ground, clockwise, from an arbitrary zero. */
  yawDegrees: number;
}

const DEG = Math.PI / 180;

/**
 * Below this much of the camera's axis lying in the horizontal plane, the
 * direction it looks across the ground is noise: the phone is pointed at the
 * floor or the ceiling. The top of the screen - which is what a person
 * walking holds ahead of them - stands in.
 */
const HORIZONTAL_FLOOR = 0.25;

/**
 * @param screenAngleDegrees `screen.orientation.angle`: how far the interface
 * has been turned inside the device, which turns the image with it. The
 * camera view is portrait, and this has not been checked on a handset held
 * in landscape.
 */
export function attitudeFrom(
  alphaDegrees: number,
  betaDegrees: number,
  gammaDegrees: number,
  screenAngleDegrees = 0,
): DeviceAttitude {
  const alpha = alphaDegrees * DEG;
  const beta = betaDegrees * DEG;
  const gamma = gammaDegrees * DEG;
  const cA = Math.cos(alpha);
  const sA = Math.sin(alpha);
  const cB = Math.cos(beta);
  const sB = Math.sin(beta);
  const cG = Math.cos(gamma);
  const sG = Math.sin(gamma);

  // The device's own axes in the Earth frame: the columns of Rz(a)Rx(b)Ry(g).
  // Screen right, screen top, and out of the screen towards the viewer.
  const right = [cA * cG - sA * sB * sG, sA * cG + cA * sB * sG, -cB * sG];
  const up = [-sA * cB, cA * cB, sB];
  // The rear camera looks the other way from the screen: along the device's -z.
  const forward = [-(cA * sG + sA * sB * cG), cA * sB * cG - sA * sG, -cB * cG];

  const pitchDegrees = (Math.asin(Math.max(-1, Math.min(1, forward[2]))) * 180) / Math.PI;
  const level = Math.hypot(forward[0], forward[1]);
  const across = level >= HORIZONTAL_FLOOR ? forward : up;
  // A bearing clockwise from north is atan2(east, north), as a plan bearing
  // clockwise from plan-up is atan2(dx, -dy).
  const yawDegrees = wrapDegrees((Math.atan2(across[0], across[1]) * 180) / Math.PI);
  // World up seen in the image plane: how far the horizon has tipped.
  const rollDegrees = wrapDegrees(
    (Math.atan2(-right[2], up[2]) * 180) / Math.PI - screenAngleDegrees,
  );

  return {
    pitchDegrees,
    rollDegrees: rollDegrees > 180 ? rollDegrees - 360 : rollDegrees,
    yawDegrees,
  };
}

/** The angles a `deviceorientation` event carries, when it carries all three. */
export interface OrientationAngles {
  alpha?: number | null;
  beta?: number | null;
  gamma?: number | null;
}

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** The attitude an orientation event describes, or null when it describes none. */
export function attitudeFromEvent(
  event: OrientationAngles,
  screenAngleDegrees = 0,
): DeviceAttitude | null {
  if (!finite(event.alpha) || !finite(event.beta) || !finite(event.gamma)) return null;
  return attitudeFrom(event.alpha, event.beta, event.gamma, screenAngleDegrees);
}
