import { describe, expect, it } from 'vitest';
import { LocalizationFilter } from '../../packages/localization-core/src/filter';
import { calculateRoute } from '../engine/routingCore';
import {
  planBearing,
  planDisplacement,
  reflectPlanFilterPosition,
  resolvePlanHeading,
  signedHeadingDifference,
  wrapDegrees,
  type HeadingContext,
  type HeadingReading,
  type PlanPosition,
} from './coordinateFrames';

describe('explicit Visitor coordinate frames', () => {
  it.each([
    [0, [0, -2]],
    [90, [2, 0]],
    [180, [0, 2]],
    [270, [-2, 0]],
  ] as const)(
    'agrees between routing, plan and reflected filter for %s degrees',
    (bearing, delta) => {
      const from: PlanPosition = [10, 20];
      const to: PlanPosition = [from[0] + delta[0], from[1] + delta[1]];
      expect(planBearing(from, to)).toBe(bearing);
      const displacement = planDisplacement(bearing, 2);
      expect(displacement[0]).toBeCloseTo(delta[0], 12);
      expect(displacement[1]).toBeCloseTo(delta[1], 12);
      const route = calculateRoute(
        'a',
        'b',
        [
          { id: 'a', x: from[0], y: from[1], floor: 'g', type: 'corridor' },
          { id: 'b', x: to[0], y: to[1], floor: 'g', type: 'corridor' },
        ],
        [{ from: 'a', to: 'b', distance: 2 }],
      );
      expect(route.found && route.steps[0].bearing).toBe(bearing);
      const filter = new LocalizationFilter({}, { buildingId: 'synthetic', packageHash: 'synthetic-cardinal-test' });
      filter.apply({
        kind: 'initial-fix',
        sequence: 0,
        timeMs: 0,
        source: 'manual-anchor',
        position: reflectPlanFilterPosition(from),
        floorId: 'g',
        elevationMeters: 4,
        headingDegrees: null,
        headingAccuracyDegrees: null,
        accuracyMeters: 0.1,
      });
      filter.apply({ kind: 'heading-calibration', sequence: 1, timeMs: 0, source: 'replay',
        headingDegrees: bearing, accuracyDegrees: 1, reference: 'filter-local', axis: 'travel',
        buildingId: 'synthetic', packageHash: 'synthetic-cardinal-test', provenanceId: 'constructed-cardinal-axis' });
      const result = filter.apply({
        kind: 'step',
        sequence: 1,
        timeMs: 1_000,
        source: 'pedometer',
        distanceMeters: 2,
        durationMs: 1_000,
        varianceMeters2: 0.1,
      });
      const back = reflectPlanFilterPosition([result.position[0], result.position[1]]);
      expect(back[0]).toBeCloseTo(to[0], 12);
      expect(back[1]).toBeCloseTo(to[1], 12);
      expect(result.position[2]).toBe(4);
      expect(result.floorId).toBe('g');
    },
  );

  it('round-trips arbitrary plan positions without moving their origin', () => {
    for (const point of [
      [-3, 12],
      [9, -1],
      [0, 0],
    ] as const) {
      expect(reflectPlanFilterPosition(reflectPlanFilterPosition(point))).toEqual(point);
    }
    expect(Object.is(reflectPlanFilterPosition([0, 0])[1], -0)).toBe(false);
  });

  it('does not invent a direction from coincident or invalid points', () => {
    expect(planBearing([1, 1], [1, 1])).toBeNull();
    expect(planBearing([1, NaN], [1, 1])).toBeNull();
    expect(planBearing([-Number.MAX_VALUE, 0], [Number.MAX_VALUE, 0])).toBeNull();
    expect(() => reflectPlanFilterPosition([0, Infinity])).toThrow();
    expect(() => planDisplacement(NaN, 1)).toThrow();
    expect(() => planDisplacement(0, -1)).toThrow();
  });

  it('normalizes finite angles and takes the short turn across north', () => {
    expect(wrapDegrees(-720)).toBe(0);
    expect(wrapDegrees(725)).toBe(5);
    expect(signedHeadingDifference(1, 359)).toBe(2);
    expect(signedHeadingDifference(359, 1)).toBe(-2);
    expect(signedHeadingDifference(180, 0)).toBe(-180);
    expect(() => wrapDegrees(Infinity)).toThrow();
  });
});

const reading: HeadingReading = {
  degrees: 90,
  reference: { kind: 'true-north' },
  axis: 'camera-forward',
  source: 'measured-pose',
  timeMs: 1_000,
  accuracyDegrees: 3,
};
const context: HeadingContext = {
  venueKey: 'venue@package',
  axis: 'camera-forward',
  nowMs: 1_100,
  maximumAgeMs: 500,
  maximumAccuracyDegrees: 10,
  northAlignment: {
    venueKey: 'venue@package',
    northBearingInPlanDegrees: -12,
    accuracyDegrees: 2,
    provenanceId: 'synthetic-survey',
  },
  magneticCorrection: null,
};

