import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveLocalizationSession, watchLocalizationSession } from './index';
import type { CheckpointAnchor } from './checkpoints';
import type { RouteMatchSegment } from './types';

function options() {
  return {
    identity: { sessionId: 'walk-a', buildingId: 'venue', packageHash: 'hash-a', routeRevision: 1 },
    anchors: [
      {
        id: 'start',
        floorId: 'g',
        kind: 'qr',
        position: [0, 0],
        headingDegrees: 90,
        payload: 'start',
      },
      {
        id: 'far',
        floorId: 'g',
        kind: 'qr',
        position: [10, 0],
        headingDegrees: 90,
        payload: 'far',
      },
      { id: 'up', floorId: '1', kind: 'qr', position: [10, 0], headingDegrees: 90, payload: 'up' },
    ] as CheckpointAnchor[],
    elevationByFloorId: { g: 0, '1': 4 },
    routeSegments: [
      {
        id: 'ground',
        floorId: 'g',
        from: [0, 0],
        to: [20, 0],
        lengthMeters: 20,
        startProgressMeters: 0,
      },
      {
        id: 'upper',
        floorId: '1',
        from: [0, 0],
        to: [20, 0],
        lengthMeters: 20,
        startProgressMeters: 30,
      },
    ] as RouteMatchSegment[],
  };
}

function calibration(timeMs: number) {
  return {
    timeMs,
    headingDegrees: 90,
    accuracyDegrees: 2,
    reference: 'filter-local' as const,
    axis: 'travel' as const,
    source: 'visual-anchor' as const,
    buildingId: 'venue',
    packageHash: 'hash-a',
    provenanceId: `independent-pose-${timeMs}`,
  };
}

function motion(timeMs: number, distanceMeters = 0) {
  return {
    timeMs,
    headingDegrees: 90,
    headingAccuracyDegrees: 2,
    stride: distanceMeters ? { distanceMeters, durationMs: 500, varianceMeters2: 0.001 } : null,
  };
}

function start(session = new LiveLocalizationSession(options()), timeMs = 0, payload = 'start') {
  const lease = session.beginAcquisition(timeMs);
  expect(session.reacquire(lease, { timeMs, kind: 'qr', payload }, timeMs).accepted).toBe(true);
  expect(session.calibrate(lease, calibration(timeMs), timeMs).accepted).toBe(true);
  expect(session.motion(lease, motion(timeMs), timeMs).accepted).toBe(true);
  expect(session.read(timeMs).guidanceState).toBe('active');
  return { session, lease };
}

afterEach(() => vi.useRealTimers());

