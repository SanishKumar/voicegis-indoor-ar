import {
  ANCHOR_INDEPENDENCE_TOLERANCE_METERS,
  CAPTURE_STREAM_VERSION,
  MAX_BUILDING_FRAME_COORDINATE_METERS,
  MIN_SAMPLE_INTERVAL_MS,
  canonicalJson,
  exportCaptureSession,
  type CaptureSession,
} from './captureStream';
import {
  EVIDENCE_POLICY_VERSION,
  evidentialSensorModel,
  maxPublishableSurveyAccuracyMeters,
  publishableSurveyMethods,
} from './internalEvidencePolicy';
import {
  GROUND_TRUTH_ALIGNMENT_TOLERANCE_MS,
  MATERIAL_SENSOR_GAP_MS,
  buildEvidenceReport,
  type EvidenceReport,
} from './recorder';
import { LOCALIZATION_RECORDING_VERSION, type EvidenceStatus } from './types';
import type { SurveyMethod } from './captureStream';
import type { CheckpointAdapterConfig } from './checkpoints';
import type { DeadReckoningConfig } from './deadReckoning';
import type { LocalizationFilterConfig } from './filter';
import {
  denseArrayLength,
  isFiniteNumber,
  isNonEmptyString,
  isPlainObjectShape,
  isPrototypeSensitiveKey,
  describeValue,
  isSafeCount,
  isSha256Hex,
  listContains,
  normalizeZero,
  readOwn,
  safeOwnKeys,
  undeclaredKeys,
} from './internalDescriptors';

/**
 * The document shape. Bumped when a field is added, removed, or changes
 * meaning, because a reader must never guess which shape it is holding.
 */
export const EVIDENCE_ARTIFACT_VERSION = '0.1.0' as const;

/**
 * The derivation and replay pipeline that turned a capture into a figure.
 * Bumped whenever a change could move a number from the same inputs.
 */
export const EVIDENCE_PROCESSOR_VERSION = '0.1.0' as const;

/** The manifest shape, versioned separately: it is authored before a walk. */
export const CHECKPOINT_MANIFEST_VERSION = '0.2.0' as const;

/**
 * A checkpoint fixed before the walk, not discovered after it.
 *
 * `role` is what binds the denominator in advance, and it is authoritative:
 * a mark declared `diagnostic` is recorded and never counted, so relabelling a
 * mark that came out badly has to happen before capture begins, where it is
 * visible in the manifest hash.
 */
export interface CheckpointManifestEntry {
  id: string;
  position: [number, number];
  floorId: string;
  role: 'scored' | 'diagnostic';
  /**
   * How the mark will be surveyed, promised before the walk.
   *
   * Eligibility reads these three from the capture, which is written after the
   * walk, so a mark that came out badly could be rescued by upgrading its
   * declared method or accuracy, or excluded by downgrading them. Predeclaring
   * them and refusing a capture that disagrees is what stops the denominator
   * being chosen from the results.
   */
  surveyMethod: SurveyMethod;
  expectedAccuracyMeters: number;
  independentOfAnchors: boolean;
}

export interface CheckpointManifest {
  manifestVersion: typeof CHECKPOINT_MANIFEST_VERSION;
  buildingId: string;
  packageHash: string;
  checkpoints: CheckpointManifestEntry[];
}

export type SealRefusalReason =
  | 'capture-invalid'
  | 'manifest-invalid'
  | 'manifest-venue-mismatch'
  | 'unmanifested-checkpoint'
  | 'duplicate-checkpoint-id'
  | 'checkpoint-claim-mismatch'
  | 'artifact-invalid';

export interface SealRefusal {
  reason: SealRefusalReason;
  detail: string;
}

/**
 * A sealed evidence artifact.
 *
 * Deterministic by construction: it carries no timestamp of its own and no
 * value that is not derived from its inputs, so the same capture, manifest and
 * code produce the same bytes.
 *
 * It records hashes rather than the data behind them. It is not anonymous: it
 * names the session, the building, the venue package, the exact wall-clock
 * start of the walk, how many events it contained, and the timestamps of any
 * sampling gaps. What it omits is the walk itself — no inertial vectors, no
 * orientation samples, no scan payloads, no anchor positions.
 */
export interface EvidenceArtifact {
  artifactVersion: typeof EVIDENCE_ARTIFACT_VERSION;
  capture: {
    captureVersion: string;
    sessionId: string;
    buildingId: string;
    startedAtIso: string;
    /** SHA-256 of the canonical capture document. The data stays private. */
    contentHash: string;
    eventCount: number;
  };
  venue: {
    /** The package the walk was localized against, as the capture recorded it. */
    packageHash: string;
  };
  manifest: {
    manifestVersion: string;
    contentHash: string;
    scoredCount: number;
    diagnosticCount: number;
    /** Predeclared scored marks the walk never recorded. */
    missingScoredCount: number;
  };
  versions: {
    processor: typeof EVIDENCE_PROCESSOR_VERSION;
    policy: typeof EVIDENCE_POLICY_VERSION;
    captureStream: typeof CAPTURE_STREAM_VERSION;
    recording: typeof LOCALIZATION_RECORDING_VERSION;
  };
  /** The exact tuning the figure was produced with, not the tuning intended. */
  configuration: EvidenceReport['configuration'] & {
    thresholds: {
      groundTruthAlignmentToleranceMs: number;
      materialSensorGapMs: number;
      minSampleIntervalMs: number;
      maxBuildingFrameCoordinateMeters: number;
      anchorIndependenceToleranceMeters: number;
    };
  };
  /** The rules that decided publishability, as values rather than a version. */
  policy: {
    publishableSurveyMethods: string[];
    maxPublishableSurveyAccuracyMeters: number;
    evidentialSensorModel: { api: string; frame: string; gyroscopeUnits: string };
  };
  evidence: {
    status: EvidenceStatus;
    medianHorizontalErrorMeters: number | null;
    p95HorizontalErrorMeters: number | null;
    floorAccuracy: number | null;
    observationCount: number;
    checkpointCount: number;
    eligibility: EvidenceReport['eligibility'];
    survey: EvidenceReport['survey'];
    alignment: EvidenceReport['alignment'];
    sampling: EvidenceReport['sampling'];
  };
  /** SHA-256 over every field above, in canonical form. The seal itself. */
  contentHash: string;
}

export type SealResult =
  | { sealed: EvidenceArtifact; refusals: [] }
  | { sealed: null; refusals: SealRefusal[] };

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const view = new Uint8Array(digest);
  const out = new Array<string>(view.length);
  for (let index = 0; index < view.length; index += 1) {
    out[index] = view[index].toString(16).padStart(2, '0');
  }
  return out.join('');
}

export interface ManifestValidation {
  manifest: CheckpointManifest | null;
  issues: SealRefusal[];
}

const MANIFEST_KEYS = ['manifestVersion', 'buildingId', 'packageHash', 'checkpoints'] as const;
const MANIFEST_ENTRY_KEYS = [
  'id',
  'position',
  'floorId',
  'role',
  'surveyMethod',
  'expectedAccuracyMeters',
  'independentOfAnchors',
] as const;

const MANIFEST_SURVEY_METHODS: readonly string[] = [
  'tape-measure',
  'laser-distance',
  'total-station',
  'estimated',
];

/**
 * Reads an unknown value as a checkpoint manifest, or says why it is not one.
 *
 * Returns a snapshot rather than the caller's object. Everything downstream —
 * comparison, hashing, the sealed body — reads only what this produced, so a
 * manifest edited while sealing awaits a hash cannot change what was sealed.
 */
