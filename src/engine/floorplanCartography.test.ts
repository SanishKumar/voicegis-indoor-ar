import { describe, expect, it } from 'vitest';
import type { PortalSource, SpaceSource } from '@voicegis/spatial-schema';
import { ASTERION_PACKAGE, HARBOR_PACKAGE } from '../test/venueFixtures';
import {
  createCartographicProjection,
  deriveCartographicExtrusionFaces,
  deriveCartographicWalls,
  deriveFloorplanCartography,
  getCartographicBounds,
  placeCartographicLabels,
  projectCartographicPoint,
  projectCartographicPortalFrame,
} from './floorplanCartography';

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
    expect(
      sharedPartitionRuns.every((wall) => wall.spaceIds.join(',') === 'left-room,right-room'),
    ).toBe(true);
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

  it('projects the same canonical layout into deterministic plan and perspective scenes', () => {
    const plan = createCartographicProjection(outline, 'plan', 10, 20);
    const perspective = createCartographicProjection(outline, 'perspective', 10, 20);

    expect(projectCartographicPoint(plan, [0, 0])).toEqual([20, 20]);
    expect(projectCartographicPoint(plan, [8, 4])).toEqual([100, 60]);
    expect(perspective.height).toBeLessThan(plan.height);
    expect(createCartographicProjection(outline, 'perspective', 10, 20)).toEqual(perspective);

    const projectedOutline = outline.map((point) => projectCartographicPoint(perspective, point));
    const projectedBounds = getCartographicBounds(projectedOutline);
    expect(projectedBounds.minX).toBeCloseTo(20, 6);
    expect(projectedBounds.minY).toBeCloseTo(20, 6);
    expect(projectedBounds.maxX).toBeCloseTo(perspective.width - 20, 6);
    expect(projectedBounds.maxY).toBeCloseTo(perspective.height - 20, 6);
  });

  it('keeps portal glyphs aligned after perspective projection', () => {
    const projection = createCartographicProjection(outline, 'perspective', 10, 20);
    const frame = projectCartographicPortalFrame(projection, {
      position: sharedDoor.position,
      width: sharedDoor.width,
      angleRadians: Math.PI / 2,
    });

    expect(frame.width).toBeGreaterThan(0);
    expect(Number.isFinite(frame.angleRadians)).toBe(true);
    const projectedCenter = projectCartographicPoint(projection, sharedDoor.position);
    expect(frame.center[0]).toBeCloseTo(projectedCenter[0], 8);
    expect(frame.center[1]).toBeCloseTo(projectedCenter[1], 8);
  });

  it('creates only the visible slab faces for a pitched floor plate', () => {
    const projection = createCartographicProjection(outline, 'perspective', 10, 20);
    const projectedOutline = outline.map((point) => projectCartographicPoint(projection, point));
    const faces = deriveCartographicExtrusionFaces(projectedOutline, 14);

    expect(faces.length).toBeGreaterThan(0);
    expect(faces.length).toBeLessThan(outline.length);
    for (const face of faces) {
      expect(face.points[2][1] - face.points[1][1]).toBeCloseTo(14, 8);
    }
  });

  it('places higher-priority labels first and removes deterministic collisions', () => {
    const candidates = [
      { id: 'secondary', center: [50, 50] as [number, number], width: 60, height: 24, priority: 2 },
      { id: 'primary', center: [55, 50] as [number, number], width: 60, height: 24, priority: 10 },
      { id: 'separate', center: [150, 50] as [number, number], width: 50, height: 24, priority: 1 },
    ];

    expect(placeCartographicLabels(candidates).map((label) => label.id)).toEqual([
      'primary',
      'separate',
    ]);
    expect(placeCartographicLabels([...candidates].reverse())).toEqual(
      placeCartographicLabels(candidates),
    );
  });
});
