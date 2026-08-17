import type {
  CaptureSensorProfile,
  DeviceOrientationSample,
  SessionRecorder,
  Vector3,
} from '@voicegis/localization-core';

/**
 * Driving a capture session from a handset's own sensors.
 *
 * This is the first code in the project that touches a real device. Everything
 * upstream of it is deterministic replay over streams that were authored, so
 * the failure modes here are new in kind: the browser decides when to deliver a
 * sample, whether to deliver it at all, and how many it quietly merges first.
 *
 * The adapter is written against structural event shapes rather than the DOM
 * types so it can be driven by plain objects in tests. Nothing here reads
 * `window`; wiring is the caller's job, which also keeps permission prompts —
 * which must happen inside a user gesture — out of the data path.
 *
 * ## Why the orientation pairing is measured rather than assumed
 *
 * Inertial samples and orientation samples arrive on two independent event
 * channels. `devicemotion` carries the turn, `deviceorientation` carries the
 * tilt needed to work out which way that turn was about, and nothing
 * synchronises them: each is throttled and coalesced on its own schedule. So
 * every inertial sample is paired with the most recent orientation, which is
 * always at least slightly stale, and if it is stale enough the projection is
 * applying an old tilt to a new turn — wrong in a way that looks completely
 * reasonable.
 *
 * Nobody has measured how large that lag actually is on real hardware. That is
 * the open question blocking device-frame captures from counting as evidence,
 * so this adapter's job is as much to report the lag as to record the walk:
 * `pairing` is the distribution, and it is what a decision about admitting
 * device-frame data should be made from rather than guessed at.
 */

/** What this adapter produces, and the terms the projection will read it under. */
export const HANDSET_SENSOR_PROFILE: Readonly<CaptureSensorProfile> = Object.freeze({
  api: 'devicemotion',
  // DeviceMotionEvent.rotationRate is specified in degrees per second. The
  // Generic Sensor API's Gyroscope reports radians per second for the same
  // physical quantity, which is exactly why the profile records units at all.
  gyroscopeUnits: 'deg/s',
  // Raw device axes. Resolving these into a heading needs the tilt, which is
  // what the orientation pairing below is for.
  frame: 'device',
});

export interface MotionEventLike {
  timeStamp: number;
  accelerationIncludingGravity: { x: number | null; y: number | null; z: number | null } | null;
  rotationRate: { alpha: number | null; beta: number | null; gamma: number | null } | null;
}

export interface OrientationEventLike {
  timeStamp: number;
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
  absolute?: boolean;
}

/**
 * How far behind each inertial sample its tilt was, in milliseconds.
 *
 * `unpaired` counts samples recorded before any orientation had arrived at all.
 * Those are stored with a null orientation rather than dropped: the
 * accelerometer half is still a perfectly good footfall, and a null orientation
 * is refused explicitly downstream instead of silently becoming a heading.
 */
export interface PairingSummary {
  pairedCount: number;
  unpairedCount: number;
  medianStalenessMs: number | null;
  p95StalenessMs: number | null;
  worstStalenessMs: number | null;
}

/** Samples that never reached the recorder, and why. */
export interface RejectionSummary {
  /** The event carried no acceleration, no rotation rate, or a null component. */
  incomplete: number;
  /** The event's timestamp went backwards, which no honest clock does. */
  regressed: number;
  /** The recorder refused the reading. Should stay zero; counted, not assumed. */
  refused: number;
}

export interface HandsetCaptureOptions {
  /**
   * Timestamp that means zero on the session clock. Defaults to the first
   * event seen, so a session's first sample lands at 0 rather than at whatever
   * the page's time origin happened to be.
   */
  originTimeStampMs?: number;
  /**
   * Orientation older than this is treated as unusable, and the sample is
   * stored with a null orientation instead of a stale tilt.
   *
   * Null by default, meaning nothing is discarded. A threshold here would be a
   * number nobody has measured, and this adapter exists to produce the
   * measurement that a real threshold should come from. Set it once there is
   * field data to set it from.
   */
  maxOrientationStalenessMs?: number | null;
}

function upperMedian(sorted: number[]) {
  // Matches `summarizeSampling`: the upper median of the sorted values. Two
  // ideas of "median" in one codebase is one more than is useful.
  return sorted.length === 0 ? null : sorted[Math.floor(sorted.length / 2)];
}

