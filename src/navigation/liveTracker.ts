import { DeadReckoningIntegrator, type ImuSample } from '@voicegis/localization-core';
import { signedHeadingDifference, wrapDegrees } from './coordinateFrames';
import {
  ARRIVAL_METERS,
  bearingAt,
  bearingsNear,
  clampProgress,
  nextVerticalRun,
  positionAt,
  type RouteTrack,
  type VerticalRun,
} from './routeProgress';

/**
 * Where the visitor is along the route, from the phone's own sensors.
 *
 * This is guidance, not evidence. It answers one question - how far along the
 * route is the person, and how sure are we - and it answers it under a stated
 * assumption: that after a check-in the visitor sets off along the route they
 * asked for. Detected strides advance progress only while the direction of
 * travel, integrated from the gyroscope relative to that departure, agrees
 * with the corridor the route is on. Uncertainty grows with every metre
 * walked and resets at every scanned code. A storey change is never inferred
 * from motion; it is confirmed by a scan or by the visitor.
 *
 * The assumption is tested continuously rather than trusted: a wrong first
 * direction, a missed turn or a walk down the wrong corridor shows up as
 * strides that disagree with the route, and the tracker says so instead of
 * moving the marker. That is also why the corridor constraint makes this
 * workable where free dead reckoning would not - a route is a line, and a
 * stride either follows it or it does not.
 *
 * Nothing here is written to a recording. The evidence pipeline in
 * `localization-core` requires independently surveyed heading provenance for
 * exactly the reason this module cannot supply it, and the two must stay apart.
 */

export type TrackingTier = 'anchored' | 'tracking' | 'caution' | 'frozen';

export type TrackingReason =
  /** No trustworthy start; a scan is needed before anything can move. */
  | 'no-anchor'
  /** Anchored and waiting for the first strides to establish the direction of travel. */
  | 'awaiting-departure'
  | 'following'
  /** Uncertainty has grown; a scan would fix it. */
  | 'uncertain'
  /** The compass says the visitor is facing away from the route as they set off. */
  | 'wrong-way'
  /** Strides keep disagreeing with the corridor. */
  | 'off-route'
  /** The gyroscope is missing or silent; strides are counted along the route without a heading check. */
  | 'no-heading'
  /** At a lift or stair, waiting for the storey change to be confirmed. */
  | 'floor-change'
  | 'arrived'
  /** The motion stream stopped. */
  | 'sensors-silent'
  | 'sensors-unavailable';

export interface TrackerSnapshot {
  tier: TrackingTier;
  reason: TrackingReason;
  progressMeters: number;
  sigmaMeters: number;
  floorId: string;
  /** Plan bearing of travel once departure is established; null before that. */
  headingDegrees: number | null;
  walkedSinceAnchorMeters: number;
  stridesSinceAnchor: number;
  strideMeters: number;
  lastMotionMs: number | null;
  pendingFloor: { toFloorId: string; alightingMeters: number } | null;
  /** True while progress may still be advanced by strides. */
  moving: boolean;
}

export interface TrackerOptions {
  /** Length of one stride until two scans calibrate it. */
  strideMeters?: number;
  /** Uncertainty added per metre walked without a scan. */
  driftPerMeter?: number;
  /** Strides needed to establish the direction of travel after an anchor. */
  orientingStrides?: number;
  /** A stride within this many degrees of the corridor counts as following it. */
  agreeDegrees?: number;
  /** Any bearing within this distance of a corner is acceptable near it. */
  turnWindowMeters?: number;
  /** Motion stream silence that counts as a stopped sensor. */
  silenceMs?: number;
  /** Compass readings older than this are not consulted. */
  compassMaxAgeMs?: number;
  arrivalMeters?: number;
  cautionSigmaMeters?: number;
  frozenSigmaMeters?: number;
  /** Disagreeing strides before caution, and before freezing. */
  offRouteCaution?: number;
  offRouteFrozen?: number;
  /** Consecutive samples without a usable heading rate before the gyroscope is treated as absent. */
  missingRateSamples?: number;
}

const DEFAULTS: Required<TrackerOptions> = {
  strideMeters: 0.72,
  /*
   * Stride-based reckoning runs at roughly a tenth of distance walked once the
   * stride is right; this is a little worse than that. With Asterion's signs
   * 48 m apart, a walk between two scans stays in the tracking tier and a
   * missed scan reads as caution about fifteen metres later.
   */
  driftPerMeter: 0.08,
  orientingStrides: 3,
  agreeDegrees: 60,
  turnWindowMeters: 3,
  silenceMs: 1_500,
  compassMaxAgeMs: 3_000,
  arrivalMeters: ARRIVAL_METERS,
  cautionSigmaMeters: 6,
  frozenSigmaMeters: 12,
  offRouteCaution: 6,
  offRouteFrozen: 12,
  missingRateSamples: 25,
};

