import { describe, expect, it } from 'vitest';
import {
  CaptureExportError,
  CaptureValidationError,
  SessionRecorder,
  buildEvidenceReport,
  exportCaptureSession,
  validateCaptureSession,
  type CaptureDeviceProfile,
  type CaptureEvent,
  type CaptureSession,
  type CheckpointAnchor,
} from './index';

/**
 * The known-field scalar contract.
 *
 * Device metadata and lifecycle detail are typed and bounded, so an object,
 * array or BigInt in one of them is a validation issue rather than something
 * that travels quietly into an exported capture. Limits are measured in
 * JavaScript string length, which is UTF-16 code units rather than bytes.
 *
 * This covers those fields only. Ids, anchor and scan payloads, and other
 * strings are outside this slice, as is structural strictness elsewhere.
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
  sensors: { api: 'native', gyroscopeUnits: 'deg/s', frame: 'world' },
};

function sessionWith(deviceOverrides: Partial<CaptureDeviceProfile> = {}) {
  const recorder = new SessionRecorder({
    sessionId: 'scalar-contract',
    buildingId: 'reference-medical-centre',
    packageHash: 'a'.repeat(64),
    device: { ...device, ...deviceOverrides },
    anchors,
    startedAtIso: '2026-08-07T09:00:00.000Z',
  });
  recorder.recordImu({ timeMs: 10, accelerometer: [0, 0, 9.81], gyroscope: [0, 0, 0] });
  return recorder.buildSession();
}

const codesFor = (session: CaptureSession) =>
  validateCaptureSession(session).map((issue) => issue.code);

/** Field limits, mirrored here so a change to either side shows up as a failure. */
const REQUIRED_LIMITS: Array<[keyof CaptureDeviceProfile, number]> = [
  ['label', 120],
  ['platform', 60],
];
const OPTIONAL_LIMITS: Array<[keyof CaptureDeviceProfile, number]> = [
  ['model', 120],
  ['osVersion', 60],
  ['browser', 60],
  ['browserVersion', 60],
  ['userAgent', 512],
  ['appVersion', 60],
  ['timezone', 64],
];

describe('device metadata scalar bounds', () => {
  it('accepts every field at exactly its limit', () => {
    for (const [field, limit] of [...REQUIRED_LIMITS, ...OPTIONAL_LIMITS]) {
      const session = sessionWith({ [field]: 'x'.repeat(limit) });
      expect(validateCaptureSession(session), `${field} at ${limit}`).toEqual([]);
    }
  });

  it('rejects every field one code unit beyond its limit', () => {
    for (const [field, limit] of [...REQUIRED_LIMITS, ...OPTIONAL_LIMITS]) {
      const session = sessionWith({ [field]: 'x'.repeat(limit + 1) });
      const issues = validateCaptureSession(session);
      expect(issues.map((issue) => issue.code), `${field} at ${limit + 1}`).toContain(
        'malformed-device',
      );
      // The path names the offending field, not merely the device.
      expect(issues.map((issue) => issue.path)).toContain(`/device/${field}`);
    }
  });

  it('requires label and platform, and allows the optional fields to be absent', () => {
    for (const [field] of REQUIRED_LIMITS) {
      expect(codesFor(sessionWith({ [field]: undefined }))).toContain('malformed-device');
    }
    // None of the optional fields are set by the base fixture.
    expect(validateCaptureSession(sessionWith())).toEqual([]);
  });

  it('refuses non-string values in fields the schema declares as strings', () => {
    const hostile: unknown[] = [
      { cameraFrames: ['a', 'b'] },
      ['a', 'b'],
      42,
      true,
      null,
      BigInt(9_007_199_254_740_993n),
    ];

    for (const value of hostile) {
      const session = sessionWith({ model: value as never });
      expect(codesFor(session), String(typeof value)).toContain('malformed-device');
    }
  });

  it('refuses to export a capture whose scalar fields are not scalars', () => {
    const session = sessionWith({ model: { cameraFrames: ['a'] } as never });

    expect(() => exportCaptureSession(session)).toThrow(CaptureExportError);
    expect(() => exportCaptureSession(session)).toThrow('Refusing to export');
  });
});

describe('lifecycle detail bounds', () => {
  const withDetail = (detail: unknown) => {
    const session = sessionWith();
    const lifecycle = session.events.find((event) => event.type === 'lifecycle')!;
    (lifecycle as unknown as { detail: unknown }).detail = detail;
    return session;
  };

  it('accepts detail at exactly its limit and rejects one code unit beyond', () => {
    expect(validateCaptureSession(withDetail('x'.repeat(256)))).toEqual([]);
    expect(codesFor(withDetail('x'.repeat(257)))).toContain('malformed-lifecycle-event');
  });

  it('refuses a non-string detail', () => {
    for (const value of [{ frames: ['a'] }, ['a'], 7, BigInt(1n)]) {
      expect(codesFor(withDetail(value))).toContain('malformed-lifecycle-event');
    }
    // Absent stays valid; the field is optional.
    expect(validateCaptureSession(sessionWith())).toEqual([]);
  });
});