export function validateCheckpointManifest(value: unknown): ManifestValidation {
  const issues: SealRefusal[] = [];
  const refuse = (detail: string) => {
    issues.push({ reason: 'manifest-invalid', detail });
    return { manifest: null, issues };
  };

  if (!isPlainObjectShape(value)) return refuse('A checkpoint manifest must be a plain object.');
  const extra = undeclaredKeys(value, MANIFEST_KEYS);
  if (extra.length > 0) {
    return refuse(`A manifest carries ${extra.join(', ')}, which the schema does not define.`);
  }

  const version = readOwn(value, 'manifestVersion');
  if (version.kind !== 'value' || version.value !== CHECKPOINT_MANIFEST_VERSION) {
    return refuse(
      `Unsupported checkpoint manifest version ${
        version.kind === 'value' ? describeValue(version.value) : 'nothing'
      }.`,
    );
  }
  const buildingId = readOwn(value, 'buildingId');
  if (buildingId.kind !== 'value' || !isNonEmptyString(buildingId.value)) {
    return refuse('A manifest needs a building id supplied as a plain value.');
  }
  const packageHash = readOwn(value, 'packageHash');
  if (packageHash.kind !== 'value' || !isSha256Hex(packageHash.value)) {
    // The venue package hash identifies compiled content, so it has the one
    // shape SHA-256 has. A manifest naming a venue "x" sealed and verified.
    return refuse('A manifest needs a package hash that is a 64-character lowercase hex digest.');
  }

  const list = readOwn(value, 'checkpoints');
  if (list.kind !== 'value') return refuse('A manifest needs a checkpoints array.');
  const length = denseArrayLength(list.value);
  if (length === null) {
    return refuse('A manifest needs a dense array of checkpoints carrying nothing else.');
  }

  const checkpoints: CheckpointManifestEntry[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < length; index += 1) {
    const path = `checkpoints[${index}]`;
    const element = readOwn(list.value, String(index));
    if (element.kind !== 'value' || !isPlainObjectShape(element.value)) {
      issues.push({ reason: 'manifest-invalid', detail: `${path} must be a plain object.` });
      continue;
    }
    const entryExtra = undeclaredKeys(element.value, MANIFEST_ENTRY_KEYS);
    if (entryExtra.length > 0) {
      issues.push({
        reason: 'manifest-invalid',
        detail: `${path} carries ${entryExtra.join(', ')}, which the schema does not define.`,
      });
      continue;
    }

    // Every field is read exactly once, by descriptor, into the snapshot. Plain
    // property access ran getters, so a throwing getter escaped a function that
    // promises never to throw, and a changing one could satisfy validation with
    // one position and be recorded with another.
    const id = readOwn(element.value, 'id');
    const position = readOwn(element.value, 'position');
    const floorId = readOwn(element.value, 'floorId');
    const role = readOwn(element.value, 'role');

    if (id.kind !== 'value' || !isNonEmptyString(id.value)) {
      issues.push({ reason: 'manifest-invalid', detail: `${path} needs an id.` });
      continue;
    }
    if (seen.has(id.value)) {
      issues.push({
        reason: 'manifest-invalid',
        detail: `A manifest declares "${id.value}" more than once.`,
      });
      continue;
    }
    seen.add(id.value);

    if (position.kind !== 'value' || denseArrayLength(position.value) !== 2) {
      issues.push({ reason: 'manifest-invalid', detail: `${path} needs a position pair.` });
      continue;
    }
    const east = readOwn(position.value, '0');
    const north = readOwn(position.value, '1');
    if (
      east.kind !== 'value' ||
      north.kind !== 'value' ||
      !isFiniteNumber(east.value) ||
      !isFiniteNumber(north.value)
    ) {
      issues.push({
        reason: 'manifest-invalid',
        detail: `${path} needs a position of two finite numbers.`,
      });
      continue;
    }
    if (floorId.kind !== 'value' || !isNonEmptyString(floorId.value)) {
      issues.push({ reason: 'manifest-invalid', detail: `${path} needs a floor id.` });
      continue;
    }
    if (role.kind !== 'value' || (role.value !== 'scored' && role.value !== 'diagnostic')) {
      issues.push({
        reason: 'manifest-invalid',
        detail: `${path} must declare a role of scored or diagnostic.`,
      });
      continue;
    }

    const surveyMethod = readOwn(element.value, 'surveyMethod');
    const expectedAccuracy = readOwn(element.value, 'expectedAccuracyMeters');
    const independent = readOwn(element.value, 'independentOfAnchors');

    if (
      surveyMethod.kind !== 'value' ||
      typeof surveyMethod.value !== 'string' ||
      !listContains(MANIFEST_SURVEY_METHODS, surveyMethod.value)
    ) {
      issues.push({
        reason: 'manifest-invalid',
        detail: `${path} must predeclare how the mark will be surveyed.`,
      });
      continue;
    }
    if (
      expectedAccuracy.kind !== 'value' ||
      !isFiniteNumber(expectedAccuracy.value) ||
      expectedAccuracy.value < 0
    ) {
      issues.push({
        reason: 'manifest-invalid',
        detail: `${path} must predeclare a non-negative expected survey accuracy.`,
      });
      continue;
    }
    if (independent.kind !== 'value' || typeof independent.value !== 'boolean') {
      issues.push({
        reason: 'manifest-invalid',
        detail: `${path} must predeclare whether the mark is independent of anchors.`,
      });
      continue;
    }

    checkpoints.push({
      id: id.value,
      position: [normalizeZero(east.value), normalizeZero(north.value)],
      floorId: floorId.value,
      role: role.value,
      surveyMethod: surveyMethod.value as SurveyMethod,
      expectedAccuracyMeters: normalizeZero(expectedAccuracy.value),
      independentOfAnchors: independent.value,
    });
  }

  if (issues.length > 0) return { manifest: null, issues };
  return {
    manifest: {
      manifestVersion: CHECKPOINT_MANIFEST_VERSION,
      buildingId: buildingId.value,
      packageHash: packageHash.value,
      checkpoints,
    },
    issues: [],
  };
}

const ARTIFACT_KEYS = [
  'artifactVersion',
  'capture',
  'venue',
  'manifest',
  'versions',
  'configuration',
  'policy',
  'evidence',
  'contentHash',
] as const;

/* -------------------------------------------------------------------------- */
/* The decoder.                                                               */
/*                                                                            */
/* One pass over an unknown value that either produces a complete inert deep   */
/* snapshot or says why it could not. Nothing downstream — hashing, export,    */
/* the value handed back to a caller — reads anything but the snapshot.        */
/*                                                                            */
/* A shape check that stops at section headers is not a schema. Rehashed       */
/* artifacts carrying `evidence.sampling.rawEvents`, a status of               */
/* `"made-up-status"`, a fractional `checkpointCount`, a `deadReckoning` block  */
/* missing `strideLengthMeters`, or a named property on a policy array all      */
/* verified, because validation only asked whether each section was an object. */
/* -------------------------------------------------------------------------- */

/**
 * The statuses sealing can actually produce.
 *
 * `unofficial-recording` is deliberately absent. It is what `replayRecording`
 * reports for a bare recording that never went through a capture session, so an
 * artifact can never legitimately carry it — and one relabelled that way
 * verified, because the decoder accepted every status the type admits rather
 * than every status this path emits.
 */
const EVIDENCE_STATUSES: readonly EvidenceStatus[] = [
  'ok',
  'insufficient-localization',
  'interrupted-capture',
  'insufficient-ground-truth',
  'manifest-not-satisfied',
  'unsupported-sensor-model',
  'incomplete-capture',
  'invalid-localization-state',
];

