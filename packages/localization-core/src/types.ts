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

export interface ReplayReport {
  recordingVersion: typeof LOCALIZATION_RECORDING_VERSION;
  sessionId: string;
  buildingId: string;
  packageHash: string;
  observationCount: number;
  checkpointCount: number;
  qualityFrameCounts: Record<LocalizationQuality, number>;
  medianHorizontalErrorMeters: number;
  p95HorizontalErrorMeters: number;
  floorAccuracy: number;
  mapMatching: {
    acceptedCount: number;
    rejectedCount: number;
    reasonCounts: Record<MapMatchReason, number>;
  };
  checkpointErrors: CheckpointError[];
}
