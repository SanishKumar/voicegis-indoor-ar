import {
  add,
  identity,
  inverse2x2,
  multiply,
  multiplyVector,
  subtract,
  transpose,
  zeros,
  type Matrix,
} from './matrix';
import type {
  InitialFixObservation,
  LocalizationEstimate,
  LocalizationObservation,
  LocalizationQuality,
  ObservationSource,
} from './types';

const STATE_SIZE = 5;
const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;
const HEADING = 4;

export interface LocalizationFilterConfig {
  accelerationNoiseMetersPerSecond2: number;
  headingDriftDegreesPerSecond: number;
  highQualitySigmaMeters: number;
  degradedQualitySigmaMeters: number;
  highQualityCorrectionAgeMs: number;
  degradedQualityCorrectionAgeMs: number;
}

const DEFAULT_CONFIG: LocalizationFilterConfig = {
  accelerationNoiseMetersPerSecond2: 0.45,
  headingDriftDegreesPerSecond: 2,
  highQualitySigmaMeters: 1,
  degradedQualitySigmaMeters: 3,
  highQualityCorrectionAgeMs: 5_000,
  degradedQualityCorrectionAgeMs: 15_000,
};

function degreesToRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

function radiansToDegrees(radians: number) {
  return (radians * 180) / Math.PI;
}

function normalizeRadians(value: number) {
  let result = value;
  while (result > Math.PI) result -= Math.PI * 2;
  while (result <= -Math.PI) result += Math.PI * 2;
  return result;
}

function normalizeDegrees(value: number) {
  const result = value % 360;
  return result < 0 ? result + 360 : result;
}

function diagonal(values: number[]) {
  const result = zeros(values.length, values.length);
  values.forEach((value, index) => {
    result[index][index] = value;
  });
  return result;
}

export class LocalizationFilter {
  private state: number[] | null = null;
  private covariance: Matrix | null = null;
  private timeMs = 0;
  private floorId = '';
  private elevationMeters = 0;
  private lastCorrectionTimeMs = 0;
  private readonly sources = new Set<ObservationSource>();

  constructor(private readonly config: LocalizationFilterConfig = DEFAULT_CONFIG) {}

  private initialize(observation: InitialFixObservation) {
    const positionVariance = observation.accuracyMeters ** 2;
    const headingVariance = degreesToRadians(observation.headingAccuracyDegrees) ** 2;
    this.state = [
      observation.position[0],
      observation.position[1],
      0,
      0,
      degreesToRadians(observation.headingDegrees),
    ];
    this.covariance = diagonal([positionVariance, positionVariance, 1, 1, headingVariance]);
    this.timeMs = observation.timeMs;
    this.floorId = observation.floorId;
    this.elevationMeters = observation.elevationMeters;
    this.lastCorrectionTimeMs = observation.timeMs;
    this.sources.add(observation.source);
  }

  private predict(targetTimeMs: number) {
    if (!this.state || !this.covariance) throw new Error('Localization filter is not initialized.');
    if (targetTimeMs < this.timeMs)
      throw new Error('Localization observations must be time ordered.');
    const deltaSeconds = (targetTimeMs - this.timeMs) / 1_000;
    if (deltaSeconds === 0) return;

    const transition = identity(STATE_SIZE);
    transition[X][VX] = deltaSeconds;
    transition[Y][VY] = deltaSeconds;
    this.state = multiplyVector(transition, this.state);

    const accelerationVariance = this.config.accelerationNoiseMetersPerSecond2 ** 2;
    const positionNoise = 0.25 * deltaSeconds ** 4 * accelerationVariance;
    const velocityNoise = deltaSeconds ** 2 * accelerationVariance;
    const headingNoise =
      degreesToRadians(this.config.headingDriftDegreesPerSecond * deltaSeconds) ** 2;
    const processNoise = diagonal([
      positionNoise,
      positionNoise,
      velocityNoise,
      velocityNoise,
      headingNoise,
    ]);
    this.covariance = add(
      multiply(multiply(transition, this.covariance), transpose(transition)),
      processNoise,
    );
    this.timeMs = targetTimeMs;
  }

  private updatePosition(position: [number, number], variance: number) {
    if (!this.state || !this.covariance) throw new Error('Localization filter is not initialized.');
    const observationMatrix: Matrix = [
      [1, 0, 0, 0, 0],
      [0, 1, 0, 0, 0],
    ];
    const innovation = [position[0] - this.state[X], position[1] - this.state[Y]];
    const innovationCovariance = add(
      multiply(multiply(observationMatrix, this.covariance), transpose(observationMatrix)),
      diagonal([variance, variance]),
    );
    const gain = multiply(
      multiply(this.covariance, transpose(observationMatrix)),
      inverse2x2(innovationCovariance),
    );
    const correction = multiplyVector(gain, innovation);
    this.state = this.state.map((value, index) => value + correction[index]);
    this.covariance = multiply(
      subtract(identity(STATE_SIZE), multiply(gain, observationMatrix)),
      this.covariance,
    );
  }