describe('inertial orientation presence', () => {
  const imuEventOf = (session: CaptureSession) =>
    session.events.find((event) => event.type === 'imu') as CaptureEvent & {
      orientation?: unknown;
    };

  it('is authored explicitly as null when the caller omits it', () => {
    const session = sessionWith();

    expect(imuEventOf(session).orientation).toBeNull();
    expect(validateCaptureSession(session)).toEqual([]);
  });

  it('rejects an imported event that does not own an orientation property', () => {
    const session = sessionWith();
    delete imuEventOf(session).orientation;

    const issues = validateCaptureSession(session);
    expect(issues.map((issue) => issue.code)).toContain('malformed-imu-event');
    expect(issues.some((issue) => issue.path.endsWith('/orientation'))).toBe(true);
  });

  it('still accepts a valid orientation object', () => {
    const session = sessionWith();
    imuEventOf(session).orientation = {
      alphaDegrees: 90,
      betaDegrees: 0,
      gammaDegrees: 0,
      absolute: true,
    };

    expect(validateCaptureSession(session)).toEqual([]);
  });
});


describe('enum scalars do not coerce', () => {
  /**
   * `SET.has(String(value))` accepted an array of one string, because it
   * stringifies to that string. Validation passed and every consumer then
   * compared with strict equality and saw no match, so a declared interruption
   * vanished and the walk published a figure.
   */
  const mutate = (path: (session: CaptureSession) => void) => {
    const session = sessionWith();
    path(session);
    return session;
  };

  // The last lifecycle event, never the first: `session-start` is structural,
  // and overwriting it would test the session boundary rather than the enum.
  const lifecycleOf = (session: CaptureSession) =>
    [...session.events]
      .reverse()
      .find((event) => event.type === 'lifecycle') as unknown as {
      event: unknown;
      detail?: unknown;
    };
  const imuIndexOf = (session: CaptureSession) =>
    session.events.findIndex((event) => event.type === 'imu');

  it('refuses a non-string lifecycle event, whatever it stringifies to', () => {
    for (const hostile of [['backgrounded'], { toString: () => 'backgrounded' }, 7]) {
      const session = mutate((s) => {
        lifecycleOf(s).event = hostile;
      });
      const issues = validateCaptureSession(session);
      expect(issues.map((issue) => issue.code)).toContain('malformed-lifecycle-event');
      expect(issues.some((issue) => issue.path.endsWith('/event'))).toBe(true);
    }
  });

  it('refuses non-string values in every other enum field', () => {
    const cases: Array<[string, (session: CaptureSession) => void, string]> = [
      [
        'scan outcome',
        (s) => {
          s.events = [
            ...s.events,
            {
              type: 'scan',
              sequence: 90,
              timeMs: 900,
              transport: 'qr',
              payload: 'vg:corridor-start',
              outcome: ['resolved'],
              anchorId: 'corridor-start',
            } as unknown as CaptureEvent,
          ];
        },
        'malformed-scan-event',
      ],
      [
        'sensor api',
        (s) => {
          (s.device.sensors as unknown as { api: unknown }).api = ['native'];
        },
        'malformed-sensor-profile',
      ],
      [
        'anchor kind',
        (s) => {
          (s.anchors[0] as unknown as { kind: unknown }).kind = ['qr'];
        },
        'malformed-anchor',
      ],
    ];

    for (const [label, apply, code] of cases) {
      const session = mutate(apply);
      expect(validateCaptureSession(session).map((issue) => issue.code), label).toContain(code);
    }
  });

  it('refuses a non-string ground-truth survey method', () => {
    const session = sessionWith();
    session.events = [
      ...session.events,
      {
        type: 'ground-truth',
        sequence: 99,
        timeMs: 5_000,
        checkpointId: 'mark',
        position: [3, 9],
        floorId: 'g',
        surveyMethod: ['tape-measure'],
        expectedAccuracyMeters: 0.03,
        independentOfAnchors: true,
      } as unknown as CaptureEvent,
    ];

    const issues = validateCaptureSession(session);
    expect(issues.map((issue) => issue.code)).toContain('malformed-ground-truth-event');
    expect(issues.some((issue) => issue.path.endsWith('/surveyMethod'))).toBe(true);
  });

  it('cannot hide an interruption behind an array', () => {
    // A walk that localizes, so interruption is the status under test rather
    // than the absence of a fix.
    const localizedWalk = () => {
      const recorder = new SessionRecorder({
        sessionId: 'coercion',
        buildingId: 'reference-medical-centre',
        packageHash: 'a'.repeat(64),
        device,
        anchors,
        startedAtIso: '2026-08-07T09:00:00.000Z',
      });
      recorder.recordScan({ timeMs: 100, transport: 'qr', payload: 'vg:corridor-start' });
      recorder.recordImu({ timeMs: 100, accelerometer: [0, 0, 9.81], gyroscope: [0, 0, 0] });
      recorder.recordLifecycle('session-end', 200);
      return recorder.buildSession();
    };

    const genuine = localizedWalk();
    lifecycleOf(genuine).event = 'backgrounded';
    expect(imuIndexOf(genuine)).toBeGreaterThanOrEqual(0);

    expect(validateCaptureSession(genuine)).toEqual([]);
    expect(buildEvidenceReport(genuine).report.evidenceStatus).toBe('interrupted-capture');

    const smuggled = localizedWalk();
    lifecycleOf(smuggled).event = ['backgrounded'] as unknown as string;

    // The array no longer validates, so it can never reach the point where
    // strict equality would quietly ignore it.
    expect(validateCaptureSession(smuggled).length).toBeGreaterThan(0);
    expect(() => buildEvidenceReport(smuggled)).toThrow(CaptureValidationError);
    expect(() => exportCaptureSession(smuggled)).toThrow(CaptureExportError);
  });
});
