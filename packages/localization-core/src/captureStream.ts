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
  /** Includes gravity, in m/s^2, expressed in the profile's declared frame. */
  accelerometer: Vector3;
  /** Rate of turn in the profile's declared units and frame. */
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

export type SensorApi = 'devicemotion' | 'generic-sensor' | 'native' | 'synthetic';
export type AngularRateUnits = 'deg/s' | 'rad/s';
export type SensorFrame = 'device' | 'world';

/**
 * How the samples were obtained.
 *
 * Declared rates are advisory only — actual intervals are recovered from the
 * timestamps, because browsers throttle and coalesce sensor delivery. The API,
 * units, and frame are not advisory: DeviceMotion and the Generic Sensor API
 * disagree on angular-rate units and axis conventions, so a stream without them
 * cannot be interpreted later.
 *
 * See https://www.w3.org/TR/orientation-event/ and https://www.w3.org/TR/gyroscope/.
 */
export interface CaptureSensorProfile {
  /** Nominal rates as advertised by the platform, never trusted for maths. */
  accelerometerHz?: number;
  gyroscopeHz?: number;
  orientationHz?: number;
  /** Required: the platform API the samples came from. */
  api: SensorApi;
  /** Required: DeviceMotion and Generic Sensor disagree on units. */
  gyroscopeUnits: AngularRateUnits;
  /** Required: axis conventions differ per API. */
  frame: SensorFrame;
}

export interface SamplingSummary {
  sampleCount: number;
  medianIntervalMs: number;
  /** Median absolute deviation of intervals: how irregular delivery was. */
  jitterMs: number;
  observedHz: number;
  /** Gaps longer than five times the median interval, as [startMs, endMs]. */
  gaps: Array<[number, number]>;
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
    // Takes Z as yaw, which is only the world vertical when the samples are
    // already in the world frame. The evidence path refuses anything else until
    // orientation-aware projection exists.
    yawRateDegreesPerSecond: event.gyroscope[2],
  };
}

/**
 * Conservative physical bounds for a handset.
 *
 * Individually finite components can still reduce to a non-finite magnitude —
 * three Number.MAX_VALUE axes pass a finiteness check and then hypot to
 * Infinity — and such a sample would otherwise count as inertial coverage. A
 * phone in normal use stays far inside these limits; consumer MEMS parts
 * saturate well below them.
 */
const MAX_ACCELERATION_MAGNITUDE_M_S2 = 200;
const MAX_ANGULAR_RATE_DEG_S = 2_000;

const SCAN_OUTCOMES = new Set<string>([
  'resolved',
  'unknown-payload',
  'ambiguous-payload',
  'anchor-kind-mismatch',
  'decode-failed',
  'permission-denied',
  'transport-unavailable',
]);
const SURVEY_METHODS = new Set<string>([
  'tape-measure',
  'laser-distance',
  'total-station',
  'estimated',
]);
const LIFECYCLE_EVENTS = new Set<string>([
  'session-start',
  'session-end',
  'backgrounded',
  'foregrounded',
  'sensor-interrupted',
  'sensor-resumed',
  'permission-granted',
  'permission-denied',
]);
const ANCHOR_KINDS = new Set<string>(['qr', 'apriltag', 'image', 'nfc']);
/** The complete anchor schema. `spaceId` is deliberately not part of it. */
const CAPTURE_ANCHOR_KEYS = new Set<string>([
  'id',
  'floorId',
  'kind',
  'position',
  'headingDegrees',
  'payload',
]);

