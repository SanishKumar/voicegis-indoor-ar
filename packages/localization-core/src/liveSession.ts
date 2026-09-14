import { isBuildingFrameCoordinate } from './captureStream';
import { CheckpointAdapter, type CheckpointAnchor, type CheckpointScan } from './checkpoints';
import { LocalizationFilter } from './filter';
import { requireHeadingCalibration } from './headingObservations';
import { RouteMatchTracker } from './mapMatching';
import { LocalizationRuntimeController, type GuidanceState } from './runtimeState';
import type {
  HeadingCalibrationObservation,
  LocalizationEstimate,
  MapMatchResult,
  RouteMatchSegment,
  StepObservation,
} from './types';

export interface LiveSessionIdentity {
  sessionId: string;
  buildingId: string;
  packageHash: string;
  /** Replace the session for ANY route, profile or closure-policy change. */
  routeRevision: number;
}

export interface LiveSessionOptions {
  identity: LiveSessionIdentity;
  /** Already verified by the venue owner; all geometry is in filter-local metres. */
  anchors: CheckpointAnchor[];
  elevationByFloorId: Record<string, number>;
  routeSegments: RouteMatchSegment[];
  motionTimeoutMs?: number;
  maximumDeliveryAgeMs?: number;
}

/** Opaque by object identity: copying its fields does not copy its authority.
 * Capture this BEFORE asynchronous work starts, never fetch a new lease on delivery. */
export interface LiveObservationLease {
  readonly identity: Readonly<LiveSessionIdentity>;
  readonly generation: number;
}

export type LiveHeadingCalibration = Omit<HeadingCalibrationObservation, 'kind' | 'sequence'>;

/** One qualified complete motion sample, NOT a timer tick or a compass-only event.
 * The future adapter must reset its integrator on every acquisition/lifecycle boundary.
 * Null heading reports loss; a missing stride means no observed displacement. */
export interface LiveMotionFrame {
  timeMs: number;
  headingDegrees: number | null;
  headingAccuracyDegrees: number | null;
  stride: Pick<StepObservation, 'distanceMeters' | 'durationMs' | 'varianceMeters2'> | null;
}

export type LiveInterruption =
  'hidden' | 'permission-denied' | 'sensor-unavailable' | 'floor-change';
export type LiveSessionReason =
  | 'not-started'
  | 'checkpoint-required'
  | 'awaiting-heading'
  | 'awaiting-motion'
  | 'tracking'
  | 'degraded'
  | 'stale-motion'
  | 'heading-unavailable'
  | 'quality-lost'
  | 'route-rejected'
  | 'invalid-input'
  | 'clock-invalid'
  | 'stopped'
  | LiveInterruption;

export interface LiveSessionSnapshot {
  identity: LiveSessionIdentity;
  generation: number;
  nowMs: number;
  guidanceState: GuidanceState;
  reason: LiveSessionReason;
  /** Diagnostic last estimate only. Never promote it to a current location when frozen. */
  estimate: LocalizationEstimate | null;
  routeMatch: MapMatchResult | null;
  /** Only exposed while guidance is usable; never a maneuver or arrival decision. */
  progressMeters: number | null;
  lastMotionTimeMs: number | null;
  motionAgeMs: number | null;
  checkpointAnchorId: string | null;
}

export interface LiveInputResult {
  accepted: boolean;
  reason: string;
  snapshot: LiveSessionSnapshot;
}

function positive(value: number) {
  return Number.isFinite(value) && value > 0;
}
function nonnegative(value: number) {
  return Number.isFinite(value) && value >= 0;
}
function named(value: string) {
  return typeof value === 'string' && value.trim().length > 0;
}

/** In-memory session boundary, not an evidence processor or a browser sensor adapter.
 * No replay semantics are changed. Each read checks the caller's monotonic clock;
 * observations and that clock MUST share the same origin. No velocity extrapolation. */