export const ANCHOR_SIGMA = Object.freeze({
  /** A code read at arm's length. */
  scan: 1,
  /** A landmark the visitor pointed at, which they are near rather than on. */
  selected: 4,
});

type Phase = 'unanchored' | 'orienting' | 'following' | 'floor-change';

/** Sample gap the guidance integrator tolerates before it forgets its heading. */
const GUIDANCE_SAMPLE_GAP_MS = 2_500;

function circularMean(degrees: readonly number[]) {
  let x = 0;
  let y = 0;
  for (const value of degrees) {
    const radians = (value * Math.PI) / 180;
    x += Math.cos(radians);
    y += Math.sin(radians);
  }
  return wrapDegrees((Math.atan2(y, x) * 180) / Math.PI);
}

export class RouteTracker {
  private readonly options: Required<TrackerOptions>;
  private track: RouteTrack;
  private integrator = new DeadReckoningIntegrator({ maximumSampleGapMs: GUIDANCE_SAMPLE_GAP_MS });
  private phase: Phase = 'unanchored';
  private progress = 0;
  private anchorSigma: number = ANCHOR_SIGMA.scan;
  private walked = 0;
  private strides = 0;
  private strideMeters: number;
  private alignment: number | null = null;
  private orientHeadings: number[] = [];
  private disagree = 0;
  private backward = 0;
  private lastMotionMs: number | null = null;
  private nowMs = 0;
  private nullRateRun = 0;
  private gyroMissing = false;
  private wrongWay = false;
  private compass: { planDegrees: number; atMs: number } | null = null;
  private pendingRun: VerticalRun | null = null;
  private sensorsProblem: 'sensors-unavailable' | null = null;
  private lastAnchor: { progress: number; strides: number } | null = null;

  constructor(track: RouteTrack, options: TrackerOptions = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.strideMeters = this.options.strideMeters;
    this.track = track;
  }

  /** A new route from the same walk: keep the stride calibration, forget the rest. */
  rebind(track: RouteTrack) {
    this.track = track;
    this.phase = 'unanchored';
    this.progress = 0;
    this.pendingRun = null;
    this.alignment = null;
    this.orientHeadings = [];
    this.disagree = 0;
    this.backward = 0;
    this.lastAnchor = null;
  }

  get currentTrack() {
    return this.track;
  }

  /** Whether a known point on this route has been established. */
  get isAnchored() {
    return this.phase !== 'unanchored';
  }

  /**
   * Sensors are back after a stop. Progress and uncertainty are kept - nothing
   * was learned while stopped, so nothing is reset - but the direction of
   * travel is re-established, because the visitor may well have turned.
   */
  resume(timeMs: number) {
    this.nowMs = Math.max(this.nowMs, timeMs);
    this.sensorsProblem = null;
    if (this.phase === 'following') this.beginOrienting();
  }

  /**
   * A known point on the route, from a scanned code or a chosen landmark.
   * Direction of travel is re-established from the next strides, because a
   * person who has just scanned a sign is facing the sign, not the way.
   */
  anchor(input: { progressMeters: number; sigmaMeters: number; timeMs: number }) {
    const progress = clampProgress(this.track, input.progressMeters);
    // Two scans with a walk between them measure the stride better than any
    // default can. Kept within the range a human stride occupies.
    if (
      this.lastAnchor !== null &&
      this.phase === 'following' &&
      this.strides >= 10 &&
      progress - this.lastAnchor.progress > 5
    ) {
      const measured = (progress - this.lastAnchor.progress) / this.strides;
      if (measured >= 0.45 && measured <= 1) {
        this.strideMeters = 0.5 * this.strideMeters + 0.5 * measured;
      }
    }
    this.progress = progress;
    this.anchorSigma = Math.max(0.1, input.sigmaMeters);
    this.walked = 0;
    this.strides = 0;
    this.disagree = 0;
    this.backward = 0;
    this.wrongWay = false;
    this.pendingRun = null;
    this.lastAnchor = { progress, strides: 0 };
    this.nowMs = Math.max(this.nowMs, input.timeMs);
    this.beginOrienting();
  }

