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

  /** One roof part of a building, and the material it is drawn in. */
  const roofOf = (scenery: ReturnType<typeof createSiteScenery>, id: string) => {
    const part = roofs(scenery).find((roof) => roof.userData.siteBuildingId === id)!;
    const material = Array.isArray(part.material) ? part.material[0] : part.material;
    return { part, material, group: part.parent! };
  };
  /** Says how the site is to be drawn and lets the roofs get there at once. */
  const show = (
    scenery: ReturnType<typeof createSiteScenery>,
    view: Parameters<ReturnType<typeof createSiteScenery>['setView']>[0],
  ) => {
    const result = scenery.setView(view);
    scenery.advance(0, true);
    return result;
  };

  it('shows the roofs from far off and lifts them away close to', () => {
    const scenery = createSiteScenery(site, toWorld);
    const hospital = () => roofOf(scenery, 'main-hospital');

    // The whole campus in view: solid roofs, casting shadows.
    expect(show(scenery, { metresVisible: 170 }).far).toBe(1);
    expect(hospital().material.opacity).toBeGreaterThan(0.9);
    expect(hospital().part.castShadow).toBe(true);
    expect(hospital().group.visible).toBe(true);
    expect(scenery.isOpen('main-hospital')).toBe(false);

    // One building filling the screen, and nobody on the map: no roofs at all.
    expect(show(scenery, { metresVisible: 45 }).far).toBe(0);
    expect(hospital().group.visible).toBe(false);
    expect(scenery.isOpen('main-hospital')).toBe(true);

    // On the way in, part-way: neither on nor off.
    const between = show(scenery, { metresVisible: 92 }).far;
    expect(between).toBeGreaterThan(0);
    expect(between).toBeLessThan(1);
    scenery.dispose();
  });

  it('opens the building the visitor is in and leaves the others closed', () => {
    const scenery = createSiteScenery(site, toWorld);
    // Seen from right across the site, so nothing is open for being close.
    show(scenery, { metresVisible: 170, entered: 'emergency-centre' });

    expect(scenery.isOpen('emergency-centre')).toBe(true);
    expect(roofOf(scenery, 'emergency-centre').group.visible).toBe(false);
    for (const other of ['main-hospital', 'wellness-pavilion']) {
      expect(scenery.isOpen(other), other).toBe(false);
      expect(roofOf(scenery, other).material.opacity, other).toBeGreaterThan(0.9);
    }

    // Walking out and across to the pavilion: one closes as the other opens.
    show(scenery, { metresVisible: 170, entered: 'wellness-pavilion' });
    expect(scenery.isOpen('emergency-centre')).toBe(false);
    expect(roofOf(scenery, 'emergency-centre').material.opacity).toBeGreaterThan(0.9);
    expect(roofOf(scenery, 'wellness-pavilion').group.visible).toBe(false);
    scenery.dispose();
  });

  it('does not take the roof off a building for being walked past', () => {
    const scenery = createSiteScenery(site, toWorld);
    // A visitor on the grounds, with the camera close in on their walk.
    show(scenery, { metresVisible: 40, entered: null, opensOnApproach: false });
    for (const id of ['main-hospital', 'emergency-centre', 'wellness-pavilion']) {
      expect(scenery.isOpen(id), id).toBe(false);
      expect(roofOf(scenery, id).material.opacity, id).toBeGreaterThan(0.9);
    }
    scenery.dispose();
  });

  it('never hides a route inside a building', () => {
    const scenery = createSiteScenery(site, toWorld);
    show(scenery, {
      metresVisible: 170,
      onRoute: new Set(['emergency-centre', 'wellness-pavilion']),
    });

    // A building on the route: there, but seen through, and not shading or
    // occluding the line that runs through it.
    for (const id of ['emergency-centre', 'wellness-pavilion']) {
      for (const part of roofs(scenery).filter((roof) => roof.userData.siteBuildingId === id)) {
        const surfaces = Array.isArray(part.material) ? part.material : [part.material];
        for (const surface of surfaces) {
          expect(surface.opacity).toBeGreaterThan(0);
          expect(surface.opacity).toBeLessThan(0.5);
          expect(surface.depthWrite).toBe(false);
        }
        expect(part.castShadow).toBe(false);
      }
    }
    // One the route does not touch is as solid as ever.
    expect(roofOf(scenery, 'main-hospital').material.opacity).toBeGreaterThan(0.9);
    scenery.dispose();
  });

  it('takes a roof off over a moment, and then is still', () => {
    const scenery = createSiteScenery(site, toWorld);
    show(scenery, { metresVisible: 170 });
    expect(scenery.advance(16)).toBe(false);

    scenery.setView({ metresVisible: 170, entered: 'main-hospital' });
    // Part-way after one frame, not snapped.
    expect(scenery.advance(16)).toBe(true);
    const partWay = roofOf(scenery, 'main-hospital').material.opacity;
    expect(partWay).toBeGreaterThan(0);
    expect(partWay).toBeLessThan(0.94);

    // It arrives, and once it has there is nothing more to draw.
    for (let frame = 0; frame < 120; frame += 1) scenery.advance(16);
    expect(roofOf(scenery, 'main-hospital').group.visible).toBe(false);
    expect(scenery.advance(16)).toBe(false);
    scenery.dispose();
  });

  it('fades the entire exterior with its storey and cannot regain shadows during a route', () => {
    const scenery = createSiteScenery(site, toWorld, CAMPUS.portals);
    const onRoute = new Set(['main-hospital']);
    show(scenery, { metresVisible: 170, onRoute, floorOpacity: 0.22 });
    expect(roofOf(scenery, 'main-hospital').material.opacity).toBeCloseTo(0.4 * 0.22);
    // The scene toggles a storey's shadows while it comes back into view.
    for (const roof of roofs(scenery)) roof.castShadow = true;
    show(scenery, { metresVisible: 170, onRoute, floorOpacity: 1 });
    for (const roof of roofs(scenery).filter(
      (part) => part.userData.siteBuildingId === 'main-hospital',
    )) {
      expect(roof.castShadow).toBe(false);
    }
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