export class LiveLocalizationSession {
  private readonly identity: Readonly<LiveSessionIdentity>;
  private readonly anchors: CheckpointAnchor[];
  private readonly elevations: Record<string, number>;
  private readonly segments: RouteMatchSegment[];
  private readonly motionTimeoutMs: number;
  private readonly maximumDeliveryAgeMs: number;
  private clockMs = 0;
  private generation = 0;
  private boundaryMs = 0;
  private lease: LiveObservationLease | null = null;
  private reason: LiveSessionReason = 'not-started';
  private guidance: GuidanceState = 'frozen';
  private filter: LocalizationFilter | null = null;
  private tracker: RouteMatchTracker | null = null;
  private runtime = new LocalizationRuntimeController();
  private estimate: LocalizationEstimate | null = null;
  private routeMatch: MapMatchResult | null = null;
  private fixTimeMs: number | null = null;
  private lastMotionTimeMs: number | null = null;
  private lastStrideEndMs = 0;
  private checkpointAnchorId: string | null = null;
  private sequence = 0;
  private calibrated = false;

  constructor(options: LiveSessionOptions) {
    const { identity } = options;
    if (
      ![identity.sessionId, identity.buildingId, identity.packageHash].every(named) ||
      !Number.isSafeInteger(identity.routeRevision) ||
      identity.routeRevision < 0
    ) {
      throw new Error('Live session requires an exact venue, session and route identity.');
    }
    this.identity = Object.freeze({ ...identity });
    this.motionTimeoutMs = options.motionTimeoutMs ?? 1_500;
    this.maximumDeliveryAgeMs = options.maximumDeliveryAgeMs ?? 500;
    if (
      !positive(this.motionTimeoutMs) ||
      !nonnegative(this.maximumDeliveryAgeMs) ||
      this.maximumDeliveryAgeMs >= this.motionTimeoutMs
    ) {
      throw new Error('Live freshness requires a finite timeout and a shorter delivery-age limit.');
    }
    this.elevations = { ...options.elevationByFloorId };
    const ids = new Set<string>();
    this.anchors = options.anchors.map((anchor) => {
      if (
        !named(anchor.id) ||
        ids.has(anchor.id) ||
        !named(anchor.payload) ||
        !named(anchor.floorId) ||
        !['qr', 'nfc', 'image', 'apriltag'].includes(anchor.kind) ||
        anchor.position.length !== 2 ||
        !anchor.position.every(isBuildingFrameCoordinate) ||
        !Object.hasOwn(this.elevations, anchor.floorId) ||
        !isBuildingFrameCoordinate(this.elevations[anchor.floorId])
      ) {
        throw new Error(
          'Live checkpoint anchors require unique IDs, valid positions and explicit floor elevations.',
        );
      }
      ids.add(anchor.id);
      return { ...anchor, position: [...anchor.position] };
    });
    this.segments = options.routeSegments.map((segment) => ({
      ...segment,
      from: [...segment.from],
      to: [...segment.to],
    }));
  }

  private freeze(reason: LiveSessionReason) {
    if (this.reason === 'stopped') return;
    this.reason = reason;
    this.guidance = 'frozen';
    this.lease = null;
    // Keep the last estimate for diagnostics, but retire every mutable processor.
    this.filter = null;
    this.tracker = null;
  }

  private advanceClock(nowMs: number) {
    if (!nonnegative(nowMs) || nowMs < this.clockMs) {
      this.freeze('clock-invalid');
      throw new Error('Live session clock must be finite, non-negative and monotonic.');
    }
    this.clockMs = nowMs;
    const motionBaseline = this.lastMotionTimeMs ?? this.fixTimeMs;
    if (
      this.lease &&
      this.fixTimeMs !== null &&
      motionBaseline !== null &&
      nowMs - motionBaseline >= this.motionTimeoutMs
    )
      this.freeze('stale-motion');
  }

  private snapshot(): LiveSessionSnapshot {
    return {
      identity: { ...this.identity },
      generation: this.generation,
      nowMs: this.clockMs,
      guidanceState: this.guidance,
      reason: this.reason,
      estimate: this.estimate ? structuredClone(this.estimate) : null,
      routeMatch: this.routeMatch ? structuredClone(this.routeMatch) : null,
      progressMeters: this.guidance === 'frozen' ? null : (this.routeMatch?.progressMeters ?? null),
      lastMotionTimeMs: this.lastMotionTimeMs,
      motionAgeMs: this.lastMotionTimeMs === null ? null : this.clockMs - this.lastMotionTimeMs,
      checkpointAnchorId: this.checkpointAnchorId,
    };
  }

  read(nowMs: number): LiveSessionSnapshot {
    this.advanceClock(nowMs);
    return this.snapshot();
  }

