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
  private readonly sessionId: string;
  private readonly buildingId: string;
  private readonly packageHash: string;
  private readonly startedAtIso: string;
  private readonly device: CaptureDeviceProfile;
  private readonly anchors: CaptureAnchorSnapshot[];
  private readonly events: CaptureEvent[] = [];
  private sequence = 0;

  /**
   * Everything the session claims about itself is copied out of `options` here
   * and never read from it again.
   *
   * Holding the options object meant `buildSession` read the caller's live
   * fields on every call. Reaching through that reference after the walk turned
   * a capture refused as `unsupported-sensor-model` into a publishable `ok` by
   * rewriting the declared sensor frame, and rewrote `packageHash` so the same
   * recording claimed a different venue.
   */
  constructor(options: SessionRecorderOptions) {
    this.sessionId = ownRequired<string>(options, 'sessionId');
    this.buildingId = ownRequired<string>(options, 'buildingId');
    this.packageHash = ownRequired<string>(options, 'packageHash');
    this.startedAtIso = ownRequired<string>(options, 'startedAtIso');
    this.device = captureDeviceSnapshot(ownRequired<CaptureDeviceProfile>(options, 'device'));
    // Anchors are normalised once, here, rather than at build time. A caller
    // may hand over anchors straight from a compiled VenuePackage, which carry
    // fields the capture schema does not define; the snapshot is what this
    // session resolves against and what it later serialises, so a later edit to
    // the caller's own anchor objects cannot change either.
    this.anchors = ownDenseArray<CheckpointAnchor>(options, 'anchors').map(captureAnchorSnapshot);
    this.recordLifecycle('session-start', 0);
  }

  get eventCount() {
    return this.events.length;
  }

  private nextSequence() {
    return this.sequence++;
  }

  recordImu(reading: ImuReading) {
    const timeMs = ownRequired<number>(reading, 'timeMs');
    const accelerometer = ownNumberTuple(reading, 'accelerometer', 3) as Vector3;
    const gyroscope = ownNumberTuple(reading, 'gyroscope', 3) as Vector3;
    // Snapshotted before a sequence is allocated: a refused orientation that
    // had already taken one left the recorder permanently non-contiguous.
    const orientation = ownDeclaredOrientation(reading);

    this.events.push({
      type: 'imu',
      sequence: this.nextSequence(),
      timeMs,
      accelerometer,
      gyroscope,
      orientation,
    });
  }

  /**
   * Records an acquisition attempt. Resolution against the anchor set happens
   * here so the stored outcome reflects what the device actually knew at the
   * time, including refusals.
   */
  recordScan(attempt: ScanAttempt) {
    // Read once, then resolve and store the same values. Reading `payload`
    // separately for the null check, the resolution and the stored event let a
    // repeating getter resolve one payload and record another, so the stored
    // outcome described a scan that was never stored.
    const timeMs = ownRequired<number>(attempt, 'timeMs');
    const transport = ownRequired<ScanAttempt['transport']>(attempt, 'transport');
    const payload = ownRequired<string | null>(attempt, 'payload');
    const failure = ownDeclaredFailure(attempt);

    // Nothing was acquired, so nothing can have been read. Validation already
    // refuses this pairing in a stored stream; refusing it here names the
    // conflict at the call that made it, rather than at the end of a walk.
    if (failure !== undefined && payload !== null) {
      throw new CaptureAuthoringError(
        'failure',
        `A scan reporting ${failure} cannot also carry a payload it read.`,
      );
    }

    let outcome: ScanOutcome = failure ?? 'decode-failed';
    let anchorId: string | null = null;

    if (!failure && payload !== null) {
      const adapter = new CheckpointAdapter(this.anchors);
      const resolution = adapter.resolve({ timeMs, kind: transport, payload });
      outcome = resolution.accepted ? 'resolved' : resolution.reason;
      anchorId = resolution.anchorId;
    }

    const event: ScanCaptureEvent = {
      type: 'scan',
      sequence: this.nextSequence(),
      timeMs,
      transport,
      payload,
      outcome,
      anchorId,
    };
    this.events.push(event);
    // The caller gets its own copy. Handing back the stored object let a scan
    // outcome be rewritten after the fact.
    return captureEventSnapshot(event) as ScanCaptureEvent;
  }

  recordGroundTruth(mark: GroundTruthMark) {
    // Every field is snapshotted before a sequence is allocated. Taking the
    // sequence first meant a refused mark still consumed one, leaving the
    // recorder permanently unable to produce a contiguous stream: the next
    // capture validated as non-contiguous and could never be evidence again.
    const position = ownNumberTuple(mark, 'position', 2) as [number, number];
    const timeMs = ownRequired<number>(mark, 'timeMs');
    const checkpointId = ownRequired<string>(mark, 'checkpointId');
    const floorId = ownRequired<string>(mark, 'floorId');
    const surveyMethod = ownRequired<SurveyMethod>(mark, 'surveyMethod');
    const expectedAccuracyMeters = ownRequired<number>(mark, 'expectedAccuracyMeters');
    const independentOfAnchors = ownRequired<boolean>(mark, 'independentOfAnchors');

    const event: GroundTruthCaptureEvent = {
      type: 'ground-truth',
      sequence: this.nextSequence(),
      timeMs,
      checkpointId,
      position,
      floorId,
      surveyMethod,
      expectedAccuracyMeters,
      independentOfAnchors,
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
      sessionId: this.sessionId,
      buildingId: this.buildingId,
      packageHash: this.packageHash,
      startedAtIso: this.startedAtIso,
      device: captureDeviceSnapshot(this.device),
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
 * A dense array of plain own elements, copied by descriptor.
 *
 * Spreading and `Array.from` both go through the caller's iterator, so an
 * object whose `Symbol.iterator` disagrees with its indices stored values the
 * caller never held: indices `[1, 2, 3]` were recorded as `[99, 98, 97]`.
 * Reading by index fixed that but left the elements themselves unchecked, so an
 * accessor-backed element was still laundered into a valid anchor and moved a
 * published median from 3.688 m to 18.688 m.
 *
 * This mirrors the schema's own dense-array rule at the authoring boundary: a
 * real array, no holes, no named properties, and every element a plain own
 * value.
 */
function ownDenseArray<T>(source: object, key: string, field = key): T[] {
  const values = ownRequired<unknown>(source, key, field);
  const length = ownArrayLength(values, field);
  const keys = Reflect.ownKeys(values as object);
  if (keys.length !== length + 1 || !listContains(keys, 'length')) {
    throw new CaptureAuthoringError(
      field,
      `${field} must be dense and carry nothing but its elements.`,
    );
  }
  const copy: T[] = [];
  for (let index = 0; index < length; index += 1) {
    copy.push(ownRequired<T>(values as object, String(index), `${field}[${index}]`));
  }
  return copy;
}

/**
 * The length of an array, taken once from its own descriptor.
 *
 * `values.length` is a property read, and a Proxy answers each one however it
 * likes. Reading it to check the shape and again to drive the copy let a
 * collection present its true length for validation and a shorter one for
 * copying: two anchors sharing a payload — an ambiguity that refuses to resolve
 * — became one anchor that resolves cleanly, turning
 * `insufficient-localization` into a publishable `ok` at 3.188 m. One read,
 * used for everything after it.
 */
function ownArrayLength(values: unknown, field: string): number {
  if (
    values === null ||
    typeof values !== 'object' ||
    !Array.isArray(values) ||
    Object.getPrototypeOf(values) !== Array.prototype
  ) {
    throw new CaptureAuthoringError(field, `${field} must be a plain array.`);
  }
  const descriptor = Object.getOwnPropertyDescriptor(values, 'length');
  if (descriptor === undefined || !('value' in descriptor)) {
    throw new CaptureAuthoringError(field, `${field} must carry a plain length.`);
  }
  const length = descriptor.value;
  if (typeof length !== 'number' || !Number.isInteger(length) || length < 0) {
    throw new CaptureAuthoringError(field, `${field} must carry a non-negative integer length.`);
  }
  return length;
}

function vector3Once(values: Vector3): Vector3 {
  return [values[0], values[1], values[2]];
}

function tuple2Once(values: readonly [number, number]): [number, number] {
  return [values[0], values[1]];
}

/**
 * An optional field: absent, or a plain own value. Never anything else.
 *
 * Optional fields were first copied by plain property access, which also reads
 * the prototype chain, so a prototype getter injected `device.model` and a
 * lifecycle `detail` into a recorded session. Treating those as absent fixed
 * the injection but introduced the mirror-image bug: a scan declaring
 * `permission-denied` through an own getter had its `failure` silently
 * discarded, resolved against the anchors instead, and published `ok` at 2 m
 * from a reset the device had reported it never made.
 *
 * Absent and malformed are therefore different answers. Nothing at all is a
 * legitimate omission; something present that is inherited, hidden, or computed
 * is a field the caller meant to supply and the capture will not carry.
 */
function ownOptional<T>(source: object, key: string, field = key): T | undefined {
  if (source === null || typeof source !== 'object') {
    throw new CaptureAuthoringError(field, `Cannot author ${field} from a non-object.`);
  }
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  if (descriptor !== undefined) {
    if (!descriptor.enumerable || !('value' in descriptor)) {
      throw new CaptureAuthoringError(
        field,
        `${field} is present but hidden or computed; supply it as a plain value or omit it.`,
      );
    }
    return descriptor.value as T;
  }
  if (inheritedFromCaller(source, key)) {
    throw new CaptureAuthoringError(
      field,
      `${field} is inherited rather than owned; supply it as a plain value or omit it.`,
    );
  }
  return undefined;
}

/**
 * Whether the caller's own prototype chain supplies a field, ignoring the
 * ambient builtin prototypes at the end of it.
 *
 * `key in source` was the obvious check and it makes the recorder hostage to
 * `Object.prototype` pollution: a page that sets `Object.prototype.failure`
 * makes every honest scan look like it inherited one, and authoring refuses
 * every capture. That fails closed rather than publishing anything false, but a
 * recorder that cannot record is still broken, and the pollution says nothing
 * about what this caller supplied.
 *
 * The chain is therefore walked explicitly and stopped at the builtins, which
 * belong to the realm rather than to the caller.
 */
function inheritedFromCaller(source: object, key: string) {
  let prototype = Object.getPrototypeOf(source);
  while (prototype !== null && prototype !== Object.prototype && prototype !== Array.prototype) {
    if (Object.getOwnPropertyDescriptor(prototype, key) !== undefined) return true;
    prototype = Object.getPrototypeOf(prototype);
  }
  return false;
}

/** The acquisition failures a caller may declare. Nothing else is one. */
const DECLARABLE_SCAN_FAILURES: readonly string[] = [
  'decode-failed',
  'permission-denied',
  'transport-unavailable',
];

/**
 * An optional field checked against its own domain rather than its truthiness.
 *
 * `failure ?? 'decode-failed'` and `orientation ? … : null` both treat a
 * malformed value as an absent one. `failure: false`, `0`, `''` or `null` each
 * produced a valid resolved scan naming an anchor, so a declared acquisition
 * failure published `ok`; and `orientation: false`, `0` or `''` each became a
 * valid `orientation: null`, quietly discarding a sample the caller believed
 * carried orientation.
 */
function ownDeclaredFailure(attempt: object): ScanAttempt['failure'] | undefined {
  const failure = ownOptional<unknown>(attempt, 'failure');
  if (failure === undefined) return undefined;
  if (typeof failure !== 'string' || !listContains(DECLARABLE_SCAN_FAILURES, failure)) {
    throw new CaptureAuthoringError(
      'failure',
      `failure must be one of ${DECLARABLE_SCAN_FAILURES.join(', ')} when present.`,
    );
  }
  return failure as ScanAttempt['failure'];
}

function ownDeclaredOrientation(reading: object): DeviceOrientationSample | null {
  const orientation = ownOptional<unknown>(reading, 'orientation');
  if (orientation === undefined || orientation === null) return null;
  if (typeof orientation !== 'object') {
    throw new CaptureAuthoringError(
      'orientation',
      'orientation must be an object, null, or omitted.',
    );
  }
  return orientationSnapshot(orientation as DeviceOrientationSample);
}

/**
 * Raised when a recorder is handed something it will not author from.
 *
 * Refusing is the whole point. Degrading instead was itself a bypass: a scan
 * payload supplied as an accessor became a valid `decode-failed` with no
 * payload, which silently suppressed a genuine anchor reset and moved a
 * published figure from 1.288 m to 2.449 m while still reporting `ok`.
 */
export class CaptureAuthoringError extends Error {
  constructor(readonly field: string, message: string) {
    super(message);
    this.name = 'CaptureAuthoringError';
  }
}

/**
 * A required authoring input, which must be a plain own value.
 *
 * The own-data rule initially covered only optional fields, which left the
 * fields that matter most reachable from a prototype: an inherited
 * `packageHash` claimed a different venue, an inherited `label` and `platform`
 * described a different handset, and an inherited `payload` resolved a scan the
 * caller never presented. All of it persisted as evidence and validated
 * cleanly.
 *
 * Anything that is not an own, enumerable data property is refused here rather
 * than recorded as absent. A capture must not be able to launder input the
 * schema would have rejected into a stream that validates.
 */
function ownRequired<T>(source: object, key: string, field = key): T {
  if (source === null || typeof source !== 'object') {
    throw new CaptureAuthoringError(field, `Cannot author ${field} from a non-object.`);
  }
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
    throw new CaptureAuthoringError(
      field,
      `${field} must be supplied as an own enumerable value, not inherited, hidden, or computed.`,
    );
  }
  return descriptor.value as T;
}

/**
 * A fixed-length tuple of plain own numbers.
 *
 * The own-data rule stopped at the property holding the array, so its elements
 * were still read as ordinary indices. An object with accessor indices — one
 * the schema's own `isPlainArray` check would have rejected outright — was
 * copied element by element into a real array and became a valid capture,
 * moving a published median from 3.688 m to 22.688 m.
 *
 * The property itself is also read exactly once, through `ownRequired`. Reading
 * `mark.position` twice to take its two components let a getter returning a
 * different array each time produce a coordinate that existed in neither:
 * `[1, 9]` and `[500, 500]` stored as `[1, 500]`, which validated cleanly
 * because a mixed pair is still two finite in-frame numbers.
 */
function ownNumberTuple(source: object, key: string, length: number, field = key): number[] {
  const values = ownRequired<unknown>(source, key, field);
  if (ownArrayLength(values, field) !== length) {
    throw new CaptureAuthoringError(
      field,
      `${field} must be a plain array of ${length} numbers.`,
    );
  }
  requireExactKeys(values as object, tupleKeys(length), field);
  const copy: number[] = [];
  for (let index = 0; index < length; index += 1) {
    copy.push(ownRequired<number>(values as object, String(index), `${field}[${index}]`));
  }
  return copy;
}

/**
 * `['0', … , String(length - 1), 'length']`, built by indexed assignment.
 *
 * The allowed-key list is part of the check rather than part of the data, so it
 * is assembled without calling anything: `push` is an intrinsic like any other,
 * and the surrounding trust boundary puts intrinsics inside it, but a control
 * list is cheap to build from nothing at all.
 */
function tupleKeys(length: number): string[] {
  const keys = new Array<string>(length + 1);
  for (let index = 0; index < length; index += 1) keys[index] = String(index);
  keys[length] = 'length';
  return keys;
}

/** Membership by index. `includes` and `Set.has` are both replaceable methods. */
function listContains(list: readonly (string | symbol)[], value: string | symbol) {
  for (let index = 0; index < list.length; index += 1) {
    if (list[index] === value) return true;
  }
  return false;
}

/**
 * Refuses an authored object that carries anything the schema does not define.
 *
 * The rest of the capture schema is closed — unknown properties are reported
 * rather than dropped — but the authoring snapshots read only the fields they
 * knew about, so a tuple or an orientation could arrive carrying extra ones. It
 * never reached the stored stream, because the snapshot copies field by field.
 * Checking it here keeps the recorder's contract the same shape as the schema's
 * instead of quietly narrower, so a caller sending something unrecognised is
 * told rather than silently having it ignored.
 *
 * Written with counted loops over `Reflect.ownKeys` and no `Set`, spread, or
 * `for…of`. All three reach `Array.prototype[Symbol.iterator]`, and replacing
 * that with a generator yielding nothing made this check pass unconditionally:
 * a tuple carrying `smuggled` was accepted, and the property was then silently
 * dropped by the field-by-field copy — precisely the outcome the check exists
 * to prevent.
 *
 * That exploit needs global prototype mutation, which the trust boundary
 * already concedes — replacing `Array.prototype.push` rewrites a copied
 * position just as effectively. The loops are kept because they cost nothing,
 * not because they defend a class the boundary excludes.
 */
function requireExactKeys(source: object, allowed: readonly string[], field: string) {
  const keys = Reflect.ownKeys(source);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (!listContains(allowed, key)) {
      throw new CaptureAuthoringError(
        field,
        `${field} carries ${String(key)}, which the capture schema does not define.`,
      );
    }
  }
}

