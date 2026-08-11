import { describe, expect, it } from 'vitest';
import referenceRecording from '../../../recordings/reference-corridor-walk.json';
import * as pkg from './index';
import {
  CaptureValidationError,
  SessionRecorder,
  buildEvidenceReport,
  validateCaptureSession,
  type CaptureDeviceProfile,
  type CaptureSession,
  type CheckpointAnchor,
} from './index';
import { MAX_BUILDING_FRAME_COORDINATE_METERS } from './captureStream';
import { replayCore } from './internalReplay';
import type { LocalizationRecording } from './types';

/**
 * Coordinates that are finite but not measurable.
 *
 * Finiteness was the only thing asked of a position, and it is not enough. A
 * mark declared at `1e308` validated cleanly and published a median error of
 * `1e308` metres with a status of `ok`; the same mark against an opposite
 * extreme overflows in the subtraction, so the published figure becomes
 * `Infinity` before `Math.hypot` is ever reached.
 *
 * Both halves are covered here, because they fail in different places. A
 * declared coordinate is bounded by capture validation. An estimate is derived,
 * never declared, so nothing about the capture bounds it — the measurement
 * itself has to refuse a pair it cannot subtract.
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

/** A walk that localizes, keeps continuous inertial coverage, and ends on a mark. */
function walkEndingOn(markPosition: [number, number]) {
  const recorder = new SessionRecorder({
    sessionId: 'coordinate-bounds',
    buildingId: 'reference-medical-centre',
    packageHash: 'a'.repeat(64),
    device,
    anchors,
    startedAtIso: '2026-08-07T09:00:00.000Z',
  });
  recorder.recordScan({ timeMs: 100, transport: 'qr', payload: 'vg:corridor-start' });
  for (let t = 100; t <= 3_000; t += 20) {
    recorder.recordImu({
      timeMs: t,
      accelerometer: [0, 0, 9.81 + 3 * Math.sin((2 * Math.PI * t) / 500)],
      gyroscope: [0, 0, 0],
    });
  }
  recorder.recordGroundTruth({
    timeMs: 3_000,
    checkpointId: 'mark',
    position: markPosition,
    floorId: 'g',
    surveyMethod: 'tape-measure',
    expectedAccuracyMeters: 0.03,
    independentOfAnchors: true,
  });
  return recorder.buildSession();
}

function anchorAt(position: [number, number]): CaptureSession {
  const recorder = new SessionRecorder({
    sessionId: 'coordinate-bounds-anchor',
    buildingId: 'reference-medical-centre',
    packageHash: 'a'.repeat(64),
    device,
    anchors: [{ ...anchors[0], position }],
    startedAtIso: '2026-08-07T09:00:00.000Z',
  });
  recorder.recordImu({ timeMs: 10, accelerometer: [0, 0, 9.81], gyroscope: [0, 0, 0] });
  return recorder.buildSession();
}

const issuesFor = (session: CaptureSession) => validateCaptureSession(session);

const BOUND = MAX_BUILDING_FRAME_COORDINATE_METERS;

describe('declared coordinates are bounded to the building frame', () => {
  it('accepts a mark and an anchor at exactly the bound', () => {
    expect(issuesFor(walkEndingOn([BOUND, -BOUND]))).toEqual([]);
    expect(issuesFor(anchorAt([-BOUND, BOUND]))).toEqual([]);
  });

  it('refuses a mark one metre beyond the bound, naming the field', () => {
    const issues = issuesFor(walkEndingOn([BOUND + 1, 9]));

    expect(issues.map((issue) => issue.code)).toContain('malformed-ground-truth-event');
    expect(issues.map((issue) => issue.path).some((path) => path.endsWith('/position'))).toBe(true);
  });

  it('refuses an anchor one metre beyond the bound, naming the field', () => {
    const issues = issuesFor(anchorAt([9, -(BOUND + 1)]));

    expect(issues.map((issue) => issue.code)).toContain('malformed-anchor');
    expect(issues.map((issue) => issue.path)).toContain('/anchors/0/position');
  });

  it('refuses the extreme coordinates that overflowed, and still refuses non-finite ones', () => {
    // 1e308 published as a figure; the opposite pair overflowed to Infinity.
    for (const value of [1e308, -1e308, Number.MAX_VALUE, Infinity, -Infinity, NaN]) {
      expect(issuesFor(walkEndingOn([value, 9])).map((issue) => issue.code), String(value)).toContain(
        'malformed-ground-truth-event',
      );
    }
  });

  it('refuses a capture with an out-of-frame mark rather than reporting on it', () => {
    // Structurally invalid data throws; it is a different problem from a valid
    // walk that simply produced no usable evidence.
    let thrown: unknown;
    try {
      buildEvidenceReport(walkEndingOn([1e308, 9]));
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CaptureValidationError);
    const { issues } = thrown as CaptureValidationError;
    expect(issues.map((issue) => issue.code)).toEqual(['malformed-ground-truth-event']);
    expect(issues[0].message).toMatch(/within 100000 m of the building origin/);
  });

  it('keeps the bound out of the package root', () => {
    const exported = Object.keys(pkg);

    expect(exported).not.toContain('MAX_BUILDING_FRAME_COORDINATE_METERS');
    expect(exported).not.toContain('isBuildingFrameCoordinate');
  });
});

