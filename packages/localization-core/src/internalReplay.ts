import { isBuildingFrameCoordinate } from './captureStream';
import { LocalizationFilter } from './filter';
import { matchEstimateToRoute } from './mapMatching';
import { LocalizationRuntimeController, type RuntimeSnapshot } from './runtimeState';
import {
  LOCALIZATION_RECORDING_VERSION,
  type CheckpointError,
  type LocalizationEstimate,
  type LocalizationQuality,
  type MapMatchReason,
  type MapMatchResult,
  type LocalizationRecording,
  type ReplayReport,
} from './types';

/** Unredacted replay output. Only the evidence builder may consume this. */
export interface ReplayCoreResult {
  estimates: LocalizationEstimate[];
  mapMatches: MapMatchResult[];
  runtimeSnapshots: RuntimeSnapshot[];
  checkpointErrors: CheckpointError[];
  /**
   * Marks whose geometry could not be measured, so no error was produced for
   * them. A single entry here voids every aggregate: dropping the mark and
   * scoring the rest would shrink the denominator and hide the reason.
   */
  unmeasurableCheckpointIds: string[];
  medianHorizontalErrorMeters: number | null;
  p95HorizontalErrorMeters: number | null;
  floorAccuracy: number | null;
  qualityFrameCounts: Record<LocalizationQuality, number>;
  mapMatching: ReplayReport['mapMatching'];
  runtime: ReplayReport['runtime'];
}

