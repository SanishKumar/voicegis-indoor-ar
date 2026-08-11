import {
  CheckpointAdapter,
  resolveCheckpointConfig,
  type CheckpointAdapterConfig,
  type CheckpointAnchor,
} from './checkpoints';
import {
  CAPTURE_STREAM_VERSION,
  inspectCaptureSession,
  reduceImuEvent,
  sortCaptureEvents,
  summarizeSampling,
  type SamplingSummary,
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
  DeadReckoningIntegrator,
  resolveDeadReckoningConfig,
  type DeadReckoningConfig,
} from './deadReckoning';
import {
  isEvidentialSensorModel,
  isPublishableSurveyAccuracy,
  isPublishableSurveyMethod,
  worstCoverageGapMs,
} from './internalEvidencePolicy';
import { replayCore } from './internalReplay';
import {
  LOCALIZATION_RECORDING_VERSION,
  type EvidenceStatus,
  type GroundTruthCheckpoint,
  type LocalizationObservation,
  type LocalizationRecording,
  type ReplayReport,
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
  private readonly anchors: CaptureAnchorSnapshot[];
  private readonly events: CaptureEvent[] = [];
  private sequence = 0;

  constructor(options: SessionRecorderOptions) {
    this.options = options;
    // Anchors are normalised once, here, rather than at build time. A caller
    // may hand over anchors straight from a compiled VenuePackage, which carry
    // fields the capture schema does not define; the snapshot is what this
    // session resolves against and what it later serialises, so a later edit to
    // the caller's own anchor objects cannot change either.
    this.anchors = options.anchors.map(captureAnchorSnapshot);
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
      const adapter = new CheckpointAdapter(this.anchors);
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
    // The caller gets its own copy. Handing back the stored object let a scan
    // outcome be rewritten after the fact.
    return captureEventSnapshot(event) as ScanCaptureEvent;
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
    return captureEventSnapshot(event) as GroundTruthCaptureEvent;
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
      anchors: this.anchors.map(captureAnchorSnapshot),
      // Snapshot per call, so two sessions built from one recorder never share
      // an event, and mutating either cannot reach back into the recorder.
      events: sortCaptureEvents(this.events.map(captureEventSnapshot)),
    };
  }
}

/**
 * An anchor reduced to what the capture schema defines.
 *
 * A VenuePackage anchor also carries `spaceId`, which anchor resolution,
 * localization and replay never read. Storing it would duplicate a fact the
 * package already owns and create a second thing that can disagree with it; the
 * capture records `packageHash` and the anchor `id`, so venue semantics remain
 * recoverable by looking them up rather than by copying them.
 */
export type CaptureAnchorSnapshot = CheckpointAnchor;

/**
 * A capture event detached from every reference the caller can still reach.
 *
 * `buildSession` copied the events array but not the events, and `recordScan`
 * and `recordGroundTruth` handed back the very object they had stored. A caller
 * could therefore build a session, read its report, then reach through the
 * returned mark and rewrite the position and survey method the figure rested
 * on — and every session already built from that recorder changed with it.
 *
 * Written per event type rather than as a generic clone so the snapshot stays
 * tied to the closed schema: a field the schema does not define cannot travel
 * into a session by being present on the object that was passed in.
 */
function captureEventSnapshot(event: CaptureEvent): CaptureEvent {
  if (event.type === 'imu') {
    return {
      type: 'imu',
      sequence: event.sequence,
      timeMs: event.timeMs,
      accelerometer: [...event.accelerometer] as Vector3,
      gyroscope: [...event.gyroscope] as Vector3,
      orientation: event.orientation ? { ...event.orientation } : null,
    };
  }
  if (event.type === 'scan') {
    return {
      type: 'scan',
      sequence: event.sequence,
      timeMs: event.timeMs,
      transport: event.transport,
      payload: event.payload,
      outcome: event.outcome,
      anchorId: event.anchorId,
    };
  }
  if (event.type === 'ground-truth') {
    return {
      type: 'ground-truth',
      sequence: event.sequence,
      timeMs: event.timeMs,
      checkpointId: event.checkpointId,
      position: [event.position[0], event.position[1]],
      floorId: event.floorId,
      surveyMethod: event.surveyMethod,
      expectedAccuracyMeters: event.expectedAccuracyMeters,
      independentOfAnchors: event.independentOfAnchors,
    };
  }
  return {
    type: 'lifecycle',
    sequence: event.sequence,
    timeMs: event.timeMs,
    event: event.event,
    ...(event.detail === undefined ? {} : { detail: event.detail }),
  };
}

