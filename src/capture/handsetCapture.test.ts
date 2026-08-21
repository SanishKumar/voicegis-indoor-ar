import { describe, expect, it } from 'vitest';
import {
  SessionRecorder,
  buildEvidenceReport,
  validateCaptureSession,
  type CheckpointAnchor,
} from '@voicegis/localization-core';
import {
  HANDSET_SENSOR_PROFILE,
  HandsetCaptureAdapter,
  requestMotionPermission,
  type MotionEventLike,
  type OrientationEventLike,
} from './handsetCapture';

/**
 * The first code here that meets a real device, so these cover the things a
 * deterministic replay never had to survive: half-populated events, a clock
 * that steps backwards, and two sensor channels that arrive on their own
 * schedules.
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

function recorder() {
  return new SessionRecorder({
    sessionId: 'handset-walk',
    buildingId: 'reference-medical-centre',
    packageHash: 'a'.repeat(64),
    device: {
      label: 'pixel 7a',
      platform: 'android',
      sensors: { ...HANDSET_SENSOR_PROFILE },
    },
    anchors,
    startedAtIso: '2026-08-17T09:00:00.000Z',
  });
}

function motion(
  timeStamp: number,
  rotationRate: { alpha: number; beta: number; gamma: number } = { alpha: 0, beta: 0, gamma: 0 },
  accelerationIncludingGravity = { x: 0, y: 0, z: 9.81 },
): MotionEventLike {
  return { timeStamp, accelerationIncludingGravity, rotationRate };
}

function orientation(timeStamp: number, beta: number, gamma: number, alpha = 0): OrientationEventLike {
  return { timeStamp, alpha, beta, gamma, absolute: false };
}

describe('mapping a browser motion event onto a capture reading', () => {
  it('puts each rotation rate on the axis it is about, not the one it is named after', () => {
    // The trap: rotationRate.alpha is the rate about Z, .beta about X and
    // .gamma about Y. Written across in name order the vector is plausible and
    // completely wrong, and no downstream check would ever notice.
    const session = recorder();
    const adapter = new HandsetCaptureAdapter(session);

    adapter.handleMotion(motion(0, { alpha: 1, beta: 2, gamma: 3 }));

    const events = session.buildSession().events.filter((event) => event.type === 'imu');
    expect(events).toHaveLength(1);
    expect(events[0].gyroscope).toEqual([2, 3, 1]);
  });

  it('records acceleration including gravity in axis order', () => {
    const session = recorder();
    const adapter = new HandsetCaptureAdapter(session);

    adapter.handleMotion(motion(0, undefined, { x: 0.5, y: -1.5, z: 9.7 }));

    const events = session.buildSession().events.filter((event) => event.type === 'imu');
    expect(events[0].accelerometer).toEqual([0.5, -1.5, 9.7]);
  });

  it('starts the session clock at the first event rather than the page time origin', () => {
    const session = recorder();
    const adapter = new HandsetCaptureAdapter(session);

    adapter.handleMotion(motion(184_233.5));
    adapter.handleMotion(motion(184_253.5));

    const events = session.buildSession().events.filter((event) => event.type === 'imu');
    expect(events.map((event) => event.timeMs)).toEqual([0, 20]);
  });

  it('honours an explicit origin when the caller has one', () => {
    const session = recorder();
    const adapter = new HandsetCaptureAdapter(session, { originTimeStampMs: 1_000 });

    adapter.handleMotion(motion(1_250));

    const events = session.buildSession().events.filter((event) => event.type === 'imu');
    expect(events[0].timeMs).toBe(250);
  });
});

describe('pairing tilt with turn across two independent channels', () => {
  it('attaches the most recent orientation and measures how stale it was', () => {
    const session = recorder();
    const adapter = new HandsetCaptureAdapter(session);

    adapter.handleOrientation(orientation(100, 90, 0));
    adapter.handleMotion(motion(140, { alpha: 0, beta: 0, gamma: 30 }));

    const events = session.buildSession().events.filter((event) => event.type === 'imu');
    expect(events[0].orientation).toEqual({
      alphaDegrees: 0,
      betaDegrees: 90,
      gammaDegrees: 0,
      absolute: false,
    });
    expect(adapter.pairing).toMatchObject({
      pairedCount: 1,
      unpairedCount: 0,
      medianStalenessMs: 40,
      worstStalenessMs: 40,
    });
  });

  it('records a sample that arrived before any tilt, with no orientation', () => {
    // Dropping it would cost a footfall the accelerometer measured perfectly
    // well. A null orientation is refused explicitly downstream rather than
    // quietly becoming a heading.
    const session = recorder();
    const adapter = new HandsetCaptureAdapter(session);

    adapter.handleMotion(motion(0, { alpha: 5, beta: 0, gamma: 0 }));

    const events = session.buildSession().events.filter((event) => event.type === 'imu');
    expect(events).toHaveLength(1);
    expect(events[0].orientation).toBeNull();
    expect(adapter.pairing).toMatchObject({ pairedCount: 0, unpairedCount: 1 });
  });

  it('summarises the staleness distribution the lag decision needs', () => {
    const session = recorder();
    const adapter = new HandsetCaptureAdapter(session);

    // Ten samples whose tilt is between 1 ms and 10 ms behind.
    for (let index = 1; index <= 10; index += 1) {
      adapter.handleOrientation(orientation(index * 100, 0, 0));
      adapter.handleMotion(motion(index * 100 + index));
    }

    expect(adapter.pairing).toMatchObject({
      pairedCount: 10,
      medianStalenessMs: 6,
      p95StalenessMs: 10,
      worstStalenessMs: 10,
    });
  });

  it('drops a tilt that is older than the caller allows, but still counts it', () => {
    // The measurement is the point, so an excluded sample still contributes to
    // the distribution. Excluding it from both would hide exactly the walks
    // that motivated setting a limit.
    const session = recorder();
    const adapter = new HandsetCaptureAdapter(session, { maxOrientationStalenessMs: 50 });

    adapter.handleOrientation(orientation(0, 90, 0));
    adapter.handleMotion(motion(500));

    const events = session.buildSession().events.filter((event) => event.type === 'imu');
    expect(events[0].orientation).toBeNull();
    expect(adapter.pairing).toMatchObject({ pairedCount: 1, worstStalenessMs: 500 });
    expect(adapter.orientationStalenessLimitMs).toBe(50);
  });

  it('keeps nothing by default, because no threshold has been measured yet', () => {
    const session = recorder();
    const adapter = new HandsetCaptureAdapter(session);

    adapter.handleOrientation(orientation(0, 90, 0));
    adapter.handleMotion(motion(10_000));

    const events = session.buildSession().events.filter((event) => event.type === 'imu');
    expect(events[0].orientation).not.toBeNull();
    expect(adapter.orientationStalenessLimitMs).toBeNull();
  });
});

describe('what the adapter refuses', () => {
  it('counts a motion event with no gyroscope rather than recording half of it', () => {
    // A device without a gyroscope still fires devicemotion, with rotationRate
    // present and empty. Recorded, it would look like a walk with no turns.
    const session = recorder();
    const adapter = new HandsetCaptureAdapter(session);

    adapter.handleMotion({
      timeStamp: 0,
      accelerationIncludingGravity: { x: 0, y: 0, z: 9.81 },
      rotationRate: { alpha: null, beta: null, gamma: null },
    });
    adapter.handleMotion({
      timeStamp: 20,
      accelerationIncludingGravity: null,
      rotationRate: { alpha: 0, beta: 0, gamma: 0 },
    });

    expect(session.buildSession().events.filter((event) => event.type === 'imu')).toHaveLength(0);
    expect(adapter.rejections).toMatchObject({ incomplete: 2, regressed: 0, refused: 0 });
  });

  it('refuses a sample whose clock stepped backwards instead of reordering it', () => {
    // Sorting a regressing clock into place is the erasure the capture
    // chronology rules exist to prevent, so it must not happen here either.
    const session = recorder();
    const adapter = new HandsetCaptureAdapter(session);

    adapter.handleMotion(motion(100));
    adapter.handleMotion(motion(80));
    adapter.handleMotion(motion(120));

    const events = session.buildSession().events.filter((event) => event.type === 'imu');
    expect(events.map((event) => event.timeMs)).toEqual([0, 20]);
    expect(adapter.rejections).toMatchObject({ regressed: 1 });
  });

  it('ignores an orientation event with missing angles', () => {
    const session = recorder();
    const adapter = new HandsetCaptureAdapter(session);

    adapter.handleOrientation({ timeStamp: 0, alpha: null, beta: null, gamma: null });
    adapter.handleMotion(motion(10));

    const events = session.buildSession().events.filter((event) => event.type === 'imu');
    expect(events[0].orientation).toBeNull();
    expect(adapter.pairing).toMatchObject({ unpairedCount: 1 });
  });
});

describe('what the adapter produces is a valid capture', () => {
  it('builds a session the capture schema accepts', () => {
    const session = recorder();
    const adapter = new HandsetCaptureAdapter(session);

    adapter.handleOrientation(orientation(0, 90, 0));
    for (let timeStamp = 0; timeStamp <= 3_000; timeStamp += 20) {
      adapter.handleMotion(
        motion(
          timeStamp,
          { alpha: 0, beta: 30, gamma: 0 },
          { x: 0, y: 0, z: 9.81 + 3 * Math.sin((2 * Math.PI * timeStamp) / 500) },
        ),
      );
    }
    session.recordLifecycle('session-end', 3_100);

    expect(validateCaptureSession(session.buildSession())).toEqual([]);
  });

  it('is still refused as evidence, which is the decision this unblocks', () => {
    // Interpretable is not the same as admissible, and this is where the two
    // part company. The projection can now resolve a device-frame turn, but the
    // policy admits only native/world/deg/s, so every handset walk this adapter
    // produces is refused outright.
    //
    // Pinned deliberately. Widening the policy is a decision that should be
    // taken once the orientation lag this adapter measures is known, and this
    // test is what makes taking it loud rather than incidental.
    const session = recorder();
    const adapter = new HandsetCaptureAdapter(session);

    adapter.handleOrientation(orientation(0, 90, 0));
    for (let timeStamp = 0; timeStamp <= 2_000; timeStamp += 20) {
      adapter.handleMotion(motion(timeStamp, { alpha: 0, beta: 0, gamma: 30 }));
    }
    session.recordLifecycle('session-end', 2_100);

    const { report } = buildEvidenceReport(session.buildSession());
    expect(report.evidenceStatus).toBe('unsupported-sensor-model');
  });

  it('carries the tilt every recorded turn needs to be projected at all', () => {
    // The precondition for admitting device-frame data: no inertial sample may
    // reach the stream without the orientation that resolves it. A walk that
    // met the policy but carried null tilts would still be unprojectable.
    const session = recorder();
    const adapter = new HandsetCaptureAdapter(session);

    adapter.handleOrientation(orientation(0, 90, 0));
    for (let timeStamp = 0; timeStamp <= 500; timeStamp += 20) {
      adapter.handleMotion(motion(timeStamp, { alpha: 0, beta: 0, gamma: 30 }));
    }

    const imu = session.buildSession().events.filter((event) => event.type === 'imu');
    expect(imu.length).toBeGreaterThan(0);
    expect(imu.every((event) => event.orientation !== null)).toBe(true);
  });
});

describe('asking for motion access', () => {
  it('separates a platform that never asks from one that granted', async () => {
    await expect(requestMotionPermission(undefined)).resolves.toBe('unsupported');
    await expect(requestMotionPermission({})).resolves.toBe('not-required');
    await expect(
      requestMotionPermission({ requestPermission: async () => 'granted' }),
    ).resolves.toBe('granted');
    await expect(
      requestMotionPermission({ requestPermission: async () => 'denied' }),
    ).resolves.toBe('denied');
  });

  it('treats a throw as a denial rather than crashing the walk', async () => {
    // iOS throws when the request happens outside a user gesture.
    await expect(
      requestMotionPermission({
        requestPermission: async () => {
          throw new Error('requires a user gesture');
        },
      }),
    ).resolves.toBe('denied');
  });
});

describe('a tilt from the future is not a tilt', () => {
  it('refuses to pair an orientation stamped after the sample it would explain', () => {
    // Reported by review: orientation at 200 ms paired with motion at 100 ms
    // produced a validating capture whose median, p95 and worst staleness were
    // all -100 ms. A negative lag is not a lag, and the orientation describes a
    // pose the handset had not reached yet.
    const session = recorder();
    const adapter = new HandsetCaptureAdapter(session);

    adapter.handleOrientation(orientation(200, 90, 0));
    adapter.handleMotion(motion(100, { alpha: 0, beta: 0, gamma: 30 }));

    const events = session.buildSession().events.filter((event) => event.type === 'imu');
    expect(events).toHaveLength(1);
    expect(events[0].orientation).toBeNull();

    expect(adapter.pairing.pairedCount).toBe(0);
    expect(adapter.pairing.medianStalenessMs).toBeNull();
    expect(adapter.pairing.worstStalenessMs).toBeNull();
    expect(adapter.rejections.futureOrientation).toBe(1);
  });

  it('never reports a negative lag in the distribution', () => {
    const session = recorder();
    const adapter = new HandsetCaptureAdapter(session);

    adapter.handleOrientation(orientation(500, 90, 0));
    for (const timeStamp of [100, 200, 300, 600, 700]) {
      adapter.handleMotion(motion(timeStamp));
    }

    const { medianStalenessMs, p95StalenessMs, worstStalenessMs, pairedCount } = adapter.pairing;
    expect(pairedCount).toBe(2);
    for (const value of [medianStalenessMs, p95StalenessMs, worstStalenessMs]) {
      expect(value).not.toBeNull();
      expect(value as number).toBeGreaterThanOrEqual(0);
    }
  });

  it('pairs again once orientation catches up', () => {
    // The refusal is per sample, not a latch: a clock hiccup must not cost the
    // rest of the walk its tilt.
    const session = recorder();
    const adapter = new HandsetCaptureAdapter(session);

    adapter.handleOrientation(orientation(200, 90, 0));
    adapter.handleMotion(motion(100));
    adapter.handleMotion(motion(300));

    expect(adapter.pairing.pairedCount).toBe(1);
    expect(adapter.rejections.futureOrientation).toBe(1);
  });
});

describe('the session clock is defined by the samples that are stored in it', () => {
  /** The check the earlier tests were missing: does the capture actually validate? */
  function validated(session: ReturnType<typeof recorder>) {
    const built = session.buildSession();
    return {
      issues: validateCaptureSession(built),
      imuTimes: built.events.filter((event) => event.type === 'imu').map((event) => event.timeMs),
    };
  }

  it('is not dated from an orientation, which is never stored as an event', () => {
    // The regression: orientation at 200 ms then a sample at 100 ms dated the
    // stream from the orientation, stored timeMs -100, and the whole capture
    // failed validation as malformed-event. The earlier test for this checked
    // the tilt and the lag fields and never validated the session.
    const session = recorder();
    const adapter = new HandsetCaptureAdapter(session);

    adapter.handleOrientation(orientation(200, 90, 0));
    adapter.handleMotion(motion(100, { alpha: 0, beta: 0, gamma: 30 }));

    const { issues, imuTimes } = validated(session);
    expect(issues).toEqual([]);
    expect(imuTimes).toEqual([0]);
  });

  it('never stores a negative timestamp, whatever order the channels arrive in', () => {
    const session = recorder();
    const adapter = new HandsetCaptureAdapter(session);

    adapter.handleOrientation(orientation(5_000, 90, 0));
    for (const timeStamp of [100, 120, 140, 6_000]) adapter.handleMotion(motion(timeStamp));

    const { issues, imuTimes } = validated(session);
    expect(issues).toEqual([]);
    expect(Math.min(...imuTimes)).toBeGreaterThanOrEqual(0);
  });

  it('refuses a sample from before an explicit origin instead of storing it negative', () => {
    // The same defect on the parallel path: an origin later than the first
    // sample also wrote a negative timeMs and failed validation.
    const session = recorder();
    const adapter = new HandsetCaptureAdapter(session, { originTimeStampMs: 1_000 });

    adapter.handleMotion(motion(500));
    adapter.handleMotion(motion(1_250));

    const { issues, imuTimes } = validated(session);
    expect(issues).toEqual([]);
    expect(imuTimes).toEqual([250]);
    expect(adapter.rejections.regressed).toBe(1);
  });

  it('still produces a valid capture on the ordinary path', () => {
    const session = recorder();
    const adapter = new HandsetCaptureAdapter(session);

    adapter.handleOrientation(orientation(0, 90, 0));
    for (let timeStamp = 0; timeStamp <= 400; timeStamp += 20) adapter.handleMotion(motion(timeStamp));
    session.recordLifecycle('session-end', 500);

    expect(validated(session).issues).toEqual([]);
  });
});

