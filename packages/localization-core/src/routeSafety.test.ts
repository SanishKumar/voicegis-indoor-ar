import { describe, expect, it } from 'vitest';
import { matchEstimateToRoute, RouteMatchTracker } from './mapMatching';
import { LocalizationFilter } from './filter';
import { replayRecording } from './replay';
import { LocalizationRuntimeController } from './runtimeState';
import type {
  FloorObservation,
  LocalizationEstimate,
  LocalizationObservation,
  LocalizationRecording,
  RouteMatchSegment,
} from './types';

const segment = (
  id: string,
  from: [number, number],
  to: [number, number],
  startProgressMeters = 0,
  floorId = 'g',
): RouteMatchSegment => ({
  id,
  from,
  to,
  startProgressMeters,
  floorId,
  lengthMeters: Math.hypot(to[0] - from[0], to[1] - from[1]),
});

const estimate = (position: [number, number, number] = [2, 0, 0]): LocalizationEstimate => ({
  timeMs: 1_000,
  position,
  velocity: [0, 0, 0],
  headingDegrees: 90,
  floorId: 'g',
  covariance: [],
  positionSigmaMeters: 0.2,
  headingSigmaDegrees: 5,
  lastCorrectionTimeMs: 1_000,
  observationSources: ['manual-anchor'],
  quality: 'high',
});
const frame = { buildingId: 'synthetic', packageHash: 'route-safety-test' };
const initial: LocalizationObservation = {
  kind: 'initial-fix',
  sequence: 0,
  timeMs: 0,
  source: 'manual-anchor',
  position: [0, 0],
  floorId: 'g',
  elevationMeters: 0,
  accuracyMeters: 0.2,
  headingDegrees: null,
  headingAccuracyDegrees: null,
};
const calibration: LocalizationObservation = {
  kind: 'heading-calibration',
  sequence: 1,
  timeMs: 0,
  source: 'replay',
  headingDegrees: 90,
  accuracyDegrees: 5,
  reference: 'filter-local',
  axis: 'travel',
  ...frame,
  provenanceId: 'constructed-axis',
};
const floor = (source: 'barometer' | 'manual-anchor', confidence = 1): FloorObservation => ({
  kind: 'floor',
  sequence: 2,
  timeMs: 100,
  source,
  floorId: 'l1',
  elevationMeters: 4,
  confidence,
});
function recording(
  observations: LocalizationObservation[],
  routeSegments: RouteMatchSegment[],
): LocalizationRecording {
  return {
    schemaVersion: '0.2.0',
    sessionId: 'constructed-route-safety',
    ...frame,
    device: { label: 'constructed', platform: 'test' },
    privacy: { cameraFramesStored: false },
    observations,
    routeSegments,
    checkpoints: [],
  };
}

