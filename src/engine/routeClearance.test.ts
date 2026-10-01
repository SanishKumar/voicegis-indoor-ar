import { describe, expect, it } from 'vitest';
import type { CompiledBuildingPackage } from '@voicegis/map-compiler';
import type { Coordinate2D, SpaceSource } from '@voicegis/spatial-schema';
import { arChevronFootprint, createRouteGraphicGuard } from './routeClearance';
import { calculateCompiledRoute } from './compiledRoutePolicy';
import { createCompiledBuildingRuntime } from '../data/compiledBuilding';
import { ASTERION_RUNTIME, HARBOR_RUNTIME } from '../test/venueFixtures';
import reference from '../../buildings/reference-medical-centre/compiled/building.package.json';

const rectangle = (x0: number, y0: number, x1: number, y1: number): Coordinate2D[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];
const space = (id: string, polygon: Coordinate2D[]): SpaceSource => ({
  id,
  polygon,
  floorId: 'g',
  type: 'room',
  name: id,
  public: true,
  accessible: true,
});
function fixture(
  polygon = rectangle(0, 0, 10, 4),
  points: Coordinate2D[] = [
    [1, 2],
    [9, 2],
  ],
) {
  const path = points.map(([x, y], i) => ({ id: `n${i}`, x, y, floor: 'g' }));
  const venue = {
    ...(reference as unknown as CompiledBuildingPackage),
    building: {
      ...reference.building,
      entrySpaceId: 'a',
      coordinateSystem: { ...reference.building.coordinateSystem, origin: [0, 0, 0] },
    },
    spaces: [space('a', polygon)],
    portals: [],
    verticalConnectors: [],
    pois: [
      {
        id: 'entry',
        name: 'Entry',
        category: 'entrance',
        public: true,
        accessible: true,
        floorId: 'g',
        spaceId: 'a',
        position: points[0],
      },
    ],
    localizationAnchors: [],
    routing: {
      nodes: path.map((p) => ({
        id: p.id,
        position: [p.x, p.y],
        floorId: 'g',
        sourceId: 'a',
        kind: 'waypoint',
      })),
      edges: path.slice(1).map((p, i) => ({
        id: `e${i}`,
        from: path[i].id,
        to: p.id,
        sourceId: 'a',
        spaceId: 'a',
        kind: 'within-space',
        accessible: true,
        restricted: false,
        floorIds: ['g'],
        distanceMeters: 1,
      })),
    },
  } as CompiledBuildingPackage;
  venue.routing.nodes[0].kind = 'poi';
  venue.routing.nodes[0].sourceId = 'entry';
  return { venue, path };
}
function doorway(width = 1) {
  const result = fixture(rectangle(0, 0, 5, 4), [
    [1, 2],
    [5, 2],
    [9, 2],
  ]);
  result.venue.spaces.push(space('b', rectangle(5, 0, 10, 4)));
  result.venue.portals = [
    {
      id: 'door',
      floorId: 'g',
      position: [5, 2],
      width,
      kind: 'door',
      connects: ['a', 'b'],
      accessible: true,
    },
  ];
  result.venue.routing.nodes[1].kind = 'portal';
  result.venue.routing.nodes[1].sourceId = 'door';
  result.venue.routing.nodes[2].sourceId = 'b';
  result.venue.routing.edges[1].spaceId = 'b';
  result.venue.routing.edges[1].sourceId = 'b';
  return result;
}

