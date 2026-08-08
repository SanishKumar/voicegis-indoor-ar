import {
  CheckpointAdapter,
  DEFAULT_CHECKPOINT_CONFIG,
  type CheckpointAdapterConfig,
  type CheckpointAnchor,
} from './checkpoints';
import {
  CAPTURE_STREAM_VERSION,
  reduceImuEvent,
  sortCaptureEvents,
  validateCaptureSession,
  type CaptureDeviceProfile,
  type CaptureEvent,
  type CaptureIssue,
  type CaptureSession,
  type DeviceOrientationSample,
  type GroundTruthCaptureEvent,
  type LifecycleEvent,
  type ScanCaptureEvent,
  type ScanOutcome,
  type SurveyMethod,
  type Vector3,
} from './captureStream';
import {
  DEFAULT_DEAD_RECKONING_CONFIG,
  DeadReckoningIntegrator,
  type DeadReckoningConfig,
} from './deadReckoning';
import {
  LOCALIZATION_RECORDING_VERSION,
  type GroundTruthCheckpoint,
  type LocalizationObservation,
  type LocalizationRecording,
  type RouteMatchSegment,
} from './types';

export interface SessionRecorderOptions {
  sessionId: string;
  buildingId: string;
  packageHash: string;
  device: CaptureDeviceProfile;
  anchors: CheckpointAnchor[];
  /** Required. A walk with no wall clock cannot be dated afterwards. */
  startedAtIso: string;
}

export interface ImuReading {
  timeMs: number;
  accelerometer: Vector3;
  gyroscope: Vector3;
  orientation?: DeviceOrientationSample | null;
}

export interface ScanAttempt {
  timeMs: number;
  transport: 'qr' | 'nfc';
  /** Null when the camera or reader produced nothing decodable. */
  payload: string | null;
  /** Set when acquisition itself failed rather than resolution. */
  failure?: Extract<
    ScanOutcome,
    'decode-failed' | 'permission-denied' | 'transport-unavailable'
  >;
}

export interface GroundTruthMark {
  timeMs: number;
  checkpointId: string;
  position: [number, number];
  floorId: string;
  surveyMethod: SurveyMethod;
  expectedAccuracyMeters: number;
  independentOfAnchors: boolean;
}

/**
 * Accumulates a chronological capture stream from a walk.
 *
 * The stream is the record of what happened and nothing is derived into it.
 * Observations are produced separately by `deriveRecording`, so re-running an
 * improved step detector against a stored walk cannot disturb the evidence it
 * is being measured against.
 */
export class SessionRecorder {
  private readonly options: SessionRecorderOptions;
  private readonly events: CaptureEvent[] = [];
  private sequence = 0;

  constructor(options: SessionRecorderOptions) {
    this.options = options;
    this.recordLifecycle('session-start', 0);
  }

  get eventCount() {
    return this.events.length;
  }

  private nextSequence() {
    return this.sequence++;
  }

  recordImu(reading: ImuReading) {
    this.events.push({
      type: 'imu',
      sequence: this.nextSequence(),
      timeMs: reading.timeMs,
      accelerometer: [...reading.accelerometer] as Vector3,
      gyroscope: [...reading.gyroscope] as Vector3,
      orientation: reading.orientation ? { ...reading.orientation } : null,
    });
  }

  /**
   * Records an acquisition attempt. Resolution against the anchor set happens
   * here so the stored outcome reflects what the device actually knew at the
   * time, including refusals.
   */
  recordScan(attempt: ScanAttempt) {
    let outcome: ScanOutcome = attempt.failure ?? 'decode-failed';
    let anchorId: string | null = null;

    if (!attempt.failure && attempt.payload !== null) {
      const adapter = new CheckpointAdapter(this.options.anchors);
      const resolution = adapter.resolve({
        timeMs: attempt.timeMs,
        kind: attempt.transport,
        payload: attempt.payload,
      });
      outcome = resolution.accepted ? 'resolved' : resolution.reason;
      anchorId = resolution.anchorId;
    }

    const event: ScanCaptureEvent = {
      type: 'scan',
      sequence: this.nextSequence(),
      timeMs: attempt.timeMs,
      transport: attempt.transport,
      payload: attempt.payload,
      outcome,
      anchorId,
    };
    this.events.push(event);
    return event;
  }

  recordGroundTruth(mark: GroundTruthMark) {
    const event: GroundTruthCaptureEvent = {
      type: 'ground-truth',
      sequence: this.nextSequence(),
      timeMs: mark.timeMs,
      checkpointId: mark.checkpointId,
      position: [...mark.position] as [number, number],
      floorId: mark.floorId,
      surveyMethod: mark.surveyMethod,
      expectedAccuracyMeters: mark.expectedAccuracyMeters,
      independentOfAnchors: mark.independentOfAnchors,
    };
    this.events.push(event);
    return event;
  }

