import { describe, expect, it, vi } from 'vitest';
import * as localizationCore from './index';
import {
  CaptureExportError,
  SessionRecorder,
  buildEvidenceReport,
  deriveRecording,
  exportCaptureSession,
  importCaptureSession,
  validateCaptureSession,
  type CaptureDeviceProfile,
  type CaptureEvent,
  type CaptureSession,
  type CheckpointAnchor,
} from './index';

/**
 * The schema is closed: only declared properties exist, at every level.
 *
 * Closing it is what makes canonical serialisation meaningful. If undeclared
 * properties could survive, two captures describing the same walk could still
 * differ, and a BigInt or a circular reference would have somewhere to hide
 * until the serialiser met it.
 */

const anchors: CheckpointAnchor[] = [
  {
    id: 'corridor-start',
    floorId: 'g',
    kind: 'qr',
    position: [1, 9],
    headingDegrees: 90,
    payload: 'vg:corridor-start',
  },
];

const device: CaptureDeviceProfile = {
  label: 'field handset',
  platform: 'android',
  model: 'Pixel 8',
  sensors: { api: 'native', gyroscopeUnits: 'deg/s', frame: 'world' },
};

function walk() {
  const recorder = new SessionRecorder({
    sessionId: 'closed-schema',
    buildingId: 'reference-medical-centre',
    packageHash: 'a'.repeat(64),
    device,
    anchors,
    startedAtIso: '2026-08-07T09:00:00.000Z',
  });
  recorder.recordScan({ timeMs: 100, transport: 'qr', payload: 'vg:corridor-start' });
  recorder.recordImu({
    timeMs: 120,
    accelerometer: [0, 0, 9.81],
    gyroscope: [0, 0, 0],
    orientation: { alphaDegrees: 90, betaDegrees: 0, gammaDegrees: 0, absolute: true },
  });
  recorder.recordGroundTruth({
    timeMs: 140,
    checkpointId: 'mark',
    position: [3.5, 9],
    floorId: 'g',
    surveyMethod: 'tape-measure',
    expectedAccuracyMeters: 0.03,
    independentOfAnchors: true,
  });
  recorder.recordLifecycle('session-end', 200, 'walk complete');
  return recorder.buildSession();
}

const eventOfType = (session: CaptureSession, type: string) =>
  session.events.find((event) => event.type === type) as unknown as Record<string, unknown>;

describe('unknown properties are reported at every level', () => {
  it('names the exact path of an undeclared property', () => {
    const cases: Array<[string, (session: CaptureSession) => void, string, string]> = [
      [
        'capture root',
        (s) => {
          (s as unknown as Record<string, unknown>).unversionedPayload = { cameraFrames: ['a'] };
        },
        'unknown-capture-property',
        '/unversionedPayload',
      ],
      [
        'device',
        (s) => {
          (s.device as unknown as Record<string, unknown>).selfie = 'data:image/png;base64,AAA';
        },
        'unknown-device-property',
        '/device/selfie',
      ],
      [
        'sensor profile',
        (s) => {
          (s.device.sensors as unknown as Record<string, unknown>).rawTrace = [1, 2, 3];
        },
        'unknown-device-property',
        '/device/sensors/rawTrace',
      ],
      [
        'imu event',
        (s) => {
          eventOfType(s, 'imu').frame = 'data:image/png;base64,AAA';
        },
        'unknown-event-property',
        '/frame',
      ],
      [
        'orientation object',
        (s) => {
          (eventOfType(s, 'imu').orientation as Record<string, unknown>).quaternion = [0, 0, 0, 1];
        },
        'unknown-event-property',
        '/orientation/quaternion',
      ],
      [
        'scan event',
        (s) => {
          eventOfType(s, 'scan').cameraFrame = 'data:image/png;base64,AAA';
        },
        'unknown-event-property',
        '/cameraFrame',
      ],
      [
        'ground truth event',
        (s) => {
          eventOfType(s, 'ground-truth').photo = 'data:image/png;base64,AAA';
        },
        'unknown-event-property',
        '/photo',
      ],
      [
        'lifecycle event',
        (s) => {
          eventOfType(s, 'lifecycle').stack = 'Error: ...';
        },
        'unknown-event-property',
        '/stack',
      ],
    ];

    for (const [label, apply, code, pathSuffix] of cases) {
      const session = walk();
      apply(session);
      const issues = validateCaptureSession(session);

      expect(issues.map((issue) => issue.code), label).toContain(code);
      expect(
        issues.some((issue) => issue.path.endsWith(pathSuffix)),
        `${label} path ${pathSuffix}`,
      ).toBe(true);
      // Refusing means never writing it out.
      expect(() => exportCaptureSession(session), label).toThrow(CaptureExportError);
    }
  });

  it('retains the anchor rule unchanged', () => {
    const session = walk();
    (session.anchors[0] as unknown as { spaceId: string }).spaceId = 'g-corridor';

    expect(validateCaptureSession(session).map((issue) => issue.code)).toContain(
      'unknown-anchor-property',
    );
  });
});

