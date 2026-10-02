import { describe, expect, it } from 'vitest';
import { cutOutline, insetPolygon, ribbon, roundCorners, type Point } from './softGeometry';

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

describe('cutOutline', () => {
  it('leaves one line round a room with one door, starting and ending at the door', () => {
    const lines = cutOutline(SQUARE, [{ at: [5, 0], halfWidth: 1 }]);
    expect(lines).toHaveLength(1);
    const [line] = lines;
    // From one side of the door, all the way round, to the other side.
    expect(line[0]).toEqual([6, 0]);
    expect(line[line.length - 1]).toEqual([4, 0]);
    expect(line).toEqual(
      expect.arrayContaining([
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ]),
    );
  });

  it('gives a line for each stretch between two doors', () => {
    const lines = cutOutline(SQUARE, [
      { at: [5, 0], halfWidth: 1 },
      { at: [5, 10], halfWidth: 1 },
    ]);
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      // Each runs up one side of the room: bottom, side, top.
      expect(line).toHaveLength(4);
    }
  });

  it('ignores a door that is beside some other wall', () => {
    expect(cutOutline(SQUARE, [{ at: [5, 5], halfWidth: 1 }])).toHaveLength(1);
    expect(cutOutline(SQUARE, [{ at: [40, 0], halfWidth: 1 }])).toHaveLength(1);
  });

  it('cuts a door that sits on a corner out of both walls', () => {
    const lines = cutOutline(SQUARE, [{ at: [10, 0], halfWidth: 1 }]);
    expect(lines).toHaveLength(1);
    expect(lines[0][0]).toEqual([10, 1]);
    expect(lines[0][lines[0].length - 1]).toEqual([9, 0]);
  });

  it('returns the whole outline, closed, when there is no door', () => {
    const lines = cutOutline(SQUARE, []);
    expect(lines).toHaveLength(1);
    expect(lines[0][0]).toEqual(lines[0][lines[0].length - 1]);
  });
});

describe('ribbon', () => {
  const distanceToSegment = ([x, y]: Point, [x1, y1]: Point, [x2, y2]: Point) => {
    const length = Math.hypot(x2 - x1, y2 - y1);
    const t = Math.min(1, Math.max(0, ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / length ** 2));
    return Math.hypot(x - (x1 + t * (x2 - x1)), y - (y1 + t * (y2 - y1)));
  };

  it('is the width asked for all along a straight line, with a round end at each end', () => {
    const outline = ribbon(
      [
        [0, 0],
        [10, 0],
      ],
      0.5,
      3,
    );
    const [minX, minY, maxX, maxY] = bounds(outline);
    expect(minY).toBeCloseTo(-0.5);
    expect(maxY).toBeCloseTo(0.5);
    // The ends bulge out by less than the half-width: a round end, not a square one.
    expect(minX).toBeLessThan(0);
    expect(minX).toBeGreaterThanOrEqual(-0.5);
    expect(maxX).toBeGreaterThan(10);
    for (const point of outline) {
      expect(distanceToSegment(point, [0, 0], [10, 0])).toBeCloseTo(0.5);
    }
  });

  it('turns a corner as one piece, keeping its width on both legs', () => {
    const line: Point[] = [
      [0, 0],
      [10, 0],
      [10, 10],
    ];
    const outline = ribbon(line, 0.5);
    // Outside of the corner and inside of it: the mitre points.
    expect(outline).toContainEqual([10.5, -0.5]);
    expect(outline).toContainEqual([9.5, 0.5]);
    expect(area(outline)).toBeGreaterThan(19.5);
    expect(area(outline)).toBeLessThan(21);
  });

  it('is one outline however many points the line has', () => {
    const curve: Point[] = Array.from({ length: 30 }, (_, index) => [
      Math.cos(index / 10) * 8,
      Math.sin(index / 10) * 8,
    ]);
    const outline = ribbon(curve, 0.2, 2);
    // Two sides and two round ends: nothing per segment.
    expect(outline).toHaveLength(30 * 2 + 4);
    for (const [x, y] of outline) {
      expect(Math.abs(Math.hypot(x, y) - 8)).toBeLessThan(0.25);
    }
  });

  it('is empty for a line with no length', () => {
    expect(
      ribbon(
        [
          [1, 1],
          [1, 1],
        ],
        0.5,
      ),
    ).toEqual([]);
  });
});