/**
 * What each status implies about the three counts.
 *
 * Written as a table rather than as the checks that happened to be asked for,
 * because the gap was never one status: constraining `ok`, then
 * `insufficient-ground-truth`, then `manifest-not-satisfied` left whichever
 * status had not yet come up free to carry any counts at all. A walk that never
 * localized produced no estimate, so nothing could be scored against one; the
 * blocking statuses that sit after derivation may legitimately carry eligible
 * marks, and are bound only by the reconciliations every artifact obeys.
 */
const STATUS_REQUIRES_NO_SCORING: readonly EvidenceStatus[] = [
  'insufficient-localization',
  'insufficient-ground-truth',
];

/**
 * What each status implies about whether the walk localized at all.
 *
 * Derivation produces no observation until a first fix exists, and replay only
 * runs once one does, so `observationCount === 0` and a null filter tuning are
 * two views of the same fact. `buildEvidenceReport` checks localization third,
 * after the sensor model and completeness, which is exactly why those two may
 * carry either shape while everything below them localized by definition.
 *
 * Counting alone could not separate these. A localized diagnostic-only walk and
 * a walk that never got a fix both report zero publishable marks, so a status
 * table written in terms of scoring let the first be relabelled as the second —
 * 12 observations and a live filter beside a status that means neither exists.
 */
const STATUS_REQUIRES_LOCALIZATION: readonly EvidenceStatus[] = [
  'ok',
  'interrupted-capture',
  'invalid-localization-state',
  'manifest-not-satisfied',
  'insufficient-ground-truth',
];

const EXCLUSION_REASONS: readonly string[] = [
  'dependent-on-anchor',
  'alignment-crosses-anchor-reset',
  'no-causal-estimate-in-range',
  'survey-method-not-publishable',
  'survey-accuracy-out-of-policy',
  'ambiguous-anchor-reset-tie',
  'not-declared-scored',
];

const SURVEY_METHOD_NAMES: readonly string[] = [
  'tape-measure',
  'laser-distance',
  'total-station',
  'estimated',
];

const CHECKPOINT_CONFIG_KEYS = [
  'qrAccuracyMeters',
  'nfcAccuracyMeters',
  'headingAccuracyDegrees',
  'floorConfidence',
  'elevationByFloorId',
] as const;

const DEAD_RECKONING_CONFIG_KEYS = [
  'stepThresholdMetersPerSecond2',
  'minimumStepIntervalMs',
  'maximumStepIntervalMs',
  'strideLengthMeters',
  'strideVarianceMeters2',
  'headingAccuracyDegrees',
  'headingEmitIntervalMs',
  'baselineSmoothing',
] as const;

const FILTER_CONFIG_KEYS = [
  'accelerationNoiseMetersPerSecond2',
  'headingDriftDegreesPerSecond',
  'highQualitySigmaMeters',
  'degradedQualitySigmaMeters',
  'highQualityCorrectionAgeMs',
  'degradedQualityCorrectionAgeMs',
] as const;

const THRESHOLD_KEYS = [
  'groundTruthAlignmentToleranceMs',
  'materialSensorGapMs',
  'minSampleIntervalMs',
  'maxBuildingFrameCoordinateMeters',
  'anchorIndependenceToleranceMeters',
] as const;

const SAMPLING_KEYS = ['sampleCount', 'medianIntervalMs', 'jitterMs', 'observedHz', 'gaps'] as const;

/** Collects issues and builds the snapshot as it goes. Never throws. */
class ArtifactDecoder {
  readonly issues: string[] = [];

  fail(path: string, detail: string) {
    this.issues.push(`${path}: ${detail}`);
    return undefined;
  }

  /** An own, enumerable, plain-object section with exactly the declared keys. */
  section(parent: unknown, key: string, path: string, allowed: readonly string[]) {
    const read = readOwn(parent, key);
    if (read.kind !== 'value') {
      this.fail(path, read.kind === 'absent' ? 'is missing.' : 'must be a plain value.');
      return null;
    }
    if (!isPlainObjectShape(read.value)) {
      this.fail(path, 'must be a plain object.');
      return null;
    }
    const extra = undeclaredKeys(read.value, allowed);
    if (extra.length > 0) {
      this.fail(path, `carries ${extra.join(', ')}, which the schema does not define.`);
      return null;
    }
    for (let index = 0; index < allowed.length; index += 1) {
      if (readOwn(read.value, allowed[index]).kind === 'absent') {
        this.fail(`${path}.${allowed[index]}`, 'is missing.');
        return null;
      }
    }
    return read.value;
  }

  text(parent: unknown, key: string, path: string) {
    const read = readOwn(parent, key);
    if (read.kind !== 'value' || !isNonEmptyString(read.value)) {
      this.fail(path, 'must be a non-empty string.');
      return '';
    }
    return read.value;
  }

  literal(parent: unknown, key: string, path: string, expected: string) {
    const read = readOwn(parent, key);
    if (read.kind !== 'value' || read.value !== expected) {
      this.fail(path, `must be ${expected}, which is what this build can interpret.`);
      return expected;
    }
    return expected;
  }

  member(parent: unknown, key: string, path: string, allowed: readonly string[]) {
    const read = readOwn(parent, key);
    if (read.kind !== 'value' || typeof read.value !== 'string' || !listContains(allowed, read.value)) {
      this.fail(path, `must be one of ${allowed.join(', ')}.`);
      return allowed[0];
    }
    return read.value;
  }

  number(parent: unknown, key: string, path: string) {
    const read = readOwn(parent, key);
    if (read.kind !== 'value' || !isFiniteNumber(read.value)) {
      this.fail(path, 'must be a finite number.');
      return 0;
    }
    return normalizeZero(read.value);
  }

  /** A finite number inside a stated range, inclusive. */
  boundedNumber(parent: unknown, key: string, path: string, low: number, high: number) {
    const value = this.number(parent, key, path);
    if (value < low || value > high) this.fail(path, `must lie between ${low} and ${high}.`);
    return value;
  }

  /** A SHA-256 digest, which has exactly one shape. */
  digest(parent: unknown, key: string, path: string) {
    const read = readOwn(parent, key);
    if (read.kind !== 'value' || !isSha256Hex(read.value)) {
      this.fail(path, 'must be a 64-character lowercase hex digest.');
      return '';
    }
    return read.value;
  }

  nullableNumber(parent: unknown, key: string, path: string) {
    const read = readOwn(parent, key);
    if (read.kind !== 'value') {
      this.fail(path, 'is missing.');
      return null;
    }
    if (read.value === null) return null;
    if (!isFiniteNumber(read.value)) {
      this.fail(path, 'must be a finite number or null.');
      return null;
    }
    return normalizeZero(read.value);
  }

  count(parent: unknown, key: string, path: string) {
    const read = readOwn(parent, key);
    if (read.kind !== 'value' || !isSafeCount(read.value)) {
      this.fail(path, 'must be a non-negative whole number.');
      return 0;
    }
    // `-0` is a safe integer and is not less than zero, so it passed every
    // check and came back out of the decoder still signed, hashing as `0`.
    return normalizeZero(read.value);
  }

  /** Every declared key present, finite, and nothing else. */
  numberGroup(parent: unknown, key: string, path: string, keys: readonly string[]) {
    const group = this.section(parent, key, path, keys);
    const out: Record<string, number> = {};
    if (group === null) return out;
    for (let index = 0; index < keys.length; index += 1) {
      out[keys[index]] = this.number(group, keys[index], `${path}.${keys[index]}`);
    }
    return out;
  }

