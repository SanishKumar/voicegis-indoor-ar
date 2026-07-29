import { describe, expect, it } from 'vitest';
import example from '../../packages/spatial-schema/examples/minimal-two-floor.json';
import type { BuildingSource } from '@voicegis/spatial-schema';
import {
  getFloorCanvasBounds,
  getSpacesForFloor,
  snapCoordinate,
  snapPoint,
  updateSpacePolygonVertex,
} from './floorCanvasModel';

describe('Venue Studio floor canvas model', () => {
  const source = example as unknown as BuildingSource;

  it('snaps metric coordinates deterministically', () => {
    expect(snapCoordinate(2.24, 0.5)).toBe(2);
    expect(snapCoordinate(2.26, 0.5)).toBe(2.5);
    expect(snapPoint([-0.1, 4.76], 0.5)).toEqual([0, 5]);
  });

  it('derives stable bounds from a floor outline', () => {
    expect(getFloorCanvasBounds(source.floors[0])).toEqual({
      minX: 0,
      minY: 0,
      maxX: 12,
      maxY: 8,
      width: 12,
      height: 8,
    });
  });

  it('returns only spaces on the selected floor', () => {
    const spaces = getSpacesForFloor(source, source.floors[0].id);

    expect(spaces.length).toBeGreaterThan(0);
    expect(spaces.every((space) => space.floorId === source.floors[0].id)).toBe(true);
  });

  it('updates one vertex without mutating the source or unrelated geometry', () => {
    const target = source.spaces[0];
    const unrelated = source.spaces[1];
    const before = structuredClone(source);
    const result = updateSpacePolygonVertex(source, target.id, 1, [3.5, 1.5]);

    expect(source).toEqual(before);
    expect(result).not.toBe(source);
    expect(result.spaces[0]).not.toBe(source.spaces[0]);
    expect(result.spaces[0].polygon[1]).toEqual([3.5, 1.5]);
    expect(result.spaces[0].polygon[0]).toBe(source.spaces[0].polygon[0]);
    expect(result.spaces[1]).toBe(unrelated);
  });

  it('does not create a new source for an unknown selection', () => {
    expect(updateSpacePolygonVertex(source, 'missing-space', 0, [1, 1])).toBe(source);
    expect(updateSpacePolygonVertex(source, source.spaces[0].id, 99, [1, 1])).toBe(source);
  });
});
