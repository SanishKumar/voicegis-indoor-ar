import type { CheckpointAnchor } from './checkpoints';
import type { ImuSample } from './deadReckoning';

export const CAPTURE_STREAM_VERSION = '0.2.0' as const;

export type Vector3 = [number, number, number];

/** Raw device orientation, as reported by the platform. */
export interface DeviceOrientationSample {
  alphaDegrees: number;
  betaDegrees: number;
  gammaDegrees: number;
  absolute: boolean;
}

export type CaptureEventType = 'imu' | 'scan' | 'ground-truth' | 'lifecycle';

interface CaptureEventBase {
  /** Monotonic across the session, never reused, assigned at capture. */
  sequence: number;
  /** Milliseconds since session start on the device clock. */
  timeMs: number;
  type: CaptureEventType;
}

/**
 * A raw inertial sample. Full vectors are stored rather than the two scalars
 * dead reckoning happens to need today, because a better step detector cannot
 * be recovered from data that has already been reduced.
 */
export interface ImuCaptureEvent extends CaptureEventBase {
  type: 'imu';
  /** Includes gravity, in m/s^2, device frame. */
  accelerometer: Vector3;
  /** Rate of turn in degrees/second, device frame. */
  gyroscope: Vector3;
  orientation: DeviceOrientationSample | null;
}

export type ScanOutcome =
  | 'resolved'
  | 'unknown-payload'
  | 'ambiguous-payload'
  | 'anchor-kind-mismatch'
  | 'decode-failed'
  | 'permission-denied'
  | 'transport-unavailable';

/**
 * One acquisition attempt. Failures are recorded deliberately: a marker that
 * would not decode is evidence about the venue, and a permission denial
 * explains a gap in the walk that would otherwise look like sensor loss.
 */
export interface ScanCaptureEvent extends CaptureEventBase {
  type: 'scan';
  transport: 'qr' | 'nfc';
  /** Null when nothing decoded. */
  payload: string | null;
  outcome: ScanOutcome;
  anchorId: string | null;
}

export type SurveyMethod =
  | 'tape-measure'
  | 'laser-distance'
  | 'total-station'
  | 'estimated';

/**
 * A surveyed floor mark that error is measured against.
 *
 * `independentOfAnchors` records whether this mark is a point the system was
 * never told about. A checkpoint that sits on the anchor which just reset the
 * position measures the reset, not the localization, so independence is
 * asserted per checkpoint and validated against the anchor set.
 */
export interface GroundTruthCaptureEvent extends CaptureEventBase {
  type: 'ground-truth';
  checkpointId: string;
  position: [number, number];
  floorId: string;
  surveyMethod: SurveyMethod;
  expectedAccuracyMeters: number;
  independentOfAnchors: boolean;
}

export type LifecycleEvent =
  | 'session-start'
  | 'session-end'
  | 'backgrounded'
  | 'foregrounded'
  | 'sensor-interrupted'
  | 'sensor-resumed'
  | 'permission-granted'
  | 'permission-denied';

export interface LifecycleCaptureEvent extends CaptureEventBase {
  type: 'lifecycle';
  event: LifecycleEvent;
  detail?: string;
}

export type CaptureEvent =
  | ImuCaptureEvent
  | ScanCaptureEvent
  | GroundTruthCaptureEvent
  | LifecycleCaptureEvent;

export interface CaptureSensorProfile {
  accelerometerHz?: number;
  gyroscopeHz?: number;
  orientationHz?: number;
}

export interface CaptureDeviceProfile {
  label: string;
  platform: string;
  model?: string;
  osVersion?: string;
  browser?: string;
  browserVersion?: string;
  userAgent?: string;
  appVersion?: string;
  timezone?: string;
  sensors: CaptureSensorProfile;
}

export interface CaptureSession {
  captureVersion: typeof CAPTURE_STREAM_VERSION;
  sessionId: string;
  buildingId: string;
  packageHash: string;
  /** Wall clock at session start. Required: a walk with no date cannot be dated. */
  startedAtIso: string;
  device: CaptureDeviceProfile;
  anchors: CheckpointAnchor[];
  events: CaptureEvent[];
}

