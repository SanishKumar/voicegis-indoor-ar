import {
  BoxGeometry,
  ExtrudeGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Shape,
  Vector3,
} from 'three';
import type { CompiledBuildingPackage } from '@voicegis/map-compiler';
import { insetPolygon, roundCorners, type Point } from './softGeometry';
import type { ToWorld } from './siteScenery';

type SiteBuilding = NonNullable<CompiledBuildingPackage['site']>['buildings'][number];
type Placement = { position: Vector3; scale: Vector3; angle?: number };

/** Exterior illustration. Room elevations and routing retain their authored geometry. */
export const siteBuildingHeight = (storeys: number) => 0.5 + storeys * 4.2;

/** A hospital envelope with glazed bays, floor bands and entrances at actual portals.
 * Parts are instanced per material. The caller fades the entire envelope together.
 */
export function createSiteArchitecture(
  building: SiteBuilding,
  portals: CompiledBuildingPackage['portals'],
  toWorld: ToWorld,
) {
  const group = new Group();
  const materials: MeshStandardMaterial[] = [];
  const geometries: Array<BoxGeometry | ExtrudeGeometry> = [];
  const instanceMeshes: InstancedMesh[] = [];
  const unitBox = new BoxGeometry(1, 1, 1);
  geometries.push(unitBox);
  const footprint = building.footprint as Point[];
  const xs = footprint.map(([x]) => x);
  const ys = footprint.map(([, y]) => y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const centre: Point = [(x0 + x1) / 2, (y0 + y1) / 2];
  // Winding, not the bounds' centre, determines outside on concave footprints.
  const signedArea = footprint.reduce((area, point, index) => {
    const next = footprint[(index + 1) % footprint.length];
    return area + point[0] * next[1] - next[0] * point[1];
  }, 0);
  const height = siteBuildingHeight(building.storeys);
  const material = (color: number, roughness = 0.75, metalness = 0) => {
    const result = new MeshStandardMaterial({
      color,
      roughness,
      metalness,
      transparent: true,
      opacity: 0.94,
    });
    materials.push(result);
    return result;
  };
  const stone = material(0xe9e5dc);
  const trim = material(0xf8f9f6);
  const glass = material(0x51778e, 0.25, 0.2);
  const roofDeck = material(0xd3d9d6, 0.9);
  const skylight = material(0x89b7c7, 0.2, 0.15);

  const identify = (mesh: Mesh, name: string) => {
    mesh.name = name;
    mesh.userData.siteBuildingId = building.id;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  const tile = (polygon: Point[], top: number, depth: number, bevel = 0.08) => {
    const shape = new Shape();
    polygon.forEach((point, i) => {
      const world = toWorld(point);
      if (i === 0) shape.moveTo(world.x, world.z);
      else shape.lineTo(world.x, world.z);
    });
    shape.closePath();
    const geometry = new ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: bevel > 0,
      bevelSize: bevel,
      bevelThickness: bevel,
      bevelSegments: 2,
    });
    geometry.rotateX(Math.PI / 2);
    geometry.translate(0, top, 0);
    geometries.push(geometry);
    return geometry;
  };
  const instances = (name: string, placements: Placement[], surface: MeshStandardMaterial) => {
    if (placements.length === 0) return;
    const mesh = identify(new InstancedMesh(unitBox, surface, placements.length), name);
    instanceMeshes.push(mesh as InstancedMesh);
    const scratch = new Object3D();
    placements.forEach(({ position, scale, angle = 0 }, index) => {
      scratch.position.copy(position);
      scratch.scale.copy(scale);
      scratch.rotation.set(0, angle, 0);
      scratch.updateMatrix();
      (mesh as InstancedMesh).setMatrixAt(index, scratch.matrix);
    });
    return mesh;
  };

  identify(
    new Mesh(
      tile(roundCorners(insetPolygon(footprint, 0.25), 1.7, 6), height, height - 0.3),
      stone,
    ),
    'building-envelope',
  );
  identify(
    new Mesh(tile(roundCorners(insetPolygon(footprint, -0.2), 2, 6), height + 0.18, 0.28), trim),
    'roof-eave',
  );
  identify(
    new Mesh(
      tile(roundCorners(insetPolygon(footprint, 1.25), 1.6, 6), height + 0.32, 0.12),
      roofDeck,
    ),
    'roof-terrace',
  );

  const windows: Placement[] = [];
  const bands: Placement[] = [];
  const fins: Placement[] = [];
  const entrances: Placement[] = [];
  const canopies: Placement[] = [];
  const columns: Placement[] = [];
  const entryPortals = new Set<string>();

  for (let i = 0; i < footprint.length; i += 1) {
    const a = footprint[i];
    const b = footprint[(i + 1) % footprint.length];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < 3) continue;
    const direction: Point = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
    const normal: Point =
      signedArea >= 0 ? [direction[1], -direction[0]] : [-direction[1], direction[0]];
    const startWorld = toWorld(a);
    const endWorld = toWorld(b);
    const angle = Math.atan2(-(endWorld.z - startWorld.z), endWorld.x - startWorld.x);
    const at = (distance: number, offset: number, elevation: number) =>
      toWorld(
        [
          a[0] + direction[0] * distance + normal[0] * offset,
          a[1] + direction[1] * distance + normal[1] * offset,
        ],
        elevation,
      );
    const entries = portals.filter((portal) => {
      const along =
        (portal.position[0] - a[0]) * direction[0] + (portal.position[1] - a[1]) * direction[1];
      const across = Math.abs(
        (portal.position[0] - a[0]) * normal[0] + (portal.position[1] - a[1]) * normal[1],
      );
      return along >= 2 && along <= length - 2 && across < 0.35 && !entryPortals.has(portal.id);
    });
    for (const portal of entries) {
      entryPortals.add(portal.id);
      const along =
        (portal.position[0] - a[0]) * direction[0] + (portal.position[1] - a[1]) * direction[1];
      const width = Math.min(length - 4, Math.max(building.storeys > 1 ? 16 : 8, portal.width + 7));
      const canopyHeight = building.storeys > 1 ? 4.7 : 3.6;
      const projection = building.storeys > 1 ? 8 : 6;
      entrances.push({
        position: at(along, 0.18, 1.9),
        scale: new Vector3(portal.width + 1.5, 3.1, 0.25),
        angle,
      });
      canopies.push({
        position: at(along, projection / 2 - 0.5, canopyHeight),
        scale: new Vector3(width, 0.35, projection),
        angle,
      });
      for (const offset of [-width / 2 + 0.7, width / 2 - 0.7]) {
        columns.push({
          position: at(along + offset, projection - 1.2, canopyHeight / 2),
          scale: new Vector3(0.3, canopyHeight, 0.3),
          angle,
        });
      }
    }
    const bays = Math.max(1, Math.floor((length - 4) / 3.8));
    const spacing = (length - 4) / bays;
    for (let bay = 0; bay < bays; bay += 1) {
      const along = 2 + spacing * (bay + 0.5);
      for (let level = 0; level < building.storeys; level += 1) {
        const inEntry =
          level === 0 &&
          entries.some((entry) => {
            const entryAlong =
              (entry.position[0] - a[0]) * direction[0] + (entry.position[1] - a[1]) * direction[1];
            return Math.abs(entryAlong - along) < entry.width / 2 + 1;
          });
        if (!inEntry)
          windows.push({
            position: at(along, 0.12, 2.15 + level * 4.2),
            scale: new Vector3(Math.min(2.65, spacing - 0.7), 2.35, 0.24),
            angle,
          });
      }
      fins.push({
        position: at(along - spacing / 2, 0.22, height / 2),
        scale: new Vector3(0.2, height - 0.5, 0.42),
        angle,
      });
    }
    for (let level = 1; level <= building.storeys; level += 1) {
      bands.push({
        position: at(length / 2, 0.16, 0.35 + level * 4.2),
        scale: new Vector3(length - 2, 0.2, 0.5),
        angle,
      });
    }
  }
  instances('facade-windows', windows, glass);
  instances('facade-floor-bands', bands, trim);
  instances('facade-fins', fins, trim);
  instances('entrance-glazing', entrances, glass);
  instances('entrance-canopy', canopies, trim);
  instances('entrance-columns', columns, stone);

  // A raised glazed lantern and ribs give the roof an identifiable silhouette.
  // Small or irregular footprints are left alone rather than inventing an atrium.
  const lanternWidth = Math.min(26, (x1 - x0) * 0.4);
  const lanternDepth = Math.min(14, (y1 - y0) * 0.4);
  const inset = insetPolygon(footprint, 4);
  const inside = ([x, y]: Point) => {
    let included = false;
    for (let i = 0, j = inset.length - 1; i < inset.length; j = i, i += 1) {
      const [xi, yi] = inset[i];
      const [xj, yj] = inset[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) included = !included;
    }
    return included;
  };
  const lantern: Point[] = [
    [centre[0] - lanternWidth / 2, centre[1] - lanternDepth / 2],
    [centre[0] + lanternWidth / 2, centre[1] - lanternDepth / 2],
    [centre[0] + lanternWidth / 2, centre[1] + lanternDepth / 2],
    [centre[0] - lanternWidth / 2, centre[1] + lanternDepth / 2],
  ];
  if (lanternWidth >= 9 && lanternDepth >= 7 && lantern.every(inside)) {
    identify(
      new Mesh(tile(roundCorners(lantern, 0.8, 4), height + 1.75, 1.4), skylight),
      'roof-lantern',
    );
    const ribs: Placement[] = [];
    for (let x = centre[0] - lanternWidth / 2 + 1; x < centre[0] + lanternWidth / 2; x += 2.5) {
      ribs.push({
        position: toWorld([x, centre[1]], height + 1.83),
        scale: new Vector3(0.16, 0.12, lanternDepth - 0.5),
      });
    }
    instances('roof-lantern-ribs', ribs, trim);
  }

  return {
    group,
    materials,
    height,
    dispose() {
      for (const mesh of instanceMeshes) mesh.dispose();
      for (const geometry of geometries) geometry.dispose();
      for (const surface of materials) surface.dispose();
    },
  };
}
