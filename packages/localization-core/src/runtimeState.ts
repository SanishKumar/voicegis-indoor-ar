import type { LocalizationEstimate } from './types';

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

export class LocalizationRuntimeController {
  private state: LocalizationRuntimeState = 'initializing';
  private lostAtMs: number | null = null;
  private recoveryDurationMs: number | null = null;
  private recoveryAnchorId: string | null = null;
  private reason = 'Waiting for an initial localization estimate.';

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

  update(estimate: LocalizationEstimate): RuntimeSnapshot {
    if (estimate.quality === 'lost') {
      if (this.lostAtMs === null) this.lostAtMs = estimate.timeMs;
      this.state = 'lost';
      this.reason = 'Localization quality is lost; spatial guidance is frozen.';
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

  confirmRelocalization(estimate: LocalizationEstimate, anchorId: string): RuntimeSnapshot {
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
    this.recoveryAnchorId = anchorId;
    this.recoveryDurationMs =
      this.lostAtMs === null ? null : Math.max(0, estimate.timeMs - this.lostAtMs);
    this.reason = `Relocalization confirmed by anchor ${anchorId}.`;
    return this.snapshot(estimate.timeMs);
  }
}
