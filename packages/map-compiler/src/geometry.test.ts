import { describe, expect, it } from 'vitest';
import {
  pointInPolygon,
  pointOnPolygonBoundary,
  polygonArea,
  polygonCentroid,
  segmentInsidePolygon,
} from './geometry';

const square: [number, number][] = [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
];

describe('compiler geometry primitives', () => {
  it('calculates polygon area and centroid independent of winding order', () => {
    expect(polygonArea(square)).toBe(16);
    expect(polygonArea([...square].reverse())).toBe(16);
    expect(polygonCentroid(square)).toEqual([2, 2]);
    expect(polygonCentroid([...square].reverse())).toEqual([2, 2]);
  });

  it('treats boundary points as contained', () => {
    expect(pointOnPolygonBoundary([0, 2], square)).toBe(true);
    expect(pointInPolygon([0, 2], square)).toBe(true);
    expect(pointInPolygon([2, 2], square)).toBe(true);
    expect(pointInPolygon([5, 2], square)).toBe(false);
  });

  it('detects a segment that leaves a concave polygon', () => {
    const concave: [number, number][] = [
      [0, 0],
      [4, 0],
      [4, 1],
      [1, 1],
      [1, 4],
      [0, 4],
    ];
    expect(segmentInsidePolygon([0.5, 3], [3, 0.5], concave)).toBe(false);
    expect(segmentInsidePolygon([0.5, 3], [0.5, 0.5], concave)).toBe(true);
  });
});
