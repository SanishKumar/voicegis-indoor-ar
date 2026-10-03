import { describe, expect, it } from 'vitest';
import { Box3, InstancedMesh, Matrix4, Mesh, Vector3 } from 'three';
import type { CompiledBuildingPackage } from '@voicegis/map-compiler';
import campusPackageJson from '../../buildings/meridian-park-campus/compiled/building.package.json';
import { createSiteScenery } from './siteScenery';

const CAMPUS = campusPackageJson as unknown as CompiledBuildingPackage;
const site = CAMPUS.site!;
const toWorld = ([x, y]: readonly [number, number], height = 0) => new Vector3(x, height, y);

/** The roofs: the meshes that carry a building's id. */
function roofs(scenery: ReturnType<typeof createSiteScenery>) {
  const found: Mesh[] = [];
  scenery.group.traverse((object) => {
    if (typeof object.userData.siteBuildingId === 'string') found.push(object as Mesh);
  });
  return found;
}

function roofMaterial(scenery: ReturnType<typeof createSiteScenery>) {
  const material = roofs(scenery)[0].material;
  return Array.isArray(material) ? material[0] : material;
}

describe('the outside of a venue with grounds', () => {
  it('gives every building a roof and a name above it', () => {
    const scenery = createSiteScenery(site, toWorld);

    expect(scenery.buildings.map((building) => building.name).sort()).toEqual([
      'Emergency Centre',
      'Main Hospital',
      'Wellness Pavilion',
    ]);
    const ids = new Set(roofs(scenery).map((roof) => roof.userData.siteBuildingId));
    expect(ids).toEqual(new Set(['emergency-centre', 'main-hospital', 'wellness-pavilion']));

    // A three-storey building stands taller than a single-storey one.
    const height = (id: string) =>
      scenery.buildings.find((building) => building.id === id)!.anchor.y;
    expect(height('main-hospital')).toBeGreaterThan(height('wellness-pavilion'));
    scenery.dispose();
  });

  it('knows a room from a garden path', () => {
    const scenery = createSiteScenery(site, toWorld);

    expect(scenery.isIndoors([105, 28])).toBe(true); // the hospital concourse
    expect(scenery.buildingAt([180, 86])?.id).toBe('wellness-pavilion');
    expect(scenery.isIndoors([105, 84])).toBe(false); // the fountain
    expect(scenery.isIndoors([105, 115])).toBe(false); // the promenade
    scenery.dispose();
  });

  it('shows the roofs from far off and lifts them away close to', () => {
    const scenery = createSiteScenery(site, toWorld);
    const material = () => roofMaterial(scenery);

    // The whole campus in view: solid roofs, casting shadows.
    expect(scenery.setView(170, false)).toEqual({ far: 1, changed: true });
    expect(material().opacity).toBeGreaterThan(0.9);
    expect(roofs(scenery)[0].castShadow).toBe(true);
    expect(roofs(scenery)[0].parent!.visible).toBe(true);

    // One building filling the screen: no roofs at all.
    expect(scenery.setView(45, false).far).toBe(0);
    expect(roofs(scenery)[0].parent!.visible).toBe(false);

    // On the way in, part-way: neither on nor off.
    const between = scenery.setView(92, false).far;
    expect(between).toBeGreaterThan(0);
    expect(between).toBeLessThan(1);
    scenery.dispose();
  });

  it('never hides a route inside a building', () => {
    const scenery = createSiteScenery(site, toWorld);
    scenery.setView(170, true);
    const roof = roofs(scenery)[0];
    const material = roofMaterial(scenery);

    // A ghost: there, but seen through, and not shading or occluding the route.
    expect(material.opacity).toBeGreaterThan(0);
    expect(material.opacity).toBeLessThan(0.25);
    expect(material.depthWrite).toBe(false);
    expect(roof.castShadow).toBe(false);
    for (const part of roofs(scenery)) {
      const surfaces = Array.isArray(part.material) ? part.material : [part.material];
      for (const surface of surfaces) {
        expect(surface.opacity).toBeLessThan(0.25);
        expect(surface.depthWrite).toBe(false);
      }
      expect(part.castShadow).toBe(false);
    }
    scenery.dispose();
  });

  it('reports no change when asked for the view it already has', () => {
    const scenery = createSiteScenery(site, toWorld);
    scenery.setView(170, false);
    expect(scenery.setView(170, false).changed).toBe(false);
    expect(scenery.setView(170, true).changed).toBe(true);
    scenery.dispose();
  });

  it('fades the entire exterior with its storey and cannot regain shadows during a route', () => {
    const scenery = createSiteScenery(site, toWorld, CAMPUS.portals);
    scenery.setView(170, true, 0.22);
    expect(roofMaterial(scenery).opacity).toBeCloseTo(0.16 * 0.22);
    // The scene toggles a storey's shadows while it comes back into view.
    for (const roof of roofs(scenery)) roof.castShadow = true;
    expect(scenery.setView(170, true, 1).changed).toBe(true);
    for (const roof of roofs(scenery)) expect(roof.castShadow).toBe(false);
    scenery.dispose();
  });

  it('draws the grounds beneath whatever lies on them', () => {
    // Every tile is translucent and shares an origin; without an order the
    // grass under a garden's paving can lose the depth test and vanish.
    const scenery = createSiteScenery(site, toWorld);
    const orders: number[] = [];
    scenery.group.traverse((object) => {
      if ((object as Mesh).isMesh) orders.push(object.renderOrder);
    });
    expect(orders.filter((order) => order < 0).length).toBeGreaterThanOrEqual(site.grounds.length);
    scenery.dispose();
  });

  it('draws road and bay markings above the bevels of opaque ground tiles', () => {
    const scenery = createSiteScenery(site, toWorld);
    for (const [kind, expectedTop] of [
      ['road', 0.1],
      ['parking', 0.14],
    ] as const) {
      const ground = scenery.group.getObjectByName(`site-ground-${kind}`)!;
      const surface = new Box3().setFromObject(ground);
      expect(surface.max.y).toBeCloseTo(expectedTop);
      const marks = scenery.group.children[scenery.group.children.indexOf(ground) + 1];
      expect(new Box3().setFromObject(marks).max.y).toBeGreaterThan(surface.max.y + 0.01);
    }
    scenery.dispose();
  });

  it('keeps illustrative parked cars inside bays and out of the central aisle', () => {
    const scenery = createSiteScenery(site, toWorld);
    const cars = scenery.group.getObjectByName('parking-car-bodies') as InstancedMesh;
    expect(cars.count).toBeGreaterThan(20);
    const matrix = new Matrix4();
    cars.geometry.computeBoundingBox();
    for (let index = 0; index < cars.count; index++) {
      cars.getMatrixAt(index, matrix);
      const box = cars.geometry.boundingBox!.clone().applyMatrix4(matrix);
      expect(box.min.x).toBeGreaterThan(24);
      expect(box.max.x).toBeLessThan(96);
      expect(box.min.z).toBeGreaterThan(112);
      expect(box.max.z).toBeLessThan(134);
      expect(box.max.z < 120 || box.min.z > 126).toBe(true);
    }
    scenery.dispose();
  });
});
