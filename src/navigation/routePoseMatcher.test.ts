import { describe, expect, it } from 'vitest';
import { buildRouteTrack, type RouteTrack } from './routeProgress';
import { matchRoutePose } from './routePoseMatcher';

function route(points: [number, number, string?][]) {
  return buildRouteTrack(
    points.map(([x, y, floor = 'g'], i) => ({ id: String(i), x, y, floor })),
    [],
  );
}
const straight = route([
  [0, 0],
  [20, 0],
]);
const corner = route([
  [0, 0],
  [10, 0],
  [10, 10],
]);
const match = (track: RouteTrack, x: number, y: number, previous = 0, movement = 0.5) =>
  matchRoutePose(track, { x, y, previousProgressMeters: previous, movementMeters: movement });

describe('local route matching of an unsnapped pose', () => {
  it.each([0.25, 2])(
    'matching is unchanged by %s metre subdivisions on a straight corridor',
    (spacing) => {
      const split = route(Array.from({ length: 20 / spacing + 1 }, (_, i) => [i * spacing, 0]));
      for (const [x, y, previous] of [
        [5.1, 1.3, 4.6],
        [5, 0, 5.5],
        [19.5, 0.5, 19],
      ]) {
        expect(match(split, x, y, previous)).toEqual(match(straight, x, y, previous));
      }
    },
  );
  it('projects lateral movement without counting it as forward travel', () => {
    expect(match(straight, 0.3, 0.4)).toEqual({
      kind: 'matched',
      progressMeters: 0.3,
      distanceMeters: 0.4,
    });
    expect(match(straight, 0, 1)).toEqual({
      kind: 'matched',
      progressMeters: 0,
      distanceMeters: 1,
    });
    expect(match(straight, 0, 2)).toEqual({ kind: 'held', reason: 'outside-route' });
  });

  it.each([0, 45, 90, 180, 270])(
    'has the same result after rotating the plan by %s degrees',
    (angle) => {
      const radians = (angle * Math.PI) / 180;
      const rotate = (x: number, y: number): [number, number] => [
        100 + x * Math.cos(radians) - y * Math.sin(radians),
        -50 + x * Math.sin(radians) + y * Math.cos(radians),
      ];
      const rotated = route([rotate(0, 0), rotate(20, 0)]);
      const [x, y] = rotate(0.3, 0.4);
      const result = match(rotated, x, y);
      expect(result.kind).toBe('matched');
      if (result.kind !== 'matched') throw new Error('expected a projection');
      expect(result.progressMeters).toBeCloseTo(0.3, 10);
      expect(result.distanceMeters).toBeCloseTo(0.4, 10);
    },
  );

  it('does not clamp an unreachable projection onto the progress window', () => {
    expect(match(straight, 4, 0, 0, 0.1)).toEqual({ kind: 'held', reason: 'unreachable' });
  });

  it('follows a real corner, including small corner rounding', () => {
    expect(match(corner, 10, 0.5, 10)).toMatchObject({ kind: 'matched', progressMeters: 10.5 });
    expect(match(corner, 9.8, 0.3, 9.5, 0.6)).toMatchObject({
      kind: 'matched',
      progressMeters: 10.3,
    });
  });

  it('holds at a missed corner rather than spending movement on the next leg', () => {
    expect(match(corner, 10.5, 0, 10)).toMatchObject({ kind: 'matched', progressMeters: 10 });
    expect(match(corner, 12, 0, 10)).toEqual({ kind: 'held', reason: 'outside-route' });
  });

  it('can retreat along the leg actually walked', () => {
    expect(match(corner, 9.5, 0, 10)).toMatchObject({ kind: 'matched', progressMeters: 9.5 });
  });

  it('does not jump to a later crossing or a nearby parallel return leg', () => {
    const crossing = route([
      [0, 0],
      [10, 0],
      [10, 10],
      [5, 10],
      [5, -10],
    ]);
    expect(match(crossing, 5, 0, 4.5)).toMatchObject({ kind: 'matched', progressMeters: 5 });
    const parallel = route([
      [0, 0],
      [20, 0],
      [20, 2],
      [0, 2],
    ]);
    expect(match(parallel, 5, 1.1, 4.5)).toMatchObject({ kind: 'matched', progressMeters: 5 });
  });

  it('holds when two nearby, reachable legs have similarly good matches', () => {
    const hairpin = route([
      [0, 0],
      [5, 0],
      [5, 0.4],
      [0, 0.4],
    ]);
    expect(match(hairpin, 4.5, 0.2, 5.2)).toEqual({ kind: 'held', reason: 'ambiguous' });
  });

  it('does not confuse repeated vertices at a corner with two possible locations', () => {
    const repeated = route([
      [0, 0],
      [10, 0],
      [10, 0],
      [10, 10],
    ]);
    expect(match(repeated, 10, 0, 9.5)).toMatchObject({ kind: 'matched', progressMeters: 10 });
    // Duplicating a vertex cannot turn a normal rounded corner into ambiguity.
    expect(match(repeated, 9.7, 0.3, 9.5)).toEqual(match(corner, 9.7, 0.3, 9.5));
  });

  it('cannot infer a storey change or match a later visit to the same storey', () => {
    const floors = route([
      [0, 0],
      [10, 0],
      [10, 0, '1'],
      [10, 10, '1'],
      [10, 10],
      [0, 10],
    ]);
    expect(match(floors, 10, 0, 9.5)).toMatchObject({ kind: 'matched', progressMeters: 10 });
    expect(match(floors, 10, 0, 13)).toEqual({ kind: 'held', reason: 'unreachable' });
    expect(match(floors, 5, 10, 5)).toEqual({ kind: 'held', reason: 'outside-route' });
    expect(match(floors, 10, 0.5, 16)).toMatchObject({ kind: 'matched', progressMeters: 16.5 });
    // Once alighted, the old floor cannot be reached by walking backwards.
    expect(match(floors, 9.5, 0, 16)).toMatchObject({ kind: 'matched', progressMeters: 16 });
  });

  it('supports a known point with no planar leg without inventing progress', () => {
    expect(match(route([[2, 3]]), 2.2, 3)).toMatchObject({ kind: 'matched', progressMeters: 0 });
    expect(
      match(
        route([
          [2, 3],
          [2, 3, '1'],
        ]),
        2,
        3,
      ),
    ).toMatchObject({ kind: 'matched', progressMeters: 0 });
  });

  it.each([
    [NaN, 0, 0, 0.5],
    [0, Infinity, 0, 0.5],
    [0, 0, NaN, 0.5],
    [0, 0, -1, 0.5],
    [0, 0, 21, 0.5],
    [0, 0, 0, -1],
    [0, 0, 0, Infinity],
  ])('rejects invalid input (%s, %s, %s, %s)', (x, y, previous, movement) => {
    expect(match(straight, x, y, previous, movement)).toEqual({
      kind: 'held',
      reason: 'invalid-input',
    });
  });

  it('rejects an empty route', () => {
    expect(match(route([]), 0, 0)).toEqual({ kind: 'held', reason: 'invalid-input' });
  });
});