  /**
   * A record of arbitrary string keys to counts.
   *
   * The survey breakdown counts marks, so a fractional or negative entry is not
   * a smaller count — it is not a count. Summing correctly is not enough:
   * `{ 'tape-measure': 1.5, 'laser-distance': -0.5 }` sums to one mark that
   * nobody surveyed.
   */
  countMap(parent: unknown, key: string, path: string) {
    const out = this.numberMap(parent, key, path);
    for (const entry of Object.keys(out)) {
      if (!isSafeCount(out[entry])) {
        this.fail(`${path}.${entry}`, 'must be a non-negative whole number of marks.');
      }
    }
    return out;
  }

  /** A record of arbitrary string keys to finite numbers. */
  numberMap(parent: unknown, key: string, path: string) {
    // Null-prototype so a key named `__proto__` becomes an ordinary own key
    // rather than silently reshaping the object. Writing into `{}` swallowed it
    // entirely: the tampering vanished from the snapshot, the snapshot hashed
    // like the untampered original, and verification called it valid while
    // export wrote the sanitised version.
    const out: Record<string, number> = Object.create(null) as Record<string, number>;
    const read = readOwn(parent, key);
    if (read.kind !== 'value' || !isPlainObjectShape(read.value)) {
      this.fail(path, 'must be a plain object.');
      return out;
    }
    const keys = safeOwnKeys(read.value);
    if (keys === null) {
      this.fail(path, 'would not disclose its keys.');
      return out;
    }
    for (let index = 0; index < keys.length; index += 1) {
      const entry = keys[index];
      if (typeof entry !== 'string') {
        this.fail(path, 'must not carry symbol keys.');
        continue;
      }
      if (isPrototypeSensitiveKey(entry)) {
        this.fail(path, `must not carry ${entry}, which names an object's shape.`);
        continue;
      }
      out[entry] = this.number(read.value, entry, `${path}.${entry}`);
    }
    return out;
  }

  /** A dense array of strings drawn from a known set. */
  stringList(parent: unknown, key: string, path: string, allowed: readonly string[]) {
    const read = readOwn(parent, key);
    const out: string[] = [];
    if (read.kind !== 'value') {
      this.fail(path, 'is missing.');
      return out;
    }
    const length = denseArrayLength(read.value);
    if (length === null) {
      this.fail(path, 'must be a dense array carrying nothing but its elements.');
      return out;
    }
    for (let index = 0; index < length; index += 1) {
      out.push(this.member(read.value, String(index), `${path}[${index}]`, allowed));
    }
    return out;
  }

  /** A dense array of two-number dense arrays, as sampling gaps are. */
  spanList(parent: unknown, key: string, path: string) {
    const read = readOwn(parent, key);
    const out: Array<[number, number]> = [];
    if (read.kind !== 'value') {
      this.fail(path, 'is missing.');
      return out;
    }
    const length = denseArrayLength(read.value);
    if (length === null) {
      this.fail(path, 'must be a dense array carrying nothing but its elements.');
      return out;
    }
    for (let index = 0; index < length; index += 1) {
      const entry = readOwn(read.value, String(index));
      const span = entry.kind === 'value' ? denseArrayLength(entry.value) : null;
      if (span !== 2) {
        this.fail(`${path}[${index}]`, 'must be a dense pair of numbers.');
        out.push([0, 0]);
        continue;
      }
      const pair = entry.kind === 'value' ? entry.value : null;
      out.push([
        this.number(pair, '0', `${path}[${index}][0]`),
        this.number(pair, '1', `${path}[${index}][1]`),
      ]);
    }
    return out;
  }
}


/**
 * The checkpoint tuning, whose `elevationByFloorId` is a map rather than a
 * number. Read as one section so its declared keys stay exact.
 */
function decodeCheckpointConfig(
  decoder: ArtifactDecoder,
  configuration: Record<string, unknown> | null,
): CheckpointAdapterConfig {
  const group = decoder.section(
    configuration,
    'checkpoint',
    'configuration.checkpoint',
    CHECKPOINT_CONFIG_KEYS,
  );
  return {
    qrAccuracyMeters: decoder.number(group, 'qrAccuracyMeters', 'configuration.checkpoint.qrAccuracyMeters'),
    nfcAccuracyMeters: decoder.number(group, 'nfcAccuracyMeters', 'configuration.checkpoint.nfcAccuracyMeters'),
    headingAccuracyDegrees: decoder.number(
      group,
      'headingAccuracyDegrees',
      'configuration.checkpoint.headingAccuracyDegrees',
    ),
    floorConfidence: decoder.number(group, 'floorConfidence', 'configuration.checkpoint.floorConfidence'),
    elevationByFloorId: decoder.numberMap(
      group,
      'elevationByFloorId',
      'configuration.checkpoint.elevationByFloorId',
    ),
  };
}

/**
 * A decoded artifact whose seal has *not* been checked.
 *
 * Named apart from `EvidenceArtifact` on purpose. Decoding proves the shape and
 * the internal arithmetic; it says nothing about whether the digest matches, so
 * handing one back as an `EvidenceArtifact` would let a caller mistake
 * well-formed for verified. Only `verifyEvidenceArtifact` produces the latter,
 * and only this module can reach the former.
 */
export interface UnverifiedArtifact {
  shape: EvidenceArtifact;
}

export interface ArtifactDecoding {
  artifact: UnverifiedArtifact | null;
  issues: string[];
}

/**
 * Reads an unknown value as an evidence artifact, or says why it is not one.
 *
 * Returns a fresh deep snapshot built field by field. Nothing in it is the
 * caller's object, so nothing downstream can be changed after it was checked —
 * verification used to hash a shallow copy, await a digest, and then hand back
 * the caller's live object, which meant a mutation during that await returned
 * `valid: true` carrying a figure nobody had verified.
 */