describe('heading provenance and map alignment', () => {
  it.each([-90, -12, 0, 18, 90, 180, 359])(
    'applies explicit north-in-plan alignment %s',
    (north) => {
      for (const degrees of [0, 90, 180, 270]) {
        const result = resolvePlanHeading(
          { ...reading, degrees },
          {
            ...context,
            northAlignment: { ...context.northAlignment!, northBearingInPlanDegrees: north },
          },
        );
        expect(result).toMatchObject({
          status: 'known',
          degrees: wrapDegrees(degrees + north),
          accuracyDegrees: 5,
          timeMs: 1_000,
          venueKey: 'venue@package',
          axis: 'camera-forward',
          alignmentProvenanceIds: ['synthetic-survey'],
        });
      }
    },
  );

  it('does not silently treat a numeric venue northOffsetDegrees as a calibration', () => {
    expect(resolvePlanHeading(reading, { ...context, northAlignment: null })).toEqual({
      status: 'unknown',
      reason: 'north-unverified',
    });
  });

  it('keeps magnetic and true north distinct until an explicit correction is supplied', () => {
    const magnetic: HeadingReading = { ...reading, reference: { kind: 'magnetic-north' } };
    expect(resolvePlanHeading(magnetic, context)).toEqual({
      status: 'unknown',
      reason: 'magnetic-north-uncorrected',
    });
    expect(
      resolvePlanHeading(magnetic, {
        ...context,
        magneticCorrection: {
          declinationDegrees: 7,
          accuracyDegrees: 1,
          provenanceId: 'synthetic-declination',
        },
      }),
    ).toMatchObject({
      status: 'known',
      degrees: 85,
      accuracyDegrees: 6,
      alignmentProvenanceIds: ['synthetic-declination', 'synthetic-survey'],
    });
  });

  it('accepts explicit plan-frame calibration without applying north twice', () => {
    expect(
      resolvePlanHeading(
        {
          ...reading,
          reference: { kind: 'venue-plan', venueKey: context.venueKey },
          source: 'explicit-calibration',
        },
        context,
      ),
    ).toMatchObject({
      status: 'known',
      degrees: 90,
      accuracyDegrees: 3,
      alignmentProvenanceIds: [],
    });
  });

  it.each([
    [{ ...reading, reference: { kind: 'relative' } }, 'relative-only'],
    [{ ...reading, axis: 'device-top' }, 'axis-unverified'],
    [{ ...reading, axis: 'travel' }, 'axis-unverified'],
    [{ ...reading, axis: 'unspecified' }, 'axis-unverified'],
    [{ ...reading, timeMs: 599 }, 'stale'],
    [{ ...reading, timeMs: 1_101 }, 'invalid-reading'],
    [{ ...reading, timeMs: NaN }, 'invalid-reading'],
    [{ ...reading, degrees: Infinity }, 'invalid-reading'],
    [{ ...reading, accuracyDegrees: null }, 'accuracy-unknown'],
    [{ ...reading, accuracyDegrees: -1 }, 'accuracy-unknown'],
    [{ ...reading, accuracyDegrees: 9 }, 'too-uncertain'],
    [
      { ...reading, reference: { kind: 'venue-plan', venueKey: 'other-package' } },
      'venue-mismatch',
    ],
    [
      {
        ...reading,
        source: 'browser-compass',
        reference: { kind: 'venue-plan', venueKey: context.venueKey },
      },
      'invalid-reading',
    ],
  ] as const)('refuses an unsupported heading contract %#', (candidate, reason) => {
    expect(resolvePlanHeading(candidate, context)).toEqual({ status: 'unknown', reason });
  });

  it('refuses missing provenance, uncertainty and calibration for another venue revision', () => {
    for (const alignment of [
      { ...context.northAlignment!, provenanceId: '' },
      { ...context.northAlignment!, accuracyDegrees: NaN },
      { ...context.northAlignment!, venueKey: 'venue@old-package' },
    ])
      expect(resolvePlanHeading(reading, { ...context, northAlignment: alignment }).status).toBe(
        'unknown',
      );
    expect(resolvePlanHeading(null, context)).toEqual({ status: 'unknown', reason: 'no-reading' });
  });

  it('does not mutate readings or alignment metadata', () => {
    const before = structuredClone({ reading, context });
    resolvePlanHeading(reading, context);
    expect({ reading, context }).toEqual(before);
  });
});
