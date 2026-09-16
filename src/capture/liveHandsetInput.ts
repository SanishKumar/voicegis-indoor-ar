import {
  DeadReckoningIntegrator,
  DEFAULT_DEAD_RECKONING_CONFIG,
  headingRateDegreesPerSecond,
  type DeviceOrientationSample,
  type LiveHeadingCalibration,
  type LiveLocalizationSession,
  type LiveObservationLease,
} from '@voicegis/localization-core';
import {
  HANDSET_SENSOR_PROFILE,
  type MotionEventLike,
  type OrientationEventLike,
} from './handsetCapture';

/** Conservative diagnostic policy, NOT measured device tolerances or evidence admission. */
export const LIVE_HANDSET_POLICY = Object.freeze({
  maximumDeliveryAgeMs: 500,
  maximumTiltAgeMs: 100,
  maximumSampleGapMs: 1000,
});
export interface HandsetInputSnapshot {
  completeSamples: number;
  rejectedSamples: number;
  forwardedFrames: number;
  unlocatedSteps: number;
  suppressedStrides: number;
  lastCompleteTimeMs: number | null;
  sampleAgeMs: number | null;
  tiltAgeMs: number | null;
  headingDegrees: number | null;
  problem: string | null;
}
function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** One acquisition only. Replace after checkpoint/permission/lifecycle recovery.
 * No DOM listeners, recording, route actions or calibration source live here. */
export class LiveHandsetInput {
  private integrator = new DeadReckoningIntegrator();
  private tilt: DeviceOrientationSample | null = null;
  private tiltAt: number | null = null;
  private motionAt: number | null = null;
  private motionEventAt: number | null = null;
  private tiltEventAt: number | null = null;
  private boundary: number;
  private lastStrideEnd: number;
  private disposed = false;
  private faulted = false;
  private calibrated = false;
  private headingAccuracy = DEFAULT_DEAD_RECKONING_CONFIG.headingAccuracyDegrees;
  private counts = {
    completeSamples: 0,
    rejectedSamples: 0,
    forwardedFrames: 0,
    unlocatedSteps: 0,
    suppressedStrides: 0,
  };
  private lastComplete: number | null = null;
  private lastTiltAge: number | null = null;
  private problem: string | null = null;

  constructor(
    private readonly session: LiveLocalizationSession,
    private readonly lease: LiveObservationLease,
    notBeforeMs: number,
  ) {
    if (!finite(notBeforeMs) || notBeforeMs < 0)
      throw new Error('A monotonic acquisition boundary is required.');
    if (!session.ownsAcquisition(lease))
      throw new Error('The current acquisition lease is required.');
    this.boundary = notBeforeMs;
    this.lastStrideEnd = notBeforeMs;
  }

  private owned(now: number) {
    if (this.disposed) return false;
    const snapshot = this.session.read(now);
    if (
      snapshot.generation !== this.lease.generation ||
      Object.entries(this.lease.identity).some(
        ([key, value]) => snapshot.identity[key as keyof typeof snapshot.identity] !== value,
      )
    ) {
      this.clear();
      return false;
    }
    if (['stopped', 'hidden', 'permission-denied', 'floor-change'].includes(snapshot.reason)) {
      this.clear();
      return false;
    }
    if (
      ![
        'checkpoint-required',
        'awaiting-heading',
        'awaiting-motion',
        'tracking',
        'degraded',
      ].includes(snapshot.reason)
    ) {
      if (!this.faulted) this.clear();
      this.faulted = true;
      this.problem ??= 'Session needs explicit checkpoint recovery';
    }
    return true;
  }
  private clear() {
    this.integrator = new DeadReckoningIntegrator();
    this.calibrated = false;
    this.tilt = null;
    this.tiltAt = null;
    this.motionAt = null;
  }
  private refuse(problem: string, now: number) {
    this.counts.rejectedSamples += 1;
    this.problem = problem;
    const owned = this.owned(now) && !this.faulted;
    this.clear();
    this.faulted = true;
    if (owned) this.session.interrupt('sensor-unavailable', now);
  }
  private time(time: number, last: number | null, now: number) {
    if (!finite(time) || time < 0 || time > now) {
      this.refuse('Invalid event timestamp', now);
      return false;
    }
    // Queued callbacks from a retired acquisition cannot invalidate the new one.
    if (time < this.boundary) return false;
    if (last !== null && time <= last) {
      this.refuse('Duplicate or regressing event', now);
      return false;
    }
    if (now - time > LIVE_HANDSET_POLICY.maximumDeliveryAgeMs) {
      this.refuse('Event delivered too late', now);
      return false;
    }
    return true;
  }

  orientation(event: OrientationEventLike, now: number) {
    if (!this.owned(now) || !this.time(event.timeStamp, this.tiltEventAt, now)) return;
    this.tiltEventAt = event.timeStamp;
    // Alpha, compass/absolute flags and QR orientation are never travel heading.
    if (
      !finite(event.beta) ||
      !finite(event.gamma) ||
      Math.abs(event.beta) > 180 ||
      Math.abs(event.gamma) > 90
    ) {
      this.refuse('Tilt unavailable', now);
      return;
    }
    this.tilt = {
      alphaDegrees: 0,
      betaDegrees: event.beta,
      gammaDegrees: event.gamma,
      absolute: false,
    };
    this.tiltAt = event.timeStamp;
  }