function captureAnchorSnapshot(anchor: CheckpointAnchor): CaptureAnchorSnapshot {
  return {
    id: anchor.id,
    floorId: anchor.floorId,
    kind: anchor.kind,
    position: [anchor.position[0], anchor.position[1]],
    headingDegrees: anchor.headingDegrees,
    payload: anchor.payload,
  };
}

/** How far a surveyed mark may sit from the nearest estimate and still be measured. */
export const GROUND_TRUTH_ALIGNMENT_TOLERANCE_MS = 1_000;

/**
 * Inertial silence long enough to matter.
 *
 * At walking pace a second of missing samples is over a metre of unmodelled
 * motion, which is larger than the accuracy being claimed.
 */
export const MATERIAL_SENSOR_GAP_MS = 1_000;

/**
 * Identifies one derived observation, and therefore one estimate.
 *
 * `timeMs` alone is ambiguous, and so is `(timeMs, sequence)` — a single scan
 * emits several observations at one instant from one capture event. The ordinal
 * separates them.
 */
export interface ObservationKey {
  timeMs: number;
  sequence: number;
  ordinal: number;
}

/** Lexicographic order over observation keys. */
export function compareObservationKeys(left: ObservationKey, right: ObservationKey) {
  return left.timeMs - right.timeMs || left.sequence - right.sequence || left.ordinal - right.ordinal;
}

export interface EvidenceReport {
  report: ReplayReport;
  /** Every mark considered, whether it counted or not. */
  evaluationCheckpoints: EvaluationCheckpoint[];
  eligibility: {
    surveyed: number;
    publishable: number;
    excluded: number;
    exclusionCounts: Record<CheckpointExclusionReason, number>;
  };
  survey: {
    methods: Record<string, number>;
    worstExpectedAccuracyMeters: number | null;
  };
  alignment: {
    /** Always <= 0: evaluation never reads forward in time. */
    worstAlignmentDeltaMs: number | null;
    toleranceMs: number;
  };
  sampling: SamplingSummary;
}

/**
 * The only supported way to produce a quotable accuracy figure.
 *
 * It starts from a capture session so validation, checkpoint eligibility, and
 * provenance cannot be skipped. Handing a hand-written `LocalizationRecording`
 * straight to `replayRecording` bypasses all three, which is why that path is
 * treated as diagnostic rather than evidential.
 */
