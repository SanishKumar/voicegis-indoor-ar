import { describe, expect, it } from 'vitest';
import { insetPolygon, roundCorners, stadium, type Point } from './softGeometry';

const SQUARE: Point[] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];
// The same room drawn the other way round, as a floor plan is free to do.
const SQUARE_CLOCKWISE: Point[] = [...SQUARE].reverse();
// An L: one corner turns the other way.
const L_SHAPE: Point[] = [
  [0, 0],
  [10, 0],
  [10, 4],
  [4, 4],
  [4, 10],
  [0, 10],
];

function area(polygon: readonly Point[]) {
  let total = 0;
  polygon.forEach(([x1, y1], index) => {
    const [x2, y2] = polygon[(index + 1) % polygon.length];
    total += x1 * y2 - x2 * y1;
  });
  return Math.abs(total) / 2;
}

function bounds(polygon: readonly Point[]) {
  const xs = polygon.map((point) => point[0]);
  const ys = polygon.map((point) => point[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

describe('insetPolygon', () => {
  it('moves every edge of a square in by the distance', () => {
    expect(insetPolygon(SQUARE, 1)).toEqual([
      [1, 1],
      [9, 1],
      [9, 9],
      [1, 9],
    ]);
  });

  it('moves inward whichever way round the points run', () => {
    const [minX, minY, maxX, maxY] = bounds(insetPolygon(SQUARE_CLOCKWISE, 1));
    expect([minX, minY, maxX, maxY]).toEqual([1, 1, 9, 9]);
  });

  it('moves outward for a negative distance', () => {
    expect(bounds(insetPolygon(SQUARE, -0.5))).toEqual([-0.5, -0.5, 10.5, 10.5]);
  });

  it('handles a corner that turns the other way', () => {
    const inset = insetPolygon(L_SHAPE, 1);
    // The inside corner of the L moves away from the notch, not into it.
    expect(inset[3][0]).toBeCloseTo(3);
    expect(inset[3][1]).toBeCloseTo(3);
    expect(area(inset)).toBeLessThan(area(L_SHAPE));
  });

  it('leaves a room alone rather than turning it inside out', () => {
    const closet: Point[] = [
      [0, 0],
      [0.3, 0],
      [0.3, 4],
      [0, 4],
    ];
    expect(insetPolygon(closet, 0.2)).toEqual(closet);
  });

  it('ignores a closing point that repeats the first', () => {
    expect(insetPolygon([...SQUARE, SQUARE[0]], 1)).toHaveLength(4);
  });
});

describe('roundCorners', () => {
  it('stays inside the outline it rounds and keeps the edges where they were', () => {
    const rounded = roundCorners(SQUARE, 2);
    expect(bounds(rounded)).toEqual([0, 0, 10, 10]);
    expect(area(rounded)).toBeLessThan(area(SQUARE));
    expect(area(rounded)).toBeGreaterThan(area(SQUARE) * 0.9);
    // The corner itself is gone; the curve passes inside it.
    expect(rounded.some(([x, y]) => x === 0 && y === 0)).toBe(false);
  });

  it('starts each curve the radius back from the corner', () => {
    const rounded = roundCorners(SQUARE, 2, 4);
    // Five points per corner, the first on the incoming edge.
    expect(rounded).toHaveLength(20);
    expect(rounded[0]).toEqual([0, 2]);
    expect(rounded[4]).toEqual([2, 0]);
  });

  it('never rounds by more than half an edge, so neighbouring curves do not cross', () => {
    const rounded = roundCorners(SQUARE, 50, 4);
    for (const [x, y] of rounded) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(10);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(10);
    }
    // Each curve ends where the next begins: the midpoint of the edge.
    expect(rounded[4]).toEqual(rounded[5]);
  });

  it('rounds a corner that turns the other way without leaving the shape', () => {
    const rounded = roundCorners(L_SHAPE, 1);
    expect(area(rounded)).toBeGreaterThan(area(L_SHAPE) * 0.95);
    expect(bounds(rounded)).toEqual([0, 0, 10, 10]);
  });

  it('passes a point on a straight run through untouched', () => {
    const withMidpoint: Point[] = [
      [0, 0],
      [5, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    expect(roundCorners(withMidpoint, 1)).toContainEqual([5, 0]);
  });

  it('returns the polygon as given when there is nothing to round by', () => {
    expect(roundCorners(SQUARE, 0)).toEqual(SQUARE);
  });
});

describe('stadium', () => {
  it('is as long as the run plus its two round ends, and as wide as asked', () => {
    const [minX, minY, maxX, maxY] = bounds(stadium([0, 0], [10, 0], 0.5));
    expect(minX).toBeCloseTo(-0.5);
    expect(maxX).toBeCloseTo(10.5);
    expect(minY).toBeCloseTo(-0.5);
    expect(maxY).toBeCloseTo(0.5);
  });

  it('keeps every point the half-width from the run', () => {
    for (const [x, y] of stadium([2, 3], [2, 9], 0.25, 4)) {
      const nearestY = Math.min(9, Math.max(3, y));
      expect(Math.hypot(x - 2, y - nearestY)).toBeCloseTo(0.25);
    }
  });

  it('is empty for a run with no length', () => {
    expect(stadium([1, 1], [1, 1], 0.5)).toEqual([]);
  });
});