  private beginOrienting() {
    this.phase = 'orienting';
    this.alignment = null;
    this.orientHeadings = [];
    if (!this.gyroMissing) this.integrator.syncHeading(0);
  }

  /** A compass heading already turned into a plan bearing, or null when there is none. */
  compassPlanBearing(degrees: number | null, timeMs: number) {
    this.compass =
      degrees === null || !Number.isFinite(degrees)
        ? null
        : { planDegrees: wrapDegrees(degrees), atMs: timeMs };
  }

  sensorsLost(reason: 'sensors-unavailable' | 'sensors-silent' | null) {
    this.sensorsProblem = reason === 'sensors-unavailable' ? reason : null;
  }

  /** One reduced inertial sample. Strides and turns come out of it; nothing else does. */
  motion(sample: ImuSample) {
    if (!Number.isFinite(sample.timeMs)) return;
    this.nowMs = Math.max(this.nowMs, sample.timeMs);
    this.lastMotionMs = sample.timeMs;
    this.sensorsProblem = null;

    const rateMissing =
      sample.headingRateDegreesPerSecond === null ||
      !Number.isFinite(sample.headingRateDegreesPerSecond);
    this.nullRateRun = rateMissing ? this.nullRateRun + 1 : 0;
    const wasMissing = this.gyroMissing;
    if (this.nullRateRun >= this.options.missingRateSamples) this.gyroMissing = true;
    else if (!rateMissing) this.gyroMissing = false;

    let observations;
    try {
      observations = this.integrator.push(sample);
    } catch {
      // A regressing or non-finite timestamp is a sample to skip, not a reason to stop.
      return;
    }

    // Heading continuity was lost - a gap, a dropout, or the very first
    // sample. Relative integration restarts from here and direction of travel
    // is re-established from the next strides; progress is kept.
    if (!rateMissing && this.integrator.heading === null) {
      this.integrator.syncHeading(0);
      if (this.phase === 'following') this.beginOrienting();
    } else if (wasMissing && !this.gyroMissing && this.phase === 'following') {
      this.beginOrienting();
    }

    for (const observation of observations) {
      if (observation.kind === 'step') this.stride();
    }
  }

  private stride() {
    if (this.phase === 'unanchored' || this.phase === 'floor-change') return;
    this.strides += 1;
    this.walked += this.strideMeters;

    if (this.gyroMissing) {
      // No direction at all: count the stride along the route and say so.
      this.advance(this.strideMeters);
      return;
    }

    const relative = this.integrator.heading;
    if (this.phase === 'orienting') {
      if (this.compassOpposesRoute()) {
        this.wrongWay = true;
        return;
      }
      this.wrongWay = false;
      if (relative !== null) this.orientHeadings.push(relative);
      this.advance(this.strideMeters);
      if (this.orientHeadings.length >= this.options.orientingStrides) {
        this.alignment = wrapDegrees(
          bearingAt(this.track, this.progress) - circularMean(this.orientHeadings),
        );
        this.phase = 'following';
      }
      return;
    }

    if (this.alignment === null || relative === null) return;
    const heading = wrapDegrees(this.alignment + relative);
    const forward = bearingsNear(this.track, this.progress, this.options.turnWindowMeters);
    if (forward.length === 0) forward.push(bearingAt(this.track, this.progress));
    const ahead = Math.min(
      ...forward.map((bearing) => Math.abs(signedHeadingDifference(bearing, heading))),
    );
    // Retreating is walking back the way this point was reached - not facing
    // away from any nearby segment, which at a corner would also describe
    // walking off down a corridor the route never uses.
    const cameFrom = wrapDegrees(bearingAt(this.track, Math.max(0, this.progress - 0.3)) + 180);
    const retreat = Math.abs(signedHeadingDifference(cameFrom, heading));
    if (ahead <= this.options.agreeDegrees) {
      this.disagree = 0;
      this.backward = 0;
      this.advance(this.strideMeters);
    } else if (retreat <= this.options.agreeDegrees) {
      this.backward += 1;
      this.disagree = 0;
      this.progress = clampProgress(this.track, this.progress - this.strideMeters);
    } else {
      this.disagree += 1;
    }
  }

  private compassOpposesRoute() {
    if (this.compass === null || this.nowMs - this.compass.atMs > this.options.compassMaxAgeMs)
      return false;
    const route = bearingAt(this.track, this.progress);
    return Math.abs(signedHeadingDifference(route, this.compass.planDegrees)) > 120;
  }

