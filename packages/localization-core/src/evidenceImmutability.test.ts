import { describe, expect, it } from 'vitest';
import * as pkg from './index';
import {
  DEFAULT_CHECKPOINT_CONFIG,
  DEFAULT_DEAD_RECKONING_CONFIG,
  SessionRecorder,
  buildEvidenceReport,
  type CaptureDeviceProfile,
  type CheckpointAnchor,
} from './index';

/**
 * Everything here reaches the package exactly as an outside caller would,
 * through the barrel, and tries to bend the result of one fixed capture.
 *
 * Each defect these cover was real: a widened survey-method set turned a
 * refused walk into a published metric, and editing the exported stride length
 * moved a published figure while the report still said ok.
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

function walkWithMark(surveyMethod: 'tape-measure' | 'estimated', accuracyMeters = 0.03) {
  const recorder = new SessionRecorder({
    sessionId: 'immutability',
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
    position: [3.5, 9],
    floorId: 'g',
    surveyMethod,
    expectedAccuracyMeters: accuracyMeters,
    independentOfAnchors: true,
  });
  return recorder.buildSession();
}

describe('evidence dependencies resist mutation from the package root', () => {
  it('does not expose the policy internals that decide publishability', () => {
    const exported = Object.keys(pkg);

    for (const name of [
      'PUBLISHABLE_SURVEY_METHODS',
      'MAX_PUBLISHABLE_SURVEY_ACCURACY_METERS',
      'EVIDENTIAL_SENSOR_MODEL',
      'isEvidentialSensorModel',
      'isPublishableSurveyMethod',
      'worstCoverageGapMs',
      'replayCore',
    ]) {
      expect(exported).not.toContain(name);
    }
  });

  it('cannot be made to accept an estimated survey by widening a set', () => {
    const session = walkWithMark('estimated');
    const before = buildEvidenceReport(session).report.evidenceStatus;

    // The old policy was an exported Set; freezing one does not disable `add`.
    const candidate = (pkg as Record<string, unknown>).PUBLISHABLE_SURVEY_METHODS;
    if (candidate instanceof Set) (candidate as Set<string>).add('estimated');

    expect(before).toBe('insufficient-ground-truth');
    expect(buildEvidenceReport(session).report.evidenceStatus).toBe('insufficient-ground-truth');
  });

  it('cannot be retuned by editing the exported dead-reckoning defaults', () => {
    const session = walkWithMark('tape-measure');
    const before = buildEvidenceReport(session).report;

    expect(() => {
      (DEFAULT_DEAD_RECKONING_CONFIG as { strideLengthMeters: number }).strideLengthMeters = 25;
    }).toThrow();

    const after = buildEvidenceReport(session).report;
    expect(after.medianHorizontalErrorMeters).toBe(before.medianHorizontalErrorMeters);
    expect(DEFAULT_DEAD_RECKONING_CONFIG.strideLengthMeters).toBe(0.72);
  });

  it('cannot be retuned by editing the exported checkpoint defaults or its nested map', () => {
    const session = walkWithMark('tape-measure');
    const before = buildEvidenceReport(session).report.medianHorizontalErrorMeters;

    expect(() => {
      (DEFAULT_CHECKPOINT_CONFIG as { qrAccuracyMeters: number }).qrAccuracyMeters = 99;
    }).toThrow();
    expect(() => {
      (DEFAULT_CHECKPOINT_CONFIG.elevationByFloorId as Record<string, number>).g = 1_000;
    }).toThrow();

    expect(buildEvidenceReport(session).report.medianHorizontalErrorMeters).toBe(before);
  });

  it('does not share the nested elevation map between derivations', () => {
    const session = walkWithMark('tape-measure');
    const first = buildEvidenceReport(session, {
      checkpointConfig: { elevationByFloorId: { g: 5 } },
    });
    // A caller's map must not leak into a later derivation that did not pass one.
    const second = buildEvidenceReport(session);

    expect(first.report.evidenceStatus).toBe('ok');
    expect(second.report.evidenceStatus).toBe('ok');
    expect(DEFAULT_CHECKPOINT_CONFIG.elevationByFloorId).toEqual({});
  });
});
