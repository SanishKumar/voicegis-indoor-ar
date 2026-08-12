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
  const copy: CaptureEvent[] = [];
  for (let index = 0; index < events.length; index += 1) copy.push(events[index]);
  return copy.sort(compareCaptureEvents);
}

/**
 * An array that is dense and carries nothing but its elements.
 *
 * `Array.prototype.every` and `forEach` skip holes, so `[1, , 3]` passed an
 * element check and then serialised its hole as null, which no longer
 * re-imports. Named properties are invisible to both, so `events.secret = 1n`
 * survived a schema that claimed to be closed.
 */
function isPlainArray(value: unknown, expectedLength?: number): value is unknown[] {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
    if (expectedLength !== undefined && value.length !== expectedLength) return false;

    // A real array owns `length` plus one enumerable data property per index.
    // Reflecting every key also catches symbols and non-enumerable names that
    // Object.keys silently omitted.
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1 || !keys.includes('length')) return false;
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return false;
    }
    for (const key of keys) {
      if (key === 'length') continue;
      if (typeof key !== 'string') return false;
      const index = Number(key);
      if (!Number.isInteger(index) || index < 0 || index >= value.length || String(index) !== key) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function hasOwnEnumerableDataProperty(record: object, key: string) {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor !== undefined && descriptor.enumerable && 'value' in descriptor;
}

/**
 * Requires declared fields to be own enumerable data. Inherited,
 * non-enumerable and accessor values can satisfy a read while disappearing or
 * changing during serialisation.
 */
function requireOwnKeys(
  record: Record<string, unknown>,
  required: readonly string[],
  path: string,
  code: string,
  issues: CaptureIssue[],
) {
  let ok = true;
  for (const key of required) {
    if (!hasOwnEnumerableDataProperty(record, key)) {
      add(
        issues,
        code,
        appendJsonPointer(path, key),
        `"${key}" must be an own enumerable data property.`,
      );
      ok = false;
    }
  }
  return ok;
}

/**
 * Ordinal ordering by UTF-16 code unit.
 *
 * `localeCompare` follows the host locale, so the same session serialised under
 * English and Czech collation produced different bytes. Canonical output cannot
 * depend on where it was produced.
 */
function compareOrdinal(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function escapeJsonPointerSegment(segment: string) {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

function appendJsonPointer(path: string, segment: string | number) {
  return `${path}/${escapeJsonPointerSegment(String(segment))}`;
}

function isVector3(value: unknown): value is Vector3 {
  if (!isPlainArray(value, 3)) return false;
  for (let index = 0; index < 3; index += 1) {
    if (!Number.isFinite(value[index])) return false;
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const INVALID_JSON_DATA = Symbol('invalid-json-data');

function sortCaptureIssues(issues: CaptureIssue[]) {
  return issues.sort(
    (left, right) =>
      compareOrdinal(left.code, right.code) || compareOrdinal(left.path, right.path),
  );
}

/**
 * Copies caller-owned input into inert JSON data without invoking getters,
 * array methods or iterators.
 *
 * Validation and export both consume this exact snapshot. That removes the
 * gap where an accessor or proxy could present one value during validation and
 * another during serialisation, and it gives non-JSON values nowhere to hide.
 * Own data descriptors are deliberately authoritative; ordinary property reads
 * are never consulted. A proxy can claim arbitrary descriptor values just as a
 * plain object can claim arbitrary field values, while capture authenticity is
 * the later sealed-artifact concern rather than something shape validation can
 * infer.
 */
function snapshotJsonData(
  value: unknown,
  path: string,
  issues: CaptureIssue[],
  ancestors: WeakSet<object>,
): unknown | typeof INVALID_JSON_DATA {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) {
      // JSON has one numeric zero. Treat IEEE-754 negative zero as the same
      // canonical value explicitly instead of letting JSON.stringify change it
      // invisibly after validation.
      return Object.is(value, -0) ? 0 : value;
    }
    add(
      issues,
      'non-json-capture-value',
      path || '/',
      'Capture numbers must be finite JSON numbers.',
    );
    return value;
  }
  if (typeof value !== 'object') {
    add(
      issues,
      'non-json-capture-value',
      path || '/',
      'Capture values must be JSON data; undefined, bigint, symbols and functions are refused.',
    );
    return value;
  }

  if (ancestors.has(value)) {
    add(
      issues,
      'circular-capture-value',
      path || '/',
      'Capture data must not contain circular references.',
    );
    // Null is an inert placeholder that lets schema validation add its more
    // specific field issue while the circular-data issue still blocks export.
    return null;
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      let arrayShapeInvalid = false;
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        add(
          issues,
          'non-json-capture-array',
          path || '/',
          'Capture arrays must use the ordinary Array prototype.',
        );
        arrayShapeInvalid = true;
      }

      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
      const length = lengthDescriptor && 'value' in lengthDescriptor ? lengthDescriptor.value : null;
      if (!Number.isSafeInteger(length) || length < 0) {
        add(issues, 'non-json-capture-array', path || '/', 'Capture array length is invalid.');
        return INVALID_JSON_DATA;
      }

      const keys = Reflect.ownKeys(value);
      const indexKeys = new Set<string>();
      const elementValues = new Map<number, unknown>();
      for (const key of keys) {
        if (key === 'length') continue;
        if (typeof key !== 'string') {
          add(
            issues,
            'non-json-capture-property',
            appendJsonPointer(path, '<symbol>'),
            'Symbol properties are not part of JSON capture data.',
          );
          arrayShapeInvalid = true;
          continue;
        }
        const index = Number(key);
        if (!Number.isInteger(index) || index < 0 || index >= length || String(index) !== key) {
          add(
            issues,
            'non-json-capture-property',
            appendJsonPointer(path, key),
            'Capture arrays may carry only their indexed elements.',
          );
          arrayShapeInvalid = true;
          continue;
        }
        indexKeys.add(key);
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
          add(
            issues,
            'non-json-capture-property',
            appendJsonPointer(path, key),
            'Capture array elements must be own enumerable data properties.',
          );
          arrayShapeInvalid = true;
        } else {
          elementValues.set(index, descriptor.value);
        }
      }
      if (indexKeys.size !== length) {
        add(
          issues,
          'non-json-capture-array',
          path || '/',
          'Capture arrays must be dense.',
        );
        arrayShapeInvalid = true;
      }
      // Do not allocate or walk `length` after structural failure. A sparse
      // hostile array can advertise billions of elements while owning almost
      // none; one array-level issue is enough to refuse it.
      if (
        arrayShapeInvalid ||
        indexKeys.size !== length ||
        elementValues.size !== length
      ) {
        return INVALID_JSON_DATA;
      }

      const snapshot = new Array<unknown>(length);
      for (let index = 0; index < length; index += 1) {
        const child = snapshotJsonData(
          elementValues.get(index),
          appendJsonPointer(path, index),
          issues,
          ancestors,
        );
        snapshot[index] = child === INVALID_JSON_DATA ? null : child;
      }
      return snapshot;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      add(
        issues,
        'non-json-capture-object',
        path || '/',
        'Capture objects must use the ordinary Object prototype or a null prototype.',
      );
    }

    const keys = Reflect.ownKeys(value);
    const stringKeys: string[] = [];
    for (const key of keys) {
      if (typeof key === 'string') stringKeys.push(key);
      else {
        add(
          issues,
          'non-json-capture-property',
          appendJsonPointer(path, '<symbol>'),
          'Symbol properties are not part of JSON capture data.',
        );
      }
    }

    // Null-prototype snapshots prevent inherited getters (for example an
    // Object.prototype.model hook) from becoming values for absent optional
    // schema fields during validation or downstream processing.
    const snapshot: Record<string, unknown> = Object.create(null);
    for (const key of stringKeys.sort(compareOrdinal)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
        add(
          issues,
          'non-json-capture-property',
          appendJsonPointer(path, key),
          'Capture fields must be own enumerable data properties.',
        );
        continue;
      }
      const child = snapshotJsonData(
        descriptor.value,
        appendJsonPointer(path, key),
        issues,
        ancestors,
      );
      if (child === INVALID_JSON_DATA) {
        Object.defineProperty(snapshot, key, {
          value: null,
          enumerable: true,
          configurable: true,
          writable: true,
        });
        continue;
      }
      Object.defineProperty(snapshot, key, {
        value: child,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return snapshot;
  } catch {
    add(
      issues,
      'uninspectable-capture-value',
      path || '/',
      'Capture data could not be inspected without invoking caller-controlled behaviour.',
    );
    return INVALID_JSON_DATA;
  } finally {
    ancestors.delete(value);
  }
}

export interface CaptureInspection {
  issues: CaptureIssue[];
  session: CaptureSession | null;
}

export function inspectCaptureSession(value: unknown): CaptureInspection {
  const dataIssues: CaptureIssue[] = [];
  let snapshot: unknown | typeof INVALID_JSON_DATA;
  try {
    snapshot = snapshotJsonData(value, '', dataIssues, new WeakSet<object>());
  } catch {
    dataIssues.push({
      code: 'uninspectable-capture',
      path: '/',
      message: 'Capture data could not be inspected safely.',
    });
    snapshot = INVALID_JSON_DATA;
  }
  if (snapshot === INVALID_JSON_DATA) {
    if (dataIssues.length === 0) {
      dataIssues.push({
        code: 'uninspectable-capture',
        path: '/',
        message: 'Capture data changed while it was being inspected.',
      });
    }
    return { issues: sortCaptureIssues(dataIssues), session: null };
  }

  const issues = sortCaptureIssues([
    ...dataIssues,
    ...validateCaptureSessionSchema(snapshot),
  ]);
  return {
    issues,
    session: issues.length === 0 ? (snapshot as CaptureSession) : null,
  };
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
/** The same ceiling expressed in radians per second. */
const MAX_ANGULAR_RATE_RAD_S = (2_000 * Math.PI) / 180;

/**
 * Absolute bound for each building-frame coordinate component, in metres.
 *
 * Finiteness alone does not make a coordinate measurable. A mark declared at
 * `1e308` passed every check and published a median error of `1e308` metres
 * with a status of `ok`; pair it with an opposite extreme and the subtraction
 * overflows before `Math.hypot` ever runs, so the figure becomes `Infinity`.
 *
 * This is a sanity bound, not a tight plausibility filter. Compiled venues use
 * a local frame measured in tens to hundreds of metres, and the largest
 * building complexes are a few kilometres across, so the axis-aligned
 * -100 km..100 km frame leaves room for an offset origin or an unusually large
 * campus while refusing a coordinate that cannot describe a building.
 * Bounding both operands is also what makes the arithmetic safe by
 * construction: the widest possible separation is 2e5 on either axis, and
 * `Math.hypot(2e5, 2e5)` is nowhere near overflow.
 */
export const MAX_BUILDING_FRAME_COORDINATE_METERS = 100_000;

/**
 * Shortest gap that can separate two distinct inertial samples, in
 * milliseconds — one microsecond.
 *
 * A positive interval had no lower bound, and the summary divides by it. An
 * interval of `5e-324` is a finite, non-negative, strictly increasing timestamp
 * that passes every check and then makes `observedHz` overflow to `Infinity`,
 * which `JSON.stringify` writes as `null` — so the recorded sampling rate of a
 * capture became a hole rather than a number.
 *
 * A microsecond is a megahertz sample rate. Handset inertial sensors run at
 * hundreds of hertz and the fastest MEMS parts are orders of magnitude below
 * this, so the bound refuses only intervals that no clock produced, and caps
 * `observedHz` at 1e6. Samples sharing a timestamp are still allowed: coalesced
 * delivery is real, and a zero interval never reaches the division.
 */
export const MIN_SAMPLE_INTERVAL_MS = 0.001;

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
const SENSOR_APIS = new Set<string>(['devicemotion', 'generic-sensor', 'native', 'synthetic']);
/**
 * The complete schema, level by level.
 *
 * Anything outside these sets is reported rather than dropped. Closing the
 * schema is also what removes the places a BigInt or a circular reference could
 * hide: every surviving field is one the validator already types.
 */
const CAPTURE_ROOT_KEYS = new Set<string>([
  'captureVersion',
  'sessionId',
  'buildingId',
  'packageHash',
  'startedAtIso',
  'device',
  'anchors',
  'events',
]);
const DEVICE_KEYS = new Set<string>([
  'label',
  'platform',
  'model',
  'osVersion',
  'browser',
  'browserVersion',
  'userAgent',
  'appVersion',
  'timezone',
  'sensors',
]);
const SENSOR_KEYS = new Set<string>([
  'accelerometerHz',
  'gyroscopeHz',
  'orientationHz',
  'api',
  'gyroscopeUnits',
  'frame',
]);
const ORIENTATION_KEYS = new Set<string>([
  'alphaDegrees',
  'betaDegrees',
  'gammaDegrees',
  'absolute',
]);
const EVENT_KEYS_BY_TYPE = new Map<string, ReadonlySet<string>>(Object.entries({
  imu: new Set(['type', 'sequence', 'timeMs', 'accelerometer', 'gyroscope', 'orientation']),
  scan: new Set(['type', 'sequence', 'timeMs', 'transport', 'payload', 'outcome', 'anchorId']),
  'ground-truth': new Set([
    'type',
    'sequence',
    'timeMs',
    'checkpointId',
    'position',
    'floorId',
    'surveyMethod',
    'expectedAccuracyMeters',
    'independentOfAnchors',
  ]),
  lifecycle: new Set(['type', 'sequence', 'timeMs', 'event', 'detail']),
}));
const EVENT_REQUIRED_KEYS_BY_TYPE = new Map<
  string,
  { keys: readonly string[]; issueCode: string }
>([
  [
    'imu',
    {
      keys: ['type', 'sequence', 'timeMs', 'accelerometer', 'gyroscope', 'orientation'],
      issueCode: 'malformed-imu-event',
    },
  ],
  [
    'scan',
    {
      keys: ['type', 'sequence', 'timeMs', 'transport', 'payload', 'outcome', 'anchorId'],
      issueCode: 'malformed-scan-event',
    },
  ],
  [
    'ground-truth',
    {
      keys: [
        'type',
        'sequence',
        'timeMs',
        'checkpointId',
        'position',
        'floorId',
        'surveyMethod',
        'expectedAccuracyMeters',
        'independentOfAnchors',
      ],
      issueCode: 'malformed-ground-truth-event',
    },
  ],
  [
    'lifecycle',
    {
      keys: ['type', 'sequence', 'timeMs', 'event'],
      issueCode: 'malformed-lifecycle-event',
    },
  ],
]);

/**
 * Reports every property the schema does not declare, in sorted order so the
 * issue list is identical run to run.
 */
function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  code: string,
  issues: CaptureIssue[],
) {
  const unknown = Object.keys(value)
    .filter((key) => !allowed.has(key))
    .sort(compareOrdinal);
  for (const key of unknown) {
    add(
      issues,
      code,
      appendJsonPointer(path, key),
      `"${key}" is not part of the capture schema.`,
    );
  }
  return unknown.length === 0;
}

/** The complete anchor schema. `spaceId` is deliberately not part of it. */
const CAPTURE_ANCHOR_KEYS = new Set<string>([
  'id',
  'floorId',
  'kind',
  'position',
  'headingDegrees',
  'payload',
]);

/** A coordinate that is finite and inside the building frame. NaN fails both. */
export function isBuildingFrameCoordinate(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Math.abs(value) <= MAX_BUILDING_FRAME_COORDINATE_METERS
  );
}

function isBuildingFramePosition(value: unknown): value is [number, number] {
  if (!isPlainArray(value, 2)) return false;
  return isBuildingFrameCoordinate(value[0]) && isBuildingFrameCoordinate(value[1]);
}

/**
 * Membership without coercion.
 *
 * `SET.has(String(value))` accepted `['backgrounded']`, because an array of one
 * string stringifies to that string. Validation passed, and every consumer then
 * compared the real value with strict equality and saw no match — so an
 * interruption declared as an array simply disappeared and the walk published.
 */
function isMemberOf(value: unknown, allowed: ReadonlySet<string>): value is string {
  return typeof value === 'string' && allowed.has(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * A string field within its own declared limit.
 *
 * The type check is what refuses objects, arrays, and BigInt in fields the
 * schema declares as scalar; a nested object here is how media payloads have
 * previously travelled inside an otherwise ordinary-looking capture.
 */
function boundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

/**
 * Per-field limits, named individually rather than sharing one opaque number.
 *
 * The sizes differ because the fields do: a user agent is a long vendor string,
 * a platform name is a word, and an IANA timezone has a known upper bound.
 */
const REQUIRED_DEVICE_FIELD_LIMITS: Record<string, number> = {
  /** Human label for the handset, chosen by whoever ran the walk. */
  label: 120,
  /** Operating system family, such as android or ios. */
  platform: 60,
};

const OPTIONAL_DEVICE_FIELD_LIMITS: Record<string, number> = {
  /** Marketing model name, such as Pixel 8. */
  model: 120,
  osVersion: 60,
  browser: 60,
  browserVersion: 60,
  /** Vendor UA strings are long; this is the one field that needs room. */
  userAgent: 512,
  appVersion: 60,
  /** Longest IANA zone names sit well inside this. */
  timezone: 64,
};

/** Free text attached to a lifecycle event, such as why the app backgrounded. */
const LIFECYCLE_DETAIL_MAX_LENGTH = 256;

function optionalOf(value: unknown, check: (candidate: unknown) => boolean) {
  return value === undefined || check(value);
}

function add(issues: CaptureIssue[], code: string, path: string, message: string) {
  issues.push({ code, path, message });
}

function validateEvent(
  event: unknown,
  index: number,
  issues: CaptureIssue[],
  gyroscopeUnits: AngularRateUnits | null,
) {
  const path = `/events/${index}`;
  if (!isRecord(event)) {
    add(issues, 'malformed-event', path, 'Every capture event must be an object.');
    return false;
  }

  if (!requireOwnKeys(event, ['type', 'sequence', 'timeMs'], path, 'malformed-event', issues)) {
    return false;
  }
  // A Map lookup, not a property read. Indexing a plain object with a type of
  // "constructor" or "__proto__" returned an inherited value and threw.
  const allowedKeys =
    typeof event.type === 'string' ? EVENT_KEYS_BY_TYPE.get(event.type) : undefined;
  const required =
    typeof event.type === 'string' ? EVENT_REQUIRED_KEYS_BY_TYPE.get(event.type) : undefined;
  if (!allowedKeys || !required) {
    add(issues, 'unknown-event-type', path, 'Unsupported event type.');
    return false;
  }
  if (!requireOwnKeys(event, required.keys, path, required.issueCode, issues)) return false;
  if (!rejectUnknownKeys(event, allowedKeys, path, 'unknown-event-property', issues)) return false;

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
    const acceleration = event.accelerometer as Vector3;
    const magnitude = Math.hypot(acceleration[0], acceleration[1], acceleration[2]);
    if (!Number.isFinite(magnitude) || magnitude > MAX_ACCELERATION_MAGNITUDE_M_S2) {
      add(
        issues,
        'implausible-imu-event',
        `${path}/accelerometer`,
        'Acceleration must reduce to a finite magnitude within handset limits.',
      );
      return false;
    }
    // The same physical limit, expressed in whichever units the capture
    // declares. Applying the degree bound to radians would let a rate roughly
    // fifty-seven times too large through.
    const angularLimit =
      gyroscopeUnits === 'rad/s' ? MAX_ANGULAR_RATE_RAD_S : MAX_ANGULAR_RATE_DEG_S;
    if (
      gyroscopeUnits !== null &&
      (() => {
        const gyroscope = event.gyroscope as Vector3;
        for (let axis = 0; axis < 3; axis += 1) {
          if (!Number.isFinite(gyroscope[axis]) || Math.abs(gyroscope[axis]) > angularLimit) {
            return true;
          }
        }
        return false;
      })()
    ) {
      add(
        issues,
        'implausible-imu-event',
        `${path}/gyroscope`,
        `Angular rate must be finite and within ${angularLimit} ${gyroscopeUnits}.`,
      );
      return false;
    }
    // Presence is required, not merely validity. An imported event with no
    // orientation key is indistinguishable from one whose orientation was lost
    // in transit, and silently reading it as null would invent the claim that
    // the device reported no orientation.
    if (!hasOwnEnumerableDataProperty(event, 'orientation')) {
      add(
        issues,
        'malformed-imu-event',
        `${path}/orientation`,
        'Inertial events must state orientation explicitly as null or an orientation object.',
      );
      return false;
    }
    if (event.orientation !== null) {
      const orientation = event.orientation;
      if (isRecord(orientation)) {
        rejectUnknownKeys(
          orientation,
          ORIENTATION_KEYS,
          `${path}/orientation`,
          'unknown-event-property',
          issues,
        );
        requireOwnKeys(
          orientation,
          ['alphaDegrees', 'betaDegrees', 'gammaDegrees', 'absolute'],
          `${path}/orientation`,
          'malformed-imu-event',
          issues,
        );
      }
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
    if (!isMemberOf(event.outcome, SCAN_OUTCOMES)) {
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
    if (!isBuildingFramePosition(event.position)) {
      add(
        issues,
        'malformed-ground-truth-event',
        `${path}/position`,
        `Each position component must be between -${MAX_BUILDING_FRAME_COORDINATE_METERS} and ${MAX_BUILDING_FRAME_COORDINATE_METERS} m.`,
      );
      ok = false;
    }
    if (!nonEmptyString(event.floorId)) {
      add(issues, 'malformed-ground-truth-event', `${path}/floorId`, 'Floor id is required.');
      ok = false;
    }
    if (!isMemberOf(event.surveyMethod, SURVEY_METHODS)) {
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
    if (!isMemberOf(event.event, LIFECYCLE_EVENTS)) {
      add(issues, 'malformed-lifecycle-event', `${path}/event`, 'Unknown lifecycle event.');
      return false;
    }
    if (event.detail !== undefined && !boundedString(event.detail, LIFECYCLE_DETAIL_MAX_LENGTH)) {
      add(
        issues,
        'malformed-lifecycle-event',
        `${path}/detail`,
        `Lifecycle detail must be a string of 1 to ${LIFECYCLE_DETAIL_MAX_LENGTH} characters when present.`,
      );
      return false;
    }
    return true;
  }

  return false;
}

function validateDevice(device: unknown, issues: CaptureIssue[]) {
  if (!isRecord(device)) {
    add(issues, 'malformed-device', '/device', 'Capture must record the device it came from.');
    return;
  }
  rejectUnknownKeys(device, DEVICE_KEYS, '/device', 'unknown-device-property', issues);
  requireOwnKeys(device, ['label', 'platform', 'sensors'], '/device', 'malformed-device', issues);
  for (const [field, limit] of Object.entries(REQUIRED_DEVICE_FIELD_LIMITS)) {
    if (!boundedString(device[field], limit)) {
      add(
        issues,
        'malformed-device',
        `/device/${field}`,
        `Device ${field} is required and must be a string of 1 to ${limit} characters.`,
      );
    }
  }
  for (const [field, limit] of Object.entries(OPTIONAL_DEVICE_FIELD_LIMITS)) {
    if (device[field] !== undefined && !boundedString(device[field], limit)) {
      add(
        issues,
        'malformed-device',
        `/device/${field}`,
        `Device ${field} must be a string of 1 to ${limit} characters when present.`,
      );
    }
  }
  if (!isRecord(device.sensors)) {
    add(issues, 'malformed-device', '/device/sensors', 'Sensor profile is required.');
    return;
  }
  const sensors = device.sensors;
  rejectUnknownKeys(sensors, SENSOR_KEYS, '/device/sensors', 'unknown-device-property', issues);
  requireOwnKeys(
    sensors,
    ['api', 'gyroscopeUnits', 'frame'],
    '/device/sensors',
    'malformed-sensor-profile',
    issues,
  );
  const finiteOrAbsent = (value: unknown) => Number.isFinite(value) && Number(value) > 0;
  for (const key of ['accelerometerHz', 'gyroscopeHz', 'orientationHz']) {
    if (!optionalOf(sensors[key], finiteOrAbsent)) {
      add(issues, 'malformed-sensor-profile', `/device/sensors/${key}`, 'Declared rate must be positive.');
    }
  }
  // API, units, and frame are required, not optional. DeviceMotion and the
  // Generic Sensor API disagree on angular-rate units and axis conventions, so
  // a stream that omits them cannot be interpreted after the fact.
  if (!isMemberOf(sensors.api, SENSOR_APIS)) {
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
  if (!isPlainArray(anchors)) {
    add(
      issues,
      'malformed-anchors',
      '/anchors',
      'Anchors must be a dense array carrying nothing but anchors.',
    );
    return [];
  }
  const valid: CheckpointAnchor[] = [];
  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index];
    const path = `/anchors/${index}`;
    if (!isRecord(anchor)) {
      add(issues, 'malformed-anchor', path, 'Each anchor must be an object.');
      continue;
    }
    let ok = true;
    // Unknown properties are refused rather than dropped. Export validates
    // first, so a session that gained a field after authorship fails loudly
    // instead of being quietly sanitised into something that looks authored.
    // Every undeclared key, sorted, so diagnostics do not depend on the order
    // the object happened to be built in.
    if (!rejectUnknownKeys(anchor, CAPTURE_ANCHOR_KEYS, path, 'unknown-anchor-property', issues)) {
      ok = false;
    }
    if (
      !requireOwnKeys(
        anchor,
        ['id', 'floorId', 'kind', 'position', 'headingDegrees', 'payload'],
        path,
        'malformed-anchor',
        issues,
      )
    ) {
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
    if (!isMemberOf(anchor.kind, ANCHOR_KINDS)) {
      add(issues, 'malformed-anchor', `${path}/kind`, 'Unknown anchor kind.');
      ok = false;
    }
    if (!isBuildingFramePosition(anchor.position)) {
      add(
        issues,
        'malformed-anchor',
        `${path}/position`,
        `Each anchor position component must be between -${MAX_BUILDING_FRAME_COORDINATE_METERS} and ${MAX_BUILDING_FRAME_COORDINATE_METERS} m.`,
      );
      ok = false;
    }
    const heading = anchor.headingDegrees;
    if (!Number.isFinite(heading) || Number(heading) < 0 || Number(heading) >= 360) {
      add(issues, 'malformed-anchor', `${path}/headingDegrees`, 'Anchor heading must be in [0, 360).');
      ok = false;
    }
    if (ok) valid.push(anchor as unknown as CheckpointAnchor);
  }
  return valid;
}

/**
 * Checks a session is internally consistent and methodologically sound.
 *
 * The independence rule is the one that changes a number rather than a
 * behaviour: a ground-truth mark claiming independence while sitting on the
 * anchor that just reset the estimate would report the reset as accuracy.
 */
function validateCaptureSessionSchema(value: unknown): CaptureIssue[] {
  const issues: CaptureIssue[] = [];

  if (!isRecord(value)) {
    return [{ code: 'malformed-capture', path: '/', message: 'Capture must be an object.' }];
  }
  requireOwnKeys(
    value,
    [
      'captureVersion',
      'sessionId',
      'buildingId',
      'packageHash',
      'startedAtIso',
      'device',
      'anchors',
      'events',
    ],
    '',
    'malformed-capture',
    issues,
  );
  for (const key of ['sessionId', 'buildingId', 'packageHash']) {
    if (!nonEmptyString(value[key])) {
      add(issues, 'malformed-capture', `/${key}`, `${key} is required.`);
    }
  }
  rejectUnknownKeys(value, CAPTURE_ROOT_KEYS, '', 'unknown-capture-property', issues);
  validateDevice(value.device, issues);
  // Only anchors that passed structural validation are used below. Reading the
  // raw array would crash on a null anchor set or a null entry.
  const validAnchors = validateAnchors(value.anchors, issues);
  if (!isPlainArray(value.events)) {
    add(
      issues,
      'malformed-capture',
      '/events',
      'Events must be a dense array carrying nothing but events.',
    );
    return sortCaptureIssues(issues);
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
  // Gyro plausibility depends on the units the capture declares. When the
  // profile is unusable the device errors already fire, so the magnitude check
  // is skipped rather than applied against a guess.
  const declaredUnits: AngularRateUnits | null = isRecord(value.device)
    && isRecord((value.device as Record<string, unknown>).sensors)
    && (((value.device as Record<string, unknown>).sensors as Record<string, unknown>)
      .gyroscopeUnits === 'deg/s'
      || ((value.device as Record<string, unknown>).sensors as Record<string, unknown>)
        .gyroscopeUnits === 'rad/s')
    ? (((value.device as Record<string, unknown>).sensors as Record<string, unknown>)
        .gyroscopeUnits as AngularRateUnits)
    : null;

  const wellFormed: Array<{ event: CaptureEvent; index: number }> = [];
  for (let index = 0; index < session.events.length; index += 1) {
    const event = session.events[index];
    if (validateEvent(event, index, issues, declaredUnits)) {
      wellFormed.push({ event: event as CaptureEvent, index });
    }
  }

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

  // Everything above validates *stored* order, which `buildSession` produces by
  // sorting on time. Sorting is what erases a regressing clock: a sample that
  // arrived late carrying an earlier timestamp is simply moved earlier in the
  // array, and the result reads as a flawless chronology.
  //
  // Samples, scans and lifecycle events are all stamped by the device clock at
  // the moment they are recorded, so their capture order is their clock order.
  // A later-captured event carrying an earlier time means the clock went
  // backwards. Only ground-truth marks are exempt: a floor mark is
  // hand-annotated and often noted a moment after it was stood on, which is the
  // legitimate divergence the stored-order rules above already allow for.
  //
  // Scans and lifecycle events matter as much as samples. A scan backdated
  // before a mark it was actually recorded after validated cleanly, sorted
  // ahead of that mark, and moved the anchor reset the mark was scored against.
  const clockStamped = wellFormed
    .filter(({ event }) => event.type !== 'ground-truth')
    .sort((left, right) => left.event.sequence - right.event.sequence);

  for (let position = 1; position < clockStamped.length; position += 1) {
    const previous = clockStamped[position - 1].event;
    const current = clockStamped[position];
    if (current.event.timeMs < previous.timeMs) {
      issues.push({
        code: 'regressing-capture-clock',
        path: `/events/${current.index}/timeMs`,
        message: `Event ${current.event.sequence} was captured after event ${previous.sequence} but carries an earlier time, so the device clock went backwards.`,
      });
    }
  }

  // Distinct samples must be far enough apart to be two samples. The summary
  // divides by the interval, so an interval below the clock's own resolution
  // produces a sampling rate no device could have observed.
  const inertialByTime = wellFormed
    .filter(({ event }) => event.type === 'imu')
    .sort((left, right) => left.event.timeMs - right.event.timeMs);

  for (let position = 1; position < inertialByTime.length; position += 1) {
    const interval = inertialByTime[position].event.timeMs - inertialByTime[position - 1].event.timeMs;
    if (interval > 0 && interval < MIN_SAMPLE_INTERVAL_MS) {
      issues.push({
        code: 'unresolvable-sample-interval',
        path: `/events/${inertialByTime[position].index}/timeMs`,
        message: `Inertial samples must share a timestamp or differ by at least ${MIN_SAMPLE_INTERVAL_MS} ms.`,
      });
    }
  }

  // Uniqueness alone let events be removed. Deleting the `backgrounded` event
  // from a walk left a hole in the sequence that nothing objected to, and the
  // capture went from `interrupted-capture` to a publishable `ok` — evidence
  // suppressed by deletion rather than by argument. Requiring the sequences to
  // be exactly 0..n-1 makes the stream assert its own completeness.
  //
  // Skipped when an event is malformed: those are already reported, and their
  // absence from `wellFormed` would raise a second, misleading complaint.
  if (wellFormed.length === session.events.length) {
    const sequences = wellFormed.map(({ event }) => event.sequence).sort((a, b) => a - b);
    for (let position = 0; position < sequences.length; position += 1) {
      if (sequences[position] !== position) {
        issues.push({
          code: 'non-contiguous-event-sequence',
          path: '/events',
          message: `Capture sequences must run 0..${sequences.length - 1} with nothing missing; found a gap at ${position}.`,
        });
        break;
      }
    }
  }

  // A session has one beginning and at most one end, and nothing happens after
  // the end. Duplicate starts, several ends, and samples recorded after
  // `session-end` all validated, and events past the end still reached
  // evaluation.
  const lifecycleEvents = wellFormed.filter(
    (entry): entry is { event: LifecycleCaptureEvent; index: number } =>
      entry.event.type === 'lifecycle',
  );
  const starts = lifecycleEvents.filter(({ event }) => event.event === 'session-start');
  const ends = lifecycleEvents.filter(({ event }) => event.event === 'session-end');

  if (starts.length !== 1) {
    issues.push({
      code: 'invalid-session-boundary',
      path: '/events',
      message: `A capture must record exactly one session-start; found ${starts.length}.`,
    });
  } else if (starts[0].event.sequence !== 0 || starts[0].event.timeMs !== 0) {
    issues.push({
      code: 'invalid-session-boundary',
      path: `/events/${starts[0].index}`,
      message: 'session-start must be the first event captured, at time zero.',
    });
  }

  if (ends.length > 1) {
    issues.push({
      code: 'invalid-session-boundary',
      path: '/events',
      message: `A capture may record at most one session-end; found ${ends.length}.`,
    });
  } else if (ends.length === 1) {
    const end = ends[0].event;
    const after = wellFormed.filter(
      ({ event }) => event.sequence > end.sequence || event.timeMs > end.timeMs,
    );
    if (after.length > 0) {
      issues.push({
        code: 'invalid-session-boundary',
        path: `/events/${after[0].index}`,
        message: 'session-end must be the last event captured, and nothing may be timed after it.',
      });
    }
  }

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

  return sortCaptureIssues(issues);
}

/**
 * Validates unknown input without ever trusting caller-owned accessors,
 * prototypes, iterators or methods. Schema checks run against the inert snapshot
 * that export will use, so accepted input cannot change shape at the boundary.
 */
export function validateCaptureSession(value: unknown): CaptureIssue[] {
  return inspectCaptureSession(value).issues;
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
    // Validation refuses a sub-resolution interval, but this is exported and
    // runs on unvalidated sessions too. 0 already means "not determinable"
    // here, which is the honest answer for a rate no clock could produce.
    observedHz:
      medianIntervalMs >= MIN_SAMPLE_INTERVAL_MS
        ? Number((1_000 / medianIntervalMs).toFixed(3))
        : 0,
    gaps,
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    const result = new Array<unknown>(value.length);
    for (let index = 0; index < value.length; index += 1) {
      result[index] = canonicalize(value[index]);
    }
    // JSON.stringify consults inherited `toJSON`. A polluted Array prototype
    // must not be able to replace the validated event stream at write time.
    Object.setPrototypeOf(result, null);
    return result;
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = Object.create(null);
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => compareOrdinal(left, right));
    for (const [key, entry] of entries) result[key] = canonicalize(entry);
    return result;
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
  const inspection = inspectCaptureSession(session);
  if (inspection.issues.length > 0 || inspection.session === null) {
    throw new CaptureExportError(inspection.issues);
  }
  try {
    return serializeCaptureSession(inspection.session);
  } catch {
    // The closed schema should already have refused anything unserialisable.
    // This converts whatever slipped through into the same typed failure rather
    // than letting a raw TypeError escape from a serialiser.
    throw new CaptureExportError([
      {
        code: 'unserializable-capture',
        path: '/',
        // Never format a caller-controlled thrown value here: its toString can
        // itself throw and escape the typed boundary.
        message: 'Capture could not be serialised after validation.',
      },
    ]);
  }
}

/**
 * Canonical bytes: keys sorted at every level, events in stream order.
 *
 * No projection happens here. Silently removing an undeclared property would
 * write a file that looks authored but is not what the caller handed over, so
 * validation refuses it before serialisation is reached.
 */
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
  const inspection = inspectCaptureSession(parsed);
  return {
    valid: inspection.issues.length === 0,
    session: inspection.session,
    issues: inspection.issues,
  };
}