  private advance(meters: number) {
    if (this.frozenBySigma() || this.disagree >= this.options.offRouteFrozen) return;
    const run = nextVerticalRun(this.track, this.progress);
    let next = clampProgress(this.track, this.progress + meters);
    if (run !== null && next >= run.boardingMeters - 1e-6) {
      next = run.boardingMeters;
      this.progress = next;
      this.phase = 'floor-change';
      this.pendingRun = run;
      return;
    }
    this.progress = next;
  }

  /** The visitor says they have made the storey change the route asked for. */
  confirmFloor(timeMs: number) {
    if (this.phase !== 'floor-change' || this.pendingRun === null) return;
    this.progress = this.pendingRun.alightingMeters;
    // A ride is a place the estimate cannot follow; it costs certainty.
    this.anchorSigma = this.sigma() + 2;
    this.walked = 0;
    this.strides = 0;
    this.lastAnchor = null;
    this.pendingRun = null;
    this.nowMs = Math.max(this.nowMs, timeMs);
    this.beginOrienting();
  }

  private sigma() {
    const drift = this.options.driftPerMeter * (this.gyroMissing ? 2 : 1);
    return this.anchorSigma + drift * this.walked + 0.3 * this.disagree + 0.5 * this.backward;
  }

  private frozenBySigma() {
    return this.sigma() >= this.options.frozenSigmaMeters;
  }

  private silent(nowMs: number) {
    return this.lastMotionMs !== null && nowMs - this.lastMotionMs > this.options.silenceMs;
  }

  /** Current state at a moment on the sensor clock. */
  read(nowMs: number): TrackerSnapshot {
    this.nowMs = Math.max(this.nowMs, nowMs);
    const sigma = this.sigma();
    const position = positionAt(this.track, this.progress);
    const arrivedNow =
      this.phase !== 'unanchored' &&
      this.progress >= this.track.length - this.options.arrivalMeters;
    const heading =
      this.phase === 'following' && this.alignment !== null && this.integrator.heading !== null
        ? wrapDegrees(this.alignment + this.integrator.heading)
        : null;

    let tier: TrackingTier;
    let reason: TrackingReason;
    let moving = false;
    if (this.sensorsProblem !== null) {
      tier = 'frozen';
      reason = this.sensorsProblem;
    } else if (this.phase === 'unanchored') {
      tier = 'frozen';
      reason = 'no-anchor';
    } else if (this.silent(this.nowMs)) {
      tier = 'frozen';
      reason = 'sensors-silent';
    } else if (this.phase === 'floor-change') {
      tier = 'frozen';
      reason = 'floor-change';
    } else if (this.disagree >= this.options.offRouteFrozen) {
      tier = 'frozen';
      reason = 'off-route';
    } else if (sigma >= this.options.frozenSigmaMeters) {
      tier = 'frozen';
      reason = 'uncertain';
    } else if (arrivedNow) {
      tier = sigma >= this.options.cautionSigmaMeters ? 'caution' : 'tracking';
      reason = 'arrived';
      moving = true;
    } else if (this.wrongWay) {
      tier = 'caution';
      reason = 'wrong-way';
    } else if (this.gyroMissing) {
      tier = 'caution';
      reason = 'no-heading';
      moving = true;
    } else if (this.disagree >= this.options.offRouteCaution) {
      tier = 'caution';
      reason = 'off-route';
      moving = true;
    } else if (this.backward >= 3) {
      tier = 'caution';
      reason = 'wrong-way';
      moving = true;
    } else if (this.phase === 'orienting') {
      tier = this.strides === 0 ? 'anchored' : 'tracking';
      reason = this.strides === 0 ? 'awaiting-departure' : 'following';
      moving = true;
    } else if (sigma >= this.options.cautionSigmaMeters) {
      tier = 'caution';
      reason = 'uncertain';
      moving = true;
    } else {
      tier = 'tracking';
      reason = 'following';
      moving = true;
    }

    return {
      tier,
      reason,
      progressMeters: this.progress,
      sigmaMeters: sigma,
      floorId: position.floor,
      headingDegrees: heading,
      walkedSinceAnchorMeters: this.walked,
      stridesSinceAnchor: this.strides,
      strideMeters: this.strideMeters,
      lastMotionMs: this.lastMotionMs,
      pendingFloor: this.pendingRun
        ? { toFloorId: this.pendingRun.toFloorId, alightingMeters: this.pendingRun.alightingMeters }
        : null,
      moving,
    };
  }
}
