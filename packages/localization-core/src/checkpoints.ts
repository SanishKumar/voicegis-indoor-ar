import type { LocalizationObservation } from './types';

/**
 * Structural view of a surveyed localization anchor. The localization core
 * deliberately does not depend on the spatial schema, so callers pass anchors
 * from a compiled package and only the fields used here are read.
 */
export interface CheckpointAnchor {
  id: string;
  floorId: string;
  kind: 'qr' | 'apriltag' | 'image' | 'nfc';
  position: [number, number];
  headingDegrees: number;
  payload: string;
}

export type CheckpointScanKind = 'qr' | 'nfc';

export interface CheckpointScan {
  timeMs: number;
  kind: CheckpointScanKind;
  payload: string;
}

export interface CheckpointAdapterConfig {
  /** A QR is read at arm's length, so the fix is good but not exact. */
  qrAccuracyMeters: number;
  /** NFC only couples within a few centimetres, so the fix is tighter. */
  nfcAccuracyMeters: number;
  /** Presenting a device to a marker constrains heading, but loosely. */
  headingAccuracyDegrees: number;
  floorConfidence: number;
  elevationByFloorId: Record<string, number>;
}

export const DEFAULT_CHECKPOINT_CONFIG: CheckpointAdapterConfig = {
  qrAccuracyMeters: 0.35,
  nfcAccuracyMeters: 0.15,
  headingAccuracyDegrees: 22,
  floorConfidence: 0.99,
  elevationByFloorId: {},
};

export type CheckpointRejectionReason =
  | 'unknown-payload'
  | 'ambiguous-payload'
  | 'anchor-kind-mismatch';

export interface CheckpointResolution {
  accepted: boolean;
  reason: CheckpointRejectionReason | 'resolved';
  anchorId: string | null;
  observations: LocalizationObservation[];
}

function normalizeHeading(degrees: number) {
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/**
 * Turns a scanned QR or NFC checkpoint into observations the localization
 * filter already understands.
 *
 * The first accepted scan produces the initial fix the filter requires; every
 * later scan produces a position, heading, and floor correction. A scan that
 * cannot be resolved to exactly one anchor is rejected rather than guessed:
 * a payload that identifies two anchors would silently teleport a visitor, so
 * ambiguity fails closed the same way the mapping workspace refuses to publish
 * two anchors sharing a payload.
 */
export class CheckpointAdapter {
  private readonly anchorsByPayload: Map<string, CheckpointAnchor[]>;
  private readonly config: CheckpointAdapterConfig;
  private sequence: number;
  private initialized = false;

  constructor(
    anchors: CheckpointAnchor[],
    config: Partial<CheckpointAdapterConfig> = {},
    startSequence = 0,
  ) {
    this.config = { ...DEFAULT_CHECKPOINT_CONFIG, ...config };
    this.sequence = startSequence;
    this.anchorsByPayload = new Map();
    for (const anchor of anchors) {
      const existing = this.anchorsByPayload.get(anchor.payload) ?? [];
      existing.push(anchor);
      this.anchorsByPayload.set(anchor.payload, existing);
    }
  }

  /** True once an initial fix has been emitted. */
  get hasFix() {
    return this.initialized;
  }

  get nextSequence() {
    return this.sequence;
  }

  private accuracyFor(kind: CheckpointScanKind) {
    return kind === 'nfc' ? this.config.nfcAccuracyMeters : this.config.qrAccuracyMeters;
  }

  private reject(reason: CheckpointRejectionReason, anchorId: string | null): CheckpointResolution {
    return { accepted: false, reason, anchorId, observations: [] };
  }

  resolve(scan: CheckpointScan): CheckpointResolution {
    const matches = this.anchorsByPayload.get(scan.payload) ?? [];
    if (matches.length === 0) return this.reject('unknown-payload', null);
    if (matches.length > 1) return this.reject('ambiguous-payload', null);

    const [anchor] = matches;
    // An NFC tap must not be satisfied by a printed QR anchor, and vice versa.
    if (anchor.kind !== scan.kind) return this.reject('anchor-kind-mismatch', anchor.id);

    const accuracyMeters = this.accuracyFor(scan.kind);
    const headingDegrees = normalizeHeading(anchor.headingDegrees);
    const elevationMeters = this.config.elevationByFloorId[anchor.floorId] ?? 0;
    const observations: LocalizationObservation[] = [];

    if (!this.initialized) {
      observations.push({
        kind: 'initial-fix',
        sequence: this.sequence++,
        timeMs: scan.timeMs,
        source: 'manual-anchor',
        position: [...anchor.position] as [number, number],
        floorId: anchor.floorId,
        elevationMeters,
        headingDegrees,
        accuracyMeters,
        headingAccuracyDegrees: this.config.headingAccuracyDegrees,
      });
      this.initialized = true;
    } else {
      observations.push({
        kind: 'position-fix',
        sequence: this.sequence++,
        timeMs: scan.timeMs,
        source: 'manual-anchor',
        position: [...anchor.position] as [number, number],
        accuracyMeters,
      });
      observations.push({
        kind: 'heading',
        sequence: this.sequence++,
        timeMs: scan.timeMs,
        source: 'manual-anchor',
        headingDegrees,
        accuracyDegrees: this.config.headingAccuracyDegrees,
      });
      observations.push({
        kind: 'floor',
        sequence: this.sequence++,
        timeMs: scan.timeMs,
        source: 'manual-anchor',
        floorId: anchor.floorId,
        elevationMeters,
        confidence: this.config.floorConfidence,
      });
    }

    return { accepted: true, reason: 'resolved', anchorId: anchor.id, observations };
  }
}
