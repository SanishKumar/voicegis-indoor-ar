import { isFiniteNumber, normalizeZero } from './internalDescriptors';
import type {
  AngularRateUnits,
  DeviceOrientationSample,
  SensorFrame,
  Vector3,
} from './captureStream';

/**
 * Turning a gyroscope reading into a rate of change of compass heading.
 *
 * This module exists because "yaw rate" was never a defined quantity here. The
 * reduction took `gyroscope[2]`, which is the rate of turn a walker cares about
 * only when the handset lies flat, and it ignored the declared angular-rate
 * units entirely — a capture in rad/s integrated a heading 57 times too slowly
 * while passing every check. Both are fixed here, and the terms the fix depends
 * on are written down rather than assumed.
 *
 * ## The frames
 *
 * **Device frame** is the W3C convention shared by DeviceMotion and the Generic
 * Sensor API: +X out of the right edge of the screen, +Y out of the top edge,
 * +Z out of the face towards the viewer. Rates are right-handed — positive is
 * counter-clockwise seen from the positive end of the axis.
 *
 * **Declared world frame** (`frame: 'world'`) is North-East-Down. The third axis
 * points at the ground, so a right-handed rate about it is positive when the
 * device turns clockwise seen from above, which is the direction a compass
 * heading increases. That is what makes the world path a straight read of the
 * third component.
 *
 * NED is chosen over the East-North-Up frame the orientation event uses because
 * heading is an NED quantity: rotation about Down *is* rate of change of
 * heading, with no sign to remember. The two differ only in the direction of
 * the vertical axis, so a rate about Up is the negation of a rate about Down.
 *
 * ## The projection
 *
 * `DeviceOrientationSample` gives alpha, beta and gamma, which the orientation
 * event defines as intrinsic Z-X'-Y'' rotations taking the device frame into
 * East-North-Up. Composing them gives a rotation matrix whose third row is the
 * world-up axis expressed in device coordinates:
 *
 *     [ -cos(beta)sin(gamma),  sin(beta),  cos(beta)cos(gamma) ]
 *
 * Dotting that row with the gyroscope vector is the component of the turn that
 * is about true vertical; negating it converts a rate about Up into the rate
 * about Down that heading is measured in.
 *
 * Alpha does not appear, and its absence is the point. A rotation *about* the
 * vertical axis cannot change which axis is vertical, so the projection needs
 * only the tilt. This is why `absolute: false` orientation is still usable:
 * a device that never found true north still knows which way is down.
 *
 * The postures the algebra was checked against:
 *
 * | Posture                     | beta | gamma | World up is |
 * | --------------------------- | ---- | ----- | ----------- |
 * | flat, face up               | 0    | 0     | +Z          |
 * | upright portrait            | 90   | 0     | +Y          |
 * | flat, face down             | 180  | 0     | -Z          |
 * | on its left edge, landscape | 0    | 90    | -X          |
 *
 * The first row is the case the old reduction assumed always held. The second
 * is the natural posture for walking a building while looking at the screen,
 * and there the old code read an axis that is horizontal — a turn produced no
 * heading change at all, and a nod produced a large one.
 */

const DEGREES_PER_RADIAN = 180 / Math.PI;
const RADIANS_PER_DEGREE = Math.PI / 180;

/**
 * The component of a device-frame vector that lies along world vertical,
 * positive towards the sky.
 *
 * Exported for its own tests. It is pure geometry and knows nothing about
 * gyroscopes: the same projection applies to any device-frame vector.
 *
 * Deliberately unguarded — a non-finite input propagates rather than becoming
 * null. The refusal belongs at `headingRateDegreesPerSecond`, which is the only
 * path into heading integration; putting it here as well would give two places
 * an opinion about what an unusable sample is.
 */
export function worldUpComponent(vector: Vector3, betaDegrees: number, gammaDegrees: number) {
  const beta = betaDegrees * RADIANS_PER_DEGREE;
  const gamma = gammaDegrees * RADIANS_PER_DEGREE;
  const cosBeta = Math.cos(beta);

  return normalizeZero(
    -cosBeta * Math.sin(gamma) * vector[0] +
      Math.sin(beta) * vector[1] +
      cosBeta * Math.cos(gamma) * vector[2],
  );
}

/**
 * Rate of change of compass heading in degrees per second, or null when the
 * sample cannot yield one.
 *
 * Null is a refusal, not a zero. A device-frame sample with no orientation
 * carries no information about which way is up, so its turn cannot be resolved
 * into a heading change. Returning zero would assert that the walker did not
 * turn, which is a claim the data does not support and the kind of invention
 * that makes a drifted heading look confident. The caller is expected to skip
 * the sample rather than integrate it.
 */
export function headingRateDegreesPerSecond(
  gyroscope: Vector3,
  orientation: DeviceOrientationSample | null,
  sensors: { frame: SensorFrame; gyroscopeUnits: AngularRateUnits },
): number | null {
  // Validation already bounds these, but this is exported and pure, and a NaN
  // reaching heading integration poisons every later estimate silently.
  if (!isFiniteNumber(gyroscope[0]) || !isFiniteNumber(gyroscope[1]) || !isFiniteNumber(gyroscope[2])) {
    return null;
  }

  const toDegrees = sensors.gyroscopeUnits === 'rad/s' ? DEGREES_PER_RADIAN : 1;

  if (sensors.frame === 'world') {
    // Already resolved into North-East-Down by whatever produced the stream, so
    // the third component is the rate about Down and needs no projection. What
    // performed that resolution is not recorded anywhere; see known-seams.
    return normalizeZero(gyroscope[2] * toDegrees);
  }

  if (orientation === null) return null;
  if (!isFiniteNumber(orientation.betaDegrees) || !isFiniteNumber(orientation.gammaDegrees)) {
    return null;
  }

  // A rate about Up, negated into the rate about Down that heading measures.
  const aboutUp = worldUpComponent(gyroscope, orientation.betaDegrees, orientation.gammaDegrees);
  return normalizeZero(-aboutUp * toDegrees);
}
