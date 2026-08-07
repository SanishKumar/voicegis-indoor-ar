import {
  CheckpointAdapter,
  DEFAULT_CHECKPOINT_CONFIG,
  type CheckpointAdapterConfig,
  type CheckpointAnchor,
  type CheckpointRejectionReason,
  type CheckpointScan,
} from './checkpoints';
import {
  DEFAULT_DEAD_RECKONING_CONFIG,
  DeadReckoningIntegrator,
  type DeadReckoningConfig,
  type ImuSample,
} from './deadReckoning';
import {
  LOCALIZATION_RECORDING_VERSION,
  type GroundTruthCheckpoint,
  type LocalizationObservation,
  type LocalizationRecording,
  type RouteMatchSegment,
} from './types';

export const LOCALIZATION_CAPTURE_VERSION = '0.1.0' as const;

/**
 * Everything known about the handset that produced a walk. A field trip is
 * expensive and a recording is cheap, so this is recorded generously: sensor
 * behaviour differs enough between models and OS versions that a number without
 * provenance is hard to defend later.
 */
export interface CaptureDevice {
  label: string;
  platform: string;
  model?: string;
  osVersion?: string;
  appVersion?: string;
  imuSampleRateHz?: number;
  notes?: string;
}

export interface RecordedScan extends CheckpointScan {
  accepted: boolean;
  reason: CheckpointRejectionReason | 'resolved';
  anchorId: string | null;
}

/**
 * The raw walk, kept alongside the derived observations.
 *
 * Storing only observations would freeze the walk against whichever step
 * detector and resolution policy happened to be running that day. Keeping every
 * sample and every scan means an improved filter can be re-run against the same
 * building six months later without going back to it.
 */
export interface RawCapture {
  captureVersion: typeof LOCALIZATION_CAPTURE_VERSION;
  startedAtIso: string;
  imuSamples: ImuSample[];
  scans: RecordedScan[];
  anchors: CheckpointAnchor[];
  checkpointConfig: CheckpointAdapterConfig;
  deadReckoningConfig: DeadReckoningConfig;
}

export interface CapturedRecording extends LocalizationRecording {
  device: CaptureDevice;
  capture: RawCapture;
}

export interface SessionRecorderOptions {
  sessionId: string;
  buildingId: string;
  packageHash: string;
  device: CaptureDevice;
  anchors: CheckpointAnchor[];
  startedAtIso?: string;
  routeSegments?: RouteMatchSegment[];
  checkpointConfig?: Partial<CheckpointAdapterConfig>;
  deadReckoningConfig?: Partial<DeadReckoningConfig>;
}

interface TimedObservation {
  timeMs: number;
  order: number;
  observation: LocalizationObservation;
}

/**
 * Captures a real walk into a replayable recording.
 *
 * Live behaviour and recorded behaviour are the same code path: the caller
 * pushes sensor events as they arrive, gets observations back to drive the
 * filter on the handset, and the recorder retains both the raw events and the
 * derived observations. A resolved scan re-seeds integrated heading, which is
 * what stops inertial drift accumulating across the whole walk.
 */
export class SessionRecorder {
  private readonly options: SessionRecorderOptions;
  private readonly checkpoints: CheckpointAdapter;
  private readonly deadReckoning: DeadReckoningIntegrator;
  private readonly checkpointConfig: CheckpointAdapterConfig;
  private readonly deadReckoningConfig: DeadReckoningConfig;
  private readonly imuSamples: ImuSample[] = [];
  private readonly scans: RecordedScan[] = [];
  private readonly groundTruth: GroundTruthCheckpoint[] = [];
  private readonly observations: TimedObservation[] = [];
  private readonly startedAtIso: string;
  private order = 0;
  private firstFixTimeMs: number | null = null;

  constructor(options: SessionRecorderOptions) {
    this.options = options;
    this.startedAtIso = options.startedAtIso ?? new Date(0).toISOString();
    this.checkpointConfig = { ...DEFAULT_CHECKPOINT_CONFIG, ...options.checkpointConfig };
    this.deadReckoningConfig = { ...DEFAULT_DEAD_RECKONING_CONFIG, ...options.deadReckoningConfig };
    this.checkpoints = new CheckpointAdapter(options.anchors, this.checkpointConfig);
    this.deadReckoning = new DeadReckoningIntegrator(this.deadReckoningConfig);
  }

  get scanCount() {
    return this.scans.length;
  }

  get sampleCount() {
    return this.imuSamples.length;
  }

  get hasFix() {
    return this.checkpoints.hasFix;
  }

  private collect(observations: LocalizationObservation[]) {
    for (const observation of observations) {
      if (observation.kind === 'initial-fix' && this.firstFixTimeMs === null) {
        this.firstFixTimeMs = observation.timeMs;
      }
      this.observations.push({
        timeMs: observation.timeMs,
        order: this.order++,
        observation,
      });
    }
    return observations;
  }