describe('unserialisable values never reach the serialiser', () => {
  it('refuses BigInt anywhere in the graph', () => {
    const inKnownField = walk();
    (inKnownField.device as unknown as { model: unknown }).model = BigInt(1n);
    expect(() => exportCaptureSession(inKnownField)).toThrow(CaptureExportError);

    const inUndeclaredField = walk();
    (inUndeclaredField as unknown as Record<string, unknown>).ledger = BigInt(1n);
    expect(() => exportCaptureSession(inUndeclaredField)).toThrow(CaptureExportError);
  });

  it('refuses a circular reference rather than throwing from JSON', () => {
    const session = walk();
    (session as unknown as Record<string, unknown>).self = session;

    // A raw TypeError from the serialiser would escape the capture error type.
    expect(() => exportCaptureSession(session)).toThrow(CaptureExportError);
    expect(() => exportCaptureSession(session)).not.toThrow(TypeError);
  });
});

describe('canonical serialisation', () => {
  it('round-trips to identical bytes', () => {
    const first = exportCaptureSession(walk());
    const imported = importCaptureSession(first);

    expect(imported.valid).toBe(true);
    expect(exportCaptureSession(imported.session!)).toBe(first);
  });

  it('is unaffected by property insertion order', () => {
    const session = walk();
    // Rebuild the root and the device with their keys in reverse order.
    const reversedKeys = <T extends object>(value: T): T =>
      Object.fromEntries(Object.entries(value).reverse()) as T;

    const reordered: CaptureSession = {
      ...reversedKeys(session),
      device: { ...reversedKeys(session.device), sensors: reversedKeys(session.device.sensors) },
      events: session.events.map((event) => reversedKeys(event) as CaptureEvent),
    };

    expect(exportCaptureSession(reordered)).toBe(exportCaptureSession(session));
  });

  it('treats IEEE negative zero as canonical JSON zero', () => {
    const session = walk();
    const imu = eventOfType(session, 'imu');
    (imu.accelerometer as number[])[0] = -0;
    (imu.orientation as { betaDegrees: number }).betaDegrees = -0;

    const first = exportCaptureSession(session);
    const imported = importCaptureSession(first);
    const exportedImu = imported.session!.events.find((event) => event.type === 'imu');

    expect(exportedImu?.type).toBe('imu');
    if (exportedImu?.type !== 'imu') throw new Error('Expected the inertial fixture event.');
    expect(Object.is(exportedImu.accelerometer[0], -0)).toBe(false);
    expect(Object.is(exportedImu.orientation?.betaDegrees, -0)).toBe(false);
    expect(exportCaptureSession(imported.session!)).toBe(first);
  });

  it('is immune to inherited toJSON hooks', () => {
    const session = walk();
    const originalArrayHook = Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON');
    const originalObjectHook = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON');
    Object.defineProperty(Array.prototype, 'toJSON', {
      value: () => [],
      configurable: true,
    });
    Object.defineProperty(Object.prototype, 'toJSON', {
      value: () => ({}),
      configurable: true,
    });

    let bytes: string;
    try {
      bytes = exportCaptureSession(session);
    } finally {
      if (originalArrayHook) Object.defineProperty(Array.prototype, 'toJSON', originalArrayHook);
      else delete (Array.prototype as unknown as Record<string, unknown>).toJSON;
      if (originalObjectHook) Object.defineProperty(Object.prototype, 'toJSON', originalObjectHook);
      else delete (Object.prototype as unknown as Record<string, unknown>).toJSON;
    }

    const exported = JSON.parse(bytes) as CaptureSession;
    expect(exported.events).toHaveLength(session.events.length);
    expect(exported.anchors).toHaveLength(session.anchors.length);
    expect(importCaptureSession(bytes).valid).toBe(true);
  });

  it('keeps serializer failures typed without formatting a hostile thrown value', () => {
    let formatted = false;
    const stringify = vi.spyOn(JSON, 'stringify').mockImplementation(() => {
      throw {
        toString() {
          formatted = true;
          throw new Error('secondary failure');
        },
      };
    });

    let caught: unknown;
    try {
      exportCaptureSession(walk());
    } catch (error) {
      caught = error;
    } finally {
      stringify.mockRestore();
    }

    expect(caught).toBeInstanceOf(CaptureExportError);
    expect(formatted).toBe(false);
  });

  it('writes events in stream order, and refuses a stream stored out of order', () => {
    const session = walk();
    const exported = JSON.parse(exportCaptureSession(session)) as CaptureSession;
    const times = exported.events.map((event) => event.timeMs);

    expect([...times].sort((a, b) => a - b)).toEqual(times);

    // Reordering the array is not a formatting difference to be tidied away on
    // the way out; a stream stored out of order is a different claim about what
    // happened, so validation refuses it rather than export re-sorting it.
    const shuffled: CaptureSession = { ...session, events: [...session.events].reverse() };
    expect(validateCaptureSession(shuffled).map((issue) => issue.code)).toContain(
      'non-monotonic-time',
    );
    expect(() => exportCaptureSession(shuffled)).toThrow(CaptureExportError);
  });
});