/**
 * Orientation is optional, but once supplied its components are required.
 *
 * They were read by plain access, so an inherited or computed subfield became
 * valid raw orientation evidence — the one part of the stream a better
 * processor is meant to be able to re-derive from.
 */
function orientationSnapshot(sample: DeviceOrientationSample): DeviceOrientationSample {
  // Orientation is stored, not merely read, so it has to be the kind of object
  // the schema accepts in that position. A custom prototype carrying inherited
  // unknown data was accepted here and normalised into a clean sample, while
  // the same raw shape handed to validation is refused outright as
  // `non-json-capture-object`. The recorder must not be the lenient door.
  //
  // This applies to nested data that becomes part of the stream. The argument
  // bags — options, an attempt, a mark — are never stored, so a class instance
  // remains a perfectly good way to call the recorder.
  const prototype = Object.getPrototypeOf(sample);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new CaptureAuthoringError(
      'orientation',
      'orientation must be a plain object, so it cannot carry an inherited shape.',
    );
  }
  requireExactKeys(
    sample,
    ['alphaDegrees', 'betaDegrees', 'gammaDegrees', 'absolute'],
    'orientation',
  );
  return {
    alphaDegrees: ownRequired<number>(sample, 'alphaDegrees', 'orientation.alphaDegrees'),
    betaDegrees: ownRequired<number>(sample, 'betaDegrees', 'orientation.betaDegrees'),
    gammaDegrees: ownRequired<number>(sample, 'gammaDegrees', 'orientation.gammaDegrees'),
    absolute: ownRequired<boolean>(sample, 'absolute', 'orientation.absolute'),
  };
}

