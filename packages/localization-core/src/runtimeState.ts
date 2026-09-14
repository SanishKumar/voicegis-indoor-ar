import type { LocalizationEstimate, MapMatchResult } from './types';

export type LocalizationRuntimeState =
  'initializing' | 'tracking' | 'degraded' | 'lost' | 'relocalizing';

export type GuidanceState = 'active' | 'caution' | 'frozen';

export interface RuntimeSnapshot {
  timeMs: number;
  localizationState: LocalizationRuntimeState;
  guidanceState: GuidanceState;
  reason: string;
  lostAtMs: number | null;
  recoveryDurationMs: number | null;
  recoveryAnchorId: string | null;
}

export interface RecoveryConfig {
  maximumAnchorAgeMs: number;
}

const DEFAULT_RECOVERY_CONFIG: RecoveryConfig = {
  maximumAnchorAgeMs: 2_000,
};

function guidanceFor(state: LocalizationRuntimeState): GuidanceState {
  if (state === 'tracking') return 'active';
  if (state === 'degraded') return 'caution';
  return 'frozen';
}

function currentRouteAccepted(estimate: LocalizationEstimate, match?: MapMatchResult) {
  return (
    match !== undefined &&
    match.accepted &&
    match.timeMs === estimate.timeMs &&
    match.floorId === estimate.floorId &&
    match.rawPosition[0] === estimate.position[0] &&
    match.rawPosition[1] === estimate.position[1]
  );
}

export class LocalizationRuntimeController {
  private state: LocalizationRuntimeState = 'initializing';
  private lostAtMs: number | null = null;
  private recoveryDurationMs: number | null = null;
  private recoveryAnchorId: string | null = null;
  private reason = 'Waiting for an initial localization estimate.';
  private routeRequired = false;

  constructor(private readonly config: RecoveryConfig = DEFAULT_RECOVERY_CONFIG) {}

  private snapshot(timeMs: number): RuntimeSnapshot {
    return {
      timeMs,
      localizationState: this.state,
      guidanceState: guidanceFor(this.state),
      reason: this.reason,
      lostAtMs: this.lostAtMs,
      recoveryDurationMs: this.recoveryDurationMs,
      recoveryAnchorId: this.recoveryAnchorId,
    };
  }

  update(estimate: LocalizationEstimate, routeMatch?: MapMatchResult): RuntimeSnapshot {
    if (routeMatch !== undefined) this.routeRequired = true;
    if (estimate.quality === 'lost') {
      if (this.lostAtMs === null) this.lostAtMs = estimate.timeMs;
      this.state = 'lost';
      this.reason = 'Localization quality is lost; spatial guidance is frozen.';
      return this.snapshot(estimate.timeMs);
    }

    if (estimate.headingDegrees === null) {
      if (this.state !== 'lost' && this.state !== 'relocalizing') this.state = 'initializing';
      this.reason =
        'Position is available but travel direction is unverified; spatial guidance is frozen.';
      return this.snapshot(estimate.timeMs);
    }

    if (
      estimate.floorTransitionPending ||
      (this.routeRequired && !currentRouteAccepted(estimate, routeMatch))
    ) {
      if (this.state !== 'lost' && this.state !== 'relocalizing') this.state = 'initializing';
      this.reason = estimate.floorTransitionPending
        ? 'Floor change is unverified; spatial guidance is frozen until an anchor confirms location.'
        : `No accepted route match for this estimate (${routeMatch?.reason ?? 'missing'}); spatial guidance is frozen.`;
      return this.snapshot(estimate.timeMs);
    }

    if (this.state === 'lost' || this.state === 'relocalizing') {
      this.state = 'relocalizing';
      this.reason =
        'A plausible estimate is available, but a trusted anchor must confirm recovery.';
      return this.snapshot(estimate.timeMs);
    }

    if (estimate.quality === 'degraded') {
      this.state = 'degraded';
      this.reason = 'Localization uncertainty is elevated; guidance remains in caution mode.';
      return this.snapshot(estimate.timeMs);
    }

    this.state = 'tracking';
    this.reason = 'Localization quality is high.';
    return this.snapshot(estimate.timeMs);
  }

  beginRelocalization(timeMs: number): RuntimeSnapshot {
    if (this.state !== 'lost') {
      throw new Error('Relocalization can begin only after localization is lost.');
    }
    this.state = 'relocalizing';
    this.reason = 'Waiting for a trusted anchor confirmation.';
    return this.snapshot(timeMs);
  }

  confirmRelocalization(
    estimate: LocalizationEstimate,
    anchorId: string,
    routeMatch?: MapMatchResult,
  ): RuntimeSnapshot {
    const routeRequired = this.routeRequired || routeMatch !== undefined;
    if (routeRequired && !currentRouteAccepted(estimate, routeMatch)) {
      throw new Error(
        'Relocalization confirmation requires an accepted route match for this estimate.',
      );
    }
    if (estimate.floorTransitionPending) {
      throw new Error('Relocalization confirmation requires a confirmed floor.');
    }
    if (estimate.headingDegrees === null) {
      throw new Error('Relocalization confirmation requires independently established heading.');
    }
    if (this.state !== 'relocalizing') {
      throw new Error('Relocalization confirmation requires the relocalizing state.');
    }
    if (estimate.quality !== 'high') {
      throw new Error('Relocalization confirmation requires a high-quality estimate.');
    }
    const hasTrustedAnchor = estimate.observationSources.some(
      (source) => source === 'visual-anchor' || source === 'manual-anchor',
    );
    if (!hasTrustedAnchor) {
      throw new Error('Relocalization confirmation requires a trusted anchor observation.');
    }
    if (estimate.timeMs - estimate.lastCorrectionTimeMs > this.config.maximumAnchorAgeMs) {
      throw new Error('Relocalization anchor correction is too old.');
    }

    this.state = 'tracking';
    this.routeRequired = routeRequired;
    this.recoveryAnchorId = anchorId;
    this.recoveryDurationMs =
      this.lostAtMs === null ? null : Math.max(0, estimate.timeMs - this.lostAtMs);
    this.reason = `Relocalization confirmed by anchor ${anchorId}.`;
    return this.snapshot(estimate.timeMs);
  }
}