export interface CaptureIssue {
  code: string;
  path: string;
  message: string;
}

/** Distance below which a ground-truth mark is treated as sitting on an anchor. */
export const ANCHOR_INDEPENDENCE_TOLERANCE_METERS = 1.5;

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/**
 * Total order over capture events: time first, then the capture sequence.
 *
 * Timestamps alone are not an order. Two events can share a millisecond, and
 * resolving those ties by array position makes a rebuilt stream depend on how
 * the arrays were assembled rather than on what happened.
 */
export function compareCaptureEvents(left: CaptureEvent, right: CaptureEvent) {
  return left.timeMs - right.timeMs || left.sequence - right.sequence;
}

export function sortCaptureEvents(events: CaptureEvent[]): CaptureEvent[] {
  return [...events].sort(compareCaptureEvents);
}

function isVector3(value: unknown): value is Vector3 {
  return (
    Array.isArray(value) && value.length === 3 && value.every((entry) => Number.isFinite(entry))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reduces a raw inertial sample to the scalars the current dead reckoner
 * consumes. Kept separate from capture so the reduction can change without
 * invalidating a recorded walk.
 */
export function reduceImuEvent(event: ImuCaptureEvent): ImuSample {
  const [ax, ay, az] = event.accelerometer;
  return {
    timeMs: event.timeMs,
    accelerationMagnitude: Math.hypot(ax, ay, az),
    // Z is the device's vertical axis when the handset is held flat, which is
    // the axis a walking turn shows up on.
    yawRateDegreesPerSecond: event.gyroscope[2],
  };
}

function validateEvent(event: unknown, index: number, issues: CaptureIssue[]) {
  const path = `/events/${index}`;
  if (!isRecord(event)) {
    issues.push({ code: 'malformed-event', path, message: 'Every capture event must be an object.' });
    return false;
  }
  if (!Number.isFinite(event.sequence) || !Number.isFinite(event.timeMs)) {
    issues.push({
      code: 'malformed-event',
      path,
      message: 'Capture events need a finite sequence and timeMs.',
    });
    return false;
  }
  if (event.type === 'imu') {
    if (!isVector3(event.accelerometer) || !isVector3(event.gyroscope)) {
      issues.push({
        code: 'malformed-imu-event',
        path,
        message: 'Inertial events need full accelerometer and gyroscope vectors.',
      });
      return false;
    }
    return true;
  }
  if (event.type === 'scan') {
    if (event.transport !== 'qr' && event.transport !== 'nfc') {
      issues.push({ code: 'malformed-scan-event', path, message: 'Scan transport must be qr or nfc.' });
      return false;
    }
    return true;
  }
  if (event.type === 'ground-truth') {
    if (
      typeof event.checkpointId !== 'string' ||
      !Array.isArray(event.position) ||
      event.position.length !== 2 ||
      typeof event.independentOfAnchors !== 'boolean' ||
      !Number.isFinite(event.expectedAccuracyMeters)
    ) {
      issues.push({
        code: 'malformed-ground-truth-event',
        path,
        message:
          'Ground truth needs a checkpoint id, position, survey accuracy, and an independence claim.',
      });
      return false;
    }
    return true;
  }
  if (event.type === 'lifecycle') return true;
  issues.push({ code: 'unknown-event-type', path, message: `Unsupported event type.` });
  return false;
}

/**
 * Checks a session is internally consistent and methodologically sound.
 *
 * The independence rule is the one that changes a number rather than a
 * behaviour: a ground-truth mark claiming independence while sitting on the
 * anchor that just reset the estimate would report the reset as accuracy.
 */
export function validateCaptureSession(session: CaptureSession): CaptureIssue[] {
  const issues: CaptureIssue[] = [];

  if (session.captureVersion !== CAPTURE_STREAM_VERSION) {
    issues.push({
      code: 'unsupported-capture-version',
      path: '/captureVersion',
      message: `Expected capture stream ${CAPTURE_STREAM_VERSION}.`,
    });
  }
  if (typeof session.startedAtIso !== 'string' || !ISO_INSTANT.test(session.startedAtIso)) {
    issues.push({
      code: 'invalid-capture-start',
      path: '/startedAtIso',
      message: 'Capture start must be a UTC ISO instant.',
    });
  } else if (new Date(session.startedAtIso).getUTCFullYear() < 2000) {
    // A missing clock previously defaulted to the epoch, which silently dated
    // every walk to 1970.
    issues.push({
      code: 'implausible-capture-start',
      path: '/startedAtIso',
      message: 'Capture start predates 2000 and is almost certainly a missing clock.',
    });
  }

  session.events.forEach((event, index) => validateEvent(event, index, issues));

  // Sequence records the order events were captured; the stream is stored in
  // time order. Those differ legitimately — a floor mark is often noted a
  // moment after it was stood on — so sequence is required to be unique
  // globally and increasing only among events sharing a millisecond, which is
  // exactly where it acts as the tie-break.
  let previousTimeMs = Number.NEGATIVE_INFINITY;
  let previousSequenceAtTime = -1;
  const seenSequences = new Set<number>();
  session.events.forEach((event, index) => {
    if (seenSequences.has(event.sequence)) {
      issues.push({
        code: 'duplicate-event-sequence',
        path: `/events/${index}/sequence`,
        message: `Sequence ${event.sequence} is used more than once.`,
      });
    }
    seenSequences.add(event.sequence);
    if (event.timeMs < previousTimeMs) {
      issues.push({
        code: 'non-monotonic-time',
        path: `/events/${index}/timeMs`,
        message: 'Capture times must not go backwards in stored order.',
      });
    } else if (event.timeMs === previousTimeMs && event.sequence <= previousSequenceAtTime) {
      issues.push({
        code: 'non-monotonic-sequence',
        path: `/events/${index}/sequence`,
        message: 'Events sharing a timestamp must be stored in capture-sequence order.',
      });
    }
    previousSequenceAtTime = event.timeMs === previousTimeMs ? event.sequence : event.sequence;
    previousTimeMs = event.timeMs;
  });

  const anchorsByFloor = new Map<string, CheckpointAnchor[]>();
  for (const anchor of session.anchors) {
    const list = anchorsByFloor.get(anchor.floorId) ?? [];
    list.push(anchor);
    anchorsByFloor.set(anchor.floorId, list);
  }
  session.events.forEach((event, index) => {
    if (event.type !== 'ground-truth' || !event.independentOfAnchors) return;
    const nearby = (anchorsByFloor.get(event.floorId) ?? []).find(
      (anchor) =>
        Math.hypot(anchor.position[0] - event.position[0], anchor.position[1] - event.position[1]) <=
        ANCHOR_INDEPENDENCE_TOLERANCE_METERS,
    );
    if (nearby) {
      issues.push({
        code: 'ground-truth-not-independent',
        path: `/events/${index}/independentOfAnchors`,
        message: `Checkpoint "${event.checkpointId}" claims independence but sits within ${ANCHOR_INDEPENDENCE_TOLERANCE_METERS} m of anchor "${nearby.id}", so it would measure that anchor's own reset.`,
      });
    }
  });

  return issues.sort((a, b) => a.code.localeCompare(b.code) || a.path.localeCompare(b.path));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

/** Canonical JSON: identical sessions always produce identical bytes. */
export function exportCaptureSession(session: CaptureSession): string {
  return `${JSON.stringify(canonicalize({ ...session, events: sortCaptureEvents(session.events) }), null, 2)}\n`;
}

export interface CaptureImportResult {
  valid: boolean;
  session: CaptureSession | null;
  issues: CaptureIssue[];
}

export function importCaptureSession(text: string): CaptureImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      valid: false,
      session: null,
      issues: [{ code: 'invalid-capture-json', path: '/', message: 'Capture must be valid JSON.' }],
    };
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.events) || !Array.isArray(parsed.anchors)) {
    return {
      valid: false,
      session: null,
      issues: [
        {
          code: 'malformed-capture',
          path: '/',
          message: 'Capture needs an events array and an anchors array.',
        },
      ],
    };
  }

  const session = parsed as unknown as CaptureSession;
  const issues = validateCaptureSession(session);
  return { valid: issues.length === 0, session: issues.length === 0 ? session : null, issues };
}
