import { LocalizationFilter } from './filter';
import {
  LOCALIZATION_RECORDING_VERSION,
  type CheckpointError,
  type LocalizationEstimate,
  type LocalizationQuality,
  type LocalizationRecording,
  type ReplayReport,
} from './types';

export interface ReplayResult {
  estimates: LocalizationEstimate[];
  report: ReplayReport;
}

function round(value: number, digits = 3) {
  return Number(value.toFixed(digits));
}

function percentile(sortedValues: number[], percentileValue: number) {
  if (sortedValues.length === 0) return 0;
  const index = Math.max(0, Math.ceil(percentileValue * sortedValues.length) - 1);
  return sortedValues[Math.min(index, sortedValues.length - 1)];
}

function median(sortedValues: number[]) {
  if (sortedValues.length === 0) return 0;
  const middle = Math.floor(sortedValues.length / 2);
  return sortedValues.length % 2 === 0
    ? (sortedValues[middle - 1] + sortedValues[middle]) / 2
    : sortedValues[middle];
}

export function validateRecording(recording: LocalizationRecording) {
  if (recording.schemaVersion !== LOCALIZATION_RECORDING_VERSION) {
    throw new Error(`Unsupported localization recording version: ${recording.schemaVersion}.`);
  }
  if (recording.privacy.cameraFramesStored !== false) {
    throw new Error('Localization recordings must not contain camera frames by default.');
  }
  if (recording.observations.length === 0 || recording.observations[0].kind !== 'initial-fix') {
    throw new Error('A localization recording must start with an initial fix.');
  }
  for (let index = 1; index < recording.observations.length; index += 1) {
    const previous = recording.observations[index - 1];
    const current = recording.observations[index];
    if (current.sequence <= previous.sequence) {
      throw new Error('Observation sequence numbers must be strictly increasing.');
    }
    if (current.timeMs < previous.timeMs) {
      throw new Error('Observation times must be non-decreasing.');
    }
  }
}

export function replayRecording(recording: LocalizationRecording): ReplayResult {
  validateRecording(recording);
  const filter = new LocalizationFilter();
  const estimates = recording.observations.map((observation) => filter.apply(observation));
  const estimatesByTime = new Map(estimates.map((estimate) => [estimate.timeMs, estimate]));

  const checkpointErrors: CheckpointError[] = recording.checkpoints.map((checkpoint) => {
    const estimate = estimatesByTime.get(checkpoint.timeMs);
    if (!estimate) {
      throw new Error(`Checkpoint ${checkpoint.id} has no estimate at ${checkpoint.timeMs} ms.`);
    }
    return {
      checkpointId: checkpoint.id,
      timeMs: checkpoint.timeMs,
      floorCorrect: estimate.floorId === checkpoint.floorId,
      horizontalErrorMeters: round(
        Math.hypot(
          estimate.position[0] - checkpoint.position[0],
          estimate.position[1] - checkpoint.position[1],
        ),
      ),
    };
  });
  const sortedErrors = checkpointErrors
    .map((checkpoint) => checkpoint.horizontalErrorMeters)
    .sort((a, b) => a - b);
  const qualityFrameCounts: Record<LocalizationQuality, number> = {
    high: 0,
    degraded: 0,
    lost: 0,
  };
  estimates.forEach((estimate) => {
    qualityFrameCounts[estimate.quality] += 1;
  });

  return {
    estimates,
    report: {
      recordingVersion: LOCALIZATION_RECORDING_VERSION,
      sessionId: recording.sessionId,
      buildingId: recording.buildingId,
      packageHash: recording.packageHash,
      observationCount: recording.observations.length,
      checkpointCount: recording.checkpoints.length,
      qualityFrameCounts,
      medianHorizontalErrorMeters: round(median(sortedErrors)),
      p95HorizontalErrorMeters: round(percentile(sortedErrors, 0.95)),
      floorAccuracy: round(
        checkpointErrors.filter((checkpoint) => checkpoint.floorCorrect).length /
          Math.max(1, checkpointErrors.length),
      ),
      checkpointErrors,
    },
  };
}
