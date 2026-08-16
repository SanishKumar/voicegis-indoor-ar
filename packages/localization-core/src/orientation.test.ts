import { describe, expect, it } from 'vitest';
import { headingRateDegreesPerSecond, worldUpComponent } from './orientation';
import { reduceImuEvent } from './captureStream';
import { DeadReckoningIntegrator } from './deadReckoning';
import type {
  CaptureSensorProfile,
  DeviceOrientationSample,
  ImuCaptureEvent,
  Vector3,
} from './captureStream';

/**
 * Heading came from `gyroscope[2]`, which is the turn a walker makes only when
 * the handset is flat. Held upright — the posture someone actually walks a
 * building in — that component is horizontal, so turning a corner produced no
 * heading change and nodding at the screen produced a large one.
 *
 * Every value the old reduction produced was plausible, which is why this is
 * checked against postures with known answers rather than against a fixture.
 */

const flat: DeviceOrientationSample = {
  alphaDegrees: 0,
  betaDegrees: 0,
  gammaDegrees: 0,
  absolute: true,
};

function orientation(betaDegrees: number, gammaDegrees: number, alphaDegrees = 0) {
  return { alphaDegrees, betaDegrees, gammaDegrees, absolute: true };
}

const world = { frame: 'world', gyroscopeUnits: 'deg/s' } as const;
const device = { frame: 'device', gyroscopeUnits: 'deg/s' } as const;