function percentile95(sorted: number[]) {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[Math.max(0, index)];
}

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export class HandsetCaptureAdapter {
  private readonly recorder: SessionRecorder;
  private readonly maxStalenessMs: number | null;
  private originTimeStampMs: number | null;

  private latestOrientation: DeviceOrientationSample | null = null;
  private latestOrientationAtMs: number | null = null;

  private lastMotionTimeStampMs: number | null = null;
  private readonly stalenessMs: number[] = [];
  private unpaired = 0;
  private incomplete = 0;
  private regressed = 0;
  private refused = 0;

  constructor(recorder: SessionRecorder, options: HandsetCaptureOptions = {}) {
    this.recorder = recorder;
    this.originTimeStampMs = options.originTimeStampMs ?? null;
    this.maxStalenessMs = options.maxOrientationStalenessMs ?? null;
  }

  /** The resolved staleness limit, so a walk can record what it was run under. */
  get orientationStalenessLimitMs() {
    return this.maxStalenessMs;
  }

  /**
   * Stores the latest tilt. Nothing is recorded here.
   *
   * Orientation is not an event in the capture stream; it is context attached
   * to inertial samples. Recording it separately would make the stream's event
   * count depend on how chattily the platform happened to deliver tilt.
   */
  handleOrientation(event: OrientationEventLike) {
    if (!finite(event.alpha) || !finite(event.beta) || !finite(event.gamma)) return;
    this.adoptOrigin(event.timeStamp);
    this.latestOrientation = {
      alphaDegrees: event.alpha,
      betaDegrees: event.beta,
      gammaDegrees: event.gamma,
      // `absolute` records whether alpha is referenced to true north. The
      // projection never reads alpha, so a relative orientation is fully usable
      // for heading rate; this is carried because the stream should say what
      // the device claimed, not what this adapter happened to need.
      absolute: event.absolute === true,
    };
    this.latestOrientationAtMs = event.timeStamp;
  }

  handleMotion(event: MotionEventLike) {
    const acceleration = event.accelerationIncludingGravity;
    const rotation = event.rotationRate;
    if (
      acceleration === null ||
      rotation === null ||
      !finite(acceleration.x) ||
      !finite(acceleration.y) ||
      !finite(acceleration.z) ||
      !finite(rotation.alpha) ||
      !finite(rotation.beta) ||
      !finite(rotation.gamma) ||
      !finite(event.timeStamp)
    ) {
      // A partially populated motion event is normal on the web: a device with
      // no gyroscope still fires `devicemotion`, with `rotationRate` present
      // and empty. Counting these is how a walk recorded on the wrong hardware
      // is visible afterwards rather than looking like a short walk.
      this.incomplete += 1;
      return;
    }

    if (this.lastMotionTimeStampMs !== null && event.timeStamp < this.lastMotionTimeStampMs) {
      // Refused rather than reordered. Sorting a regressing clock into place is
      // precisely the erasure the capture chronology rules exist to prevent.
      this.regressed += 1;
      return;
    }

    this.adoptOrigin(event.timeStamp);
    this.lastMotionTimeStampMs = event.timeStamp;

    let orientation = this.latestOrientation;
    if (orientation === null || this.latestOrientationAtMs === null) {
      this.unpaired += 1;
      orientation = null;
    } else {
      const staleness = event.timeStamp - this.latestOrientationAtMs;
      this.stalenessMs.push(staleness);
      if (this.maxStalenessMs !== null && staleness > this.maxStalenessMs) {
        orientation = null;
      }
    }

    try {
      const accelerometer: Vector3 = [acceleration.x, acceleration.y, acceleration.z];
      // The axis mapping is the trap in this whole file. `rotationRate.alpha`
      // is the rate about Z, `.beta` about X and `.gamma` about Y — each named
      // for the orientation angle it corresponds to, not for the position it
      // takes in a vector. Copying them across in name order yields a
      // plausible, entirely wrong gyroscope reading.
      const gyroscope: Vector3 = [rotation.beta, rotation.gamma, rotation.alpha];

      this.recorder.recordImu({
        timeMs: event.timeStamp - (this.originTimeStampMs ?? event.timeStamp),
        accelerometer,
        gyroscope,
        orientation,
      });
    } catch {
      this.refused += 1;
    }
  }

  private adoptOrigin(timeStampMs: number) {
    if (this.originTimeStampMs === null && finite(timeStampMs)) {
      this.originTimeStampMs = timeStampMs;
    }
  }

  get pairing(): PairingSummary {
    const sorted = [...this.stalenessMs].sort((left, right) => left - right);
    return {
      pairedCount: sorted.length,
      unpairedCount: this.unpaired,
      medianStalenessMs: upperMedian(sorted),
      p95StalenessMs: percentile95(sorted),
      worstStalenessMs: sorted.length === 0 ? null : sorted[sorted.length - 1],
    };
  }

  get rejections(): RejectionSummary {
    return { incomplete: this.incomplete, regressed: this.regressed, refused: this.refused };
  }
}

export type MotionPermission = 'granted' | 'denied' | 'unsupported' | 'not-required';

/**
 * Asks for motion access. Must be called from inside a user gesture.
 *
 * iOS gates both `devicemotion` and `deviceorientation` behind an explicit
 * grant and only honours the request during a real interaction; elsewhere the
 * events simply flow, which is `not-required` rather than `granted`, because
 * the two are different facts and only one of them means someone was asked.
 */
export async function requestMotionPermission(
  motionEvent: { requestPermission?: () => Promise<string> } | undefined,
): Promise<MotionPermission> {
  if (motionEvent === undefined) return 'unsupported';
  if (typeof motionEvent.requestPermission !== 'function') return 'not-required';
  try {
    return (await motionEvent.requestPermission()) === 'granted' ? 'granted' : 'denied';
  } catch {
    // Throws when called outside a user gesture. That is a wiring mistake
    // rather than a refusal, but the caller can only do the same thing either
    // way, so it is reported as denied rather than crashing the walk.
    return 'denied';
  }
}