describe('live localization session lifecycle', () => {
  it('starts frozen and keeps QR position separate from travel heading and motion freshness', () => {
    const session = new LiveLocalizationSession(options());
    expect(session.read(0)).toMatchObject({ guidanceState: 'frozen', reason: 'not-started' });
    const lease = session.beginAcquisition(0);
    expect(session.reacquire(lease, { timeMs: 0, kind: 'qr', payload: 'start' }, 0).accepted).toBe(
      true,
    );
    expect(session.read(0)).toMatchObject({
      guidanceState: 'frozen',
      estimate: { headingDegrees: null },
    });
    session.calibrate(lease, calibration(0), 0);
    expect(session.read(0)).toMatchObject({ guidanceState: 'frozen', reason: 'awaiting-motion' });
    session.motion(lease, motion(0), 0);
    expect(session.read(0).guidanceState).toBe('active');
  });

  it('expires without any new observation and never extrapolates the last stride', () => {
    const { session, lease } = start();
    session.motion(lease, motion(500, 1), 500);
    expect(session.read(1_999).guidanceState).not.toBe('frozen');
    expect(session.read(2_000)).toMatchObject({
      guidanceState: 'frozen',
      reason: 'stale-motion',
      progressMeters: null,
      estimate: { timeMs: 500 },
    });
    expect(session.read(2_000).estimate?.position[0]).toBeCloseTo(1);
    expect(session.read(2_000).estimate?.position[1]).toBeCloseTo(0);
    expect(session.read(20_000).estimate?.position[0]).toBeCloseTo(1);
  });

  it('checks expiry before a newly arriving sample can refresh the session', () => {
    const { session, lease } = start();
    expect(session.motion(lease, motion(1_500, 1), 1_500).accepted).toBe(false);
    expect(session.read(1_500)).toMatchObject({ reason: 'stale-motion', guidanceState: 'frozen' });
  });

  it.each(['hidden', 'permission-denied', 'sensor-unavailable', 'floor-change'] as const)(
    'revokes in-flight work on %s and cannot recover from ordinary samples',
    (reason) => {
      const { session, lease } = start();
      session.interrupt(reason, 100);
      expect(session.motion(lease, motion(200, 1), 200).accepted).toBe(false);
      const next = session.beginAcquisition(200);
      expect(
        session.reacquire(lease, { timeMs: 200, kind: 'qr', payload: 'far' }, 200).accepted,
      ).toBe(false);
      expect(session.motion(next, motion(200, 1), 200).accepted).toBe(false);
      expect(session.read(200)).toMatchObject({ guidanceState: 'frozen', progressMeters: null });
    },
  );

  it('reacquires a distant checkpoint only with a new lease, then requires new calibration', () => {
    const { session, lease } = start();
    expect(
      session.reacquire(lease, { timeMs: 100, kind: 'qr', payload: 'far' }, 100).accepted,
    ).toBe(false);
    const next = session.beginAcquisition(200);
    expect(session.reacquire(next, { timeMs: 200, kind: 'qr', payload: 'far' }, 200).accepted).toBe(
      true,
    );
    expect(session.read(200)).toMatchObject({
      guidanceState: 'frozen',
      estimate: { position: [10, 0, 0], headingDegrees: null },
    });
    session.calibrate(next, calibration(200), 200);
    session.motion(next, motion(200), 200);
    expect(session.read(200)).toMatchObject({ guidanceState: 'active', progressMeters: 10 });
  });

  it('refuses leases from another route revision even with the same venue and session IDs', () => {
    const { lease } = start();
    const config = options();
    config.identity.routeRevision = 2;
    const replacement = new LiveLocalizationSession(config);
    replacement.beginAcquisition(0);
    expect(
      replacement.reacquire(lease, { timeMs: 0, kind: 'qr', payload: 'start' }, 0).accepted,
    ).toBe(false);
    expect(replacement.read(0).estimate).toBeNull();
  });

  it('does not infer a connector traversal, but can explicitly reacquire an upper-floor checkpoint', () => {
    const { session } = start();
    session.interrupt('floor-change', 100);
    const lease = session.beginAcquisition(200);
    session.reacquire(lease, { timeMs: 200, kind: 'qr', payload: 'up' }, 200);
    expect(session.read(200)).toMatchObject({
      guidanceState: 'frozen',
      estimate: { floorId: '1', position: [10, 0, 4] },
    });
  });

  it('rejects scans that occurred before the acquisition boundary', () => {
    const { session } = start();
    const lease = session.beginAcquisition(100);
    expect(session.reacquire(lease, { timeMs: 99, kind: 'qr', payload: 'far' }, 100).accepted).toBe(
      false,
    );
    expect(session.read(100).guidanceState).toBe('frozen');
  });

  it('cannot restart a disposed session or accept its pending work', () => {
    const { session, lease } = start();
    session.stop(100);
    expect(() => session.beginAcquisition(200)).toThrow('stopped');
    expect(session.motion(lease, motion(200), 200).accepted).toBe(false);
    expect(session.read(200)).toMatchObject({ reason: 'stopped', guidanceState: 'frozen' });
  });

  it('publishes watchdog expiry without sensor callbacks and cancels its timer', () => {
    vi.useFakeTimers();
    const { session } = start();
    const listener = vi.fn();
    const epoch = Date.now();
    const dispose = watchLocalizationSession(session, {
      now: () => Date.now() - epoch,
      onSnapshot: listener,
    });
    vi.advanceTimersByTime(1_500);
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({ reason: 'stale-motion', guidanceState: 'frozen' }),
    );
    dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('discards a stride whose interval crosses the latest acquisition boundary', () => {
    const { session, lease } = start(undefined, 1_000);
    expect(session.motion(lease, motion(1_100, 1), 1_100).accepted).toBe(false);
    expect(session.read(1_100)).toMatchObject({ guidanceState: 'frozen', progressMeters: null });
    expect(session.read(1_100).estimate?.position[0]).toBe(0);
  });

  it('discards overlapping strides instead of counting the same interval twice', () => {
    const { session, lease } = start();
    expect(session.motion(lease, motion(500, 1), 500).accepted).toBe(true);
    expect(session.motion(lease, motion(600, 1), 600).accepted).toBe(false);
    expect(session.read(600).estimate?.position[0]).toBeCloseTo(1);
  });

  it('fails closed on a missing stride field instead of throwing while guidance remains active', () => {
    const { session, lease } = start();
    const frame = { ...motion(100), stride: undefined } as unknown as ReturnType<typeof motion>;
    expect(() => session.motion(lease, frame, 100)).not.toThrow();
    expect(session.read(100).guidanceState).toBe('frozen');
  });

  it('retires the watchdog after the session stops', () => {
    vi.useFakeTimers();
    const { session } = start();
    const epoch = Date.now();
    watchLocalizationSession(session, { now: () => Date.now() - epoch, onSnapshot: vi.fn() });
    session.stop(0);
    vi.advanceTimersByTime(250);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('drops duplicate/out-of-order motion without refreshing its occurrence timestamp', () => {
    const { session, lease } = start();
    session.motion(lease, motion(500, 1), 500);
    expect(session.motion(lease, motion(500, 1), 900).accepted).toBe(false);
    expect(session.motion(lease, motion(499, 1), 901).accepted).toBe(false);
    expect(session.read(901).estimate?.position[0]).toBeCloseTo(1);
    expect(session.read(2_000).reason).toBe('stale-motion');
  });

  it('accepts contiguous stride intervals, once each', () => {
    const { session, lease } = start();
    expect(session.motion(lease, motion(500, 0.5), 500).accepted).toBe(true);
    expect(session.motion(lease, motion(1_000, 0.5), 1_000).accepted).toBe(true);
    expect(session.read(1_000).progressMeters).toBeCloseTo(1);
  });

  it('never replays unlocated strides when heading is calibrated later', () => {
    const session = new LiveLocalizationSession(options());
    const lease = session.beginAcquisition(0);
    session.reacquire(lease, { timeMs: 0, kind: 'qr', payload: 'start' }, 0);
    session.motion(lease, motion(500, 0.1), 500);
    expect(session.read(500).estimate?.position[0]).toBe(0);
    session.calibrate(lease, calibration(500), 500);
    expect(session.read(500).estimate?.position[0]).toBe(0);
    expect(session.motion(lease, motion(600, 0.1), 600).accepted).toBe(false);
  });

  it('latches a route rejection and requires checkpoint reacquisition', () => {
    const { session, lease } = start();
    session.motion(lease, motion(500, 3), 500);
    expect(session.read(500)).toMatchObject({
      guidanceState: 'frozen',
      reason: 'route-rejected',
      progressMeters: null,
      routeMatch: { accepted: false, reason: 'forward-progress' },
    });
    expect(session.motion(lease, motion(1_000), 1_000).accepted).toBe(false);
    expect(session.calibrate(lease, calibration(1_000), 1_000).accepted).toBe(false);
  });

  it('freezes on lost quality even while complete motion frames keep arriving', () => {
    const { session, lease } = start();
    for (let time = 500; time <= 16_000; time += 500) session.motion(lease, motion(time), time);
    expect(session.read(16_000)).toMatchObject({ guidanceState: 'frozen', reason: 'quality-lost' });
  });

  it('resolves failed scans transactionally without replacing the last checkpoint', () => {
    const config = options();
    config.anchors.push({
      ...config.anchors[0],
      id: 'outside',
      payload: 'outside',
      position: [0, 100],
    });
    const { session } = start(new LiveLocalizationSession(config));
    const lease = session.beginAcquisition(100);
    expect(
      session.reacquire(lease, { timeMs: 100, kind: 'qr', payload: 'outside' }, 100).accepted,
    ).toBe(false);
    expect(session.read(100)).toMatchObject({
      checkpointAnchorId: 'start',
      estimate: { position: [0, 0, 0] },
      guidanceState: 'frozen',
    });
    expect(
      session.reacquire(lease, { timeMs: 100, kind: 'qr', payload: 'far' }, 100).accepted,
    ).toBe(true);
    expect(session.read(100).estimate?.position[0]).toBe(10);
  });

  it.each(['unknown', 'ambiguous', 'kind-mismatch', 'no-route', 'invalid-route'])(
    'refuses %s checkpoint acquisition',
    (failure) => {
      const config = options();
      if (failure === 'ambiguous') config.anchors.push({ ...config.anchors[0], id: 'duplicate' });
      if (failure === 'no-route') config.routeSegments = [];
      if (failure === 'invalid-route') config.routeSegments[0].lengthMeters = NaN;
      const session = new LiveLocalizationSession(config);
      const lease = session.beginAcquisition(0);
      const result = session.reacquire(
        lease,
        {
          timeMs: 0,
          kind: failure === 'kind-mismatch' ? 'nfc' : 'qr',
          payload: failure === 'unknown' ? 'unknown' : 'start',
        },
        0,
      );
      expect(result.accepted).toBe(false);
      expect(session.read(0)).toMatchObject({
        guidanceState: 'frozen',
        estimate: null,
        progressMeters: null,
      });
    },
  );

  it.each([-1, NaN, Infinity, 1_001, 499])(
    'refuses invalid/future/stale acquisition time %s',
    (timeMs) => {
      const session = new LiveLocalizationSession(options());
      const lease = session.beginAcquisition(0);
      expect(
        session.reacquire(lease, { timeMs, kind: 'qr', payload: 'start' }, 1_000).accepted,
      ).toBe(false);
      expect(session.read(1_000).estimate).toBeNull();
    },
  );

  it('ages from occurrence, not delivery, including scans received at the delivery limit', () => {
    const session = new LiveLocalizationSession(options());
    const lease = session.beginAcquisition(0);
    expect(
      session.reacquire(lease, { timeMs: 0, kind: 'qr', payload: 'start' }, 500).accepted,
    ).toBe(true);
    session.calibrate(lease, calibration(500), 500);
    expect(session.read(1_500)).toMatchObject({ reason: 'stale-motion', guidanceState: 'frozen' });
  });

  it.each([
    { buildingId: 'different' },
    { packageHash: 'different' },
    { provenanceId: '' },
    { source: 'manual-anchor' },
    { source: 'replay' },
    { axis: 'camera-forward' },
    { headingDegrees: NaN },
    { accuracyDegrees: 0 },
  ])('rejects unqualified calibration %j', (change) => {
    const session = new LiveLocalizationSession(options());
    const lease = session.beginAcquisition(0);
    session.reacquire(lease, { timeMs: 0, kind: 'qr', payload: 'start' }, 0);
    const invalid = { ...calibration(0), ...change } as ReturnType<typeof calibration>;
    expect(session.calibrate(lease, invalid, 0).accepted).toBe(false);
    expect(session.read(0)).toMatchObject({
      guidanceState: 'frozen',
      estimate: { headingDegrees: null },
    });
  });

  it.each([
    { headingDegrees: null },
    { headingAccuracyDegrees: null },
    { headingDegrees: NaN },
    { headingAccuracyDegrees: -1 },
    { stride: { distanceMeters: Infinity, durationMs: 100, varianceMeters2: 0 } },
    { stride: { distanceMeters: 1, durationMs: 0, varianceMeters2: 0 } },
  ])('freezes invalid or incomplete motion %j', (change) => {
    const { session, lease } = start();
    expect(session.motion(lease, { ...motion(100), ...change }, 100).accepted).toBe(false);
    expect(session.read(100).guidanceState).toBe('frozen');
    expect(session.motion(lease, motion(200), 200).accepted).toBe(false);
  });

  it.each([NaN, Infinity, -1, 99])('fails closed on invalid/regressing clock %s', (timeMs) => {
    const { session } = start(undefined, 100);
    expect(() => session.read(timeMs)).toThrow('clock');
    expect(session.read(100)).toMatchObject({ reason: 'clock-invalid', guidanceState: 'frozen' });
  });

  it('isolates route/anchor/configuration inputs, outputs and copied lease fields', () => {
    const config = options();
    const session = new LiveLocalizationSession(config);
    config.anchors[0].position[0] = 9;
    config.elevationByFloorId.g = 50;
    config.identity.packageHash = 'new-hash';
    config.routeSegments[0].to[0] = 100;
    const { lease } = start(session);
    const snapshot = session.read(0);
    snapshot.estimate!.position[0] = 19;
    snapshot.routeMatch!.progressMeters = 19;
    snapshot.identity.packageHash = 'mutated';
    expect(session.motion({ ...lease }, motion(500, 1), 500).accepted).toBe(false);
    expect(session.motion(lease, motion(500, 1), 500).accepted).toBe(true);
    expect(session.read(500)).toMatchObject({
      identity: { packageHash: 'hash-a' },
      progressMeters: 1,
    });
  });

  it.each([
    { motionTimeoutMs: 0 },
    { motionTimeoutMs: NaN },
    { maximumDeliveryAgeMs: Infinity },
    { maximumDeliveryAgeMs: -1 },
    { maximumDeliveryAgeMs: 1_500 },
  ])('rejects invalid freshness tuning %j', (tuning) => {
    expect(() => new LiveLocalizationSession({ ...options(), ...tuning })).toThrow('freshness');
  });

  it('requires explicit elevation rather than silently assuming the ground floor', () => {
    expect(
      () => new LiveLocalizationSession({ ...options(), elevationByFloorId: { g: 0 } }),
    ).toThrow('elevations');
  });

  it('allows position/heading recovery after timeout only through a new acquisition', () => {
    const { session, lease } = start();
    session.read(1_500);
    const recovered = start(session, 2_000, 'far');
    expect(session.motion(lease, motion(2_500, 1), 2_500).accepted).toBe(false);
    expect(session.motion(recovered.lease, motion(2_500, 1), 2_500).accepted).toBe(true);
    expect(session.read(2_500).progressMeters).toBeCloseTo(11);
  });

  it('reports refusal when calibration ages uncertainty into an ambiguous route match', () => {
    const config = options();
    config.routeSegments.push({
      id: 'nearby',
      floorId: 'g',
      from: [0, 2],
      to: [20, 2],
      startProgressMeters: 100,
      lengthMeters: 20,
    });
    const session = new LiveLocalizationSession(config);
    const lease = session.beginAcquisition(0);
    expect(session.reacquire(lease, { timeMs: 0, kind: 'qr', payload: 'start' }, 0).accepted).toBe(
      true,
    );
    expect(session.calibrate(lease, calibration(1_000), 1_000).accepted).toBe(false);
    expect(session.read(1_000)).toMatchObject({
      reason: 'route-rejected',
      guidanceState: 'frozen',
    });
  });

  it('cancels the diagnostic timer if its consumer throws', () => {
    vi.useFakeTimers();
    const { session } = start();
    const epoch = Date.now();
    const listener = vi
      .fn()
      .mockImplementationOnce(() => {})
      .mockImplementation(() => {
        throw new Error('consumer failed');
      });
    watchLocalizationSession(session, { now: () => Date.now() - epoch, onSnapshot: listener });
    expect(() => vi.advanceTimersByTime(250)).toThrow('consumer failed');
    expect(vi.getTimerCount()).toBe(0);
  });
});