  /** Explicit user-authorized start/recovery, after the owner checks visibility and permissions.
   * Always retires old callbacks and heading, even if the route has not changed. */
  beginAcquisition(nowMs: number): LiveObservationLease {
    this.advanceClock(nowMs);
    if (this.reason === 'stopped') throw new Error('A stopped live session cannot restart.');
    this.freeze('checkpoint-required');
    this.boundaryMs = nowMs;
    this.fixTimeMs = null;
    this.lastMotionTimeMs = null;
    this.calibrated = false;
    this.sequence = 0;
    this.generation += 1;
    this.lease = Object.freeze({ identity: this.identity, generation: this.generation });
    return this.lease;
  }

  interrupt(reason: LiveInterruption, nowMs: number): LiveSessionSnapshot {
    this.advanceClock(nowMs);
    this.freeze(reason);
    return this.snapshot();
  }

  stop(nowMs: number): LiveSessionSnapshot {
    this.advanceClock(nowMs);
    this.freeze('stopped');
    return this.snapshot();
  }

  private result(accepted: boolean, reason: string): LiveInputResult {
    return { accepted, reason, snapshot: this.snapshot() };
  }

  private inputGate(lease: LiveObservationLease, timeMs: number, nowMs: number): string | null {
    // Expire BEFORE checking this incoming sample: a post-gap sample is not continuity.
    this.advanceClock(nowMs);
    if (!this.lease || lease !== this.lease) return 'retired-lease';
    if (!nonnegative(timeMs) || timeMs > nowMs) return 'invalid-time';
    if (
      timeMs < this.boundaryMs ||
      (this.fixTimeMs !== null && this.estimate && timeMs < this.estimate.timeMs)
    )
      return 'out-of-order';
    if (nowMs - timeMs > this.maximumDeliveryAgeMs) return 'stale-input';
    return null;
  }

  /** Resolve payload inside THIS session's immutable package snapshot. Neither caller-supplied
   * coordinates nor a historic observationSources tag can reset the route cursor. */
  reacquire(lease: LiveObservationLease, scan: CheckpointScan, nowMs: number): LiveInputResult {
    const refusal = this.inputGate(lease, scan.timeMs, nowMs);
    if (refusal) return this.result(false, refusal);
    if (this.fixTimeMs !== null) return this.result(false, 'already-acquired');
    const adapter = new CheckpointAdapter(this.anchors, { elevationByFloorId: this.elevations });
    const resolution = adapter.resolve(scan);
    if (!resolution.accepted) return this.result(false, resolution.reason);
    const filter = new LocalizationFilter({}, this.identity);
    const estimate = filter.apply(resolution.observations[0]);
    const tracker = new RouteMatchTracker(this.segments);
    const match = tracker.match(estimate);
    if (!match.accepted) return this.result(false, `checkpoint-route-${match.reason}`);
    // Commit the full position/floor/matcher transaction only after every check succeeds.
    this.filter = filter;
    this.tracker = tracker;
    this.runtime = new LocalizationRuntimeController();
    this.estimate = estimate;
    this.routeMatch = match;
    this.sequence = 1;
    this.fixTimeMs = scan.timeMs;
    this.lastStrideEndMs = scan.timeMs;
    this.checkpointAnchorId = resolution.anchorId;
    this.reason = 'awaiting-heading';
    return this.result(true, 'checkpoint-acquired');
  }

  calibrate(
    lease: LiveObservationLease,
    calibration: LiveHeadingCalibration,
    nowMs: number,
  ): LiveInputResult {
    const refusal = this.inputGate(lease, calibration.timeMs, nowMs);
    if (refusal) return this.result(false, refusal);
    if (!this.filter) return this.result(false, 'checkpoint-required');
    if (this.calibrated) return this.result(false, 'already-calibrated');
    const observation: HeadingCalibrationObservation = {
      ...calibration,
      kind: 'heading-calibration',
      sequence: this.sequence,
    };
    try {
      if (observation.source !== 'visual-anchor')
        throw new Error('Live calibration cannot use replay provenance.');
      requireHeadingCalibration(observation, this.identity);
    } catch {
      return this.result(false, 'invalid-calibration');
    }
    this.estimate = this.filter.apply(observation);
    this.sequence += 1;
    this.calibrated = true;
    this.lastStrideEndMs = calibration.timeMs;
    this.updateGuidance();
    return this.result(this.lease !== null, this.lease ? 'calibrated' : this.reason);
  }

