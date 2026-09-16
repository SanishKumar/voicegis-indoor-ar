import { describe, expect, it, vi } from 'vitest';
import { LiveLocalizationSession, type LiveHeadingCalibration } from '@voicegis/localization-core';
import { LiveHandsetInput } from './liveHandsetInput';

function setup(at = 0) {
  const session = new LiveLocalizationSession({
    identity: { sessionId: 'test', buildingId: 'venue', packageHash: 'hash', routeRevision: 1 },
    anchors: [
      {
        id: 'start',
        floorId: 'g',
        kind: 'qr',
        position: [0, 0],
        headingDegrees: 90,
        payload: 'start',
      },
    ],
    elevationByFloorId: { g: 0 },
    routeSegments: [
      {
        id: 'hall',
        floorId: 'g',
        from: [0, 0],
        to: [20, 0],
        lengthMeters: 20,
        startProgressMeters: 0,
      },
    ],
  });
  const lease = session.beginAcquisition(at);
  session.reacquire(lease, { kind: 'qr', payload: 'start', timeMs: at }, at);
  return { session, input: new LiveHandsetInput(session, lease, at) };
}
function tilt(timeStamp: number, beta = 0, gamma = 0) {
  return { timeStamp, alpha: null, beta, gamma, absolute: false };
}
function motion(timeStamp: number, z = 9.81, yaw = 0) {
  return {
    timeStamp,
    accelerationIncludingGravity: { x: 0, y: 0, z },
    rotationRate: { alpha: -yaw, beta: 0, gamma: 0 },
  };
}
function calibration(timeMs: number): LiveHeadingCalibration {
  // Explicit synthetic declaration, never produced by the browser UI.
  return {
    timeMs,
    headingDegrees: 90,
    accuracyDegrees: 2,
    reference: 'filter-local',
    axis: 'travel',
    source: 'visual-anchor',
    provenanceId: 'synthetic-pose',
    buildingId: 'venue',
    packageHash: 'hash',
  };
}
function sample(input: LiveHandsetInput, time: number, z = 9.81, yaw = 0) {
  input.orientation(tilt(time), time);
  input.motion(motion(time, z, yaw), time);
}