function isPosition2(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every((entry) => Number.isFinite(entry));
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function optionalOf(value: unknown, check: (candidate: unknown) => boolean) {
  return value === undefined || check(value);
}

function add(issues: CaptureIssue[], code: string, path: string, message: string) {
  issues.push({ code, path, message });
}

function validateEvent(event: unknown, index: number, issues: CaptureIssue[]) {
  const path = `/events/${index}`;
  if (!isRecord(event)) {
    add(issues, 'malformed-event', path, 'Every capture event must be an object.');
    return false;
  }
  // Sequence counts events, so it must be a whole non-negative number. Time is
  // allowed to be fractional because high-resolution timers report sub-
  // millisecond values, but it may never be negative or non-finite.
  if (!Number.isInteger(event.sequence) || Number(event.sequence) < 0) {
    add(issues, 'malformed-event', `${path}/sequence`, 'Sequence must be a non-negative integer.');
    return false;
  }
  if (!Number.isFinite(event.timeMs) || Number(event.timeMs) < 0) {
    add(issues, 'malformed-event', `${path}/timeMs`, 'Time must be a non-negative finite number.');
    return false;
  }

  if (event.type === 'imu') {
    if (!isVector3(event.accelerometer) || !isVector3(event.gyroscope)) {
      add(
        issues,
        'malformed-imu-event',
        path,
        'Inertial events need full accelerometer and gyroscope vectors.',
      );
      return false;
    }
    // The reduction the pipeline will perform must itself be finite and
    // physically possible, not merely each raw component.
    const magnitude = Math.hypot(...(event.accelerometer as Vector3));
    if (!Number.isFinite(magnitude) || magnitude > MAX_ACCELERATION_MAGNITUDE_M_S2) {
      add(
        issues,
        'implausible-imu-event',
        `${path}/accelerometer`,
        'Acceleration must reduce to a finite magnitude within handset limits.',
      );
      return false;
    }
    if (
      (event.gyroscope as Vector3).some(
        (rate) => !Number.isFinite(rate) || Math.abs(rate) > MAX_ANGULAR_RATE_DEG_S,
      )
    ) {
      add(
        issues,
        'implausible-imu-event',
        `${path}/gyroscope`,
        'Angular rate must be finite and within handset limits.',
      );
      return false;
    }
    if (event.orientation !== null && event.orientation !== undefined) {
      const orientation = event.orientation;
      if (
        !isRecord(orientation) ||
        !Number.isFinite(orientation.alphaDegrees) ||
        !Number.isFinite(orientation.betaDegrees) ||
        !Number.isFinite(orientation.gammaDegrees) ||
        typeof orientation.absolute !== 'boolean'
      ) {
        add(
          issues,
          'malformed-imu-event',
          `${path}/orientation`,
          'Orientation must carry finite alpha, beta, gamma and an absolute flag.',
        );
        return false;
      }
    }
    return true;
  }

  if (event.type === 'scan') {
    if (event.transport !== 'qr' && event.transport !== 'nfc') {
      add(issues, 'malformed-scan-event', path, 'Scan transport must be qr or nfc.');
      return false;
    }
    if (!SCAN_OUTCOMES.has(String(event.outcome))) {
      add(issues, 'malformed-scan-event', `${path}/outcome`, 'Unknown scan outcome.');
      return false;
    }
    if (event.payload !== null && typeof event.payload !== 'string') {
      add(issues, 'malformed-scan-event', `${path}/payload`, 'Scan payload must be a string or null.');
      return false;
    }
    if (event.anchorId !== null && typeof event.anchorId !== 'string') {
      add(issues, 'malformed-scan-event', `${path}/anchorId`, 'Anchor id must be a string or null.');
      return false;
    }
    if (event.outcome === 'resolved' && (!nonEmptyString(event.anchorId) || event.payload === null)) {
      add(
        issues,
        'malformed-scan-event',
        `${path}/outcome`,
        'A resolved scan must name the anchor it resolved and the payload it read.',
      );
      return false;
    }
    return true;
  }

  if (event.type === 'ground-truth') {
    let ok = true;
    if (!nonEmptyString(event.checkpointId)) {
      add(issues, 'malformed-ground-truth-event', `${path}/checkpointId`, 'Checkpoint id is required.');
      ok = false;
    }
    if (!isPosition2(event.position)) {
      add(issues, 'malformed-ground-truth-event', `${path}/position`, 'Position must be two finite numbers.');
      ok = false;
    }
    if (!nonEmptyString(event.floorId)) {
      add(issues, 'malformed-ground-truth-event', `${path}/floorId`, 'Floor id is required.');
      ok = false;
    }
    if (!SURVEY_METHODS.has(String(event.surveyMethod))) {
      add(
        issues,
        'malformed-ground-truth-event',
        `${path}/surveyMethod`,
        'Survey method must be recorded so the mark can be trusted.',
      );
      ok = false;
    }
    if (!Number.isFinite(event.expectedAccuracyMeters) || Number(event.expectedAccuracyMeters) < 0) {
      add(
        issues,
        'malformed-ground-truth-event',
        `${path}/expectedAccuracyMeters`,
        'Expected survey accuracy must be a non-negative number.',
      );
      ok = false;
    }
    if (typeof event.independentOfAnchors !== 'boolean') {
      add(
        issues,
        'malformed-ground-truth-event',
        `${path}/independentOfAnchors`,
        'Independence from anchors must be claimed explicitly.',
      );
      ok = false;
    }
    return ok;
  }

  if (event.type === 'lifecycle') {
    if (!LIFECYCLE_EVENTS.has(String(event.event))) {
      add(issues, 'malformed-lifecycle-event', `${path}/event`, 'Unknown lifecycle event.');
      return false;
    }
    return true;
  }

  add(issues, 'unknown-event-type', path, 'Unsupported event type.');
  return false;
}

function validateDevice(device: unknown, issues: CaptureIssue[]) {
  if (!isRecord(device)) {
    add(issues, 'malformed-device', '/device', 'Capture must record the device it came from.');
    return;
  }
  if (!nonEmptyString(device.label)) {
    add(issues, 'malformed-device', '/device/label', 'Device label is required.');
  }
  if (!nonEmptyString(device.platform)) {
    add(issues, 'malformed-device', '/device/platform', 'Device platform is required.');
  }
  if (!isRecord(device.sensors)) {
    add(issues, 'malformed-device', '/device/sensors', 'Sensor profile is required.');
    return;
  }
  const sensors = device.sensors;
  const finiteOrAbsent = (value: unknown) => Number.isFinite(value) && Number(value) > 0;
  for (const key of ['accelerometerHz', 'gyroscopeHz', 'orientationHz']) {
    if (!optionalOf(sensors[key], finiteOrAbsent)) {
      add(issues, 'malformed-sensor-profile', `/device/sensors/${key}`, 'Declared rate must be positive.');
    }
  }
  // API, units, and frame are required, not optional. DeviceMotion and the
  // Generic Sensor API disagree on angular-rate units and axis conventions, so
  // a stream that omits them cannot be interpreted after the fact.
  if (!['devicemotion', 'generic-sensor', 'native', 'synthetic'].includes(String(sensors.api))) {
    add(issues, 'malformed-sensor-profile', '/device/sensors/api', 'Sensor API must be recorded.');
  }
  if (sensors.gyroscopeUnits !== 'deg/s' && sensors.gyroscopeUnits !== 'rad/s') {
    add(
      issues,
      'malformed-sensor-profile',
      '/device/sensors/gyroscopeUnits',
      'Angular rate units must be recorded as deg/s or rad/s.',
    );
  }
  if (sensors.frame !== 'device' && sensors.frame !== 'world') {
    add(
      issues,
      'malformed-sensor-profile',
      '/device/sensors/frame',
      'Sensor coordinate frame must be recorded as device or world.',
    );
  }
}

function validateAnchors(anchors: unknown, issues: CaptureIssue[]) {
  if (!Array.isArray(anchors)) {
    add(issues, 'malformed-anchors', '/anchors', 'Capture must carry the anchor set it resolved against.');
    return [];
  }
  const valid: CheckpointAnchor[] = [];
  anchors.forEach((anchor, index) => {
    const path = `/anchors/${index}`;
    if (!isRecord(anchor)) {
      add(issues, 'malformed-anchor', path, 'Each anchor must be an object.');
      return;
    }
    let ok = true;
    // Unknown properties are refused rather than dropped. Export validates
    // first, so a session that gained a field after authorship fails loudly
    // instead of being quietly sanitised into something that looks authored.
    const unknown = Object.keys(anchor).filter((key) => !CAPTURE_ANCHOR_KEYS.has(key));
    if (unknown.length > 0) {
      add(
        issues,
        'unknown-anchor-property',
        `${path}/${unknown[0]}`,
        `Anchors carry only the fields the capture schema defines; "${unknown[0]}" is not one of them.`,
      );
      ok = false;
    }
    if (!nonEmptyString(anchor.id)) {
      add(issues, 'malformed-anchor', `${path}/id`, 'Anchor id is required.');
      ok = false;
    }
    if (!nonEmptyString(anchor.floorId)) {
      add(issues, 'malformed-anchor', `${path}/floorId`, 'Anchor floor id is required.');
      ok = false;
    }
    if (!nonEmptyString(anchor.payload)) {
      add(issues, 'malformed-anchor', `${path}/payload`, 'Anchor payload is required.');
      ok = false;
    }
    if (!ANCHOR_KINDS.has(String(anchor.kind))) {
      add(issues, 'malformed-anchor', `${path}/kind`, 'Unknown anchor kind.');
      ok = false;
    }
    if (!isPosition2(anchor.position)) {
      add(issues, 'malformed-anchor', `${path}/position`, 'Anchor position must be two finite numbers.');
      ok = false;
    }
    const heading = anchor.headingDegrees;
    if (!Number.isFinite(heading) || Number(heading) < 0 || Number(heading) >= 360) {
      add(issues, 'malformed-anchor', `${path}/headingDegrees`, 'Anchor heading must be in [0, 360).');
      ok = false;
    }
    if (ok) valid.push(anchor as unknown as CheckpointAnchor);
  });
  return valid;
}

/**
 * Checks a session is internally consistent and methodologically sound.
 *
 * The independence rule is the one that changes a number rather than a
 * behaviour: a ground-truth mark claiming independence while sitting on the
 * anchor that just reset the estimate would report the reset as accuracy.
 */
export function validateCaptureSession(value: unknown): CaptureIssue[] {
  const issues: CaptureIssue[] = [];

  if (!isRecord(value)) {
    return [{ code: 'malformed-capture', path: '/', message: 'Capture must be an object.' }];
  }
  for (const key of ['sessionId', 'buildingId', 'packageHash']) {
    if (!nonEmptyString(value[key])) {
      add(issues, 'malformed-capture', `/${key}`, `${key} is required.`);
    }
  }
  validateDevice(value.device, issues);
  // Only anchors that passed structural validation are used below. Reading the
  // raw array would crash on a null anchor set or a null entry.
  const validAnchors = validateAnchors(value.anchors, issues);
  if (!Array.isArray(value.events)) {
    add(issues, 'malformed-capture', '/events', 'Capture must carry an events array.');
    return issues.sort((a, b) => a.code.localeCompare(b.code) || a.path.localeCompare(b.path));
  }

  const session = value as unknown as CaptureSession;

  if (session.captureVersion !== CAPTURE_STREAM_VERSION) {
    issues.push({
      code: 'unsupported-capture-version',
      path: '/captureVersion',
      message: `Expected capture stream ${CAPTURE_STREAM_VERSION}.`,
    });
  }
  const startMs =
    typeof session.startedAtIso === 'string' ? Date.parse(session.startedAtIso) : Number.NaN;
  if (
    typeof session.startedAtIso !== 'string' ||
    !ISO_INSTANT.test(session.startedAtIso) ||
    Number.isNaN(startMs) ||
    // A date such as 2026-02-30 matches the shape but is not a real instant;
    // re-serialising catches it.
    new Date(startMs).toISOString().slice(0, 19) !== session.startedAtIso.slice(0, 19)
  ) {
    issues.push({
      code: 'invalid-capture-start',
      path: '/startedAtIso',
      message: 'Capture start must be a real UTC ISO instant.',
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

  // Only structurally sound events are ordered, so a malformed entry is
  // reported rather than dereferenced.
  const wellFormed: Array<{ event: CaptureEvent; index: number }> = [];
  session.events.forEach((event, index) => {
    if (validateEvent(event, index, issues)) wellFormed.push({ event: event as CaptureEvent, index });
  });

  // Sequence records the order events were captured; the stream is stored in
  // time order. Those differ legitimately — a floor mark is often noted a
  // moment after it was stood on — so sequence is required to be unique
  // globally and increasing only among events sharing a millisecond, which is
  // exactly where it acts as the tie-break.
  let previousTimeMs = Number.NEGATIVE_INFINITY;
  let previousSequenceAtTime = -1;
  const seenSequences = new Set<number>();
  wellFormed.forEach(({ event, index }) => {
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
  for (const anchor of validAnchors) {
    const list = anchorsByFloor.get(anchor.floorId) ?? [];
    list.push(anchor);
    anchorsByFloor.set(anchor.floorId, list);
  }
  wellFormed.forEach(({ event, index }) => {
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

/**
 * Recovers how the sensors actually behaved from the timestamps.
 *
 * A declared rate describes what the platform intended; browsers throttle,
 * coalesce, and stop delivering entirely when backgrounded. Anything that
 * depends on sample spacing should read this rather than the declared rate.
 */
export function summarizeSampling(session: CaptureSession): SamplingSummary {
  const times = session.events
    .filter((event): event is ImuCaptureEvent => event.type === 'imu')
    .map((event) => event.timeMs)
    .sort((left, right) => left - right);
  if (times.length < 2) {
    return { sampleCount: times.length, medianIntervalMs: 0, jitterMs: 0, observedHz: 0, gaps: [] };
  }

  const intervals: number[] = [];
  for (let index = 1; index < times.length; index += 1) intervals.push(times[index] - times[index - 1]);
  const sorted = [...intervals].sort((left, right) => left - right);
  const medianIntervalMs = sorted[Math.floor(sorted.length / 2)];
  const deviations = intervals.map((interval) => Math.abs(interval - medianIntervalMs)).sort((a, b) => a - b);
  const jitterMs = deviations[Math.floor(deviations.length / 2)];

  const gaps: Array<[number, number]> = [];
  const gapThreshold = Math.max(medianIntervalMs * 5, medianIntervalMs + 1);
  for (let index = 1; index < times.length; index += 1) {
    if (times[index] - times[index - 1] > gapThreshold) gaps.push([times[index - 1], times[index]]);
  }

  return {
    sampleCount: times.length,
    medianIntervalMs,
    jitterMs,
    observedHz: medianIntervalMs > 0 ? Number((1_000 / medianIntervalMs).toFixed(3)) : 0,
    gaps,
  };
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

export class CaptureExportError extends Error {
  readonly issues: CaptureIssue[];
  constructor(issues: CaptureIssue[]) {
    super(
      `Refusing to export an invalid capture (${issues.length} issue(s)): ${issues
        .map((issue) => `${issue.code}@${issue.path}`)
        .join(', ')}`,
    );
    this.name = 'CaptureExportError';
    this.issues = issues;
  }
}

/**
 * Canonical JSON: identical sessions always produce identical bytes.
 *
 * Validates first. Writing an invalid capture to disk would create a file that
 * looks like evidence and cannot be read back, and the failure would surface far
 * from the walk that produced it.
 */
export function exportCaptureSession(session: CaptureSession): string {
  const issues = validateCaptureSession(session);
  if (issues.length > 0) throw new CaptureExportError(issues);
  return serializeCaptureSession(projectCaptureSession(session));
}

/**
 * Projects a session onto the capture schema.
 *
 * Only known fields survive. Anything a caller attached — notably camera or
 * media payloads — is dropped rather than serialised, so an export cannot carry
 * data the format never promised to hold.
 */
function projectCaptureSession(session: CaptureSession): CaptureSession {
  const { sensors } = session.device;
  return {
    captureVersion: session.captureVersion,
    sessionId: session.sessionId,
    buildingId: session.buildingId,
    packageHash: session.packageHash,
    startedAtIso: session.startedAtIso,
    device: {
      label: session.device.label,
      platform: session.device.platform,
      model: session.device.model,
      osVersion: session.device.osVersion,
      browser: session.device.browser,
      browserVersion: session.device.browserVersion,
      userAgent: session.device.userAgent,
      appVersion: session.device.appVersion,
      timezone: session.device.timezone,
      sensors: {
        accelerometerHz: sensors.accelerometerHz,
        gyroscopeHz: sensors.gyroscopeHz,
        orientationHz: sensors.orientationHz,
        api: sensors.api,
        gyroscopeUnits: sensors.gyroscopeUnits,
        frame: sensors.frame,
      },
    },
    anchors: session.anchors.map((anchor) => ({
      id: anchor.id,
      floorId: anchor.floorId,
      kind: anchor.kind,
      position: [anchor.position[0], anchor.position[1]] as [number, number],
      headingDegrees: anchor.headingDegrees,
      payload: anchor.payload,
    })),
    events: sortCaptureEvents(session.events).map(projectCaptureEvent),
  };
}

function projectCaptureEvent(event: CaptureEvent): CaptureEvent {
  const base = { sequence: event.sequence, timeMs: event.timeMs };
  if (event.type === 'imu') {
    return {
      ...base,
      type: 'imu',
      accelerometer: [...event.accelerometer] as Vector3,
      gyroscope: [...event.gyroscope] as Vector3,
      orientation: event.orientation
        ? {
            alphaDegrees: event.orientation.alphaDegrees,
            betaDegrees: event.orientation.betaDegrees,
            gammaDegrees: event.orientation.gammaDegrees,
            absolute: event.orientation.absolute,
          }
        : null,
    };
  }
  if (event.type === 'scan') {
    return {
      ...base,
      type: 'scan',
      transport: event.transport,
      payload: event.payload,
      outcome: event.outcome,
      anchorId: event.anchorId,
    };
  }
  if (event.type === 'ground-truth') {
    return {
      ...base,
      type: 'ground-truth',
      checkpointId: event.checkpointId,
      position: [event.position[0], event.position[1]] as [number, number],
      floorId: event.floorId,
      surveyMethod: event.surveyMethod,
      expectedAccuracyMeters: event.expectedAccuracyMeters,
      independentOfAnchors: event.independentOfAnchors,
    };
  }
  return {
    ...base,
    type: 'lifecycle',
    event: event.event,
    ...(event.detail === undefined ? {} : { detail: event.detail }),
  };
}

function serializeCaptureSession(session: CaptureSession): string {
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
  const issues = validateCaptureSession(parsed);
  return {
    valid: issues.length === 0,
    session: issues.length === 0 ? (parsed as unknown as CaptureSession) : null,
    issues,
  };
}