/**
 * The device and its sensor provenance, copied field by field.
 *
 * The sensor profile decides whether a walk is interpretable at all, so it must
 * describe the handset as it was declared at construction and not as the caller
 * last left the object. Optional fields are omitted rather than set to
 * `undefined`, so a snapshot carries the same keys the schema would accept.
 */
function captureDeviceSnapshot(device: CaptureDeviceProfile): CaptureDeviceProfile {
  const sensors = ownRequired<CaptureDeviceProfile['sensors']>(device, 'sensors', 'device.sensors');
  return {
    label: ownRequired<string>(device, 'label'),
    platform: ownRequired<string>(device, 'platform'),
    ...optional('model', ownOptional<string>(device, 'model')),
    ...optional('osVersion', ownOptional<string>(device, 'osVersion')),
    ...optional('browser', ownOptional<string>(device, 'browser')),
    ...optional('browserVersion', ownOptional<string>(device, 'browserVersion')),
    ...optional('userAgent', ownOptional<string>(device, 'userAgent')),
    ...optional('appVersion', ownOptional<string>(device, 'appVersion')),
    ...optional('timezone', ownOptional<string>(device, 'timezone')),
    sensors: {
      ...optional('accelerometerHz', ownOptional<number>(sensors, 'accelerometerHz')),
      ...optional('gyroscopeHz', ownOptional<number>(sensors, 'gyroscopeHz')),
      ...optional('orientationHz', ownOptional<number>(sensors, 'orientationHz')),
      api: ownRequired<CaptureDeviceProfile['sensors']['api']>(sensors, 'api'),
      gyroscopeUnits: ownRequired<CaptureDeviceProfile['sensors']['gyroscopeUnits']>(sensors, 'gyroscopeUnits'),
      frame: ownRequired<CaptureDeviceProfile['sensors']['frame']>(sensors, 'frame'),
    },
  };
}

