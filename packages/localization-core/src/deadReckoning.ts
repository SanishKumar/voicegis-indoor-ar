import type {
  HeadingObservation,
  HeadingUnavailableObservation,
  LocalizationObservation,
  StepObservation,
} from './types';

/**
 * One inertial sample, already reduced to the two scalars dead reckoning needs.
 * Keeping the raw vectors out of this module lets platform code own sensor
 * fusion and axis conventions while replay stays deterministic.
 */
export interface ImuSample {
  timeMs: number;
  /** Magnitude of linear acceleration including gravity, in m/s^2. */
  accelerationMagnitude: number;
  /**
   * Rate of change of compass heading, in degrees per second: positive turning
   * clockwise seen from above, which is the direction heading increases.
   *
   * Named for the quantity rather than for the axis it used to be read from. It
   * was `yawRateDegreesPerSecond`, which named neither a frame nor a sign, and
   * that vagueness is what let the reduction quietly hand this a rate about a
   * horizontal axis: every value it produced was plausible.
   *
   * Null when the sample carries no usable rotation about true vertical — see
   * `headingRateDegreesPerSecond` in `orientation.ts`.
   */
  headingRateDegreesPerSecond: number | null;
}

export interface DeadReckoningConfig {
  /** Rise above the gravity baseline that counts as a footfall, in m/s^2. */
  stepThresholdMetersPerSecond2: number;
  /** Refractory period that stops one footfall being counted twice. */
  minimumStepIntervalMs: number;
  /** Cap on reported stride duration, not a sensor-continuity test. */
  maximumStepIntervalMs: number;
  /** A sample gap at or above this limit breaks both heading and step continuity. */
  maximumSampleGapMs: number;
  strideLengthMeters: number;
  strideVarianceMeters2: number;
  headingAccuracyDegrees: number;
  /** Heading is emitted at most this often; integration continues regardless. */
  headingEmitIntervalMs: number;
  /** Smoothing applied to the gravity baseline, 0 to 1. */
  baselineSmoothing: number;
}

/**
 * The authoritative tuning. Private and frozen.
 *
 * An exported mutable default is consumed on every derivation, so editing one
 * field of it changed a published metric while the report still said ok.
 */
const AUTHORITATIVE_DEAD_RECKONING_CONFIG: DeadReckoningConfig = Object.freeze({
  stepThresholdMetersPerSecond2: 1.6,
  minimumStepIntervalMs: 260,
  maximumStepIntervalMs: 2_000,
  maximumSampleGapMs: 1_000,
  strideLengthMeters: 0.72,
  strideVarianceMeters2: 0.09,
  headingAccuracyDegrees: 12,
  headingEmitIntervalMs: 500,
  baselineSmoothing: 0.05,
});

/** Frozen copy for diagnostics. The evidence path never reads this. */
export const DEFAULT_DEAD_RECKONING_CONFIG: Readonly<DeadReckoningConfig> = Object.freeze({
  ...AUTHORITATIVE_DEAD_RECKONING_CONFIG,
});

/** Resolves caller tuning against the private authority. */
export function resolveDeadReckoningConfig(
  overrides: Partial<DeadReckoningConfig> = {},
): DeadReckoningConfig {
  const config = { ...AUTHORITATIVE_DEAD_RECKONING_CONFIG, ...overrides };
  if (!Number.isFinite(config.maximumSampleGapMs) || config.maximumSampleGapMs <= 0) {
    throw new RangeError('maximumSampleGapMs must be finite and positive.');
  }
  return config;
}