describe('route tracker acceptance and retained state', () => {
  const route = [segment('east', [0, 0], [50, 0])];
  const at = (x: number, timeMs: number) => ({ ...estimate([x, 0, 0]), timeMs });

  it('does not hop between disconnected corridor legs with deceptively close progress labels', () => {
    const tracker = new RouteMatchTracker([
      segment('a', [-10, 0], [0, 0]),
      segment('b', [0, 1.5], [10, 1.5], 10.5),
    ]);
    expect(tracker.match(at(0, 100)).accepted).toBe(true);
    expect(tracker.match({ ...estimate([1, 1.5, 0]), timeMs: 200 })).toMatchObject({
      accepted: false,
      reason: 'route-discontinuity',
    });
  });

  it('treats a densely subdivided straight corridor as one path, including skipped intermediate segments', () => {
    const paths = Array.from({ length: 10 }, (_, i) =>
      segment(String(i), [i / 10, 0], [(i + 1) / 10, 0], i / 10),
    );
    const tracker = new RouteMatchTracker(paths);
    expect(tracker.match(at(0.05, 100)).accepted).toBe(true);
    expect(tracker.match(at(0.95, 200)).accepted).toBe(true);
  });

  it('cannot reuse a stale accepted projection to activate a newer runtime frame', () => {
    const runtime = new LocalizationRuntimeController();
    const previous = at(1, 100);
    const match = matchEstimateToRoute(previous, route);
    expect(runtime.update(at(1, 200), match).guidanceState).toBe('frozen');
  });

  it('cannot omit the route gate after a route-bound runtime has rejected it', () => {
    const runtime = new LocalizationRuntimeController();
    runtime.update(at(1, 100), matchEstimateToRoute(at(1, 100), []));
    expect(runtime.update(at(1, 200)).guidanceState).toBe('frozen');
  });

  it.each(['floor', 'position'] as const)(
    'cannot apply an accepted projection from another %s',
    (field) => {
      const current = at(1, 100);
      const match = matchEstimateToRoute(current, route);
      if (field === 'floor') match.floorId = 'l1';
      else match.rawPosition = [2, 0];
      expect(new LocalizationRuntimeController().update(current, match).guidanceState).toBe(
        'frozen',
      );
    },
  );

  it('requires a current route match on explicit relocalization as well as normal updates', () => {
    const runtime = new LocalizationRuntimeController();
    const lost = { ...at(1, 100), quality: 'lost' as const };
    runtime.update(lost, matchEstimateToRoute(lost, route));
    runtime.beginRelocalization(200);
    const current = { ...at(1, 300), lastCorrectionTimeMs: 300 };
    expect(() => runtime.confirmRelocalization(current, 'g')).toThrow(/route match/);
    expect(() =>
      runtime.confirmRelocalization(current, 'g', matchEstimateToRoute(at(1, 200), route)),
    ).toThrow(/route match/);
    expect(
      runtime.confirmRelocalization(current, 'g', matchEstimateToRoute(current, route))
        .guidanceState,
    ).toBe('active');
    expect(runtime.update(at(1, 400)).guidanceState).toBe('frozen');
  });

  it('preserves ordinary progress across a straight subdivision and a shared turn endpoint', () => {
    expect(
      matchEstimateToRoute(estimate([4.9, 0, 0]), [
        segment('a', [0, 0], [5, 0]),
        segment('b', [5, 0], [10, 0], 5),
      ]).accepted,
    ).toBe(true);
    expect(
      matchEstimateToRoute(estimate([5, 0, 0]), [
        segment('a', [0, 0], [5, 0]),
        segment('b', [5, 0], [5, 5], 5),
      ]).accepted,
    ).toBe(true);
  });

  it('accepts a unique leg once uncertainty no longer overlaps the competing leg', () => {
    const paths = [segment('a', [0, 0], [10, 0]), segment('b', [10, 2], [0, 2], 20)];
    expect(matchEstimateToRoute(estimate([2, 0.1, 0]), paths)).toMatchObject({
      accepted: true,
      segmentId: 'a',
    });
  });

  it('does not let forward rejections, waiting or a returned result rewrite the cursor', () => {
    const tracker = new RouteMatchTracker(route);
    const result = tracker.match(at(0, 0));
    result.progressMeters = 40;
    expect(tracker.match(at(20, 1_000)).reason).toBe('forward-progress');
    expect(tracker.match(at(21, 20_000)).reason).toBe('forward-progress');
    expect(tracker.match(at(1, 20_100)).accepted).toBe(true);
  });

  it('requires a new explicit acquisition rather than silently changing the tracked floor', () => {
    const paths = [segment('g', [0, 0], [10, 0]), segment('l1', [0, 0], [10, 0], 10, 'l1')];
    const tracker = new RouteMatchTracker(paths);
    tracker.match(at(0, 0));
    const upstairs = {
      ...at(0, 100),
      floorId: 'l1',
      position: [0, 0, 4] as [number, number, number],
    };
    expect(tracker.match(upstairs).reason).toBe('floor-transition-unverified');
    expect(new RouteMatchTracker(paths).match(upstairs)).toMatchObject({
      accepted: true,
      progressMeters: 10,
    });
    expect(tracker.match(at(1, 200)).accepted).toBe(true);
  });

  it('snapshots route geometry and options instead of retaining caller-owned arrays', () => {
    const paths = structuredClone(route);
    const options = { maximumForwardMeters: 2 };
    const tracker = new RouteMatchTracker(paths, options);
    tracker.match(at(0, 0));
    paths[0].to[0] = 1;
    options.maximumForwardMeters = 50;
    expect(tracker.match(at(3, 100)).reason).toBe('forward-progress');
    expect(tracker.match(at(1, 200))).toMatchObject({ accepted: true, progressMeters: 1 });
  });

  it('keeps rejected timestamps ordered without corrupting the accepted cursor', () => {
    const tracker = new RouteMatchTracker(route);
    tracker.match(at(0, 0));
    tracker.match(at(10, 200));
    expect(tracker.match(at(1, 100)).reason).toBe('invalid-input');
    expect(tracker.match(at(1, 300)).accepted).toBe(true);
  });

  it.each([NaN, Infinity, -1])('refuses invalid matcher tuning %s', (maximumForwardMeters) => {
    expect(matchEstimateToRoute(at(1, 100), route, { maximumForwardMeters }).reason).toBe(
      'invalid-input',
    );
  });

  it.each(['length', 'coordinate', 'duplicate-id'] as const)(
    'refuses malformed route %s',
    (field) => {
      const paths = structuredClone(route);
      if (field === 'length') paths[0].lengthMeters = 0.1;
      if (field === 'coordinate') paths[0].from[0] = Infinity;
      if (field === 'duplicate-id') paths.push({ ...paths[0], from: [0, 1], to: [50, 1] });
      expect(matchEstimateToRoute(at(1, 100), paths).reason).toBe('invalid-input');
    },
  );
});