export function decodeEvidenceArtifact(value: unknown): ArtifactDecoding {
  const decoder = new ArtifactDecoder();

  if (!isPlainObjectShape(value)) {
    return { artifact: null, issues: ['artifact: must be a plain object.'] };
  }
  const extra = undeclaredKeys(value, ARTIFACT_KEYS);
  if (extra.length > 0) {
    return {
      artifact: null,
      issues: [`artifact: carries ${extra.join(', ')}, which the schema does not define.`],
    };
  }
  const artifactVersion = readOwn(value, 'artifactVersion');
  if (artifactVersion.kind !== 'value' || artifactVersion.value !== EVIDENCE_ARTIFACT_VERSION) {
    return {
      artifact: null,
      issues: [`artifact.artifactVersion: must be ${EVIDENCE_ARTIFACT_VERSION}.`],
    };
  }

  const capture = decoder.section(value, 'capture', 'capture', [
    'captureVersion',
    'sessionId',
    'buildingId',
    'startedAtIso',
    'contentHash',
    'eventCount',
  ]);
  const venue = decoder.section(value, 'venue', 'venue', ['packageHash']);
  const manifest = decoder.section(value, 'manifest', 'manifest', [
    'manifestVersion',
    'contentHash',
    'scoredCount',
    'diagnosticCount',
    'missingScoredCount',
  ]);
  const versions = decoder.section(value, 'versions', 'versions', [
    'processor',
    'policy',
    'captureStream',
    'recording',
  ]);
  const configuration = decoder.section(value, 'configuration', 'configuration', [
    'checkpoint',
    'deadReckoning',
    'filter',
    'routeSegmentCount',
    'thresholds',
  ]);
  const policy = decoder.section(value, 'policy', 'policy', [
    'publishableSurveyMethods',
    'maxPublishableSurveyAccuracyMeters',
    'evidentialSensorModel',
  ]);
  const evidence = decoder.section(value, 'evidence', 'evidence', [
    'status',
    'medianHorizontalErrorMeters',
    'p95HorizontalErrorMeters',
    'floorAccuracy',
    'observationCount',
    'checkpointCount',
    'eligibility',
    'survey',
    'alignment',
    'sampling',
  ]);

  const contentHash = decoder.digest(value, 'contentHash', 'artifact.contentHash');

  // `filter` is the one nullable section: replay does not run when a walk never
  // localized, so there is no tuning to record.
  const filterRead = readOwn(configuration, 'filter');
  const filterIsNull = filterRead.kind === 'value' && filterRead.value === null;

  const eligibility = decoder.section(evidence, 'eligibility', 'evidence.eligibility', [
    'surveyed',
    'publishable',
    'excluded',
    'exclusionCounts',
  ]);
  const survey = decoder.section(evidence, 'survey', 'evidence.survey', [
    'methods',
    'worstExpectedAccuracyMeters',
  ]);
  const alignment = decoder.section(evidence, 'alignment', 'evidence.alignment', [
    'worstAlignmentDeltaMs',
    'toleranceMs',
  ]);
  const sampling = decoder.section(evidence, 'sampling', 'evidence.sampling', SAMPLING_KEYS);
  const sensorModel = decoder.section(policy, 'evidentialSensorModel', 'policy.evidentialSensorModel', [
    'api',
    'frame',
    'gyroscopeUnits',
  ]);

  const status = decoder.member(evidence, 'status', 'evidence.status', EVIDENCE_STATUSES);
  const median = decoder.nullableNumber(
    evidence,
    'medianHorizontalErrorMeters',
    'evidence.medianHorizontalErrorMeters',
  );
  const p95 = decoder.nullableNumber(
    evidence,
    'p95HorizontalErrorMeters',
    'evidence.p95HorizontalErrorMeters',
  );
  const floorAccuracy = decoder.nullableNumber(evidence, 'floorAccuracy', 'evidence.floorAccuracy');
  if (median !== null && median < 0) {
    decoder.fail('evidence.medianHorizontalErrorMeters', 'is a distance and cannot be negative.');
  }
  if (p95 !== null && p95 < 0) {
    decoder.fail('evidence.p95HorizontalErrorMeters', 'is a distance and cannot be negative.');
  }
  if (median !== null && p95 !== null && p95 < median) {
    decoder.fail('evidence.p95HorizontalErrorMeters', 'cannot be below the median it summarises.');
  }
  if (floorAccuracy !== null && (floorAccuracy < 0 || floorAccuracy > 1)) {
    decoder.fail('evidence.floorAccuracy', 'is a proportion and must lie between 0 and 1.');
  }

  const surveyed = decoder.count(eligibility, 'surveyed', 'evidence.eligibility.surveyed');
  const publishable = decoder.count(eligibility, 'publishable', 'evidence.eligibility.publishable');
  const excluded = decoder.count(eligibility, 'excluded', 'evidence.eligibility.excluded');
  const exclusionCounts = decoder.section(
    eligibility,
    'exclusionCounts',
    'evidence.eligibility.exclusionCounts',
    EXCLUSION_REASONS,
  );
  const decodedExclusions: Record<string, number> = {};
  for (let index = 0; index < EXCLUSION_REASONS.length; index += 1) {
    const reason = EXCLUSION_REASONS[index];
    decodedExclusions[reason] = decoder.count(
      exclusionCounts,
      reason,
      `evidence.eligibility.exclusionCounts.${reason}`,
    );
  }

  const surveyMethods = decoder.countMap(survey, 'methods', 'evidence.survey.methods');
  for (const method of Object.keys(surveyMethods)) {
    if (!listContains(SURVEY_METHOD_NAMES, method)) {
      decoder.fail('evidence.survey.methods', `"${method}" is not a survey method.`);
    }
  }

  const scoredCount = decoder.count(manifest, 'scoredCount', 'manifest.scoredCount');
  const diagnosticCount = decoder.count(manifest, 'diagnosticCount', 'manifest.diagnosticCount');
  const missingScoredCount = decoder.count(
    manifest,
    'missingScoredCount',
    'manifest.missingScoredCount',
  );
  const eventCount = decoder.count(capture, 'eventCount', 'capture.eventCount');
  const observationCount = decoder.count(evidence, 'observationCount', 'evidence.observationCount');
  const checkpointCount = decoder.count(evidence, 'checkpointCount', 'evidence.checkpointCount');

  const decoded: EvidenceArtifact = {
    artifactVersion: EVIDENCE_ARTIFACT_VERSION,
    capture: {
      captureVersion: decoder.literal(
        capture,
        'captureVersion',
        'capture.captureVersion',
        CAPTURE_STREAM_VERSION,
      ),
      sessionId: decoder.text(capture, 'sessionId', 'capture.sessionId'),
      buildingId: decoder.text(capture, 'buildingId', 'capture.buildingId'),
      startedAtIso: decoder.text(capture, 'startedAtIso', 'capture.startedAtIso'),
      contentHash: decoder.digest(capture, 'contentHash', 'capture.contentHash'),
      eventCount,
    },
    venue: { packageHash: decoder.digest(venue, 'packageHash', 'venue.packageHash') },
    manifest: {
      manifestVersion: decoder.literal(
        manifest,
        'manifestVersion',
        'manifest.manifestVersion',
        CHECKPOINT_MANIFEST_VERSION,
      ),
      contentHash: decoder.digest(manifest, 'contentHash', 'manifest.contentHash'),
      scoredCount,
      diagnosticCount,
      missingScoredCount,
    },
    versions: {
      processor: decoder.literal(
        versions,
        'processor',
        'versions.processor',
        EVIDENCE_PROCESSOR_VERSION,
      ) as typeof EVIDENCE_PROCESSOR_VERSION,
      policy: decoder.literal(
        versions,
        'policy',
        'versions.policy',
        EVIDENCE_POLICY_VERSION,
      ) as typeof EVIDENCE_POLICY_VERSION,
      captureStream: decoder.literal(
        versions,
        'captureStream',
        'versions.captureStream',
        CAPTURE_STREAM_VERSION,
      ) as typeof CAPTURE_STREAM_VERSION,
      recording: decoder.literal(
        versions,
        'recording',
        'versions.recording',
        LOCALIZATION_RECORDING_VERSION,
      ) as typeof LOCALIZATION_RECORDING_VERSION,
    },
    configuration: {
      checkpoint: decodeCheckpointConfig(decoder, configuration),
      deadReckoning: decoder.numberGroup(
        configuration,
        'deadReckoning',
        'configuration.deadReckoning',
        DEAD_RECKONING_CONFIG_KEYS,
      ) as unknown as DeadReckoningConfig,
      filter: filterIsNull
        ? null
        : (decoder.numberGroup(
            configuration,
            'filter',
            'configuration.filter',
            FILTER_CONFIG_KEYS,
          ) as unknown as LocalizationFilterConfig),
      routeSegmentCount: decoder.count(
        configuration,
        'routeSegmentCount',
        'configuration.routeSegmentCount',
      ),
      thresholds: decoder.numberGroup(
        configuration,
        'thresholds',
        'configuration.thresholds',
        THRESHOLD_KEYS,
      ) as EvidenceArtifact['configuration']['thresholds'],
    },
    policy: {
      publishableSurveyMethods: decoder.stringList(
        policy,
        'publishableSurveyMethods',
        'policy.publishableSurveyMethods',
        SURVEY_METHOD_NAMES,
      ),
      maxPublishableSurveyAccuracyMeters: decoder.number(
        policy,
        'maxPublishableSurveyAccuracyMeters',
        'policy.maxPublishableSurveyAccuracyMeters',
      ),
      evidentialSensorModel: {
        api: decoder.text(sensorModel, 'api', 'policy.evidentialSensorModel.api'),
        frame: decoder.text(sensorModel, 'frame', 'policy.evidentialSensorModel.frame'),
        gyroscopeUnits: decoder.text(
          sensorModel,
          'gyroscopeUnits',
          'policy.evidentialSensorModel.gyroscopeUnits',
        ),
      },
    },
    evidence: {
      status: status as EvidenceStatus,
      medianHorizontalErrorMeters: median,
      p95HorizontalErrorMeters: p95,
      floorAccuracy,
      observationCount,
      checkpointCount,
      eligibility: {
        surveyed,
        publishable,
        excluded,
        exclusionCounts: decodedExclusions as EvidenceReport['eligibility']['exclusionCounts'],
      },
      survey: {
        methods: surveyMethods,
        worstExpectedAccuracyMeters: decoder.nullableNumber(
          survey,
          'worstExpectedAccuracyMeters',
          'evidence.survey.worstExpectedAccuracyMeters',
        ),
      },
      alignment: {
        worstAlignmentDeltaMs: decoder.nullableNumber(
          alignment,
          'worstAlignmentDeltaMs',
          'evidence.alignment.worstAlignmentDeltaMs',
        ),
        toleranceMs: decoder.number(alignment, 'toleranceMs', 'evidence.alignment.toleranceMs'),
      },
      sampling: {
        sampleCount: decoder.count(sampling, 'sampleCount', 'evidence.sampling.sampleCount'),
        medianIntervalMs: decoder.number(
          sampling,
          'medianIntervalMs',
          'evidence.sampling.medianIntervalMs',
        ),
        jitterMs: decoder.number(sampling, 'jitterMs', 'evidence.sampling.jitterMs'),
        observedHz: decoder.number(sampling, 'observedHz', 'evidence.sampling.observedHz'),
        gaps: decoder.spanList(sampling, 'gaps', 'evidence.sampling.gaps'),
      },
    },
    contentHash,
  };

  // Cross-section invariants. Each section can be individually well formed and
  // still describe an arithmetic that never happened.
  const publishableStatus = decoded.evidence.status === 'ok';
  const metrics: Array<[string, number | null]> = [
    ['medianHorizontalErrorMeters', decoded.evidence.medianHorizontalErrorMeters],
    ['p95HorizontalErrorMeters', decoded.evidence.p95HorizontalErrorMeters],
    ['floorAccuracy', decoded.evidence.floorAccuracy],
  ];
  for (const [name, metric] of metrics) {
    if (publishableStatus && metric === null) {
      decoder.fail(`evidence.${name}`, 'is required when the status is ok.');
    }
    if (!publishableStatus && metric !== null) {
      decoder.fail(`evidence.${name}`, `must be null when the status is ${decoded.evidence.status}.`);
    }
  }
  // The manifest counts and the evidence counts describe the same marks from
  // two sides, so they have to reconcile. Left unbound, `scoredCount` could be
  // raised from 1 to 2 and rehashed while a single surveyed checkpoint sat
  // beside it, and the artifact verified: the manifest said one thing about the
  // walk and the evidence another.
  //
  // Every mark refused as `not-declared-scored` was walked and declared
  // diagnostic — an undeclared mark never gets this far, sealing refuses it —
  // so that count is exactly the diagnostics the walk reached.
  const presentDiagnostic =
    decoded.evidence.eligibility.exclusionCounts['not-declared-scored'];
  const presentScored = decoded.evidence.eligibility.surveyed - presentDiagnostic;

  if (presentScored < 0) {
    decoder.fail('evidence.eligibility', 'reports more diagnostic marks than it surveyed.');
  }
  if (presentScored + decoded.manifest.missingScoredCount !== decoded.manifest.scoredCount) {
    decoder.fail(
      'manifest.scoredCount',
      'must equal the scored marks the walk reached plus the ones it missed.',
    );
  }
  if (presentDiagnostic > decoded.manifest.diagnosticCount) {
    decoder.fail(
      'manifest.diagnosticCount',
      'cannot be fewer than the diagnostic marks the walk reached.',
    );
  }
  // A status is a claim about these three counts, so each one that can be
  // reached says what they must be. Checking only `publishable === scoredCount`
  // was satisfied by `0 === 0`: a diagnostic-only walk could be relabelled `ok`,
  // given fabricated metrics and rehashed, and it verified with nothing scored
  // at all.
  const declaredScoredCount = decoded.manifest.scoredCount;
  const publishedCount = decoded.evidence.checkpointCount;
  if (publishableStatus) {
    if (declaredScoredCount === 0 || publishable === 0 || publishedCount === 0) {
      decoder.fail('evidence.status', 'cannot be ok when nothing was scored.');
    }
    if (declaredScoredCount !== publishable || publishable !== publishedCount) {
      decoder.fail(
        'evidence.status',
        'cannot be ok unless every predeclared scored mark backed the figure.',
      );
    }
  }
  if (decoded.evidence.status === 'manifest-not-satisfied' && publishable >= declaredScoredCount) {
    decoder.fail(
      'evidence.status',
      'claims the manifest was not satisfied while every scored mark was published.',
    );
  }
  // Localization is recorded twice, so the two records must agree before either
  // is used to judge a status.
  const localized = decoded.evidence.observationCount > 0;
  const filterRan = decoded.configuration.filter !== null;
  if (localized !== filterRan) {
    decoder.fail(
      'configuration.filter',
      'must be present exactly when the walk produced observations; replay runs only after a first fix.',
    );
  }
  if (listContains(STATUS_REQUIRES_LOCALIZATION, decoded.evidence.status) && !localized) {
    decoder.fail(
      'evidence.status',
      `claims ${decoded.evidence.status}, which is only reached after a first fix, with nothing localized.`,
    );
  }
  if (decoded.evidence.status === 'insufficient-localization' && localized) {
    decoder.fail(
      'evidence.status',
      'claims nothing was localized while carrying observations and a filter that ran.',
    );
  }

  // A status that says nothing was scored must be beside counts that agree.
  // `insufficient-ground-truth` additionally means nothing was predeclared as
  // scored; `insufficient-localization` means no estimate existed to score
  // against, which leaves the predeclarations intact but nothing published.
  if (listContains(STATUS_REQUIRES_NO_SCORING, decoded.evidence.status)) {
    if (publishable !== 0 || publishedCount !== 0) {
      decoder.fail(
        'evidence.status',
        `claims ${decoded.evidence.status} while still counting publishable or published marks.`,
      );
    }
    if (decoded.evidence.status === 'insufficient-ground-truth' && declaredScoredCount !== 0) {
      decoder.fail(
        'evidence.status',
        'claims no eligible ground truth while marks were predeclared as scored.',
      );
    }
  }
  if (decoded.evidence.eligibility.surveyed !== publishable + excluded) {
    decoder.fail('evidence.eligibility', 'surveyed must equal publishable plus excluded.');
  }
  // Every excluded mark carries exactly one reason, so the reasons must account
  // for the exclusions exactly. Non-zero reasons beside `excluded: 0` described
  // marks that were both excluded and not.
  let reasonTotal = 0;
  for (let index = 0; index < EXCLUSION_REASONS.length; index += 1) {
    reasonTotal += decoded.evidence.eligibility.exclusionCounts[
      EXCLUSION_REASONS[index] as keyof typeof decoded.evidence.eligibility.exclusionCounts
    ];
  }
  if (reasonTotal !== excluded) {
    decoder.fail('evidence.eligibility.exclusionCounts', 'must account for every excluded mark.');
  }
  // A publishable mark is one that reached the evaluator, so the two counts are
  // the same number seen from either side. `checkpointCount: 0` beside
  // `publishable: 1` claims a mark that was scored and never scored.
  if (decoded.evidence.checkpointCount !== decoded.evidence.eligibility.publishable) {
    decoder.fail('evidence.checkpointCount', 'must equal the number of publishable marks.');
  }
  // The survey breakdown counts the same marks the eligibility summary does.
  let surveyTotal = 0;
  for (const method of Object.keys(decoded.evidence.survey.methods)) {
    surveyTotal += decoded.evidence.survey.methods[method];
  }
  if (surveyTotal !== decoded.evidence.eligibility.surveyed) {
    decoder.fail('evidence.survey.methods', 'must account for every surveyed mark.');
  }
  for (let index = 0; index < decoded.evidence.sampling.gaps.length; index += 1) {
    const [from, to] = decoded.evidence.sampling.gaps[index];
    if (from < 0 || to < from) {
      decoder.fail(`evidence.sampling.gaps[${index}]`, 'must run forwards from a non-negative time.');
    }
  }
  // The policy and thresholds are this build's own, and the versions above say
  // so. Values disagreeing with them describe a processor that did not run.
  const expectedMethods = publishableSurveyMethods();
  if (decoded.policy.publishableSurveyMethods.join(',') !== expectedMethods.join(',')) {
    decoder.fail('policy.publishableSurveyMethods', 'disagrees with the policy this build applies.');
  }
  if (decoded.policy.maxPublishableSurveyAccuracyMeters !== maxPublishableSurveyAccuracyMeters()) {
    decoder.fail(
      'policy.maxPublishableSurveyAccuracyMeters',
      'disagrees with the policy this build applies.',
    );
  }
  const model = evidentialSensorModel();
  if (
    decoded.policy.evidentialSensorModel.api !== model.api ||
    decoded.policy.evidentialSensorModel.frame !== model.frame ||
    decoded.policy.evidentialSensorModel.gyroscopeUnits !== model.gyroscopeUnits
  ) {
    decoder.fail('policy.evidentialSensorModel', 'disagrees with the policy this build applies.');
  }
  const expectedThresholds: Record<string, number> = {
    groundTruthAlignmentToleranceMs: GROUND_TRUTH_ALIGNMENT_TOLERANCE_MS,
    materialSensorGapMs: MATERIAL_SENSOR_GAP_MS,
    minSampleIntervalMs: MIN_SAMPLE_INTERVAL_MS,
    maxBuildingFrameCoordinateMeters: MAX_BUILDING_FRAME_COORDINATE_METERS,
    anchorIndependenceToleranceMeters: ANCHOR_INDEPENDENCE_TOLERANCE_METERS,
  };
  for (const key of Object.keys(expectedThresholds)) {
    const carried = (decoded.configuration.thresholds as unknown as Record<string, number>)[key];
    if (carried !== expectedThresholds[key]) {
      decoder.fail(`configuration.thresholds.${key}`, 'disagrees with this build.');
    }
  }
  if (decoded.evidence.alignment.toleranceMs !== GROUND_TRUTH_ALIGNMENT_TOLERANCE_MS) {
    decoder.fail('evidence.alignment.toleranceMs', 'disagrees with this build.');
  }
  if (decoded.evidence.sampling.sampleCount > decoded.capture.eventCount) {
    decoder.fail('evidence.sampling.sampleCount', 'cannot exceed the capture event count.');
  }
  if (decoded.evidence.alignment.worstAlignmentDeltaMs !== null &&
      decoded.evidence.alignment.worstAlignmentDeltaMs > 0) {
    decoder.fail('evidence.alignment.worstAlignmentDeltaMs', 'must not read forward in time.');
  }

  return decoder.issues.length > 0
    ? { artifact: null, issues: decoder.issues }
    : { artifact: { shape: decoded }, issues: [] };
}