  recordLifecycle(event: LifecycleEvent, timeMs: number, detail?: string) {
    this.events.push({
      type: 'lifecycle',
      sequence: this.nextSequence(),
      timeMs,
      event,
      ...(detail === undefined ? {} : { detail }),
    });
  }

  buildSession(): CaptureSession {
    return {
      captureVersion: CAPTURE_STREAM_VERSION,
      sessionId: this.options.sessionId,
      buildingId: this.options.buildingId,
      packageHash: this.options.packageHash,
      startedAtIso: this.options.startedAtIso,
      device: { ...this.options.device, sensors: { ...this.options.device.sensors } },
      anchors: this.options.anchors.map((anchor) => ({ ...anchor })),
      events: sortCaptureEvents(this.events),
    };
  }
}

/** How far a surveyed mark may sit from the nearest estimate and still be measured. */
export const GROUND_TRUTH_ALIGNMENT_TOLERANCE_MS = 1_000;

export interface DeriveOverrides {
  checkpointConfig?: Partial<CheckpointAdapterConfig>;
  deadReckoningConfig?: Partial<DeadReckoningConfig>;
  routeSegments?: RouteMatchSegment[];
}

export type CheckpointExclusionReason =
  | 'dependent-on-anchor'
  | 'alignment-crosses-anchor-reset'
  | 'no-estimate-in-range';

/**
 * A surveyed mark plus everything needed to defend or discard it.
 *
 * The recorded time is never overwritten by the aligned time. A published
 * number has to be traceable back to the instant someone stood on the mark.
 */
export interface EvaluationCheckpoint {
  id: string;
  recordedTimeMs: number;
  alignedTimeMs: number;
  alignmentDeltaMs: number;
  position: [number, number];
  floorId: string;
  surveyMethod: SurveyMethod;
  expectedAccuracyMeters: number;
  independentOfAnchors: boolean;
  publishable: boolean;
  exclusionReason: CheckpointExclusionReason | null;
}

export interface DerivedRecording extends LocalizationRecording {
  checkpointConfig: CheckpointAdapterConfig;
  deadReckoningConfig: DeadReckoningConfig;
  /** Every surveyed mark, publishable or not, with its provenance intact. */
  evaluationCheckpoints: EvaluationCheckpoint[];
  /** Marks excluded from accuracy, kept for diagnosis. */
  diagnosticCheckpoints: EvaluationCheckpoint[];
}

export class CaptureValidationError extends Error {
  readonly issues: CaptureIssue[];
  constructor(issues: CaptureIssue[]) {
    super(
      `Capture session failed validation with ${issues.length} issue(s): ${issues
        .map((issue) => `${issue.code}@${issue.path}`)
        .join(', ')}`,
    );
    this.name = 'CaptureValidationError';
    this.issues = issues;
  }
}

/**
 * Replays a capture stream through the adapters to produce a recording the
 * existing replay pipeline understands.
 *
 * Events are consumed in total order — time then capture sequence — so two
 * events sharing a millisecond always process the same way round. Observations
 * derived before the first checkpoint are dropped, because nothing can be
 * localized before the first fix, while the raw events that produced them stay
 * untouched in the session.
 */