  motion(lease: LiveObservationLease, frame: LiveMotionFrame, nowMs: number): LiveInputResult {
    const refusal = this.inputGate(lease, frame.timeMs, nowMs);
    if (refusal) return this.result(false, refusal);
    if (!this.filter) return this.result(false, 'checkpoint-required');
    if (this.lastMotionTimeMs !== null && frame.timeMs <= this.lastMotionTimeMs) {
      return this.result(false, 'duplicate-motion');
    }
    if (frame.headingDegrees === null || frame.headingAccuracyDegrees === null) {
      this.freeze('heading-unavailable');
      return this.result(false, 'heading-unavailable');
    }
    const stride = frame.stride;
    if (
      !Number.isFinite(frame.headingDegrees) ||
      frame.headingDegrees < 0 ||
      frame.headingDegrees >= 360 ||
      !positive(frame.headingAccuracyDegrees) ||
      frame.headingAccuracyDegrees > 180 ||
      (stride !== null &&
        (!stride ||
          typeof stride !== 'object' ||
          !nonnegative(stride.distanceMeters) ||
          !isBuildingFrameCoordinate(stride.distanceMeters) ||
          !positive(stride.durationMs) ||
          !nonnegative(stride.varianceMeters2) ||
          frame.timeMs - stride.durationMs < this.lastStrideEndMs))
    ) {
      this.freeze('invalid-input');
      return this.result(false, 'invalid-input');
    }
    this.estimate = this.filter.apply({
      kind: 'heading',
      source: 'inertial',
      sequence: this.sequence++,
      timeMs: frame.timeMs,
      headingDegrees: frame.headingDegrees,
      accuracyDegrees: frame.headingAccuracyDegrees,
    });
    if (stride)
      this.estimate = this.filter.apply({
        ...stride,
        kind: 'step',
        source: 'pedometer',
        sequence: this.sequence++,
        timeMs: frame.timeMs,
      });
    if (stride) this.lastStrideEndMs = frame.timeMs;
    this.lastMotionTimeMs = frame.timeMs;
    this.updateGuidance();
    return this.result(this.lease !== null, this.reason);
  }

  private updateGuidance() {
    if (!this.estimate || !this.tracker) return;
    if (
      !this.estimate.velocity.every(Number.isFinite) ||
      !this.estimate.covariance.every((row) => row.every(Number.isFinite)) ||
      (this.estimate.headingDegrees !== null && !Number.isFinite(this.estimate.headingDegrees)) ||
      (this.estimate.headingSigmaDegrees !== null &&
        !nonnegative(this.estimate.headingSigmaDegrees))
    ) {
      this.freeze('invalid-input');
      return;
    }
    this.routeMatch = this.tracker.match(this.estimate);
    if (!this.routeMatch.accepted) {
      this.freeze(this.estimate.quality === 'lost' ? 'quality-lost' : 'route-rejected');
      return;
    }
    const runtime = this.runtime.update(this.estimate, this.routeMatch);
    if (runtime.localizationState === 'lost') {
      this.freeze('quality-lost');
      return;
    }
    if (this.estimate.headingDegrees === null) {
      this.reason = 'awaiting-heading';
      return;
    }
    if (this.lastMotionTimeMs === null) {
      this.reason = 'awaiting-motion';
      return;
    }
    this.guidance = runtime.guidanceState;
    this.reason = this.guidance === 'active' ? 'tracking' : 'degraded';
  }
}

/** Optional diagnostic publisher. The owner must dispose on teardown, stop the session
 * on route replacement, and forward visibility/permission interruptions immediately.
 * A delayed browser timer is not a clock: read() also rechecks expiry on every input. */
export function watchLocalizationSession(
  session: LiveLocalizationSession,
  options: {
    now: () => number;
    onSnapshot: (snapshot: LiveSessionSnapshot) => void;
    intervalMs?: number;
  },
): () => void {
  const intervalMs = options.intervalMs ?? 250;
  if (!positive(intervalMs)) throw new Error('Watchdog interval must be finite and positive.');
  const { now, onSnapshot } = options;
  let timer: ReturnType<typeof setInterval> | null = null;
  const dispose = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  const publish = () => {
    try {
      const snapshot = session.read(now());
      if (snapshot.reason === 'stopped') dispose();
      onSnapshot(snapshot);
      return snapshot.reason !== 'stopped';
    } catch (error) {
      dispose();
      throw error;
    }
  };
  if (publish()) timer = setInterval(publish, intervalMs);
  return dispose;
}