describe('gyroscope bounds follow the declared units', () => {
  const withGyro = (units: 'deg/s' | 'rad/s', rate: number) => {
    const recorder = new SessionRecorder({
      sessionId: 'gyro-units',
      buildingId: 'reference-medical-centre',
      packageHash: 'a'.repeat(64),
      device: { ...device, sensors: { ...device.sensors, gyroscopeUnits: units } },
      anchors,
      startedAtIso: '2026-08-07T09:00:00.000Z',
    });
    recorder.recordImu({ timeMs: 10, accelerometer: [0, 0, 9.81], gyroscope: [0, 0, rate] });
    return validateCaptureSession(recorder.buildSession()).map((issue) => issue.code);
  };

  const radiansLimit = (2_000 * Math.PI) / 180;

  it('allows 2000 deg/s and refuses beyond it', () => {
    expect(withGyro('deg/s', 2_000)).toEqual([]);
    expect(withGyro('deg/s', 2_001)).toContain('implausible-imu-event');
  });

  it('applies the equivalent radian ceiling rather than the degree number', () => {
    expect(withGyro('rad/s', radiansLimit)).toEqual([]);
    expect(withGyro('rad/s', radiansLimit + 0.001)).toContain('implausible-imu-event');
    // 100 rad/s is far past the physical limit but well under 2000, so a
    // unit-blind check would have accepted it.
    expect(withGyro('rad/s', 100)).toContain('implausible-imu-event');
  });
});