describe('live handset input boundary', () => {
  it('requires the actual acquisition lease, not a copied identity', () => {
    const { session } = setup();
    const lease = session.beginAcquisition(100);
    expect(() => new LiveHandsetInput(session, { ...lease }, 100)).toThrow('lease');
  });

  it('drops diagnostic heading when the acquisition is replaced', () => {
    const { session, input } = setup();
    input.calibrate(calibration(0), 0);
    sample(input, 0);
    session.beginAcquisition(100);
    expect(input.read(100).headingDegrees).toBeNull();
  });
  it('does not accept calibration behind already consumed motion', () => {
    const { input } = setup();
    sample(input, 100);
    expect(input.calibrate(calibration(50), 100)).toBe(false);
  });

  it('expires the wait for the first complete sample after calibration', () => {
    const { session, input } = setup();
    input.calibrate(calibration(0), 0);
    input.read(1000);
    expect(session.read(1000).reason).toBe('sensor-unavailable');
  });
  it('keeps raw readiness observable after startup disorder without restoring the retired guidance lease', () => {
    const { session, input } = setup();
    input.motion(motion(0), 0); // Real streams need not deliver tilt first.
    sample(input, 50);
    expect(input.read(50)).toMatchObject({
      completeSamples: 1,
      rejectedSamples: 1,
      forwardedFrames: 0,
    });
    expect(session.read(50).guidanceState).toBe('frozen');
    expect(input.calibrate(calibration(50), 50)).toBe(false);
  });
  it('counts complete paired samples without inventing calibrated heading or renewing the session', () => {
    const { session, input } = setup();
    const forward = vi.spyOn(session, 'motion');
    sample(input, 0);
    sample(input, 300, 13);
    sample(input, 600, 9);
    expect(input.read(600)).toMatchObject({
      completeSamples: 3,
      forwardedFrames: 0,
      unlocatedSteps: 1,
    });
    expect(session.read(1500)).toMatchObject({
      reason: 'stale-motion',
      progressMeters: null,
      lastMotionTimeMs: null,
    });
    expect(forward).not.toHaveBeenCalled();
  });

  it('forwards only real complete motion occurrences after explicit independent calibration', () => {
    const { session, input } = setup();
    expect(input.calibrate(calibration(0), 0)).toBe(true);
    sample(input, 0);
    sample(input, 300, 13);
    sample(input, 600, 9);
    const snapshot = session.read(600);
    expect(snapshot.guidanceState).toBe('active');
    expect(snapshot.estimate?.position[0]).toBeCloseTo(0.72);
    expect(input.read(600).forwardedFrames).toBe(3);
  });

  it('maps upright portrait rotation about device Y, not alpha/Z, into clockwise heading', () => {
    const { session, input } = setup();
    input.calibrate(calibration(0), 0);
    input.orientation(tilt(0, 90), 0);
    input.motion(motion(0), 0);
    input.orientation(tilt(500, 90), 500);
    input.motion({ ...motion(500), rotationRate: { alpha: 80, beta: 0, gamma: -20 } }, 500);
    expect(session.read(500).estimate?.headingDegrees).toBeGreaterThan(90);
    expect(input.read(500).headingDegrees).toBeCloseTo(100);
  });

  it.each([
    'incomplete',
    'tilt-stale',
    'future-tilt',
    'duplicate',
    'stale-event',
    'invalid-time',
    'gap',
  ] as const)('freezes on %s and cannot resume with a later good sample', (failure) => {
    const { session, input } = setup();
    input.calibrate(calibration(0), 0);
    sample(input, 0);
    if (failure === 'incomplete') input.motion({ ...motion(50), rotationRate: null }, 50);
    if (failure === 'tilt-stale') input.motion(motion(101), 101);
    if (failure === 'future-tilt') {
      input.orientation(tilt(70), 70);
      input.motion(motion(60), 70);
    }
    if (failure === 'duplicate') input.motion(motion(0), 1);
    if (failure === 'stale-event') input.motion(motion(1), 502);
    if (failure === 'invalid-time') input.motion(motion(Number.NaN), 50);
    if (failure === 'gap') sample(input, 1000);
    expect(session.read(1000)).toMatchObject({ guidanceState: 'frozen', progressMeters: null });
    sample(input, 1100);
    expect(session.read(1100).guidanceState).toBe('frozen');
    expect(input.read(1100).forwardedFrames).toBe(1);
  });

  it('rejects null tilt immediately and ignores compass alpha as a calibration source', () => {
    const { session, input } = setup();
    input.calibrate(calibration(0), 0);
    sample(input, 0);
    input.orientation({ timeStamp: 10, alpha: 90, beta: null, gamma: null, absolute: true }, 10);
    expect(session.read(10).guidanceState).toBe('frozen');
    expect(input.read(10).headingDegrees).toBeNull();
  });

  it('does not let orientation callbacks or diagnostic reads act as motion heartbeats', () => {
    const { session, input } = setup();
    input.calibrate(calibration(0), 0);
    sample(input, 0);
    for (let time = 100; time <= 1000; time += 100) {
      input.orientation(tilt(time), time);
      input.read(time);
    }
    expect(session.read(1000)).toMatchObject({ guidanceState: 'frozen', lastMotionTimeMs: 0 });
    expect(input.read(1000).forwardedFrames).toBe(1);
  });

  it('does not finish a peak from before calibration', () => {
    const { session, input } = setup();
    sample(input, 0);
    sample(input, 300, 13);
    input.calibrate(calibration(350), 350);
    sample(input, 400, 9);
    sample(input, 700, 9.81);
    expect(session.read(700).estimate?.position).toEqual([0, 0, 0]);
  });

  it('suppresses a first stride whose heuristic duration crosses the calibration boundary', () => {
    const { session, input } = setup();
    input.calibrate(calibration(0), 0);
    sample(input, 0);
    sample(input, 50, 13);
    sample(input, 100, 9);
    expect(input.read(100).suppressedStrides).toBe(1);
    expect(session.read(100)).toMatchObject({
      guidanceState: 'active',
      estimate: { position: [0, 0, 0] },
    });
  });

  it('ignores queued pre-acquisition events and cannot disturb a replacement session lease', () => {
    const { session, input } = setup(100);
    input.orientation(tilt(50), 100);
    input.motion(motion(50), 100);
    expect(input.read(100).completeSamples).toBe(0);
    const lease = session.beginAcquisition(200);
    session.reacquire(lease, { timeMs: 200, kind: 'qr', payload: 'start' }, 200);
    input.motion({ ...motion(201), rotationRate: null }, 201);
    expect(session.read(201).reason).toBe('awaiting-heading');
    expect(input.calibrate(calibration(202), 202)).toBe(false);
  });

  it('makes disposal terminal, including queued callbacks', () => {
    const { input } = setup();
    input.dispose();
    sample(input, 100);
    expect(input.read(100)).toMatchObject({ completeSamples: 0, headingDegrees: null });
  });

  it('refuses forged/manual calibration and snapshots its counters', () => {
    const { input } = setup();
    expect(input.calibrate({ ...calibration(0), source: 'manual-anchor' }, 0)).toBe(false);
    sample(input, 0);
    const snapshot = input.read(0);
    snapshot.completeSamples = 200;
    expect(input.read(0).completeSamples).toBe(1);
  });
});