  /** Records one inertial sample and returns whatever it derived. */
  pushImuSample(sample: ImuSample): LocalizationObservation[] {
    this.imuSamples.push({ ...sample });
    return this.collect(this.deadReckoning.push(sample));
  }

  /** Records one scan, including scans that were refused. */
  pushScan(scan: CheckpointScan) {
    const resolution = this.checkpoints.resolve(scan);
    this.scans.push({
      ...scan,
      accepted: resolution.accepted,
      reason: resolution.reason,
      anchorId: resolution.anchorId,
    });
    if (resolution.accepted) {
      const anchor = this.options.anchors.find((candidate) => candidate.id === resolution.anchorId);
      if (anchor) this.deadReckoning.syncHeading(anchor.headingDegrees);
    }
    this.collect(resolution.observations);
    return resolution;
  }

  /** Notes standing on a surveyed floor mark, which is what error is measured against. */
  markGroundTruth(checkpoint: GroundTruthCheckpoint) {
    this.groundTruth.push({ ...checkpoint });
  }

  /**
   * Assembles the recording.
   *
   * Observations are ordered by time and renumbered so replay sees a strictly
   * increasing sequence. Anything derived before the first checkpoint is
   * dropped from the observation stream, because nothing can be localized
   * before the first fix — but those samples stay in the raw capture, since
   * they are still evidence about how the device behaves.
   */
  build(): CapturedRecording {
    const firstFixTimeMs = this.firstFixTimeMs;
    const ordered = [...this.observations]
      .filter((entry) =>
        firstFixTimeMs === null
          ? false
          : entry.observation.kind === 'initial-fix' || entry.timeMs >= firstFixTimeMs,
      )
      .sort(
        (left, right) =>
          Number(right.observation.kind === 'initial-fix') -
            Number(left.observation.kind === 'initial-fix') ||
          left.timeMs - right.timeMs ||
          left.order - right.order,
      )
      .map((entry, index) => ({ ...entry.observation, sequence: index }));

    return {
      schemaVersion: LOCALIZATION_RECORDING_VERSION,
      sessionId: this.options.sessionId,
      buildingId: this.options.buildingId,
      packageHash: this.options.packageHash,
      device: { ...this.options.device },
      privacy: { cameraFramesStored: false },
      ...(this.options.routeSegments ? { routeSegments: this.options.routeSegments } : {}),
      observations: ordered,
      checkpoints: [...this.groundTruth].sort((left, right) => left.timeMs - right.timeMs),
      capture: {
        captureVersion: LOCALIZATION_CAPTURE_VERSION,
        startedAtIso: this.startedAtIso,
        imuSamples: [...this.imuSamples],
        scans: [...this.scans],
        anchors: this.options.anchors.map((anchor) => ({ ...anchor })),
        checkpointConfig: this.checkpointConfig,
        deadReckoningConfig: this.deadReckoningConfig,
      },
    };
  }
}

export interface RebuildOverrides {
  checkpointConfig?: Partial<CheckpointAdapterConfig>;
  deadReckoningConfig?: Partial<DeadReckoningConfig>;
}

/**
 * Replays a raw capture through the adapters again, optionally with different
 * tuning. This is the reason raw samples are stored: an improved step detector
 * or a retuned stride length can be measured against a walk that was collected
 * once, without another visit to the building.
 */
export function rebuildRecording(
  recording: CapturedRecording,
  overrides: RebuildOverrides = {},
): CapturedRecording {
  const recorder = new SessionRecorder({
    sessionId: recording.sessionId,
    buildingId: recording.buildingId,
    packageHash: recording.packageHash,
    device: recording.device,
    anchors: recording.capture.anchors,
    startedAtIso: recording.capture.startedAtIso,
    routeSegments: recording.routeSegments,
    checkpointConfig: { ...recording.capture.checkpointConfig, ...overrides.checkpointConfig },
    deadReckoningConfig: {
      ...recording.capture.deadReckoningConfig,
      ...overrides.deadReckoningConfig,
    },
  });

  // Merge both raw streams back into the order they physically happened.
  const events = [
    ...recording.capture.imuSamples.map((sample) => ({ timeMs: sample.timeMs, sample, scan: null })),
    ...recording.capture.scans.map((scan) => ({ timeMs: scan.timeMs, sample: null, scan })),
  ].sort((left, right) => left.timeMs - right.timeMs);

  for (const event of events) {
    if (event.sample) recorder.pushImuSample(event.sample);
    else if (event.scan) recorder.pushScan(event.scan);
  }
  for (const checkpoint of recording.checkpoints) recorder.markGroundTruth(checkpoint);

  return recorder.build();
}