export function buildEvidenceReport(
  session: CaptureSession,
  overrides: DeriveOverrides = {},
): EvidenceReport {
  // Structurally invalid captures still throw: bad data is a different problem
  // from a valid walk that simply did not produce usable evidence.
  const captured = requireCaptureSnapshot(session);
  const derived = deriveValidatedRecording(captured, overrides);

  // Current processing reduces the gyroscope by taking its Z component as yaw,
  // which is only correct for degrees per second in the device frame. Anything
  // else would be silently misread.
  const sensors = captured.device.sensors;
  // Yaw is currently taken as the gyroscope's Z component, which is only the
  // world vertical for a handset held flat. Until orientation-aware projection
  // exists, only data already resolved into the world frame is eligible, and a
  // synthetic capture is never evidence about a real building.
  const unsupportedSensors = !isEvidentialSensorModel(sensors);

  const localized =
    derived.observations.length > 0 && derived.observations[0].kind === 'initial-fix';

  // Any lifecycle event in the interruption family counts, including a resume
  // with no recorded start: a stream that reports coming back without ever
  // reporting that it left has already lost events.
  const interruptedByLifecycle = captured.events.some(
    (event) =>
      event.type === 'lifecycle' &&
      (event.event === 'backgrounded' ||
        event.event === 'foregrounded' ||
        event.event === 'sensor-interrupted' ||
        event.event === 'sensor-resumed'),
  );

  // A silent gap is an interruption the device never announced. Only gaps after
  // the first fix and before the last mark being scored can affect a figure.
  const firstFixTimeMs = localized ? derived.observations[0].timeMs : null;
  const imuTimes = sortCaptureEvents(captured.events)
    .filter((event) => event.type === 'imu')
    .map((event) => event.timeMs);

  // Each mark is only defensible if inertial coverage was continuous from the
  // first fix up to the moment it was surveyed. The window ends at the recorded
  // time rather than the aligned estimate time, because the recorded time is
  // when someone actually stood on the mark.
  // Survey eligibility, not publishability, decides which marks are checked.
  // An outage long enough to strand a later mark would otherwise remove that
  // mark from consideration and hide the very outage that stranded it, leaving
  // an earlier surviving mark to report ok.
  const interruptedByGap =
    firstFixTimeMs !== null &&
    derived.evaluationCheckpoints.some(
      (checkpoint) =>
        checkpoint.surveyEligible &&
        worstCoverageGapMs(imuTimes, firstFixTimeMs, checkpoint.recordedTimeMs) >=
          MATERIAL_SENSOR_GAP_MS,
    );
  const interrupted = interruptedByLifecycle || interruptedByGap;

  // Replay is only run when the walk could produce a figure. Without a first
  // fix it would throw, and that is an expected field outcome rather than a
  // defect.
  // Replay is driven by whether localization exists, not by which status was
  // selected. Gating on the status meant an unsupported-sensor walk that also
  // never localized still reached replay and threw.
  const core = localized ? replayCore(derived) : null;

  // Only knowable after replay: capture validation bounds declared anchors and
  // marks, but estimates, covariance and map matches are derived. Every frame
  // is checked, not only the estimate selected by a checkpoint; a later QR
  // correction must not hide a trajectory that previously left the frame.
  const invalidLocalizationState =
    (core?.invalidEstimateIndices.length ?? 0) > 0 ||
    (core?.invalidMapMatchIndices.length ?? 0) > 0 ||
    (core?.unmeasurableCheckpointIds.length ?? 0) > 0;

  const blockingStatus: EvidenceStatus | null = unsupportedSensors
    ? 'unsupported-sensor-model'
    : !localized
      ? 'insufficient-localization'
      : interrupted
        ? 'interrupted-capture'
        : invalidLocalizationState
          ? 'invalid-localization-state'
          : derived.checkpoints.length === 0
            ? 'insufficient-ground-truth'
            : null;

  const status: EvidenceStatus = blockingStatus ?? 'ok';
  const isPublishable = status === 'ok';
  // Counts computed from a numerically invalid trajectory are not diagnostic
  // evidence either: a NaN route projection previously counted as an accepted
  // match, and a NaN position could still be labelled a high-quality frame.
  const reportCore = invalidLocalizationState ? null : core;

  const report: ReplayReport = {
    recordingVersion: LOCALIZATION_RECORDING_VERSION,
    sessionId: derived.sessionId,
    buildingId: derived.buildingId,
    packageHash: derived.packageHash,
    evidenceStatus: status,
    observationCount: derived.observations.length,
    checkpointCount: derived.checkpoints.length,
    qualityFrameCounts: reportCore?.qualityFrameCounts ?? { high: 0, degraded: 0, lost: 0 },
    medianHorizontalErrorMeters: isPublishable ? reportCore!.medianHorizontalErrorMeters : null,
    p95HorizontalErrorMeters: isPublishable ? reportCore!.p95HorizontalErrorMeters : null,
    floorAccuracy: isPublishable ? reportCore!.floorAccuracy : null,
    mapMatching: reportCore?.mapMatching ?? {
      acceptedCount: 0,
      rejectedCount: 0,
      reasonCounts: {
        matched: 0,
        'no-route': 0,
        'quality-lost': 0,
        'wrong-floor': 0,
        'outside-gate': 0,
        'backward-progress': 0,
      },
    },
    runtime: reportCore?.runtime ?? {
      stateCounts: { initializing: 0, tracking: 0, degraded: 0, lost: 0, relocalizing: 0 },
      guidanceFrozenFrames: 0,
    },
    checkpointErrors: isPublishable ? reportCore!.checkpointErrors : [],
  };

  const exclusionCounts = {
    'dependent-on-anchor': 0,
    'alignment-crosses-anchor-reset': 0,
    'no-causal-estimate-in-range': 0,
    'survey-method-not-publishable': 0,
    'survey-accuracy-out-of-policy': 0,
  } as Record<CheckpointExclusionReason, number>;
  for (const checkpoint of derived.diagnosticCheckpoints) {
    if (checkpoint.exclusionReason) exclusionCounts[checkpoint.exclusionReason] += 1;
  }

  const methods: Record<string, number> = {};
  for (const checkpoint of derived.evaluationCheckpoints) {
    methods[checkpoint.surveyMethod] = (methods[checkpoint.surveyMethod] ?? 0) + 1;
  }
  const publishable = derived.evaluationCheckpoints.filter((entry) => entry.publishable);

  return {
    report,
    evaluationCheckpoints: derived.evaluationCheckpoints,
    eligibility: {
      surveyed: derived.evaluationCheckpoints.length,
      publishable: publishable.length,
      excluded: derived.diagnosticCheckpoints.length,
      exclusionCounts,
    },
    survey: {
      methods,
      worstExpectedAccuracyMeters:
        publishable.length === 0
          ? null
          : Math.max(...publishable.map((entry) => entry.expectedAccuracyMeters)),
    },
    alignment: {
      worstAlignmentDeltaMs:
        publishable.length === 0
          ? null
          : Math.min(...publishable.map((entry) => entry.alignmentDeltaMs)),
      toleranceMs: GROUND_TRUTH_ALIGNMENT_TOLERANCE_MS,
    },
    sampling: summarizeSampling(captured),
  };
}