export function deriveRecording(
  session: CaptureSession,
  overrides: DeriveOverrides = {},
): DerivedRecording {
  // Nothing may be derived from a session that does not validate. A number
  // computed from a stream we refused to vouch for is worse than no number.
  const issues = validateCaptureSession(session);
  if (issues.length > 0) throw new CaptureValidationError(issues);

  const checkpointConfig: CheckpointAdapterConfig = {
    ...DEFAULT_CHECKPOINT_CONFIG,
    ...overrides.checkpointConfig,
  };
  const deadReckoningConfig: DeadReckoningConfig = {
    ...DEFAULT_DEAD_RECKONING_CONFIG,
    ...overrides.deadReckoningConfig,
  };
  const checkpoints = new CheckpointAdapter(session.anchors, checkpointConfig);
  const deadReckoning = new DeadReckoningIntegrator(deadReckoningConfig);
  const anchorsById = new Map(session.anchors.map((anchor) => [anchor.id, anchor]));

  const collected: Array<{ timeMs: number; order: number; observation: LocalizationObservation }> =
    [];
  const groundTruth: GroundTruthCaptureEvent[] = [];
  let order = 0;
  let firstFixTimeMs: number | null = null;

  const collect = (observations: LocalizationObservation[]) => {
    for (const observation of observations) {
      if (observation.kind === 'initial-fix' && firstFixTimeMs === null) {
        firstFixTimeMs = observation.timeMs;
      }
      collected.push({ timeMs: observation.timeMs, order: order++, observation });
    }
  };

  for (const event of sortCaptureEvents(session.events)) {
    if (event.type === 'imu') {
      collect(deadReckoning.push(reduceImuEvent(event)));
      continue;
    }
    if (event.type === 'scan') {
      if (event.outcome !== 'resolved' || event.payload === null) continue;
      const resolution = checkpoints.resolve({
        timeMs: event.timeMs,
        kind: event.transport,
        payload: event.payload,
      });
      if (resolution.accepted) {
        const anchor = anchorsById.get(resolution.anchorId ?? '');
        if (anchor) deadReckoning.syncHeading(anchor.headingDegrees);
      }
      collect(resolution.observations);
      continue;
    }
    if (event.type === 'ground-truth') groundTruth.push(event);
  }

  const observations = collected
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

  // The estimate timeline is discrete, but a surveyor stands on a floor mark
  // and notes the clock, which will not land on a sample boundary. Each mark is
  // therefore measured against the nearest estimate. A mark with no estimate
  // near it keeps its own time and fails loudly downstream, because that means
  // the device produced nothing while it was being stood on.
  const observationTimes = [...new Set(observations.map((entry) => entry.timeMs))].sort(
    (left, right) => left - right,
  );
  // Times at which a scan reset the estimate. Aligning a mark across one of
  // these would measure a different physical moment than the one surveyed.
  const anchorResetTimes = sortCaptureEvents(session.events)
    .filter((event) => event.type === 'scan' && event.outcome === 'resolved')
    .map((event) => event.timeMs);

  const evaluationCheckpoints: EvaluationCheckpoint[] = groundTruth
    .map((mark) => {
      let alignedTimeMs = mark.timeMs;
      let best = Number.POSITIVE_INFINITY;
      for (const time of observationTimes) {
        const distance = Math.abs(time - mark.timeMs);
        if (distance < best) {
          best = distance;
          alignedTimeMs = time;
        }
      }
      const aligned = best <= GROUND_TRUTH_ALIGNMENT_TOLERANCE_MS;
      if (!aligned) alignedTimeMs = mark.timeMs;

      const low = Math.min(mark.timeMs, alignedTimeMs);
      const high = Math.max(mark.timeMs, alignedTimeMs);
      const crossesReset = anchorResetTimes.some((time) => time > low && time <= high);

      const exclusionReason: CheckpointExclusionReason | null = !mark.independentOfAnchors
        ? 'dependent-on-anchor'
        : !aligned
          ? 'no-estimate-in-range'
          : crossesReset
            ? 'alignment-crosses-anchor-reset'
            : null;

      return {
        id: mark.checkpointId,
        recordedTimeMs: mark.timeMs,
        alignedTimeMs,
        alignmentDeltaMs: alignedTimeMs - mark.timeMs,
        position: [...mark.position] as [number, number],
        floorId: mark.floorId,
        surveyMethod: mark.surveyMethod,
        expectedAccuracyMeters: mark.expectedAccuracyMeters,
        independentOfAnchors: mark.independentOfAnchors,
        publishable: exclusionReason === null,
        exclusionReason,
      };
    })
    .sort((left, right) => left.alignedTimeMs - right.alignedTimeMs || left.id.localeCompare(right.id));

  // Only publishable marks are handed to the replay evaluator. A dependent or
  // unalignable mark cannot influence reported accuracy because it is not in
  // the array the evaluator reads.
  const alignedCheckpoints: GroundTruthCheckpoint[] = evaluationCheckpoints
    .filter((checkpoint) => checkpoint.publishable)
    .map((checkpoint) => ({
      id: checkpoint.id,
      timeMs: checkpoint.alignedTimeMs,
      position: [...checkpoint.position] as [number, number],
      floorId: checkpoint.floorId,
    }));

  return {
    schemaVersion: LOCALIZATION_RECORDING_VERSION,
    sessionId: session.sessionId,
    buildingId: session.buildingId,
    packageHash: session.packageHash,
    device: { label: session.device.label, platform: session.device.platform },
    privacy: { cameraFramesStored: false },
    ...(overrides.routeSegments ? { routeSegments: overrides.routeSegments } : {}),
    observations,
    checkpoints: alignedCheckpoints,
    checkpointConfig,
    deadReckoningConfig,
    evaluationCheckpoints,
    diagnosticCheckpoints: evaluationCheckpoints.filter((checkpoint) => !checkpoint.publishable),
  };
}