/** The manifest in canonical form: sorted by id, with nothing undeclared. */
function canonicalManifest(manifest: CheckpointManifest) {
  const checkpoints = manifest.checkpoints
    .map((entry) => ({
      id: entry.id,
      position: [entry.position[0], entry.position[1]],
      floorId: entry.floorId,
      role: entry.role,
      surveyMethod: entry.surveyMethod,
      expectedAccuracyMeters: entry.expectedAccuracyMeters,
      independentOfAnchors: entry.independentOfAnchors,
    }))
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  return {
    manifestVersion: manifest.manifestVersion,
    buildingId: manifest.buildingId,
    packageHash: manifest.packageHash,
    checkpoints,
  };
}

/**
 * Seals a capture and its predeclared manifest into a reproducible artifact.
 *
 * This is the official evidence path and it takes no tuning overrides. The
 * diagnostic `buildEvidenceReport(session, overrides)` still accepts them,
 * which is exactly why nothing sealed may go through it.
 *
 * Both inputs are snapshotted before anything else happens, and only the
 * snapshots are read afterwards. Sealing awaits a digest, and an input mutated
 * during that await previously produced an artifact that verified perfectly
 * while describing two different walks: old hashes and evidence, new metadata.
 *
 * A capture may seal with a non-publishable status. Recording *why* a walk
 * produced no figure is evidence about the walk, and refusing to seal it would
 * leave the least flattering outcomes undocumented.
 */