export interface DeriveOverrides {
  checkpointConfig?: Partial<CheckpointAdapterConfig>;
  deadReckoningConfig?: Partial<DeadReckoningConfig>;
  routeSegments?: RouteMatchSegment[];
}

export type CheckpointExclusionReason =
  | 'dependent-on-anchor'
  | 'alignment-crosses-anchor-reset'
  | 'no-causal-estimate-in-range'
  | 'survey-method-not-publishable'
  | 'survey-accuracy-out-of-policy';


/**
 * A surveyed mark plus everything needed to defend or discard it.
 *
 * The recorded time is never overwritten by the aligned time. A published
 * number has to be traceable back to the instant someone stood on the mark.
 */
export interface EvaluationCheckpoint {
  id: string;
  recordedTimeMs: number;
  recordedSequence: number;
  alignedTimeMs: number;
  alignmentDeltaMs: number;
  /** The exact derived observation this mark is scored against. */
  estimateKey: ObservationKey | null;
  /** Index of that observation, and therefore of its estimate. */
  observationIndex: number | null;
  position: [number, number];
  floorId: string;
  surveyMethod: SurveyMethod;
  expectedAccuracyMeters: number;
  independentOfAnchors: boolean;
  /** The mark qualifies on its own terms, before any estimate is sought. */
  surveyEligible: boolean;
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

function requireCaptureSnapshot(session: CaptureSession) {
  const inspection = inspectCaptureSession(session);
  if (inspection.issues.length > 0 || inspection.session === null) {
    throw new CaptureValidationError(inspection.issues);
  }
  return inspection.session;
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
  return deriveValidatedRecording(requireCaptureSnapshot(session), overrides);
}

function deriveValidatedRecording(
  session: CaptureSession,
  overrides: DeriveOverrides,
): DerivedRecording {
  const checkpointConfig: CheckpointAdapterConfig = resolveCheckpointConfig(
    overrides.checkpointConfig,
  );
  const deadReckoningConfig: DeadReckoningConfig = resolveDeadReckoningConfig(
    overrides.deadReckoningConfig,
  );
  const checkpoints = new CheckpointAdapter(session.anchors, checkpointConfig);
  const deadReckoning = new DeadReckoningIntegrator(deadReckoningConfig);
  const anchorsById = new Map(session.anchors.map((anchor) => [anchor.id, anchor]));

  // Each observation remembers the capture event that produced it, so
  // evaluation can order against the stream rather than against wall time
  // alone.
  // Every derived observation keeps the identity of the capture event that
  // produced it, plus which of that event's observations it was. One scan emits
  // a position fix, a heading, and a floor at the same millisecond, so time and
  // source sequence alone still do not name one of them.
  const collected: Array<{
    key: ObservationKey;
    order: number;
    observation: LocalizationObservation;
  }> = [];
  const groundTruth: GroundTruthCaptureEvent[] = [];
  let order = 0;
  let firstFixKey: ObservationKey | null = null;

  const collect = (observations: LocalizationObservation[], sourceSequence: number) => {
    observations.forEach((observation, ordinal) => {
      const key: ObservationKey = { timeMs: observation.timeMs, sequence: sourceSequence, ordinal };
      if (observation.kind === 'initial-fix' && firstFixKey === null) firstFixKey = key;
      collected.push({ key, order: order++, observation });
    });
  };

  for (const event of sortCaptureEvents(session.events)) {
    if (event.type === 'imu') {
      collect(deadReckoning.push(reduceImuEvent(event)), event.sequence);
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
      collect(resolution.observations, event.sequence);
      continue;
    }
    if (event.type === 'ground-truth') groundTruth.push(event);
  }

  // Pre-fix observations are dropped by the whole key, not by timestamp. An
  // observation sharing the fix's millisecond but captured before it must still
  // go, because nothing can be localized until the fix exists.
  const fixKey = firstFixKey as ObservationKey | null;
  const retained = collected
    .filter((entry) =>
      fixKey === null
        ? false
        : entry.observation.kind === 'initial-fix' || compareObservationKeys(entry.key, fixKey) >= 0,
    )
    .sort(
      (left, right) =>
        Number(right.observation.kind === 'initial-fix') -
          Number(left.observation.kind === 'initial-fix') ||
        compareObservationKeys(left.key, right.key) ||
        left.order - right.order,
    );

  const observations = retained.map((entry, index) => ({ ...entry.observation, sequence: index }));

  // The estimate timeline is discrete, but a surveyor stands on a floor mark
  // and notes the clock, which will not land on a sample boundary. Each mark is
  // therefore measured against the nearest estimate. A mark with no estimate
  // near it keeps its own time and fails loudly downstream, because that means
  // the device produced nothing while it was being stood on.
  // Evaluation is strictly causal. A mark is scored against the most recent
  // estimate that existed at the instant it was surveyed, ordered by time and
  // then capture sequence. Interpolating toward a later estimate would score
  // the mark against information the system did not have, and taking the
  // nearest estimate in absolute time does exactly that whenever the next
  // sample is closer than the previous one.
  // Candidate estimates, in the exact order replay will produce them. The index
  // is the join: estimate[i] comes from observation[i].
  const causalPoints = retained.map((entry, index) => ({ key: entry.key, index }));

  const anchorResets = sortCaptureEvents(session.events)
    .filter((event) => event.type === 'scan' && event.outcome === 'resolved')
    .map((event) => ({ timeMs: event.timeMs, sequence: event.sequence }));

  // A capture event is at or before a mark when it precedes it in the stream.
  // Equal timestamps are separated by capture sequence, which is what makes a
  // mark taken just before a same-millisecond reset score against pre-reset
  // state.
  const notAfter = (
    candidate: { timeMs: number; sequence: number },
    mark: { timeMs: number; sequence: number },
  ) =>
    candidate.timeMs < mark.timeMs ||
    (candidate.timeMs === mark.timeMs && candidate.sequence <= mark.sequence);

  const evaluationCheckpoints: EvaluationCheckpoint[] = groundTruth
    .map((mark) => {
      const markPoint = { timeMs: mark.timeMs, sequence: mark.sequence };
      let causal: { key: ObservationKey; index: number } | null = null;
      for (const point of causalPoints) {
        // A mark and the observations of an earlier event may share a
        // millisecond; sequence decides, and the mark's own sequence is
        // strictly greater than any event that preceded it.
        if (notAfter({ timeMs: point.key.timeMs, sequence: point.key.sequence }, markPoint)) {
          causal = point;
        } else break;
      }
      const withinTolerance =
        causal !== null && mark.timeMs - causal.key.timeMs <= GROUND_TRUTH_ALIGNMENT_TOLERANCE_MS;
      const alignedTimeMs = withinTolerance ? causal!.key.timeMs : mark.timeMs;
      const observationIndex = withinTolerance ? causal!.index : null;

      // A reset strictly between the chosen estimate and the mark means the
      // estimate predates a correction the mark was taken after.
      const crossesReset =
        withinTolerance &&
        anchorResets.some(
          (reset) =>
            !notAfter(reset, { timeMs: causal!.key.timeMs, sequence: causal!.key.sequence }) &&
            notAfter(reset, markPoint),
        );

      // True when the mark itself qualifies as evidence, independently of
      // whether an estimate could be found for it.
      const surveyEligible =
        mark.independentOfAnchors &&
        isPublishableSurveyMethod(mark.surveyMethod) &&
        isPublishableSurveyAccuracy(mark.expectedAccuracyMeters);

      const exclusionReason: CheckpointExclusionReason | null = !mark.independentOfAnchors
        ? 'dependent-on-anchor'
        : !isPublishableSurveyMethod(mark.surveyMethod)
          ? 'survey-method-not-publishable'
          : !isPublishableSurveyAccuracy(mark.expectedAccuracyMeters)
            ? 'survey-accuracy-out-of-policy'
            : !withinTolerance
              ? 'no-causal-estimate-in-range'
              : crossesReset
                ? 'alignment-crosses-anchor-reset'
                : null;

      return {
        id: mark.checkpointId,
        recordedTimeMs: mark.timeMs,
        recordedSequence: mark.sequence,
        alignedTimeMs,
        alignmentDeltaMs: alignedTimeMs - mark.timeMs,
        estimateKey: withinTolerance ? { ...causal!.key } : null,
        observationIndex,
        position: [...mark.position] as [number, number],
        floorId: mark.floorId,
        surveyMethod: mark.surveyMethod,
        expectedAccuracyMeters: mark.expectedAccuracyMeters,
        independentOfAnchors: mark.independentOfAnchors,
        surveyEligible,
        publishable: exclusionReason === null,
        exclusionReason,
      };
    })
    .sort(
      (left, right) =>
        left.alignedTimeMs - right.alignedTimeMs ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    );

  // Only publishable marks are handed to the replay evaluator. A dependent or
  // unalignable mark cannot influence reported accuracy because it is not in
  // the array the evaluator reads.
  const alignedCheckpoints: GroundTruthCheckpoint[] = evaluationCheckpoints
    .filter((checkpoint) => checkpoint.publishable && checkpoint.observationIndex !== null)
    .map((checkpoint) => ({
      id: checkpoint.id,
      timeMs: checkpoint.alignedTimeMs,
      position: [...checkpoint.position] as [number, number],
      floorId: checkpoint.floorId,
      // Names the estimate exactly, so scoring cannot drift to another
      // observation that happens to share the millisecond.
      observationIndex: checkpoint.observationIndex!,
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