  private updateHeading(headingDegrees: number, varianceDegrees2: number) {
    if (!this.state || !this.covariance) throw new Error('Localization filter is not initialized.');
    const innovation = normalizeRadians(degreesToRadians(headingDegrees) - this.state[HEADING]);
    const variance = degreesToRadians(Math.sqrt(varianceDegrees2)) ** 2;
    const innovationVariance = this.covariance[HEADING][HEADING] + variance;
    const gain = this.covariance.map((row) => row[HEADING] / innovationVariance);
    this.state = this.state.map((value, index) => value + gain[index] * innovation);
    this.state[HEADING] = normalizeRadians(this.state[HEADING]);

    const observationMatrix: Matrix = [[0, 0, 0, 0, 1]];
    const gainMatrix = gain.map((value) => [value]);
    this.covariance = multiply(
      subtract(identity(STATE_SIZE), multiply(gainMatrix, observationMatrix)),
      this.covariance,
    );
  }

  private quality(): LocalizationQuality {
    if (!this.covariance) return 'lost';
    const sigma = Math.sqrt(Math.max(this.covariance[X][X], this.covariance[Y][Y]));
    const correctionAge = this.timeMs - this.lastCorrectionTimeMs;
    if (
      sigma <= this.config.highQualitySigmaMeters &&
      correctionAge <= this.config.highQualityCorrectionAgeMs
    ) {
      return 'high';
    }
    if (
      sigma <= this.config.degradedQualitySigmaMeters &&
      correctionAge <= this.config.degradedQualityCorrectionAgeMs
    ) {
      return 'degraded';
    }
    return 'lost';
  }

  private estimate(): LocalizationEstimate {
    if (!this.state || !this.covariance) throw new Error('Localization filter is not initialized.');
    return {
      timeMs: this.timeMs,
      position: [this.state[X], this.state[Y], this.elevationMeters],
      velocity: [this.state[VX], this.state[VY], 0],
      headingDegrees: normalizeDegrees(radiansToDegrees(this.state[HEADING])),
      floorId: this.floorId,
      covariance: this.covariance.map((row) => [...row]),
      positionSigmaMeters: Math.sqrt(Math.max(this.covariance[X][X], this.covariance[Y][Y])),
      headingSigmaDegrees: radiansToDegrees(Math.sqrt(this.covariance[HEADING][HEADING])),
      lastCorrectionTimeMs: this.lastCorrectionTimeMs,
      observationSources: [...this.sources].sort(),
      quality: this.quality(),
    };
  }

  apply(observation: LocalizationObservation): LocalizationEstimate {
    if (observation.kind === 'initial-fix') {
      if (this.state) throw new Error('Localization filter has already been initialized.');
      this.initialize(observation);
      return this.estimate();
    }
    if (!this.state || !this.covariance) {
      throw new Error('The first localization observation must be an initial fix.');
    }

    const previousTimeMs = this.timeMs;
    this.predict(observation.timeMs);
    this.sources.add(observation.source);

    if (observation.kind === 'position-fix') {
      this.updatePosition(observation.position, observation.accuracyMeters ** 2);
      this.lastCorrectionTimeMs = observation.timeMs;
    } else if (observation.kind === 'heading') {
      this.updateHeading(observation.headingDegrees, observation.accuracyDegrees ** 2);
    } else if (observation.kind === 'step') {
      const heading = this.state[HEADING];
      const directionX = Math.sin(heading);
      const directionY = Math.cos(heading);
      const elapsedSeconds = Math.max(0.001, (observation.timeMs - previousTimeMs) / 1_000);
      const expectedDistance =
        (this.state[VX] * directionX + this.state[VY] * directionY) * elapsedSeconds;
      const correction = observation.distanceMeters - expectedDistance;
      this.state[X] += directionX * correction;
      this.state[Y] += directionY * correction;
      const speed = observation.distanceMeters / Math.max(0.001, observation.durationMs / 1_000);
      this.state[VX] = directionX * speed;
      this.state[VY] = directionY * speed;
      this.covariance[X][X] += observation.varianceMeters2;
      this.covariance[Y][Y] += observation.varianceMeters2;
    } else if (observation.kind === 'floor') {
      if (observation.confidence < 0 || observation.confidence > 1) {
        throw new Error('Floor confidence must be between 0 and 1.');
      }
      if (observation.confidence >= 0.75) {
        this.floorId = observation.floorId;
        this.elevationMeters = observation.elevationMeters;
      }
    }

    return this.estimate();
  }
}