function normalizeHeading(degrees: number) {
  if (!Number.isFinite(degrees)) throw new RangeError('Heading must be finite.');
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/**
 * Integrates inertial samples into the step and heading observations the filter
 * already consumes.
 *
 * Dead reckoning drifts without bound on its own, so this deliberately produces
 * only relative motion. A decoded checkpoint cannot seed direction. An explicit
 * independent calibration is required; the legacy capture stream has none.
 *
 * Step detection is a peak detector over the gravity baseline. A footfall is
 * emitted on the falling edge, once the signal has both risen past the threshold
 * and come back down, with a refractory period so a single step cannot be
 * double counted.
 */
export class DeadReckoningIntegrator {
  private readonly config: DeadReckoningConfig;
  private sequence: number;
  private headingDegrees: number | null;
  private baseline: number | null = null;
  private lastSampleTimeMs: number | null = null;
  private lastInputTimeMs: number | null = null;
  private lastStepTimeMs: number | null = null;
  private lastHeadingEmitMs: number | null = null;
  private aboveThreshold = false;
  private stepCount = 0;
  private unresolvedHeadingCount = 0;

  constructor(
    config: Partial<DeadReckoningConfig> = {},
    startSequence = 0,
    initialHeadingDegrees: number | null = null,
  ) {
    this.config = resolveDeadReckoningConfig(config);
    this.sequence = startSequence;
    this.headingDegrees =
      initialHeadingDegrees === null ? null : normalizeHeading(initialHeadingDegrees);
  }

  get nextSequence() {
    return this.sequence;
  }

  get steps() {
    return this.stepCount;
  }

  /**
   * Samples with no finite heading rate. They invalidate, rather than hold,
   * any previous heading. Valid acceleration may still produce unlocated steps.
   */
  get unresolvedHeadingSamples() {
    return this.unresolvedHeadingCount;
  }

  get heading() {
    return this.headingDegrees;
  }

  /** Low-level explicit calibration for the next sample onward. The caller
   * must separately supply the filter's calibration observation. Never call
   * this from a decoded checkpoint. No pre-calibration interval or peak survives. */
  syncHeading(headingDegrees: number) {
    const heading = normalizeHeading(headingDegrees);
    this.clearMotionHistory();
    this.headingDegrees = heading;
    this.lastHeadingEmitMs = null;
  }

  private clearMotionHistory() {
    this.baseline = null;
    this.lastSampleTimeMs = null;
    this.lastStepTimeMs = null;
    this.aboveThreshold = false;
  }

  private requireTime(timeMs: number) {
    if (
      !Number.isFinite(timeMs) ||
      timeMs < 0 ||
      (this.lastInputTimeMs !== null && timeMs < this.lastInputTimeMs)
    ) {
      throw new RangeError('IMU time must be finite, non-negative and non-regressing.');
    }
  }

  /** A causal reset: preserve diagnostic totals and sequence, discard direction
   * and unfinished motion. Emit loss now, even inside the normal heading cadence. */
  interrupt(timeMs: number): LocalizationObservation[] {
    this.requireTime(timeMs);
    this.lastInputTimeMs = timeMs;
    this.clearMotionHistory();
    this.headingDegrees = null;
    return [this.emitHeading(timeMs)];
  }

  private emitHeading(timeMs: number): HeadingObservation | HeadingUnavailableObservation {
    this.lastHeadingEmitMs = timeMs;
    if (this.headingDegrees === null)
      return {
        kind: 'heading-unavailable',
        sequence: this.sequence++,
        timeMs,
        source: 'inertial',
      };
    return {
      kind: 'heading',
      sequence: this.sequence++,
      timeMs,
      source: 'inertial',
      headingDegrees: this.headingDegrees,
      accuracyDegrees: this.config.headingAccuracyDegrees,
    };
  }

  private emitStep(timeMs: number, durationMs: number): StepObservation {
    this.stepCount += 1;
    return {
      kind: 'step',
      sequence: this.sequence++,
      timeMs,
      source: 'pedometer',
      distanceMeters: this.config.strideLengthMeters,
      durationMs,
      varianceMeters2: this.config.strideVarianceMeters2,
    };
  }

  /** Feeds one sample and returns any observations it produced, in order. */
  push(sample: ImuSample): LocalizationObservation[] {
    this.requireTime(sample.timeMs);
    const observations: LocalizationObservation[] = [];
    const previousTimeMs = this.lastSampleTimeMs;
    const gapMs = previousTimeMs === null ? null : sample.timeMs - previousTimeMs;
    this.lastInputTimeMs = sample.timeMs;
    if (
      !Number.isFinite(sample.accelerationMagnitude) ||
      sample.accelerationMagnitude < 0 ||
      gapMs === 0
    ) {
      return this.interrupt(sample.timeMs);
    }
    if (gapMs !== null && gapMs >= this.config.maximumSampleGapMs) {
      observations.push(...this.interrupt(sample.timeMs));
    }
    this.lastSampleTimeMs = sample.timeMs;

    // Loss must reach the filter before any step emitted by this same sample.
    // A later usable rate measures change, not a new absolute direction.
    if (
      sample.headingRateDegreesPerSecond === null ||
      !Number.isFinite(sample.headingRateDegreesPerSecond)
    ) {
      this.unresolvedHeadingCount += 1;
      if (this.headingDegrees !== null) {
        this.headingDegrees = null;
        observations.push(this.emitHeading(sample.timeMs));
      }
    } else if (this.headingDegrees !== null && gapMs !== null && gapMs > 0) {
      const heading = this.headingDegrees + sample.headingRateDegreesPerSecond * (gapMs / 1_000);
      if (Number.isFinite(heading)) this.headingDegrees = normalizeHeading(heading);
      else {
        this.headingDegrees = null;
        observations.push(this.emitHeading(sample.timeMs));
      }
    }

    if (this.baseline === null) {
      this.baseline = sample.accelerationMagnitude;
    } else {
      const smoothing = this.config.baselineSmoothing;
      this.baseline = this.baseline * (1 - smoothing) + sample.accelerationMagnitude * smoothing;
    }

    const excess = sample.accelerationMagnitude - this.baseline;
    if (!this.aboveThreshold && excess >= this.config.stepThresholdMetersPerSecond2) {
      this.aboveThreshold = true;
    } else if (this.aboveThreshold && excess <= 0) {
      this.aboveThreshold = false;
      const sinceLastStep =
        this.lastStepTimeMs === null
          ? Number.POSITIVE_INFINITY
          : sample.timeMs - this.lastStepTimeMs;
      if (sinceLastStep >= this.config.minimumStepIntervalMs) {
        const durationMs = Number.isFinite(sinceLastStep)
          ? Math.min(sinceLastStep, this.config.maximumStepIntervalMs)
          : this.config.minimumStepIntervalMs;
        observations.push(this.emitStep(sample.timeMs, durationMs));
        this.lastStepTimeMs = sample.timeMs;
      }
    }

    const sinceHeadingEmit =
      this.lastHeadingEmitMs === null
        ? Number.POSITIVE_INFINITY
        : sample.timeMs - this.lastHeadingEmitMs;
    if (sinceHeadingEmit >= this.config.headingEmitIntervalMs) {
      observations.push(this.emitHeading(sample.timeMs));
    }

    return observations;
  }
}