describe('projecting a device vector onto world vertical', () => {
  const probe: Vector3 = [3, 5, 7];

  it('finds vertical in each posture whose answer is known by inspection', () => {
    // Flat and face up: the screen normal points at the sky.
    expect(worldUpComponent(probe, 0, 0)).toBeCloseTo(7, 12);
    // Upright portrait: the top edge of the handset points at the sky. This is
    // the posture the old reduction got wrong.
    expect(worldUpComponent(probe, 90, 0)).toBeCloseTo(5, 12);
    // Face down: the screen normal points at the floor.
    expect(worldUpComponent(probe, 180, 0)).toBeCloseTo(-7, 12);
    // Resting on its left edge: the right edge points at the sky.
    expect(worldUpComponent(probe, 0, 90)).toBeCloseTo(-3, 12);
    // Tilted back 45 degrees: vertical is shared evenly between two axes.
    expect(worldUpComponent(probe, 45, 0)).toBeCloseTo((5 + 7) / Math.SQRT2, 12);
  });

  it('reads as a unit direction at every tilt', () => {
    // The projection is a row of a rotation matrix, so its three coefficients
    // must have unit norm. A scaling bug would inflate every heading rate
    // uniformly and no single posture check would notice.
    for (let beta = -180; beta <= 180; beta += 7) {
      for (let gamma = -90; gamma <= 90; gamma += 7) {
        const x = worldUpComponent([1, 0, 0], beta, gamma);
        const y = worldUpComponent([0, 1, 0], beta, gamma);
        const z = worldUpComponent([0, 0, 1], beta, gamma);
        expect(Math.hypot(x, y, z)).toBeCloseTo(1, 12);
      }
    }
  });

  it('is linear in the vector it projects', () => {
    const a: Vector3 = [1, -2, 3];
    const b: Vector3 = [-4, 5, 0.5];
    const sum: Vector3 = [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

    expect(worldUpComponent(sum, 37, -21)).toBeCloseTo(
      worldUpComponent(a, 37, -21) + worldUpComponent(b, 37, -21),
      12,
    );
  });

  it('reports no vertical component for a turn that is purely horizontal', () => {
    // Upright portrait: rotation about the screen normal is a roll, and rolling
    // the handset does not change which way the walker is facing.
    expect(worldUpComponent([0, 0, 9], 90, 0)).toBeCloseTo(0, 12);
  });
});

describe('resolving a heading rate', () => {
  it('reads the third component directly when the stream is already world-frame', () => {
    // The declared world frame is North-East-Down, so a right-handed rate about
    // the third axis is already the rate at which heading increases. This is
    // the one path whose numbers are unchanged by orientation awareness.
    expect(headingRateDegreesPerSecond([1, 2, 30], null, world)).toBe(30);
    expect(headingRateDegreesPerSecond([1, 2, 30], flat, world)).toBe(30);
  });

  it('converts radians per second, which used to be integrated as degrees', () => {
    // A rad/s capture validated cleanly and then integrated a heading roughly
    // 57 times too slowly, because the declared units were never applied.
    const oneRadianPerSecond = headingRateDegreesPerSecond(
      [0, 0, 1],
      null,
      { frame: 'world', gyroscopeUnits: 'rad/s' },
    );

    expect(oneRadianPerSecond).toBeCloseTo(57.29577951, 6);
  });

  it('turns a device-frame turn into the direction heading moves', () => {
    // Flat and face up, the screen normal points at the sky. A right-handed
    // turn about it is counter-clockwise seen from above, and compass heading
    // decreases counter-clockwise.
    expect(headingRateDegreesPerSecond([0, 0, 10], flat, device)).toBeCloseTo(-10, 12);
  });

  it('uses the axis that is actually vertical for the posture', () => {
    const upright = orientation(90, 0);

    // Held upright, a turn of the walker's body shows up on the device Y axis.
    expect(headingRateDegreesPerSecond([0, 10, 0], upright, device)).toBeCloseTo(-10, 12);
    // And the component the old reduction read is now correctly ignored: this
    // is a nod, not a turn.
    expect(headingRateDegreesPerSecond([0, 0, 10], upright, device)).toBeCloseTo(0, 12);
  });

  it('does not need orientation to be absolute', () => {
    // Only tilt is used, never alpha: a rotation about vertical cannot change
    // which axis is vertical. A handset that never found true north still knows
    // which way is down, so a relative orientation is fully usable here.
    const gyroscope: Vector3 = [2, -3, 4];
    const relative = { alphaDegrees: 0, betaDegrees: 33, gammaDegrees: -12, absolute: false };
    const absolute = { alphaDegrees: 197, betaDegrees: 33, gammaDegrees: -12, absolute: true };

    expect(headingRateDegreesPerSecond(gyroscope, relative, device)).toBe(
      headingRateDegreesPerSecond(gyroscope, absolute, device),
    );
  });

  it('refuses a device-frame sample that does not say which way is up', () => {
    // Null rather than zero. Zero would assert the walker held their course,
    // which is a measurement nobody took.
    expect(headingRateDegreesPerSecond([0, 0, 10], null, device)).toBeNull();
  });

  it('refuses values that would poison the integration silently', () => {
    expect(headingRateDegreesPerSecond([Number.NaN, 0, 0], flat, device)).toBeNull();
    expect(headingRateDegreesPerSecond([0, 0, Number.POSITIVE_INFINITY], null, world)).toBeNull();
    expect(headingRateDegreesPerSecond([0, 0, 1], orientation(Number.NaN, 0), device)).toBeNull();
    expect(headingRateDegreesPerSecond([0, 0, 1], orientation(0, Number.NaN), device)).toBeNull();
  });

  it('never reports negative zero', () => {
    // A signed zero survives JSON and arithmetic and compares equal to zero, so
    // it hides in a diff of two artifacts that should be identical.
    expect(Object.is(headingRateDegreesPerSecond([0, 0, 0], flat, device), 0)).toBe(true);
    expect(Object.is(headingRateDegreesPerSecond([0, 0, -0], null, world), 0)).toBe(true);
    expect(Object.is(worldUpComponent([0, -0, 0], 90, 0), 0)).toBe(true);
  });
});

const deviceSensors: CaptureSensorProfile = {
  api: 'devicemotion',
  gyroscopeUnits: 'deg/s',
  frame: 'device',
};

function imuEvent(
  timeMs: number,
  gyroscope: Vector3,
  orientationSample: DeviceOrientationSample | null,
): ImuCaptureEvent {
  return {
    type: 'imu',
    sequence: timeMs,
    timeMs,
    accelerometer: [0, 0, 9.81],
    gyroscope,
    orientation: orientationSample,
  };
}

/** Feeds one second of samples at 100 ms and returns the integrated heading. */
function headingAfterOneSecond(gyroscope: Vector3, tilt: DeviceOrientationSample | null) {
  const integrator = new DeadReckoningIntegrator();
  for (let timeMs = 0; timeMs <= 1_000; timeMs += 100) {
    integrator.push(reduceImuEvent(imuEvent(timeMs, gyroscope, tilt), deviceSensors));
  }
  return integrator;
}

describe('through the reduction the integrator consumes', () => {
  it('turns an upright walk that the old reduction saw as perfectly straight', () => {
    // A walker holding the handset upright and turning left at 30 deg/s. The
    // turn is entirely on device Y, so reading Z reported no turn whatsoever.
    const integrator = headingAfterOneSecond([0, 30, 0], orientation(90, 0));

    expect(integrator.heading).toBeCloseTo(330, 6);
    expect(integrator.unresolvedHeadingSamples).toBe(0);
  });

  it('reads a flat handset off the screen normal, with the device-frame sign', () => {
    // The old reduction produced 330 here rather than 30. It was not only
    // reading the wrong axis when the handset was upright; it was applying a
    // world-frame sign to device-frame data, so even the flat case it was
    // written for came out turning the wrong way.
    const integrator = headingAfterOneSecond([0, 0, -30], flat);

    expect(integrator.heading).toBeCloseTo(30, 6);
  });

  it('holds heading and counts the samples it could not resolve', () => {
    // Device frame with no orientation: nothing says which way is up, so the
    // heading stops advancing rather than advancing by an invented zero.
    const integrator = headingAfterOneSecond([0, 30, 0], null);

    expect(integrator.heading).toBe(0);
    expect(integrator.unresolvedHeadingSamples).toBe(11);
  });

  it('keeps detecting steps through samples whose heading is unresolved', () => {
    // Losing orientation must not cost the step count too: the accelerometer
    // is unaffected by not knowing which way is up.
    const integrator = new DeadReckoningIntegrator();
    for (let timeMs = 0; timeMs <= 3_000; timeMs += 20) {
      const event = imuEvent(timeMs, [0, 30, 0], null);
      event.accelerometer = [0, 0, 9.81 + 3 * Math.sin((2 * Math.PI * timeMs) / 500)];
      integrator.push(reduceImuEvent(event, deviceSensors));
    }

    expect(integrator.steps).toBeGreaterThanOrEqual(5);
    expect(integrator.unresolvedHeadingSamples).toBeGreaterThan(0);
  });
});