describe('authored route graphic clearance, not physical accessibility', () => {
  it('shares renderer dimensions and checks one-point routes and POI policy', () => {
    const { venue, path } = fixture();
    expect(createRouteGraphicGuard(venue, path.slice(0, 1)).assessment.status).toBe('checked');
    venue.pois[0].accessible = false;
    expect(
      createRouteGraphicGuard(venue, path.slice(0, 1), { profile: 'wheelchair' }).assessment
        .centerlineValid,
    ).toBe(false);
    const footprint = arChevronFootprint(0, 0, 0);
    expect(
      Math.max(...footprint.map(([x]) => x)) - Math.min(...footprint.map(([x]) => x)),
    ).toBeCloseTo(0.7, 8);
  });
  it('accepts collinear wall subdivision without treating a corner as a straight door', () => {
    const { venue, path } = doorway();
    venue.spaces[0].polygon = [
      [0, 0],
      [5, 0],
      [5, 2],
      [5, 4],
      [0, 4],
    ];
    expect(createRouteGraphicGuard(venue, path).assessment.status).toBe('checked');
  });
  it('cannot move between spaces through an ordinary graph node at a shared wall', () => {
    const { venue, path } = doorway();
    venue.routing.nodes[1].kind = 'waypoint';
    venue.routing.nodes[1].sourceId = 'a';
    expect(createRouteGraphicGuard(venue, path).assessment).toMatchObject({
      centerlineValid: false,
      status: 'withheld',
    });
  });
  it('checks a continuous width and keeps output structured-cloneable', () => {
    const { venue, path } = fixture();
    const guard = createRouteGraphicGuard(venue, path);
    expect(guard.assessment).toMatchObject({
      status: 'checked',
      centerlineValid: true,
      widthMeters: 0.7,
      basis: 'authored-geometry',
    });
    expect(structuredClone(guard.assessment)).toEqual(guard.assessment);
    expect(guard.fitsPolygon(arChevronFootprint(5, 2, 90), 'g')).toBe(true);
  });
  it('withholds graphics but keeps a valid centerline when the corridor is too narrow', () => {
    const { venue, path } = fixture(rectangle(0, 0, 10, 0.6), [
      [1, 0.3],
      [9, 0.3],
    ]);
    expect(createRouteGraphicGuard(venue, path).assessment).toMatchObject({
      status: 'withheld',
      centerlineValid: true,
      issues: [{ code: 'insufficient-clearance', sourceId: 'e0' }],
    });
  });
  it('cuts only the used declared opening, and respects its width', () => {
    const wide = doorway();
    const narrow = doorway(0.6);
    expect(createRouteGraphicGuard(wide.venue, wide.path).assessment.status).toBe('checked');
    expect(createRouteGraphicGuard(narrow.venue, narrow.path).assessment).toMatchObject({
      status: 'withheld',
      centerlineValid: true,
    });
    const guard = createRouteGraphicGuard(wide.venue, wide.path);
    expect(guard.fitsPolygon(arChevronFootprint(5, 2, 90), 'g')).toBe(true);
    // The rest of that shared wall is not a door.
    expect(guard.fitsPolygon(rectangle(4.8, 2.8, 5.2, 3.2), 'g')).toBe(false);
  });
  it('does not open an unused door just because a path approaches it', () => {
    const { venue, path } = doorway();
    expect(createRouteGraphicGuard(venue, path.slice(0, 2)).assessment.status).toBe('withheld');
  });
  it('rejects disconnected spaces and forged path coordinates', () => {
    const { venue, path } = doorway();
    venue.spaces[1].polygon = rectangle(6, 0, 10, 4);
    expect(createRouteGraphicGuard(venue, path).assessment.centerlineValid).toBe(false);
    const ordinary = fixture();
    ordinary.path[1].y += 1;
    expect(createRouteGraphicGuard(ordinary.venue, ordinary.path).assessment.issues).toContainEqual(
      { code: 'invalid-path', sourceId: 'n1' },
    );
  });
  it('withholds an opening at a corner where the schema cannot determine its direction', () => {
    const { venue, path } = doorway();
    venue.portals[0].position = [5, 0];
    venue.routing.nodes[1].position = [5, 0];
    path[1].y = 0;
    expect(createRouteGraphicGuard(venue, path).assessment.issues).toContainEqual({
      code: 'portal-geometry',
      sourceId: 'door',
    });
  });
  it('applies step-free and restriction declarations without inventing a body-width standard', () => {
    const { venue, path } = doorway();
    venue.portals[0].accessible = false;
    expect(createRouteGraphicGuard(venue, path).assessment.status).toBe('checked');
    expect(
      createRouteGraphicGuard(venue, path, { profile: 'wheelchair' }).assessment.centerlineValid,
    ).toBe(false);
    venue.spaces[1].public = false;
    expect(createRouteGraphicGuard(venue, path).assessment.centerlineValid).toBe(false);
    expect(createRouteGraphicGuard(venue, path, { allowRestricted: true }).assessment.status).toBe(
      'checked',
    );
  });
  it('catches a millimetre notch between the old compiler sample positions', () => {
    const polygon: Coordinate2D[] = [
      [0, 0],
      [5.11, 0],
      [5.11, 3],
      [5.12, 3],
      [5.12, 0],
      [10, 0],
      [10, 4],
      [0, 4],
    ];
    const { venue, path } = fixture(polygon);
    expect(createRouteGraphicGuard(venue, path).assessment).toMatchObject({
      centerlineValid: false,
      status: 'withheld',
    });
  });
  it('catches a wall entirely inside a glyph, even when all four corners are inside the room', () => {
    const polygon: Coordinate2D[] = [
      [0, 0],
      [5.11, 0],
      [5.11, 2.1],
      [5.12, 2.1],
      [5.12, 0],
      [10, 0],
      [10, 4],
      [0, 4],
    ];
    const { venue, path } = fixture(polygon, [
      [1, 3],
      [9, 3],
    ]);
    const guard = createRouteGraphicGuard(venue, path);
    expect(guard.assessment.status).toBe('checked');
    expect(guard.fitsPolygon(rectangle(4.9, 1.9, 5.4, 2.4), 'g')).toBe(false);
  });
  it('checks the outer outline and tail at a sharp corner, and the destination ring separately', () => {
    const { venue, path } = fixture(rectangle(0, 0, 10, 4), [
      [1, 1],
      [9.6, 1],
      [9.6, 3],
    ]);
    const guard = createRouteGraphicGuard(venue, path);
    expect(guard.assessment.status).toBe('checked');
    expect(guard.fitsPolygon(arChevronFootprint(9.6, 1, 0), 'g')).toBe(true);
    expect(guard.fitsPolygon(arChevronFootprint(9.6, 1, 270), 'g')).toBe(false);
    expect(guard.fitsDisc([9.6, 3], 'g', 0.65)).toBe(false);
    expect(guard.fitsPolygon(arChevronFootprint(5, 2, 90), 'l1')).toBe(false);
  });
  it.each([
    ASTERION_RUNTIME,
    HARBOR_RUNTIME,
    createCompiledBuildingRuntime(reference as CompiledBuildingPackage),
  ])(
    'keeps existing synthetic destinations routable without treating vertical hops as floor ribbons ($key)',
    (runtime) => {
      for (const profile of ['standard', 'wheelchair'] as const) {
        for (const poi of runtime.getPOIs()) {
          const route = calculateCompiledRoute(runtime, runtime.getDefaultStartNodeId(), poi.id, {
            profile,
          });
          if (!route.found) {
            expect(route.receipt.status).not.toBe('rejected');
            continue;
          }
          expect(route.displayClearance?.centerlineValid).toBe(true);
          // No frozen references/functions are needed to deliver this through the worker.
          expect(structuredClone(route).displayClearance).toEqual(route.displayClearance);
        }
      }
    },
  );
});

describe('route result and graphic fallback', () => {
  it('keeps written route evidence when only the drawn width fails', () => {
    const { venue } = fixture(rectangle(0, 0, 10, 0.6), [
      [1, 0.3],
      [9, 0.3],
    ]);
    const route = calculateCompiledRoute(createCompiledBuildingRuntime(venue), 'n0', 'n1');
    expect(route).toMatchObject({
      found: true,
      displayClearance: { status: 'withheld', centerlineValid: true },
      receipt: { status: 'routed' },
    });
  });
  it('rejects an invalid centerline rather than presenting unsafe written guidance', () => {
    const { venue } = fixture(rectangle(0, 0, 5, 4));
    const route = calculateCompiledRoute(createCompiledBuildingRuntime(venue), 'n0', 'n1');
    expect(route).toMatchObject({
      found: false,
      displayClearance: { centerlineValid: false },
      receipt: { status: 'rejected' },
    });
  });
});