describe('route matching safety regressions', () => {
  it('does not accept a large forward jump simply because it is on the route', () => {
    expect(
      matchEstimateToRoute(estimate([40, 0, 0]), [segment('long', [0, 0], [50, 0])], {
        previousProgressMeters: 2,
      }),
    ).toMatchObject({ accepted: false, reason: 'forward-progress' });
  });

  it.each([false, true])(
    'refuses a crossing instead of choosing its furthest-progress leg (reverse %s)',
    (reverse) => {
      const route = [segment('east', [-5, 0], [5, 0]), segment('north', [0, -5], [0, 5], 30)];
      expect(
        matchEstimateToRoute(estimate([0, 0, 0]), reverse ? route.reverse() : route),
      ).toMatchObject({
        accepted: false,
        reason: 'ambiguous-route',
        matchedPosition: null,
        progressMeters: null,
      });
    },
  );

  it('refuses nearly equidistant parallel route legs inside position uncertainty', () => {
    expect(
      matchEstimateToRoute(estimate([2, 0.45, 0]), [
        segment('out', [0, 0], [10, 0]),
        segment('back', [10, 1], [0, 1], 20),
      ]),
    ).toMatchObject({ accepted: false, reason: 'ambiguous-route' });
  });

  it('does not promote invalid geometry or uncertainty to an accepted match', () => {
    const invalid = estimate();
    invalid.positionSigmaMeters = NaN;
    expect(matchEstimateToRoute(invalid, [segment('east', [0, 0], [10, 0])]).accepted).toBe(false);
  });

  it('does not equate unrelated crossing legs merely because their progress labels coincide', () => {
    expect(
      matchEstimateToRoute(estimate([0, 0, 0]), [
        segment('east', [-5, 0], [5, 0]),
        segment('north', [0, -5], [0, 5]),
      ]),
    ).toMatchObject({ accepted: false, reason: 'ambiguous-route' });
  });

  it('cannot advance progress twice at the same timestamp', () => {
    const tracker = new RouteMatchTracker([segment('east', [0, 0], [10, 0])]);
    expect(tracker.match(estimate()).accepted).toBe(true);
    expect(tracker.match(estimate([3, 0, 0]))).toMatchObject({
      accepted: false,
      reason: 'forward-progress',
    });
  });

  it('freezes replay guidance when the route projection is ambiguous', () => {
    const result = replayRecording(
      recording(
        [initial, calibration],
        [segment('east', [-5, 0], [5, 0]), segment('north', [0, -5], [0, 5], 30)],
      ),
    );
    expect(result.runtimeSnapshots.at(-1)?.guidanceState).toBe('frozen');
  });

  it('does not ratchet the backward baseline down on successive tolerated jitter frames', () => {
    const observations: LocalizationObservation[] = [initial, calibration];
    // Precise synthetic position corrections isolate matching, not filter drift.
    for (const [index, x] of [2, 1.4, 0.8].entries())
      observations.push({
        kind: 'position-fix',
        sequence: index + 2,
        timeMs: (index + 1) * 100,
        source: 'visual-anchor',
        position: [x, 0],
        accuracyMeters: 0.00001,
      });
    const result = replayRecording(recording(observations, [segment('east', [0, 0], [10, 0])]));
    expect(result.mapMatches.at(-1)).toMatchObject({
      accepted: false,
      reason: 'backward-progress',
    });
  });
});

