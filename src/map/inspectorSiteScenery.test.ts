import { describe, expect, it, vi } from 'vitest';
import { Box3, Group, Mesh, Vector3 } from 'three';
import type { CompiledBuildingPackage } from '@voicegis/map-compiler';
import campusJson from '../../buildings/meridian-park-campus/compiled/building.package.json';
import referenceJson from '../../buildings/reference-medical-centre/compiled/building.package.json';
import { createInspectorSiteScenery } from './inspectorSiteScenery';

const campus = campusJson as unknown as CompiledBuildingPackage;

describe('campus grounds in the operator Inspector', () => {
  it('draws authored gardens in the same centered world as the semantic floors', () => {
    const scenery = createInspectorSiteScenery(campus)!;
    const lawn = scenery.group.getObjectByName('site-ground-lawn') as Mesh;
    expect(lawn).toBeDefined();
    // The southern road's source center is (105,146), and the whole campus
    // origin is (105,75), exactly as for the compiled floor geometry.
    const road = scenery.group.getObjectByName('site-ground-road') as Mesh;
    const position = new Box3().setFromObject(road).getCenter(new Vector3());
    expect(position.x).toBeCloseTo(0);
    expect(position.z).toBeCloseTo(71);
    expect(scenery.group.name).toBe('inspector-site-grounds');
    scenery.dispose();
  });

  it('never covers spaces with a building envelope and does not mutate the package', () => {
    const before = JSON.stringify(campus.site);
    const scenery = createInspectorSiteScenery(campus)!;
    let envelopeParts = 0;
    scenery.group.traverse((object) => {
      if (!object.userData.siteBuildingId) return;
      envelopeParts++;
      expect(object.parent?.visible).toBe(false);
    });
    expect(envelopeParts).toBeGreaterThan(0);
    expect(JSON.stringify(campus.site)).toBe(before);
    scenery.dispose();
  });

  it('detaches and disposes its own shared resources exactly once', () => {
    const scenery = createInspectorSiteScenery(campus)!;
    const parent = new Group();
    parent.add(scenery.group);
    const geometry = (scenery.group.getObjectByName('site-ground-lawn') as Mesh).geometry;
    const dispose = vi.spyOn(geometry, 'dispose');
    scenery.dispose();
    scenery.dispose();
    expect(dispose).toHaveBeenCalledOnce();
    expect(scenery.group.parent).toBeNull();
  });

  it('does not add a made-up campus to a single-building venue', () => {
    expect(
      createInspectorSiteScenery(referenceJson as unknown as CompiledBuildingPackage),
    ).toBeNull();
  });

  it('places both ground tiles and props at the ground floor elevation', () => {
    const elevated = structuredClone(campus);
    elevated.floors.find((floor) => floor.level === 0)!.elevation = 12;
    const scenery = createInspectorSiteScenery(elevated)!;
    expect(scenery.group.position.y).toBe(12);
    scenery.group.updateMatrixWorld(true);
    const road = scenery.group.getObjectByName('site-ground-road') as Mesh;
    expect(new Box3().setFromObject(road).min.y).toBeGreaterThan(11.9);
    scenery.dispose();
  });

  it('honours the site floor rather than guessing that it is level zero', () => {
    const elevated = structuredClone(campus);
    elevated.site!.floorId = 'l1';
    const floor = elevated.floors.find((candidate) => candidate.id === 'l1')!;
    const exploded = createInspectorSiteScenery(elevated)!;
    expect(exploded.group.position.y).toBe(floor.elevation + floor.level * 4);
    exploded.dispose();
    const stacked = createInspectorSiteScenery(elevated, false)!;
    expect(stacked.group.position.y).toBe(floor.elevation);
    stacked.dispose();
  });
});