describe('values that are not times', () => {
  it('ignores an orientation whose timestamp is not a number', () => {
    // The worst of the set, because it was silent: the capture validated
    // cleanly, reported a paired sample, and carried a lag distribution of NaN
    // that JSON writes out as null. A hole where the measurement should be,
    // with nothing flagged anywhere.
    const session = recorder();
    const adapter = new HandsetCaptureAdapter(session);

    adapter.handleOrientation({ timeStamp: Number.NaN, alpha: 0, beta: 90, gamma: 0, absolute: false });
    adapter.handleMotion(motion(100));

    const built = session.buildSession();
    const imu = built.events.filter((event) => event.type === 'imu');
    expect(validateCaptureSession(built)).toEqual([]);
    expect(imu[0].orientation).toBeNull();
    expect(adapter.pairing).toMatchObject({
      pairedCount: 0,
      unpairedCount: 1,
      medianStalenessMs: null,
      p95StalenessMs: null,
      worstStalenessMs: null,
    });
  });

  it('refuses a construction that could only produce broken times', () => {
    // Loud at construction, because these are programming errors rather than
    // sensor behaviour, and everything downstream of them is arithmetic.
    for (const origin of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => new HandsetCaptureAdapter(recorder(), { originTimeStampMs: origin })).toThrow(
        /finite/,
      );
    }
    expect(
      () => new HandsetCaptureAdapter(recorder(), { maxOrientationStalenessMs: Number.NaN }),
    ).toThrow(/finite/);
    expect(
      () => new HandsetCaptureAdapter(recorder(), { maxOrientationStalenessMs: -5 }),
    ).toThrow(/non-negative/);
  });

  it('accepts the option shapes that are legitimate', () => {
    expect(() => new HandsetCaptureAdapter(recorder(), {})).not.toThrow();
    expect(
      () => new HandsetCaptureAdapter(recorder(), { maxOrientationStalenessMs: null }),
    ).not.toThrow();
    expect(
      () => new HandsetCaptureAdapter(recorder(), { originTimeStampMs: 0, maxOrientationStalenessMs: 0 }),
    ).not.toThrow();
  });

  it('refuses a sample whose session time overflows two finite timestamps', () => {
    const session = recorder();
    const adapter = new HandsetCaptureAdapter(session, { originTimeStampMs: -Number.MAX_VALUE });

    adapter.handleMotion(motion(Number.MAX_VALUE));

    const built = session.buildSession();
    expect(validateCaptureSession(built)).toEqual([]);
    expect(built.events.filter((event) => event.type === 'imu')).toHaveLength(0);
    expect(adapter.rejections.regressed).toBe(1);
  });

  it('keeps every reported lag statistic finite', () => {
    const session = recorder();
    const adapter = new HandsetCaptureAdapter(session);

    adapter.handleOrientation({ timeStamp: Number.NaN, alpha: 0, beta: 1, gamma: 2, absolute: false });
    adapter.handleOrientation(orientation(100, 90, 0));
    adapter.handleMotion(motion(140));
    adapter.handleMotion(motion(160));

    for (const value of [
      adapter.pairing.medianStalenessMs,
      adapter.pairing.p95StalenessMs,
      adapter.pairing.worstStalenessMs,
    ]) {
      expect(value).not.toBeNull();
      expect(Number.isFinite(value as number)).toBe(true);
    }
  });
});