describe('adversarial JSON shapes cannot pass as canonical', () => {
  /** Never throws, and never returns something export cannot handle. */
  const check = (session: CaptureSession) => {
    const issues = validateCaptureSession(session);
    return { issues: issues.map((issue) => issue.code), paths: issues.map((issue) => issue.path) };
  };

  it('survives event types that name prototype members', () => {
    for (const hostile of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      const session = walk();
      (eventOfType(session, 'imu') as Record<string, unknown>).type = hostile;

      // Indexing a plain object with these returned an inherited value and threw.
      expect(() => validateCaptureSession(session), hostile).not.toThrow();
      expect(check(session).issues, hostile).toContain('unknown-event-type');
      expect(() => exportCaptureSession(session), hostile).toThrow(CaptureExportError);
    }
  });

  it('refuses sparse arrays wherever the schema expects elements', () => {
    const sparseEvents = walk();
    (sparseEvents as unknown as { events: unknown }).events = [, ...sparseEvents.events];
    expect(check(sparseEvents).issues).toContain('non-json-capture-array');
    expect(check(sparseEvents).issues).toContain('malformed-capture');

    const sparseAnchors = walk();
    (sparseAnchors as unknown as { anchors: unknown }).anchors = [, ...sparseAnchors.anchors];
    expect(check(sparseAnchors).issues).toContain('non-json-capture-array');
    expect(check(sparseAnchors).issues).toContain('malformed-anchors');

    const sparseVector = walk();
    const imu = eventOfType(sparseVector, 'imu');
    imu.accelerometer = [1, , 3];
    expect(check(sparseVector).issues).toContain('non-json-capture-array');
    expect(check(sparseVector).issues).toContain('malformed-imu-event');

    const sparsePosition = walk();
    (eventOfType(sparsePosition, 'ground-truth') as Record<string, unknown>).position = [1, ,];
    expect(check(sparsePosition).issues).toContain('non-json-capture-array');
    expect(check(sparsePosition).issues).toContain('malformed-ground-truth-event');
  });

  it('refuses a huge sparse array without one issue or allocation per hole', () => {
    const session = walk();
    (session as unknown as { events: unknown }).events = new Array(100_000);

    const issues = validateCaptureSession(session);
    expect(issues.map((issue) => issue.code)).toContain('non-json-capture-array');
    expect(issues.length).toBeLessThan(5);
  });

  it('refuses named properties hidden on arrays', () => {
    const session = walk();
    (session.events as unknown as Record<string, unknown>).secret = BigInt(1n);

    // Descriptor reflection sees the name; every() and forEach() never did.
    expect(check(session).issues).toContain('non-json-capture-property');
    expect(check(session).issues).toContain('malformed-capture');
    expect(() => exportCaptureSession(session)).toThrow(CaptureExportError);
  });

  it('refuses inherited values standing in for own properties', () => {
    const session = walk();
    const inherited = Object.create({ sessionId: 'inherited-walk' }) as CaptureSession;
    Object.assign(inherited, { ...session });
    delete (inherited as unknown as Record<string, unknown>).sessionId;

    // It reads fine and then serialises to nothing, so the export would lose it.
    expect((inherited as CaptureSession).sessionId).toBe('inherited-walk');
    expect(check(inherited).issues).toContain('non-json-capture-object');
    expect(check(inherited).paths).toContain('/');
  });

  it('refuses inherited event-variant payload fields', () => {
    const variants: Record<string, { fields: string[]; issueCode: string }> = {
      imu: {
        fields: ['accelerometer', 'gyroscope', 'orientation'],
        issueCode: 'malformed-imu-event',
      },
      scan: {
        fields: ['transport', 'payload', 'outcome', 'anchorId'],
        issueCode: 'malformed-scan-event',
      },
      'ground-truth': {
        fields: [
          'checkpointId',
          'position',
          'floorId',
          'surveyMethod',
          'expectedAccuracyMeters',
          'independentOfAnchors',
        ],
        issueCode: 'malformed-ground-truth-event',
      },
      lifecycle: { fields: ['event'], issueCode: 'malformed-lifecycle-event' },
    };

    for (const [type, { fields, issueCode }] of Object.entries(variants)) {
      const session = walk();
      const eventIndex = session.events.findIndex((event) => event.type === type);
      const original = session.events[eventIndex] as unknown as Record<string, unknown>;
      const inherited = Object.fromEntries(fields.map((key) => [key, original[key]]));
      const replacement = Object.assign(Object.create(inherited), {
        type: original.type,
        sequence: original.sequence,
        timeMs: original.timeMs,
      }) as CaptureEvent;
      session.events[eventIndex] = replacement;

      expect(() => validateCaptureSession(session), type).not.toThrow();
      const issues = validateCaptureSession(session);
      expect(issues.map((issue) => issue.code), type).toContain('non-json-capture-object');
      for (const field of fields) {
        expect(issues, `${type}.${field}`).toContainEqual(
          expect.objectContaining({ code: issueCode, path: expect.stringMatching(`/${field}$`) }),
        );
      }
      expect(() => exportCaptureSession(session), type).toThrow(CaptureExportError);
    }
  });

  it('requires every event variant payload as an own field', () => {
    const cases: Array<[string, string, string]> = [
      ['imu', 'accelerometer', 'malformed-imu-event'],
      ['scan', 'transport', 'malformed-scan-event'],
      ['ground-truth', 'checkpointId', 'malformed-ground-truth-event'],
      ['lifecycle', 'event', 'malformed-lifecycle-event'],
    ];

    for (const [type, field, issueCode] of cases) {
      const session = walk();
      delete eventOfType(session, type)[field];
      const issues = validateCaptureSession(session);

      expect(issues, `${type}.${field}`).toContainEqual(
        expect.objectContaining({ code: issueCode, path: expect.stringMatching(`/${field}$`) }),
      );
      expect(() => exportCaptureSession(session), type).toThrow(CaptureExportError);
    }
  });

  it('refuses non-enumerable required fields', () => {
    const session = walk();
    Object.defineProperty(session, 'sessionId', {
      value: session.sessionId,
      enumerable: false,
      configurable: true,
    });

    expect(validateCaptureSession(session)).toContainEqual(
      expect.objectContaining({ code: 'non-json-capture-property', path: '/sessionId' }),
    );
    expect(() => exportCaptureSession(session)).toThrow(CaptureExportError);
  });

  it('refuses symbol-controlled array iteration before it can delete evidence', () => {
    const session = walk();
    const originalEventCount = session.events.length;
    Object.defineProperty(session.events, Symbol.iterator, {
      value: function* emptyCaptureStream() {},
      configurable: true,
    });

    expect(validateCaptureSession(session)).toContainEqual(
      expect.objectContaining({ code: 'non-json-capture-property', path: '/events/<symbol>' }),
    );
    expect(session.events).toHaveLength(originalEventCount);
    expect(() => exportCaptureSession(session)).toThrow(CaptureExportError);
  });

  it('refuses arrays with caller-controlled prototypes without throwing', () => {
    const session = walk();
    Object.setPrototypeOf(session.events, null);

    expect(() => validateCaptureSession(session)).not.toThrow();
    expect(check(session).issues).toContain('non-json-capture-array');
    expect(() => exportCaptureSession(session)).toThrow(CaptureExportError);
  });

  it('refuses accessors without invoking them', () => {
    const session = walk();
    let invoked = false;
    Object.defineProperty(session, 'sessionId', {
      enumerable: true,
      configurable: true,
      get() {
        invoked = true;
        throw new Error('must not run');
      },
    });

    expect(validateCaptureSession(session)).toContainEqual(
      expect.objectContaining({ code: 'non-json-capture-property', path: '/sessionId' }),
    );
    expect(() => exportCaptureSession(session)).toThrow(CaptureExportError);
    expect(invoked).toBe(false);
  });

  it('never inherits optional-field getters from Object.prototype', () => {
    const session = walk();
    delete session.device.model;
    const original = Object.getOwnPropertyDescriptor(Object.prototype, 'model');
    let invoked = 0;
    let caught: unknown;
    let validationIssues: ReturnType<typeof validateCaptureSession> | undefined;
    let importedValid = false;
    try {
      Object.defineProperty(Object.prototype, 'model', {
        configurable: true,
        get() {
          invoked += 1;
          throw new Error('prototype getter must not run');
        },
      });
      validationIssues = validateCaptureSession(session);
      const bytes = exportCaptureSession(session);
      importedValid = importCaptureSession(bytes).valid;
      deriveRecording(session);
      buildEvidenceReport(session);
    } catch (error) {
      caught = error;
    } finally {
      if (original) Object.defineProperty(Object.prototype, 'model', original);
      else delete (Object.prototype as unknown as Record<string, unknown>).model;
    }

    expect(caught).toBeUndefined();
    expect(validationIssues).toEqual([]);
    expect(importedValid).toBe(true);
    expect(invoked).toBe(0);
  });

  it('converts reflection failures into typed validation and export failures', () => {
    const session = new Proxy(walk(), {
      ownKeys() {
        throw new Error('hostile reflection');
      },
    });

    expect(() => validateCaptureSession(session)).not.toThrow();
    expect(check(session).issues).toContain('uninspectable-capture-value');
    expect(() => exportCaptureSession(session)).toThrow(CaptureExportError);
  });

  it('derives and evaluates from the validated snapshot, not caller proxy reads', () => {
    const baseline = walk();
    const guarded = new Proxy(walk(), {
      get() {
        throw new Error('downstream must consume the snapshot');
      },
    });

    expect(validateCaptureSession(guarded)).toEqual([]);
    expect(exportCaptureSession(guarded)).toBe(exportCaptureSession(baseline));
    expect(deriveRecording(guarded)).toEqual(deriveRecording(baseline));
    expect(buildEvidenceReport(guarded)).toEqual(buildEvidenceReport(baseline));
  });

  it('refuses hidden and explicitly undefined values rather than dropping them', () => {
    const hidden = walk();
    Object.defineProperty(hidden, 'ledger', { value: BigInt(1n), configurable: true });
    expect(check(hidden).issues).toContain('non-json-capture-property');

    const explicitUndefined = walk();
    (explicitUndefined.device as unknown as { model: unknown }).model = undefined;
    expect(check(explicitUndefined).issues).toContain('non-json-capture-value');
    expect(() => exportCaptureSession(explicitUndefined)).toThrow(CaptureExportError);
  });

  it('reports every undeclared anchor key, sorted', () => {
    const session = walk();
    const anchor = session.anchors[0] as unknown as Record<string, unknown>;
    anchor.zeta = 1;
    anchor.alpha = 2;

    const paths = validateCaptureSession(session)
      .filter((issue) => issue.code === 'unknown-anchor-property')
      .map((issue) => issue.path);

    expect(paths).toEqual(['/anchors/0/alpha', '/anchors/0/zeta']);
  });

  it('orders keys by code unit rather than host collation', () => {
    // Czech collation sorts "ch" after "h"; ordinal ordering does not.
    const localeCompare = vi
      .spyOn(String.prototype, 'localeCompare')
      .mockImplementation(() => {
        throw new Error('Canonical ordering must not consult the host locale.');
      });
    let bytes: string;
    try {
      bytes = exportCaptureSession(walk());
    } finally {
      localeCompare.mockRestore();
    }

    const atRoot = Object.keys(JSON.parse(bytes) as Record<string, unknown>);
    expect(atRoot).toEqual([...atRoot].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });

  it('orders aligned checkpoints without consulting the host locale', () => {
    const session = walk();
    const markIndex = session.events.findIndex((event) => event.type === 'ground-truth');
    const first = session.events[markIndex];
    if (first?.type !== 'ground-truth') throw new Error('Expected the ground-truth fixture event.');
    first.checkpointId = 'ch-mark';
    for (let index = markIndex + 1; index < session.events.length; index += 1) {
      session.events[index].sequence += 1;
    }
    session.events.splice(markIndex + 1, 0, {
      ...first,
      sequence: first.sequence + 1,
      checkpointId: 'h-mark',
      position: [...first.position],
    });

    const localeCompare = vi
      .spyOn(String.prototype, 'localeCompare')
      .mockImplementation(() => {
        throw new Error('Checkpoint ordering must not consult the host locale.');
      });
    let derivedIds: string[];
    let evidenceIds: string[];
    try {
      derivedIds = deriveRecording(session).evaluationCheckpoints.map((entry) => entry.id);
      evidenceIds = buildEvidenceReport(session).evaluationCheckpoints.map((entry) => entry.id);
    } finally {
      localeCompare.mockRestore();
    }

    expect(derivedIds).toEqual(['ch-mark', 'h-mark']);
    expect(evidenceIds).toEqual(derivedIds);
  });
});

describe('validation and serialisation agree', () => {
  it('keeps the snapshot inspector behind the package boundary', () => {
    expect('inspectCaptureSession' in localizationCore).toBe(false);
  });

  it('preserves representative accepted sessions before producing stable bytes', () => {
    const accepted: CaptureSession[] = [
      walk(),
      (() => {
        const session = walk();
        session.device = { ...session.device, userAgent: 'x'.repeat(512) };
        return session;
      })(),
      (() => {
        const session = walk();
        (eventOfType(session, 'imu') as Record<string, unknown>).orientation = null;
        return session;
      })(),
    ];

    for (const session of accepted) {
      expect(validateCaptureSession(session)).toEqual([]);

      const first = exportCaptureSession(session);
      expect(JSON.parse(first)).toEqual(session);
      const reimported = importCaptureSession(first);

      expect(reimported.valid).toBe(true);
      expect(exportCaptureSession(reimported.session!)).toBe(first);
    }
  });
});
