import type { HeadingCalibrationObservation, HeadingObservation } from './types';

export interface LocalizationFrame {
  buildingId: string;
  packageHash: string;
}

export function requireHeadingMeasurement(
  observation: HeadingCalibrationObservation | HeadingObservation,
) {
  if (
    !Number.isFinite(observation.headingDegrees) ||
    observation.headingDegrees < 0 ||
    observation.headingDegrees >= 360 ||
    !Number.isFinite(observation.accuracyDegrees) ||
    observation.accuracyDegrees <= 0 ||
    observation.accuracyDegrees > 180
  ) {
    throw new Error(
      'Heading observations require a finite angle in [0, 360) and accuracy in (0, 180].',
    );
  }
  if (observation.kind === 'heading' && observation.source !== 'inertial') {
    throw new Error('An anchor payload cannot supply heading.');
  }
}

export function requireHeadingCalibration(
  observation: HeadingCalibrationObservation,
  frame: LocalizationFrame | null,
) {
  if (
    !frame ||
    !frame.buildingId.trim() ||
    !frame.packageHash.trim() ||
    !['replay', 'visual-anchor'].includes(observation.source) ||
    observation.reference !== 'filter-local' ||
    observation.axis !== 'travel' ||
    observation.buildingId !== frame.buildingId ||
    observation.packageHash !== frame.packageHash ||
    typeof observation.provenanceId !== 'string' ||
    !observation.provenanceId.trim()
  ) {
    throw new Error(
      'Heading calibration requires independent travel-axis provenance for this exact venue frame.',
    );
  }
  requireHeadingMeasurement(observation);
}
