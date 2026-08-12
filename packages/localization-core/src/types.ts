export const LOCALIZATION_RECORDING_VERSION = '0.1.0' as const;

export type ObservationSource =
  'manual-anchor' | 'visual-anchor' | 'inertial' | 'pedometer' | 'barometer' | 'replay';

interface ObservationBase {
  sequence: number;
  timeMs: number;
  source: ObservationSource;
}

export interface InitialFixObservation extends ObservationBase {
  kind: 'initial-fix';
  position: [number, number];
  floorId: string;
  elevationMeters: number;
  headingDegrees: number;
  accuracyMeters: number;
  headingAccuracyDegrees: number;
}

export interface PositionFixObservation extends ObservationBase {
  kind: 'position-fix';
  position: [number, number];
  accuracyMeters: number;
}

export interface HeadingObservation extends ObservationBase {
  kind: 'heading';
  headingDegrees: number;
  accuracyDegrees: number;
}

export interface StepObservation extends ObservationBase {
  kind: 'step';
  distanceMeters: number;
  durationMs: number;
  varianceMeters2: number;
}

export interface FloorObservation extends ObservationBase {
  kind: 'floor';
  floorId: string;
  elevationMeters: number;
  confidence: number;
}

export type LocalizationObservation =
  | InitialFixObservation
  | PositionFixObservation
  | HeadingObservation
  | StepObservation
  | FloorObservation;

export type LocalizationQuality = 'high' | 'degraded' | 'lost';

export interface LocalizationEstimate {
  timeMs: number;
  position: [number, number, number];
  velocity: [number, number, number];
  headingDegrees: number;
  floorId: string;
  covariance: number[][];
  positionSigmaMeters: number;
  headingSigmaDegrees: number;
  lastCorrectionTimeMs: number;
  observationSources: ObservationSource[];
  quality: LocalizationQuality;
}

export interface GroundTruthCheckpoint {
  id: string;
  timeMs: number;
  position: [number, number];
  floorId: string;
  /**
   * Index of the exact estimate this mark is scored against.
   *
   * Estimates are produced one per observation, so the index identifies one
   * estimate unambiguously. Looking an estimate up by time cannot: several
   * observations routinely share a millisecond — a single scan alone emits a
   * position fix, a heading, and a floor — and the last one written would win,
   * which is how a mark could be scored against a reset that happened after it.
   */
  observationIndex?: number;
}

export interface RouteMatchSegment {
  id: string;
  floorId: string;
  from: [number, number];
  to: [number, number];
  startProgressMeters: number;
  lengthMeters: number;
}

export type MapMatchReason =
  'matched' | 'no-route' | 'quality-lost' | 'wrong-floor' | 'outside-gate' | 'backward-progress';

export interface MapMatchResult {
  timeMs: number;
  accepted: boolean;
  reason: MapMatchReason;
  rawPosition: [number, number];
  matchedPosition: [number, number] | null;
  segmentId: string | null;
  distanceFromRouteMeters: number | null;
  progressMeters: number | null;
  gateMeters: number;
}

export interface LocalizationRecording {
  schemaVersion: typeof LOCALIZATION_RECORDING_VERSION;
  sessionId: string;
  buildingId: string;
  packageHash: string;
  device: {
    label: string;
    platform: string;
  };
  privacy: {
    cameraFramesStored: false;
  };
  routeSegments?: RouteMatchSegment[];
  observations: LocalizationObservation[];
  checkpoints: GroundTruthCheckpoint[];
}

export interface CheckpointError {
  checkpointId: string;
  timeMs: number;
  floorCorrect: boolean;
  horizontalErrorMeters: number;
}

/**
 * Whether a report may be quoted as accuracy evidence.
 *
 * `insufficient-ground-truth` exists because zero eligible marks previously
 * produced a median and p95 of zero, which reads as perfect accuracy rather
 * than as no measurement at all.
 */
export type EvidenceStatus =
  | 'ok'
  /** Anything replayed from a bare recording rather than a capture session. */
  | 'unofficial-recording'
  /** The walk never obtained a first fix, so nothing was ever localized. */
  | 'insufficient-localization'
  /** Backgrounding or sensor loss makes the estimate untrustworthy afterwards. */
  | 'interrupted-capture'
  /** No surveyed mark survived eligibility. */
  | 'insufficient-ground-truth'
  /** Current processing cannot interpret the recorded units or frame. */
  | 'unsupported-sensor-model'
  /**
   * The capture does not record its own end, so it may be a truncated draft.
   * A stream can always lose its tail without leaving a gap in the sequence,
   * and the missing tail is exactly where a late interruption would sit.
   */
  | 'incomplete-capture'
  /**
   * Replay produced a non-finite or out-of-frame estimate, uncertainty value,
   * or map match. Kept separate from `insufficient-ground-truth`: the marks are
   * present, but the localization state used to evaluate them is not numeric
   * evidence.
   */
  | 'invalid-localization-state';

export interface ReplayReport {
  recordingVersion: typeof LOCALIZATION_RECORDING_VERSION;
  sessionId: string;
  buildingId: string;
  packageHash: string;
  evidenceStatus: EvidenceStatus;
  observationCount: number;
  checkpointCount: number;
  qualityFrameCounts: Record<LocalizationQuality, number>;
  /** Null whenever no eligible mark backs the figure. */
  medianHorizontalErrorMeters: number | null;
  p95HorizontalErrorMeters: number | null;
  floorAccuracy: number | null;
  mapMatching: {
    acceptedCount: number;
    rejectedCount: number;
    reasonCounts: Record<MapMatchReason, number>;
  };
  runtime: {
    stateCounts: Record<'initializing' | 'tracking' | 'degraded' | 'lost' | 'relocalizing', number>;
    guidanceFrozenFrames: number;
  };
  checkpointErrors: CheckpointError[];
}