describe('the measurement refuses a pair it cannot subtract', () => {
  const recording = referenceRecording as LocalizationRecording;

  it('measures every checkpoint of the reference recording', () => {
    const core = replayCore(recording);

    expect(core.unmeasurableCheckpointIds).toEqual([]);
    expect(core.checkpointErrors).toHaveLength(3);
    expect(core.medianHorizontalErrorMeters).not.toBeNull();
    expect(core.p95HorizontalErrorMeters).not.toBeNull();
    expect(core.floorAccuracy).not.toBeNull();
  });

  it('voids every aggregate when a single mark is unmeasurable', () => {
    const forged = structuredClone(recording) as LocalizationRecording;
    forged.checkpoints[1].position = [1e308, 9];

    const core = replayCore(forged);

    // The mix is the point: two marks remain measurable and are still not
    // scored. Dropping the third and reporting the survivors would shrink the
    // denominator and hide the reason the figure is unsafe.
    expect(core.unmeasurableCheckpointIds).toEqual(['anchor-correction']);
    expect(core.checkpointErrors.map((error) => error.checkpointId)).toEqual([
      'entry',
      'corridor-end',
    ]);
    expect(core.medianHorizontalErrorMeters).toBeNull();
    expect(core.p95HorizontalErrorMeters).toBeNull();
    expect(core.floorAccuracy).toBeNull();
  });

  it('never lets an overflowing pair reach a percentile', () => {
    const forged = structuredClone(recording) as LocalizationRecording;
    forged.checkpoints[0].position = [-Number.MAX_VALUE, 0];
    forged.checkpoints[1].position = [Number.MAX_VALUE, 0];

    const core = replayCore(forged);

    expect(core.unmeasurableCheckpointIds).toEqual(['entry', 'anchor-correction']);
    for (const error of core.checkpointErrors) {
      expect(Number.isFinite(error.horizontalErrorMeters)).toBe(true);
    }
    expect(core.medianHorizontalErrorMeters).toBeNull();
  });
});

describe('a derived estimate outside the frame is not evidence', () => {
  it('reports implausible-geometry instead of an astronomical figure', () => {
    const session = walkEndingOn([3.5, 9]);

    // Tuning is caller-supplied and unrecorded, so it can drive filter state
    // anywhere. This published a median of 8.6e300 metres with a status of ok.
    const bent = buildEvidenceReport(session, {
      deadReckoningConfig: { strideLengthMeters: 1e300 },
    });

    expect(bent.report.evidenceStatus).toBe('implausible-geometry');
    expect(bent.report.medianHorizontalErrorMeters).toBeNull();
    expect(bent.report.p95HorizontalErrorMeters).toBeNull();
    expect(bent.report.floorAccuracy).toBeNull();
    expect(bent.report.checkpointErrors).toEqual([]);
  });

  it('leaves an honest walk untouched', () => {
    const honest = buildEvidenceReport(walkEndingOn([3.5, 9]));

    expect(honest.report.evidenceStatus).toBe('ok');
    expect(honest.report.medianHorizontalErrorMeters).toBeCloseTo(3.688, 3);
    expect(honest.report.checkpointErrors).toHaveLength(1);
  });
});