function optional<K extends string, V>(key: K, value: V | undefined) {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
}

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
      accelerometer: vector3Once(event.accelerometer),
      gyroscope: vector3Once(event.gyroscope),
      orientation: event.orientation ? orientationSnapshot(event.orientation) : null,
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
      position: tuple2Once(event.position),
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
    ...optional('detail', ownOptional<string>(event, 'detail')),
  };
}

function captureAnchorSnapshot(anchor: CheckpointAnchor): CaptureAnchorSnapshot {
  return {
    id: ownRequired<string>(anchor, 'id'),
    floorId: ownRequired<string>(anchor, 'floorId'),
    kind: ownRequired<CheckpointAnchor['kind']>(anchor, 'kind'),
    position: ownNumberTuple(anchor, 'position', 2) as [number, number],
    headingDegrees: ownRequired<number>(anchor, 'headingDegrees'),
    payload: ownRequired<string>(anchor, 'payload'),
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

  // Sequence contiguity catches an event removed from the middle, but never one
  // removed from the end: deleting a terminal `backgrounded` left 0..n-1 intact
  // and turned `interrupted-capture` into a publishable `ok` at 3.688 m. A walk
  // that declares its own end cannot lose its tail silently, because the end is
  // the tail. Validation stays permissive so an unfinished draft is still
  // diagnosable; only evidence requires the capture to be complete.
  const declaresItsEnd = captured.events.some(
    (event) => event.type === 'lifecycle' && event.event === 'session-end',
  );

  const blockingStatus: EvidenceStatus | null = unsupportedSensors
    ? 'unsupported-sensor-model'
    : !declaresItsEnd
      ? 'incomplete-capture'
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
    'ambiguous-anchor-reset-tie': 0,
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
  | 'survey-accuracy-out-of-policy'
  /** A resolved scan shares the mark's millisecond, so their order is unknown. */
  | 'ambiguous-anchor-reset-tie';


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
  /** Filled from the adapter's accepted resolutions as the stream is walked. */
  const anchorResets: Array<{ timeMs: number; sequence: number }> = [];
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
      // A scan with nothing decoded cannot resolve. Validation already refuses
      // an acquisition failure that carries a payload, so this is the whole
      // gate: the stored outcome is never read.
      const payload = event.payload;
      if (payload === null) continue;
      const resolution = checkpoints.resolve({
        timeMs: event.timeMs,
        kind: event.transport,
        payload,
      });
      if (resolution.accepted) {
        // The reset is recorded from the adapter's own answer. Deciding it a
        // second time through a parallel helper meant two places had to agree
        // about what resolves, and only one of them was the authority.
        anchorResets.push({ timeMs: event.timeMs, sequence: event.sequence });
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

      // A mark's `timeMs` is when the surveyor stood on it; its `sequence` is
      // when the annotation was written, which may be much later. So when a
      // resolved scan shares the mark's millisecond, nothing in the capture says
      // which happened first — whether the mark was taken against pre-reset or
      // post-reset state is genuinely unknown, and `notAfter` resolves the tie
      // by annotation order, which is not evidence of anything.
      //
      // Excluded rather than guessed. Capture Stream 0.3 is where a mark gains
      // separate occurrence and recording timestamps; until then a tie cannot
      // be scored honestly.
      const ambiguousResetTie = anchorResets.some((reset) => reset.timeMs === mark.timeMs);

      const exclusionReason: CheckpointExclusionReason | null = !mark.independentOfAnchors
        ? 'dependent-on-anchor'
        : !isPublishableSurveyMethod(mark.surveyMethod)
          ? 'survey-method-not-publishable'
          : !isPublishableSurveyAccuracy(mark.expectedAccuracyMeters)
            ? 'survey-accuracy-out-of-policy'
            : !withinTolerance
              ? 'no-causal-estimate-in-range'
              : ambiguousResetTie
                ? 'ambiguous-anchor-reset-tie'
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
