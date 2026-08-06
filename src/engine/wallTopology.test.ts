import { describe, expect, it } from 'vitest';
import type { Coordinate2D } from '@voicegis/spatial-schema';
import { buildFloorWallTopology } from './wallTopology';

const square = (x0: number, y0: number, x1: number, y1: number): Coordinate2D[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

const entry = { id: 'entry', polygon: square(0, 0, 4, 8) };
const gallery = { id: 'gallery', polygon: square(4, 0, 8, 8) };
const door = {
  connects: ['entry', 'gallery'] as [string, string],
  position: [4, 4] as Coordinate2D,
  width: 1,
};

const onSharedEdge = (wall: { start: Coordinate2D; end: Coordinate2D }) =>
  wall.start[0] === 4 && wall.end[0] === 4;

describe('floor wall topology', () => {
  it('emits one body per shared boundary instead of one per adjoining space', () => {
    const walls = buildFloorWallTopology([entry, gallery], [door]);
    const shared = walls.filter(onSharedEdge);

    // Walling each space independently produces four slabs here: two per side,
    // split around the door. Correct topology produces two.
    expect(shared).toHaveLength(2);
    expect(shared.every((wall) => wall.kind === 'interior')).toBe(true);
    expect(shared.every((wall) => wall.spaceIds.join(',') === 'entry,gallery')).toBe(true);
  });

  it('splits a shared boundary where two neighbours meet part way along it', () => {
    const walls = buildFloorWallTopology(
      [
        { id: 'corridor', polygon: square(0, 0, 2, 10) },
        { id: 'room-a', polygon: square(2, 0, 6, 4) },
        { id: 'room-b', polygon: square(2, 4, 6, 10) },
      ],
      [],
    );
    const shared = walls.filter((wall) => wall.start[0] === 2 && wall.end[0] === 2);

    expect(shared).toEqual([
      expect.objectContaining({
        kind: 'interior',
        spaceIds: ['corridor', 'room-a'],
        start: [2, 0],
        end: [2, 4],
      }),
      expect.objectContaining({
        kind: 'interior',
        spaceIds: ['corridor', 'room-b'],
        start: [2, 4],
        end: [2, 10],
      }),
    ]);
  });

  it('classifies perimeter runs as exterior and attributes them to one space', () => {
    const walls = buildFloorWallTopology([entry, gallery], [door]);
    const exterior = walls.filter((wall) => wall.kind === 'exterior');

    expect(exterior.length).toBeGreaterThan(0);
    expect(exterior.every((wall) => wall.spaceIds.length === 1)).toBe(true);
    expect(walls.filter((wall) => wall.kind === 'interior').every((w) => w.spaceIds.length === 2)).toBe(
      true,
    );
  });

  it('cuts a portal opening once rather than reopening it per space', () => {
    const walls = buildFloorWallTopology([entry, gallery], [door]);
    const shared = walls.filter(onSharedEdge);
    const covered = shared.reduce((total, wall) => total + wall.length, 0);

    // The boundary is 8m long and the door is 1m wide.
    expect(covered).toBeCloseTo(7, 6);
    expect(shared.map((wall) => wall.length)).toEqual([3.5, 3.5]);
  });

  it('leaves a boundary solid when the portal belongs to unrelated spaces', () => {
    const walls = buildFloorWallTopology(
      [entry, gallery],
      [
        {
          connects: ['storage', 'plant'] as [string, string],
          position: [4, 4] as Coordinate2D,
          width: 1,
        },
      ],
    );

    expect(walls.filter(onSharedEdge)).toEqual([
      expect.objectContaining({ start: [4, 0], end: [4, 8], length: 8 }),
    ]);
  });

  it('is deterministic under space and portal ordering', () => {
    const forward = buildFloorWallTopology([entry, gallery], [door]);
    const reversed = buildFloorWallTopology([gallery, entry], [door]);

    expect(reversed).toEqual(forward);
  });

  it('handles diagonal boundaries, not just axis-aligned ones', () => {
    const walls = buildFloorWallTopology(
      [
        {
          id: 'west',
          polygon: [
            [0, 0],
            [4, 4],
            [0, 4],
          ] as Coordinate2D[],
        },
        {
          id: 'east',
          polygon: [
            [0, 0],
            [4, 0],
            [4, 4],
          ] as Coordinate2D[],
        },
      ],
      [],
    );
    const diagonal = walls.filter((wall) => wall.spaceIds.length === 2);

    expect(diagonal).toEqual([
      expect.objectContaining({ kind: 'interior', spaceIds: ['east', 'west'] }),
    ]);
    expect(diagonal[0].length).toBeCloseTo(Math.hypot(4, 4), 6);
  });
});