describe('a refused sample leaves no trace', () => {
  it('does not let an overflowing sample advance the clock or count itself', () => {
    // Reported by review. The chronology and the pairing counters were updated
    // before the derived session time was checked, so a refused sample still
    // moved the clock forward and still counted as recorded: nothing stored,
    // one recorded sample, and the next perfectly good sample refused as a
    // regression against a timestamp that was never accepted.
    const session = recorder();
    const adapter = new HandsetCaptureAdapter(session, { originTimeStampMs: -Number.MAX_VALUE });

    adapter.handleMotion(motion(Number.MAX_VALUE));
    adapter.handleMotion(motion(-Number.MAX_VALUE + 1_000));

    const built = session.buildSession();
    expect(validateCaptureSession(built)).toEqual([]);
    expect(built.events.filter((event) => event.type === 'imu')).toHaveLength(1);
    expect(adapter.recordedSamples).toBe(1);
    expect(adapter.rejections.regressed).toBe(1);
  });

  it('keeps recordedSamples equal to what the stream actually holds', () => {
    const session = recorder();
    const adapter = new HandsetCaptureAdapter(session, { originTimeStampMs: 1_000 });

    adapter.handleMotion(motion(500));   // before the origin
    adapter.handleMotion(motion(1_100)); // good
    adapter.handleMotion(motion(900));   // regresses
    adapter.handleMotion(motion(1_200)); // good
    adapter.handleMotion({
      timeStamp: 1_300,
      accelerationIncludingGravity: null,
      rotationRate: { alpha: 0, beta: 0, gamma: 0 },
    }); // incomplete

    const stored = session.buildSession().events.filter((event) => event.type === 'imu').length;
    expect(stored).toBe(2);
    expect(adapter.recordedSamples).toBe(stored);
    expect(adapter.pairing.pairedCount + adapter.pairing.unpairedCount).toBe(stored);
  });

  it('does not let a refused sample block the next good one', () => {
    const session = recorder();
    const adapter = new HandsetCaptureAdapter(session, { originTimeStampMs: 0 });

    adapter.handleMotion(motion(100));
    adapter.handleMotion(motion(50)); // refused as a regression
    adapter.handleMotion(motion(150)); // must still be accepted

    const times = session
      .buildSession()
      .events.filter((event) => event.type === 'imu')
      .map((event) => event.timeMs);
    expect(times).toEqual([100, 150]);
  });
});