export interface ReplayResult {
  estimates: LocalizationEstimate[];
  mapMatches: MapMatchResult[];
  runtimeSnapshots: RuntimeSnapshot[];
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

/**
 * Raw replay, including per-checkpoint errors.
 *
 * Internal to the evidence path. `buildEvidenceReport` is the only caller
 * permitted to turn these numbers into a published figure; the public
 * `replayRecording` wrapper redacts them, because a bare recording carries no
 * survey provenance, no independence claims, and no checkpoint eligibility, so
 * any accuracy computed from one is not evidence.
 */
export function replayCore(recording: LocalizationRecording): ReplayCoreResult {
  validateRecording(recording);
  const filter = new LocalizationFilter();
  const estimates = recording.observations.map((observation) => filter.apply(observation));
  const runtime = new LocalizationRuntimeController();
  const runtimeSnapshots = estimates.map((estimate) => runtime.update(estimate));
  let previousProgressMeters: number | null = null;
  const mapMatches = estimates.map((estimate) => {
    const result = matchEstimateToRoute(estimate, recording.routeSegments ?? [], {
      previousProgressMeters,
    });
    if (result.accepted) previousProgressMeters = result.progressMeters;
    return result;
  });
  const estimatesByTime = new Map(estimates.map((estimate) => [estimate.timeMs, estimate]));

  const checkpointErrors: CheckpointError[] = [];
  const unmeasurableCheckpointIds: string[] = [];

  for (const checkpoint of recording.checkpoints) {
    // An index names one estimate exactly. Falling back to time is only for
    // legacy recordings that carry no index, and such recordings are never
    // publishable as evidence.
    const index = checkpoint.observationIndex;
    if (index !== undefined && (!Number.isInteger(index) || index < 0 || index >= estimates.length)) {
      // A forged or stale index must not silently select a neighbouring
      // estimate, or wrap, or read undefined.
      throw new Error(
        `Checkpoint ${checkpoint.id} references observation index ${index}, which is out of range for ${estimates.length} estimates.`,
      );
    }
    const estimate = index === undefined ? estimatesByTime.get(checkpoint.timeMs) : estimates[index];
    if (!estimate) {
      throw new Error(`Checkpoint ${checkpoint.id} has no estimate at ${checkpoint.timeMs} ms.`);
    }

    // Both operands must lie inside the building frame before they are
    // subtracted. Capture validation bounds the mark, but the estimate is
    // derived rather than declared: filter state runs away on an implausible
    // stride length or a long uncorrected gap, and an unbounded estimate
    // published a median of 8.6e300 metres while the report still said ok.
    // Refusing here is what keeps the subtraction, and so the percentile,
    // meaningful — a bounded pair cannot overflow.
    if (
      !isBuildingFrameCoordinate(estimate.position[0]) ||
      !isBuildingFrameCoordinate(estimate.position[1]) ||
      !isBuildingFrameCoordinate(checkpoint.position[0]) ||
      !isBuildingFrameCoordinate(checkpoint.position[1])
    ) {
      unmeasurableCheckpointIds.push(checkpoint.id);
      continue;
    }

    checkpointErrors.push({
      checkpointId: checkpoint.id,
      timeMs: checkpoint.timeMs,
      floorCorrect: estimate.floorId === checkpoint.floorId,
      horizontalErrorMeters: round(
        Math.hypot(
          estimate.position[0] - checkpoint.position[0],
          estimate.position[1] - checkpoint.position[1],
        ),
      ),
    });
  }

  // One unmeasurable mark voids every aggregate. Scoring the survivors would
  // report a figure from a walk that partly could not be measured.
  const measurable = unmeasurableCheckpointIds.length === 0 && checkpointErrors.length > 0;
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
  const reasonCounts: Record<MapMatchReason, number> = {
    matched: 0,
    'no-route': 0,
    'quality-lost': 0,
    'wrong-floor': 0,
    'outside-gate': 0,
    'backward-progress': 0,
  };
  mapMatches.forEach((match) => {
    reasonCounts[match.reason] += 1;
  });
  const runtimeStateCounts = {
    initializing: 0,
    tracking: 0,
    degraded: 0,
    lost: 0,
    relocalizing: 0,
  };
  runtimeSnapshots.forEach((snapshot) => {
    runtimeStateCounts[snapshot.localizationState] += 1;
  });

  return {
    estimates,
    mapMatches,
    runtimeSnapshots,
    checkpointErrors,
    unmeasurableCheckpointIds,
    medianHorizontalErrorMeters: measurable ? round(median(sortedErrors)) : null,
    p95HorizontalErrorMeters: measurable ? round(percentile(sortedErrors, 0.95)) : null,
    floorAccuracy: measurable
      ? round(
          checkpointErrors.filter((checkpoint) => checkpoint.floorCorrect).length /
            checkpointErrors.length,
        )
      : null,
    qualityFrameCounts,
    mapMatching: {
      acceptedCount: mapMatches.filter((match) => match.accepted).length,
      rejectedCount: mapMatches.filter((match) => !match.accepted).length,
      reasonCounts,
    },
    runtime: {
      stateCounts: runtimeStateCounts,
      guidanceFrozenFrames: runtimeSnapshots.filter(
        (snapshot) => snapshot.guidanceState === 'frozen',
      ).length,
    },
  };
}

/**
 * Public replay. Permanently diagnostic.
 *
 * This never returns an evidential status and never carries accuracy, whether
 * aggregate or per checkpoint. A `LocalizationRecording` can be hand-written,
 * so numbers derived from one describe a computation rather than a measurement.
 * Use `buildEvidenceReport` on a capture session to obtain a figure that may be
 * quoted.
 */
export function replayRecording(recording: LocalizationRecording): ReplayResult {
  const core = replayCore(recording);
  return {
    estimates: core.estimates,
    mapMatches: core.mapMatches,
    runtimeSnapshots: core.runtimeSnapshots,
    report: {
      recordingVersion: LOCALIZATION_RECORDING_VERSION,
      sessionId: recording.sessionId,
      buildingId: recording.buildingId,
      packageHash: recording.packageHash,
      evidenceStatus: 'unofficial-recording',
      observationCount: recording.observations.length,
      checkpointCount: recording.checkpoints.length,
      qualityFrameCounts: core.qualityFrameCounts,
      medianHorizontalErrorMeters: null,
      p95HorizontalErrorMeters: null,
      floorAccuracy: null,
      mapMatching: core.mapMatching,
      runtime: core.runtime,
      // Redacted: individual errors would let an aggregate be reconstructed.
      checkpointErrors: [],
    },
  };
}
