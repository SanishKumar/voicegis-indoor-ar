import { describe, expect, it } from 'vitest';
import { buildRouteTrack } from './routeProgress';
import { planarRouteLegs } from './routePlanarLegs';

const track = (points: [number, number, string?][]) =>
  buildRouteTrack(
    points.map(([x, y, floor = 'g'], i) => ({ id: String(i), x, y, floor })),
    [],
  );

describe('straight route legs independent of node density', () => {
  it('coalesces subdivided forward geometry and duplicate nodes', () => {
    expect(
      planarRouteLegs(
        track([
          [0, 0],
          [1, 0],
          [1, 0],
          [2, 0],
          [3, 0],
        ]),
      ),
    ).toEqual([{ startIndex: 0, endIndex: 4, bearing: 90 }]);
  });
  it.each([
    [2, 1],
    [1, 0],
    [2, 0.01],
  ])('does not merge a bend or reversal towards (%s, %s)', (x, y) => {
    expect(
      planarRouteLegs(
        track([
          [0, 0],
          [2, 0],
          [x, y],
        ]),
      ),
    ).toHaveLength(2);
  });
  it('never joins across floors, even when a later visit has the same direction', () => {
    const legs = planarRouteLegs(
      track([
        [0, 0],
        [2, 0],
        [2, 0, '1'],
        [4, 0, '1'],
        [4, 0],
        [6, 0],
      ]),
    );
    expect(legs.map(({ startIndex, endIndex }) => [startIndex, endIndex])).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
    ]);
  });
  it('has no planar legs for an empty, point-only or vertical route', () => {
    for (const points of [
      [],
      [[1, 1]],
      [
        [1, 1],
        [1, 1],
      ],
      [
        [1, 1],
        [1, 1, '1'],
      ],
    ] as [number, number, string?][][]) {
      expect(planarRouteLegs(track(points))).toEqual([]);
    }
  });
});
