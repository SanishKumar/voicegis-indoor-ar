import type { HeadingObservation, LocalizationObservation, StepObservation } from './types';

/**
 * One inertial sample, already reduced to the two scalars dead reckoning needs.
 * Keeping the raw vectors out of this module lets platform code own sensor
 * fusion and axis conventions while replay stays deterministic.
 */
export interface ImuSample {
  timeMs: number;
  /** Magnitude of linear acceleration including gravity, in m/s^2. */
  accelerationMagnitude: number;
  /** Rate of turn about the vertical axis, in degrees per second. */
  yawRateDegreesPerSecond: number;
}

export interface DeadReckoningConfig {
  /** Rise above the gravity baseline that counts as a footfall, in m/s^2. */
  stepThresholdMetersPerSecond2: number;
  /** Refractory period that stops one footfall being counted twice. */
  minimumStepIntervalMs: number;
  /** Longest gap still treated as continuous walking. */
  maximumStepIntervalMs: number;
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
  return { ...AUTHORITATIVE_DEAD_RECKONING_CONFIG, ...overrides };
}

function normalizeHeading(degrees: number) {
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/**
 * Integrates inertial samples into the step and heading observations the filter
 * already consumes.
 *
 * Dead reckoning drifts without bound on its own, so this deliberately produces
 * only relative motion. Absolute truth comes from checkpoints: `syncHeading` is
 * called when a scan resolves, which re-seeds the integrated heading and stops
 * gyro bias accumulating across the whole walk.
 *
 * Step detection is a peak detector over the gravity baseline. A footfall is
 * emitted on the falling edge, once the signal has both risen past the threshold
 * and come back down, with a refractory period so a single step cannot be
 * double counted.
 */
export class DeadReckoningIntegrator {
  private readonly config: DeadReckoningConfig;
  private sequence: number;
  private headingDegrees: number;
  private baseline: number | null = null;
  private lastSampleTimeMs: number | null = null;
  private lastStepTimeMs: number | null = null;
  private lastHeadingEmitMs: number | null = null;
  private aboveThreshold = false;
  private stepCount = 0;

  constructor(
    config: Partial<DeadReckoningConfig> = {},
    startSequence = 0,
    initialHeadingDegrees = 0,
  ) {
    this.config = resolveDeadReckoningConfig(config);
    this.sequence = startSequence;
    this.headingDegrees = normalizeHeading(initialHeadingDegrees);
  }

  get nextSequence() {
    return this.sequence;
  }

  get steps() {
    return this.stepCount;
  }

  get heading() {
    return this.headingDegrees;
  }

  /** Re-seeds integrated heading from an absolute source such as a checkpoint. */
  syncHeading(headingDegrees: number) {
    this.headingDegrees = normalizeHeading(headingDegrees);
    this.lastHeadingEmitMs = null;
  }

  private emitHeading(timeMs: number): HeadingObservation {
    this.lastHeadingEmitMs = timeMs;
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
    const observations: LocalizationObservation[] = [];
    const previousTimeMs = this.lastSampleTimeMs;
    this.lastSampleTimeMs = sample.timeMs;

    if (previousTimeMs !== null && sample.timeMs > previousTimeMs) {
      const elapsedSeconds = (sample.timeMs - previousTimeMs) / 1_000;
      this.headingDegrees = normalizeHeading(
        this.headingDegrees + sample.yawRateDegreesPerSecond * elapsedSeconds,
      );
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
        this.lastStepTimeMs === null ? Number.POSITIVE_INFINITY : sample.timeMs - this.lastStepTimeMs;
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