export async function sealEvidenceArtifact(
  session: CaptureSession,
  manifestInput: unknown,
): Promise<SealResult> {
  const validation = validateCheckpointManifest(manifestInput);
  if (validation.manifest === null) return { sealed: null, refusals: validation.issues };
  const manifest = validation.manifest;

  // The canonical capture document is the snapshot. Exporting validates the
  // session and produces the exact bytes that are hashed, and parsing it back
  // yields an inert object nothing outside this function holds a reference to.
  let captureJson: string;
  try {
    captureJson = exportCaptureSession(session);
  } catch (error) {
    return {
      sealed: null,
      refusals: [{ reason: 'capture-invalid', detail: (error as Error).message }],
    };
  }
  const capture = JSON.parse(captureJson) as CaptureSession;

  const refusals: SealRefusal[] = [];
  if (manifest.buildingId !== capture.buildingId || manifest.packageHash !== capture.packageHash) {
    refusals.push({
      reason: 'manifest-venue-mismatch',
      detail: 'The manifest was written for a different building or venue package.',
    });
  }

  const declared = new Map(manifest.checkpoints.map((entry) => [entry.id, entry]));
  const walked = new Map<
    string,
    {
      position: [number, number];
      floorId: string;
      surveyMethod: SurveyMethod;
      expectedAccuracyMeters: number;
      independentOfAnchors: boolean;
    }
  >();

  for (const event of capture.events) {
    if (event.type !== 'ground-truth') continue;
    // A checkpoint id names one mark. Two marks sharing one would collapse here
    // while evaluation scored both, so one predeclaration produced two errors.
    // Enforced at sealing rather than in capture validation: the capture stream
    // is at 0.2.0 and adding a rule to it changes a released contract without
    // the version saying so. It moves into the schema at 0.3.0.
    if (walked.has(event.checkpointId)) {
      refusals.push({
        reason: 'duplicate-checkpoint-id',
        detail: `The walk recorded "${event.checkpointId}" more than once, so which mark a figure rests on is undefined.`,
      });
      continue;
    }
    walked.set(event.checkpointId, {
      position: event.position,
      floorId: event.floorId,
      surveyMethod: event.surveyMethod,
      expectedAccuracyMeters: event.expectedAccuracyMeters,
      independentOfAnchors: event.independentOfAnchors,
    });
  }

  for (const [id, mark] of walked) {
    const entry = declared.get(id);
    if (entry === undefined) {
      refusals.push({
        reason: 'unmanifested-checkpoint',
        detail: `The walk recorded "${id}", which was not predeclared.`,
      });
      continue;
    }
    // Every claim eligibility reads must match what was promised. A capture is
    // written after the walk, so an unpinned claim can be upgraded to rescue a
    // bad mark or downgraded to drop one.
    const disagreements: string[] = [];
    if (
      entry.position[0] !== mark.position[0] ||
      entry.position[1] !== mark.position[1] ||
      entry.floorId !== mark.floorId
    ) {
      disagreements.push('its surveyed place');
    }
    if (entry.surveyMethod !== mark.surveyMethod) disagreements.push('how it was surveyed');
    if (entry.expectedAccuracyMeters !== mark.expectedAccuracyMeters) {
      disagreements.push('how accurate that survey is');
    }
    if (entry.independentOfAnchors !== mark.independentOfAnchors) {
      disagreements.push('whether it is independent of anchors');
    }
    if (disagreements.length > 0) {
      refusals.push({
        reason: 'checkpoint-claim-mismatch',
        detail: `"${id}" disagrees with the manifest about ${disagreements.join(', ')}.`,
      });
    }
  }

  // A predeclared mark the walk never reached is a result, not a malformed
  // input. Refusing to seal it suppressed the failure: the walk that fell short
  // simply produced no artifact, and only the successful walks left a record.
  // It seals with `manifest-not-satisfied` instead, and the count below says how
  // far short it fell. A missing diagnostic mark blocks nothing at all.
  const missingScored: string[] = [];
  for (const [id, entry] of declared) {
    if (entry.role === 'scored' && !walked.has(id)) missingScored.push(id);
  }

  if (refusals.length > 0) return { sealed: null, refusals };

  // No overrides, and the manifest is authoritative over the denominator.
  const scoredCheckpointIds = manifest.checkpoints
    .filter((entry) => entry.role === 'scored')
    .map((entry) => entry.id);
  const evidence = buildEvidenceReport(capture, {}, { scoredCheckpointIds });

  const [captureHash, manifestHash] = await Promise.all([
    sha256Hex(captureJson),
    sha256Hex(canonicalJson(canonicalManifest(manifest))),
  ]);

  const body = {
    artifactVersion: EVIDENCE_ARTIFACT_VERSION,
    capture: {
      captureVersion: capture.captureVersion,
      sessionId: capture.sessionId,
      buildingId: capture.buildingId,
      startedAtIso: capture.startedAtIso,
      contentHash: captureHash,
      eventCount: capture.events.length,
    },
    venue: { packageHash: capture.packageHash },
    manifest: {
      manifestVersion: manifest.manifestVersion,
      contentHash: manifestHash,
      scoredCount: scoredCheckpointIds.length,
      diagnosticCount: manifest.checkpoints.length - scoredCheckpointIds.length,
      missingScoredCount: missingScored.length,
    },
    versions: {
      processor: EVIDENCE_PROCESSOR_VERSION,
      policy: EVIDENCE_POLICY_VERSION,
      captureStream: CAPTURE_STREAM_VERSION,
      recording: LOCALIZATION_RECORDING_VERSION,
    },
    configuration: {
      ...evidence.configuration,
      thresholds: {
        groundTruthAlignmentToleranceMs: GROUND_TRUTH_ALIGNMENT_TOLERANCE_MS,
        materialSensorGapMs: MATERIAL_SENSOR_GAP_MS,
        minSampleIntervalMs: MIN_SAMPLE_INTERVAL_MS,
        maxBuildingFrameCoordinateMeters: MAX_BUILDING_FRAME_COORDINATE_METERS,
        anchorIndependenceToleranceMeters: ANCHOR_INDEPENDENCE_TOLERANCE_METERS,
      },
    },
    policy: {
      publishableSurveyMethods: publishableSurveyMethods(),
      maxPublishableSurveyAccuracyMeters: maxPublishableSurveyAccuracyMeters(),
      evidentialSensorModel: { ...evidentialSensorModel() },
    },
    evidence: {
      status: evidence.report.evidenceStatus,
      medianHorizontalErrorMeters: evidence.report.medianHorizontalErrorMeters,
      p95HorizontalErrorMeters: evidence.report.p95HorizontalErrorMeters,
      floorAccuracy: evidence.report.floorAccuracy,
      observationCount: evidence.report.observationCount,
      checkpointCount: evidence.report.checkpointCount,
      eligibility: evidence.eligibility,
      survey: evidence.survey,
      alignment: evidence.alignment,
      sampling: evidence.sampling,
    },
  };

  const sealed = { ...body, contentHash: await sha256Hex(canonicalJson(body)) };

  // Nothing leaves here that would not decode on the way back in, and what
  // leaves is the decoded snapshot rather than the object just assembled.
  const decoding = decodeEvidenceArtifact(sealed);
  if (decoding.artifact === null) {
    return {
      sealed: null,
      refusals: decoding.issues.map((detail) => ({ reason: 'artifact-invalid' as const, detail })),
    };
  }
  return { sealed: decoding.artifact.shape, refusals: [] };
}