  motion(event: MotionEventLike, now: number) {
    if (!this.owned(now) || !this.time(event.timeStamp, this.motionEventAt, now)) return;
    this.motionEventAt = event.timeStamp;
    const timeMs = event.timeStamp;
    const acceleration = event.accelerationIncludingGravity;
    const rotation = event.rotationRate;
    if (
      !acceleration ||
      !rotation ||
      !finite(acceleration.x) ||
      !finite(acceleration.y) ||
      !finite(acceleration.z) ||
      !finite(rotation.alpha) ||
      !finite(rotation.beta) ||
      !finite(rotation.gamma)
    ) {
      this.refuse('Incomplete motion sample', now);
      return;
    }
    if (!this.tilt || this.tiltAt === null) {
      this.refuse('Fresh tilt required', now);
      return;
    }
    const tiltAge = timeMs - this.tiltAt;
    if (tiltAge < 0 || tiltAge > LIVE_HANDSET_POLICY.maximumTiltAgeMs) {
      this.refuse('Tilt is not fresh for this sample', now);
      return;
    }
    if (
      this.motionAt !== null &&
      timeMs - this.motionAt >= LIVE_HANDSET_POLICY.maximumSampleGapMs
    ) {
      this.refuse('Motion continuity lost', now);
      return;
    }
    const accelerationMagnitude = Math.hypot(acceleration.x, acceleration.y, acceleration.z);
    // W3C alpha/beta/gamma rates correspond to Z/X/Y, not vector order.
    const rate = headingRateDegreesPerSecond(
      [rotation.beta, rotation.gamma, rotation.alpha],
      this.tilt,
      HANDSET_SENSOR_PROFILE,
    );
    if (!finite(accelerationMagnitude) || !finite(rate)) {
      this.refuse('Invalid motion reduction', now);
      return;
    }
    const observations = this.integrator.push({
      timeMs,
      accelerationMagnitude,
      headingRateDegreesPerSecond: rate,
    });
    this.motionAt = timeMs;
    this.lastComplete = timeMs;
    this.lastTiltAge = tiltAge;
    this.counts.completeSamples += 1;
    const step = observations.find((observation) => observation.kind === 'step');
    if (!this.calibrated) {
      if (step) this.counts.unlocatedSteps += 1;
      return; // Complete device input is not a qualified travel-frame heartbeat.
    }
    const heading = this.integrator.heading;
    if (heading === null) {
      this.refuse('Independent heading lost', now);
      return;
    }
    const stride = step && timeMs - step.durationMs >= this.lastStrideEnd ? step : null;
    if (step && !stride) this.counts.suppressedStrides += 1;
    const result = this.session.motion(
      this.lease,
      {
        timeMs,
        headingDegrees: heading,
        headingAccuracyDegrees: this.headingAccuracy,
        stride: stride
          ? {
              distanceMeters: stride.distanceMeters,
              durationMs: stride.durationMs,
              varianceMeters2: stride.varianceMeters2,
            }
          : null,
      },
      now,
    );
    if (!result.accepted) {
      this.problem = `Session refused motion: ${result.reason}`;
      this.faulted = true;
      this.clear();
      return;
    }
    if (stride) this.lastStrideEnd = timeMs;
    this.counts.forwardedFrames += 1;
  }

  /** For a future independently measured pose producer; the operator UI cannot call this. */
  calibrate(value: LiveHeadingCalibration, now: number): boolean {
    if (
      !this.owned(now) ||
      this.faulted ||
      value.timeMs < this.boundary ||
      value.timeMs < (this.motionEventAt ?? this.boundary) ||
      value.timeMs < (this.tiltEventAt ?? this.boundary)
    )
      return false;
    const result = this.session.calibrate(this.lease, value, now);
    if (!result.accepted) return false;
    this.clear();
    this.integrator.syncHeading(value.headingDegrees);
    this.calibrated = true;
    this.headingAccuracy = Math.max(
      DEFAULT_DEAD_RECKONING_CONFIG.headingAccuracyDegrees,
      value.accuracyDegrees,
    );
    this.boundary = value.timeMs;
    this.lastStrideEnd = value.timeMs;
    this.motionAt = value.timeMs;
    this.lastComplete = null;
    return true;
  }

  read(now: number): HandsetInputSnapshot {
    if (
      this.owned(now) &&
      this.calibrated &&
      (now - (this.lastComplete ?? this.boundary) >= LIVE_HANDSET_POLICY.maximumSampleGapMs ||
        (this.tiltAt !== null && now - this.tiltAt > LIVE_HANDSET_POLICY.maximumTiltAgeMs))
    ) {
      this.refuse('Motion or tilt stream went silent', now);
    }
    return {
      ...this.counts,
      lastCompleteTimeMs: this.lastComplete,
      sampleAgeMs: this.lastComplete === null ? null : now - this.lastComplete,
      tiltAgeMs: this.lastTiltAge,
      headingDegrees: this.integrator.heading,
      problem: this.problem,
    };
  }
  dispose() {
    this.disposed = true;
    this.clear();
  }
}
