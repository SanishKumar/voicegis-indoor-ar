import { describe, expect, it } from 'vitest';
import type { PortalSource, SpaceSource } from '@voicegis/spatial-schema';
import { ASTERION_PACKAGE, HARBOR_PACKAGE } from '../test/venueFixtures';
import { deriveCartographicWalls, deriveFloorplanCartography } from './floorplanCartography';

const leftRoom: SpaceSource = {
  id: 'left-room',
  floorId: 'g',
  name: 'Left room',
  type: 'room',
  polygon: [
    [0, 0],
    [4, 0],
    [4, 4],
    [0, 4],
  ],
  public: true,
  accessible: true,
};

const rightRoom: SpaceSource = {
  id: 'right-room',
  floorId: 'g',
  name: 'Right room',
  type: 'room',
  polygon: [
    [4, 0],
    [8, 0],
    [8, 4],
    [4, 4],
  ],
  public: true,
  accessible: true,
};

const sharedDoor: PortalSource = {
  id: 'shared-door',
  floorId: 'g',
  kind: 'door',
  connects: [leftRoom.id, rightRoom.id],
  position: [4, 2],
  width: 1,
  accessible: true,
};

const outline: [number, number][] = [
  [0, 0],
  [8, 0],
  [8, 4],
  [0, 4],
];

describe('floorplan cartography derivation', () => {
  it('de-duplicates a shared partition while preserving the portal-width gap', () => {
    const walls = deriveCartographicWalls([leftRoom, rightRoom], [sharedDoor], outline);
    const sharedPartitionRuns = walls.filter(
      (wall) => wall.kind === 'partition' && wall.spaceIds.length === 2,
    );

    expect(sharedPartitionRuns).toHaveLength(2);
    expect(sharedPartitionRuns.reduce((sum, wall) => sum + wall.length, 0)).toBeCloseTo(3, 6);
    expect(sharedPartitionRuns.every((wall) => wall.spaceIds.join(',') === 'left-room,right-room'))
      .toBe(true);
  });

  it('is deterministic when source arrays arrive in a different order', () => {
    const first = deriveCartographicWalls([leftRoom, rightRoom], [sharedDoor], outline);
    const second = deriveCartographicWalls([rightRoom, leftRoom], [sharedDoor], outline);

    expect(second).toEqual(first);
  });

  it('derives isolated floor geometry for two unrelated venue packages', () => {
    const asterionFloorId = ASTERION_PACKAGE.floors[0].id;
    const harborFloorId = HARBOR_PACKAGE.floors[0].id;
    const asterion = deriveFloorplanCartography(ASTERION_PACKAGE, asterionFloorId);
    const harbor = deriveFloorplanCartography(HARBOR_PACKAGE, harborFloorId);

    const asterionPortalIds = new Set(
      ASTERION_PACKAGE.portals
        .filter((portal) => portal.floorId === asterionFloorId)
        .map((portal) => portal.id),
    );
    const harborPortalIds = new Set(
      HARBOR_PACKAGE.portals
        .filter((portal) => portal.floorId === harborFloorId)
        .map((portal) => portal.id),
    );
    const harborSpaceIds = new Set(
      HARBOR_PACKAGE.spaces
        .filter((space) => space.floorId === harborFloorId)
        .map((space) => space.id),
    );

    expect(asterion.portals.every((portal) => asterionPortalIds.has(portal.id))).toBe(true);
    expect(harbor.portals.every((portal) => harborPortalIds.has(portal.id))).toBe(true);
    expect(
      harbor.walls.every((wall) => wall.spaceIds.every((spaceId) => harborSpaceIds.has(spaceId))),
    ).toBe(true);
    expect(harbor.connectorStops.some((stop) => stop.kind === 'escalator')).toBe(true);
    expect(harbor).not.toEqual(asterion);
    expect(deriveFloorplanCartography(HARBOR_PACKAGE, harborFloorId)).toEqual(harbor);
  });
});