describe('a scalar floor confidence is not floor-transition evidence', () => {
  const fix = (sequence: number, timeMs: number): LocalizationObservation => ({
    kind: 'position-fix',
    sequence,
    timeMs,
    source: 'manual-anchor',
    position: [0, 0],
    accuracyMeters: 0.2,
  });
  const initialized = () => {
    const filter = new LocalizationFilter({}, frame);
    filter.apply(initial);
    filter.apply(calibration);
    return filter;
  };

  it('rejects non-finite floor confidence without consuming a pending anchor pair', () => {
    const filter = initialized();
    filter.apply(fix(2, 100));
    expect(() => filter.apply({ ...floor('manual-anchor'), sequence: 3, confidence: NaN })).toThrow(
      /finite/,
    );
    expect(filter.apply({ ...floor('manual-anchor'), sequence: 3 })).toMatchObject({
      floorId: 'l1',
      floorTransitionPending: false,
    });
  });

  it('accepts adjacent same-time anchor position/floor observations as reacquisition, not route travel', () => {
    const filter = initialized();
    filter.apply(floor('barometer'));
    filter.apply(fix(3, 200));
    const result = filter.apply({ ...floor('manual-anchor'), sequence: 4, timeMs: 200 });
    expect(result).toMatchObject({
      floorId: 'l1',
      floorTransitionPending: false,
      headingDegrees: 90,
    });
    expect(result.position).toEqual([0, 0, 4]);
  });

  it.each(['late', 'wrong-source', 'intervening-heading', 'second-use', 'low-confidence'] as const)(
    'refuses an anchor-floor pair with %s',
    (failure) => {
      const filter = initialized();
      filter.apply(fix(2, 100));
      let claim = { ...floor('manual-anchor'), sequence: 3 };
      if (failure === 'late') claim = { ...claim, timeMs: 101 };
      if (failure === 'wrong-source') claim = { ...claim, source: 'barometer' };
      if (failure === 'intervening-heading') {
        filter.apply({
          kind: 'heading',
          sequence: 3,
          timeMs: 100,
          source: 'inertial',
          headingDegrees: 90,
          accuracyDegrees: 5,
        });
        claim = { ...claim, sequence: 4 };
      }
      if (failure === 'second-use') {
        filter.apply({ ...claim, floorId: 'g', elevationMeters: 0 });
        claim = { ...claim, sequence: 4 };
      }
      if (failure === 'low-confidence') claim = { ...claim, confidence: 0.7 };
      expect(filter.apply(claim)).toMatchObject({ floorId: 'g', floorTransitionPending: true });
    },
  );

  it('freezes displacement during a pending floor change without dropping observed-stride uncertainty', () => {
    const filter = initialized();
    const before = filter.apply(floor('barometer'));
    const after = filter.apply({
      kind: 'step',
      sequence: 3,
      timeMs: 200,
      source: 'pedometer',
      distanceMeters: 0.72,
      durationMs: 100,
      varianceMeters2: 0.09,
    });
    expect(after.position).toEqual(before.position);
    expect(after.velocity).toEqual([0, 0, 0]);
    expect(after.positionSigmaMeters).toBeGreaterThan(before.positionSigmaMeters);
  });

  it('a return anchor can confirm the retained floor and clear uncertainty', () => {
    const filter = initialized();
    filter.apply(floor('barometer'));
    filter.apply(fix(3, 200));
    expect(
      filter.apply({
        ...floor('manual-anchor'),
        sequence: 4,
        timeMs: 200,
        floorId: 'g',
        elevationMeters: 0,
      }),
    ).toMatchObject({ floorId: 'g', floorTransitionPending: false });
  });

  it('does not allow a pending floor to bypass lost-state recovery', () => {
    const runtime = new LocalizationRuntimeController();
    runtime.update({ ...estimate(), quality: 'lost' });
    runtime.beginRelocalization(1_000);
    expect(() =>
      runtime.confirmRelocalization({ ...estimate(), floorTransitionPending: true }, 'g'),
    ).toThrow(/floor/);
    expect(runtime.update({ ...estimate(), floorTransitionPending: true })).toMatchObject({
      localizationState: 'relocalizing',
      guidanceState: 'frozen',
    });
  });

  it.each(['barometer', 'manual-anchor'] as const)(
    'does not change floors on an unpaired %s claim',
    (source) => {
      const filter = new LocalizationFilter({}, frame);
      filter.apply(initial);
      filter.apply(calibration);
      const result = filter.apply(floor(source));
      expect(result.floorId).toBe('g');
      expect(result.position[2]).toBe(0);
    },
  );

  it('freezes spatial guidance on an unverified proposed floor change', () => {
    const result = replayRecording(
      recording(
        [initial, calibration, floor('barometer')],
        [segment('ground', [0, 0], [10, 0]), segment('upstairs', [0, 0], [10, 0], 10, 'l1')],
      ),
    );
    expect(result.estimates.at(-1)?.floorId).toBe('g');
    expect(result.runtimeSnapshots.at(-1)?.guidanceState).toBe('frozen');
    expect(result.mapMatches.at(-1)?.accepted).toBe(false);
  });

  it('cannot clear an uncertain floor by claiming the old floor with a barometer', () => {
    const claim = floor('barometer');
    const back: LocalizationObservation = {
      ...claim,
      sequence: 3,
      timeMs: 200,
      floorId: 'g',
      elevationMeters: 0,
    };
    const result = replayRecording(
      recording([initial, calibration, claim, back], [segment('g', [0, 0], [10, 0])]),
    );
    expect(result.runtimeSnapshots.at(-1)?.guidanceState).toBe('frozen');
  });
});