/**
 * The artifact as bytes. Canonical, so identical artifacts are identical files.
 *
 * Async because it verifies the seal, not merely the shape. Checking shape
 * alone wrote files that the very next `importEvidenceArtifact` rejected: a
 * rewritten count passed the shape check, went to disk, and failed the digest
 * on the way back in. Anything this returns round-trips.
 */
export async function exportEvidenceArtifact(artifact: unknown) {
  const verification = await verifyEvidenceArtifact(artifact);
  if (!verification.valid) {
    throw new Error(
      `Refusing to export an evidence artifact that would not verify: ${verification.issues.join(' ')}`,
    );
  }
  return canonicalJson(verification.artifact);
}

export type ArtifactVerification =
  | { valid: true; artifact: EvidenceArtifact }
  | { valid: false; issues: string[] };

/**
 * Checks the shape, then recomputes the seal and compares it.
 *
 * Shape first, always. A digest only says the bytes are consistent with
 * themselves; it cannot notice that the document is missing every section, or
 * that a metric holds `NaN` where JSON will write `null`.
 *
 * Integrity and reproducibility only. This says the artifact is the one that
 * was sealed from those inputs; it says nothing about who sealed it, which
 * needs a signature and is deliberately not part of v0.1.
 */
export async function verifyEvidenceArtifact(value: unknown): Promise<ArtifactVerification> {
  const decoding = decodeEvidenceArtifact(value);
  if (decoding.artifact === null) return { valid: false, issues: decoding.issues };

  // The snapshot is what gets hashed and what gets returned. Hashing a shallow
  // view of the caller's object and then handing that object back meant a
  // mutation during the await returned `valid: true` carrying data nobody had
  // checked.
  const artifact = decoding.artifact.shape;
  const { contentHash, ...body } = artifact;
  const recomputed = await sha256Hex(canonicalJson(body));
  if (recomputed !== contentHash) {
    return { valid: false, issues: ['The artifact content hash does not match its contents.'] };
  }
  return { valid: true, artifact };
}

export type ArtifactImport =
  | { valid: true; artifact: EvidenceArtifact }
  | { valid: false; artifact: null; issues: string[] };

/** Parses and verifies in one step, so an unverified artifact is never handed back. */
export async function importEvidenceArtifact(text: string): Promise<ArtifactImport> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { valid: false, artifact: null, issues: ['Artifact must be valid JSON.'] };
  }

  const verification = await verifyEvidenceArtifact(parsed);
  return verification.valid
    ? { valid: true, artifact: verification.artifact }
    : { valid: false, artifact: null, issues: verification.issues };
}
