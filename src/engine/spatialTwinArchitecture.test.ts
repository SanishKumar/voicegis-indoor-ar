import { describe, expect, it } from 'vitest';
import type { PortalSource, SpaceSource } from '@voicegis/spatial-schema';
import {
  buildSpaceWallSegments,
  getNearestBoundaryAngle,
  getPolygonBounds,
} from './spatialTwinArchitecture';

const room: SpaceSource = {
  id: 'room',
  floorId: 'g',
  name: 'Room',
  type: 'room',
  polygon: [
    [0, 0],
    [6, 0],
    [6, 4],
    [0, 4],
  ],
  public: true,
  accessible: true,
};

const door: PortalSource = {
  id: 'door',
  floorId: 'g',
  kind: 'door',
  connects: ['room', 'corridor'],
  position: [3, 4],
  width: 1.2,
  accessible: true,
};

describe('spatial twin architectural derivation', () => {
  it('cuts a portal-width gap into the matching boundary wall', () => {
    const segments = buildSpaceWallSegments(room, [door]);

    expect(segments).toHaveLength(5);
    expect(segments.reduce((total, segment) => total + segment.length, 0)).toBeCloseTo(
      20 - door.width,
      6,
    );
    const splitBoundarySegments = segments.filter(
      (segment) => segment.start[1] === 4 && segment.end[1] === 4,
    );
    expect(splitBoundarySegments).toHaveLength(2);
    expect(splitBoundarySegments[0].end[0]).toBeCloseTo(3.6, 6);
    expect(splitBoundarySegments[1].start[0]).toBeCloseTo(2.4, 6);
  });

  it('ignores portals that do not belong to the space', () => {
    const unrelatedDoor = { ...door, connects: ['other-room', 'corridor'] } as PortalSource;
    const segments = buildSpaceWallSegments(room, [unrelatedDoor]);

    expect(segments).toHaveLength(4);
    expect(segments.reduce((total, segment) => total + segment.length, 0)).toBeCloseTo(20, 6);
  });

  it('finds the boundary orientation nearest a portal', () => {
    expect(getNearestBoundaryAngle(room.polygon, door.position)).toBeCloseTo(Math.PI, 6);
  });

  it('summarises a polygon footprint for semantic prop placement', () => {
    expect(getPolygonBounds(room.polygon)).toEqual({
      minX: 0,
      minY: 0,
      maxX: 6,
      maxY: 4,
      width: 6,
      depth: 4,
      center: [3, 2],
    });
  });
});
