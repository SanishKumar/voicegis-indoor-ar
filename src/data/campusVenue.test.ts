import { describe, expect, it } from 'vitest';
import type { CompiledBuildingPackage } from '@voicegis/map-compiler';
import campusPackageJson from '../../buildings/meridian-park-campus/compiled/building.package.json';
import { calculateCompiledRoute } from '../engine/compiledRoutePolicy';
import { createCompiledBuildingRuntime } from './compiledBuilding';
import { verifyVenuePackage } from './venuePackageContract';

const CAMPUS = campusPackageJson as unknown as CompiledBuildingPackage;
const RUNTIME = createCompiledBuildingRuntime(CAMPUS);

/** The spaces a route passes through, in order, without repeats. */
function spacesAlong(pathIds: string[]) {
  const visited: string[] = [];
  for (const id of pathIds) {
    const node = RUNTIME.getNodeById(id);
    const spaceId =
      id.startsWith('space:') || id.startsWith('waypoint:')
        ? (node as { sourceId?: string } | null)?.sourceId
        : null;
    if (spaceId && visited[visited.length - 1] !== spaceId) visited.push(spaceId);
  }
  return visited;
}

describe('Meridian Park Medical Campus', () => {
  it('passes the same runtime contract as a single building', async () => {
    await expect(verifyVenuePackage(CAMPUS)).resolves.toBe(CAMPUS);
  });

  it('describes its grounds: three buildings, with lawns, water and trees between them', () => {
    const site = CAMPUS.site!;
    expect(site.floorId).toBe('g');
    expect(site.buildings.map((building) => building.id).sort()).toEqual([
      'emergency-centre',
      'main-hospital',
      'wellness-pavilion',
    ]);
    const kinds = new Set(site.grounds.map((ground) => ground.kind));
    for (const kind of ['lawn', 'water', 'parking', 'road']) expect(kinds).toContain(kind);
    expect(site.features.filter((feature) => feature.kind === 'tree').length).toBeGreaterThan(40);
    expect(site.features.some((feature) => feature.kind === 'fountain')).toBe(true);
    expect(site.features.some((feature) => feature.kind === 'statue')).toBe(true);
  });

  it('keeps every room inside the building that is drawn round it', () => {
    // The roofs are drawn from the footprints, so a room poking out of one
    // would show through the wall of its own building.
    const outdoors = new Set(['gate', 'promenade', 'forecourt', 'west-walk', 'east-walk']);
    const within = (polygon: number[][], footprint: number[][]) => {
      const xs = footprint.map((point) => point[0]);
      const ys = footprint.map((point) => point[1]);
      return polygon.every(
        ([x, y]) =>
          x >= Math.min(...xs) &&
          x <= Math.max(...xs) &&
          y >= Math.min(...ys) &&
          y <= Math.max(...ys),
      );
    };
    const housed = CAMPUS.spaces.filter((space) =>
      CAMPUS.site!.buildings.some((building) => within(space.polygon, building.footprint)),
    );
    // Every upper-floor space, and every ground-floor room.
    expect(housed.length).toBeGreaterThan(40);
    for (const space of CAMPUS.spaces) {
      if (space.floorId !== 'g') expect(housed, space.id).toContain(space);
      if (outdoors.has(space.id)) expect(housed, space.id).not.toContain(space);
    }
  });

  it('walks from the gate, round the fountain, across the garden and into the pavilion', () => {
    const route = calculateCompiledRoute(RUNTIME, 'poi:poi-main-gate', 'poi:poi-w-gym');
    expect(route.found).toBe(true);
    if (!route.found) return;
    const visited = spacesAlong(route.pathIds);
    expect(visited[0]).toBe('gate');
    expect(visited).toEqual(expect.arrayContaining(['promenade', 'east-walk', 'w-gallery']));
    // Round the fountain, not through it: one side of the court or the other.
    expect(visited.some((id) => id === 'court-east' || id === 'court-west')).toBe(true);
    expect(visited).not.toContain('g-concourse');
    expect(route.totalDistance).toBeGreaterThan(90);
  });

  it('goes from one building to another through the grounds, not through a wall', () => {
    const route = calculateCompiledRoute(RUNTIME, 'poi:poi-e-triage', 'poi:poi-g-pharmacy');
    expect(route.found).toBe(true);
    if (!route.found) return;
    const visited = spacesAlong(route.pathIds);
    expect(visited).toEqual(
      expect.arrayContaining(['e-corridor', 'west-walk', 'forecourt', 'g-hall', 'g-concourse']),
    );
  });

  it('reaches an upper floor of the main hospital by the lift, step-free', () => {
    const route = calculateCompiledRoute(RUNTIME, 'poi:poi-main-gate', 'poi:poi-l2-dialysis', {
      accessibleOnly: true,
    });
    expect(route.found).toBe(true);
    if (!route.found) return;
    expect(route.pathIds).toEqual(
      expect.arrayContaining(['connector:lift-main:g', 'connector:lift-main:l2']),
    );
    expect(route.pathIds.some((id) => id.startsWith('connector:stairs-main'))).toBe(false);
  });

  it('starts a visitor at the main gate', () => {
    expect(RUNTIME.getDefaultStartNodeId()).toBe('poi:poi-main-gate');
  });

  it('says which building a place is in, because every building has a ground floor', () => {
    const places = new Map(RUNTIME.getPOIs().map((node) => [node.id, node.poi.where]));
    const where = (id: string) => places.get(`poi:${id}`);
    expect(where('poi-w-gym')).toBe('Wellness Pavilion · Ground');
    expect(where('poi-e-triage')).toBe('Emergency Centre · Ground');
    expect(where('poi-g-pharmacy')).toBe('Main Hospital · Ground');
    expect(where('poi-l1-maternity')).toBe('Main Hospital · Level 1');
    expect(where('poi-l2-dialysis')).toBe('Main Hospital · Level 2');
    // Out of doors is in no building.
    expect(where('poi-fountain')).toBe('Grounds');
    expect(where('poi-main-gate')).toBe('Grounds');
    expect(where('poi-car-park')).toBe('Grounds');
  });
});
