import {
  BoxGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Shape,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
} from 'three';
import type { CompiledBuildingPackage } from '@voicegis/map-compiler';
import { insetPolygon, roundCorners, type Point } from './softGeometry';

/*
 * What a venue with grounds looks like from outside.
 *
 * A campus is read in two ways. From far off it is a few buildings standing in
 * a garden: you want to know which block is the hospital and how to get across
 * to the pavilion. Close to, it is rooms and corridors. Both are the same
 * model. The buildings have roofs; as the camera comes in the roofs lift away
 * and what was a block is a floor of rooms. Nothing switches - the outside view
 * is the inside view with its lids on.
 *
 * Everything here is drawn and nothing is measured. The grounds, the trees
 * and the roofs come from the package's `site` block, which the router never
 * reads; where you can walk is decided by spaces and doorways, as it is
 * indoors.
 */

type Site = NonNullable<CompiledBuildingPackage['site']>;
type GroundKind = Site['grounds'][number]['kind'];

/** Plan position and height to a point in the scene. */
export type ToWorld = (point: Point, height?: number) => Vector3;

interface GroundStyle {
  color: number;
  opacity: number;
  /** How far the tile stands above the plate, in metres. */
  height: number;
  /** How round its corners are. */
  radius: number;
  roughness: number;
}

/*
 * Soft, pale and a little translucent, like everything else on the model: a
 * lawn is mint, not grass green, so the route stays the only saturated thing.
 */
const GROUND: Record<GroundKind, GroundStyle> = {
  lawn: { color: 0xc4e8cd, opacity: 0.9, height: 0.16, radius: 2.4, roughness: 0.95 },
  planting: { color: 0xa5d6b3, opacity: 0.95, height: 0.42, radius: 1.2, roughness: 0.95 },
  // Water lies in a lawn, so it is drawn a little above the grass round it.
  water: { color: 0x8ec7f7, opacity: 0.85, height: 0.2, radius: 4, roughness: 0.15 },
  paving: { color: 0xffffff, opacity: 0.7, height: 0.1, radius: 1, roughness: 0.9 },
  // Dark enough for the white bay lines to show.
  parking: { color: 0xb9c7dc, opacity: 0.9, height: 0.1, radius: 1.6, roughness: 0.9 },
  road: { color: 0x9fb0c8, opacity: 0.9, height: 0.06, radius: 0, roughness: 0.9 },
};

/** How tall a building's block stands, by its storeys. Stylised, not to scale. */
const roofHeight = (storeys: number) => 2.2 + storeys * 1.5;

/** The roofs are fully on with this much of the site in view, and gone by the other. */
const ROOF_FAR_METRES = 115;
const ROOF_NEAR_METRES = 70;
const ROOF_OPACITY = 0.94;
/** With a route showing, a roof is only a ghost, so the route is never hidden in a building. */
const ROOF_GHOST_OPACITY = 0.16;

export interface SiteBuildingView {
  id: string;
  name: string;
  /** Where the building's name is anchored: above the middle of its roof. */
  anchor: Vector3;
  footprint: Point[];
}

export interface SiteScenery {
  /** Everything drawn on the ground floor, to be added to that floor's group. */
  group: Group;
  /** Materials that fade with the floor they stand on. */
  materials: MeshStandardMaterial[];
  buildings: SiteBuildingView[];
  /** True if a plan point is inside any building. */
  isIndoors(point: Point): boolean;
  /** The building a plan point is in, or null in the grounds. */
  buildingAt(point: Point): SiteBuildingView | null;
  /**
   * How much of the roofs to show: 1 from far off, 0 close to. Returns the
   * amount applied, and whether anything changed.
   */
  setView(metresVisible: number, routeShowing: boolean): { far: number; changed: boolean };
  dispose(): void;
}

function insideRing([x, y]: Point, ring: readonly Point[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const smoothstep = (from: number, to: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

export function createSiteScenery(site: Site, toWorld: ToWorld): SiteScenery {
  const group = new Group();
  const materials: MeshStandardMaterial[] = [];
  const disposables: Array<{ dispose(): void }> = [];

  const shapeFrom = (polygon: readonly Point[]) => {
    const shape = new Shape();
    polygon.forEach((point, index) => {
      const world = toWorld(point);
      if (index === 0) shape.moveTo(world.x, world.z);
      else shape.lineTo(world.x, world.z);
    });
    shape.closePath();
    return shape;
  };

  /** A flat rounded tile: its top is `top` metres above the plate. */
  const tile = (polygon: readonly Point[], top: number, thickness: number, bevel = 0.04) => {
    const geometry = new ExtrudeGeometry(shapeFrom(polygon), {
      depth: Math.max(0.01, thickness - bevel),
      bevelEnabled: bevel > 0,
      bevelSize: bevel,
      bevelThickness: bevel,
      bevelSegments: 2,
    });
    geometry.rotateX(Math.PI / 2);
    geometry.translate(0, top, 0);
    disposables.push(geometry);
    return geometry;
  };

  const surface = (color: number, opacity: number, roughness: number) => {
    const material = new MeshStandardMaterial({
      color,
      roughness,
      metalness: 0,
      flatShading: true,
      transparent: true,
      opacity,
    });
    // The same two marks the floor's own materials carry, so a storey fading
    // out multiplies this opacity and does not replace it.
    material.userData.alwaysTransparent = true;
    material.userData.baseOpacity = opacity;
    materials.push(material);
    disposables.push(material);
    return material;
  };

  // ------------------------------------------------------------- the grounds
  for (const ground of site.grounds) {
    const style = GROUND[ground.kind];
    const outline =
      style.radius > 0 ? roundCorners(ground.polygon, style.radius, 6) : ground.polygon;
    const mesh = new Mesh(
      tile(outline, style.height, style.height + 0.04),
      surface(style.color, style.opacity, style.roughness),
    );
    mesh.receiveShadow = true;
    // Drawn before anything that lies on it. Every tile here is translucent
    // and shares one origin, so without an order the renderer may draw the
    // garden's paving first, and the grass under it then fails the depth test
    // and is never drawn at all.
    mesh.renderOrder = -3;
    group.add(mesh);

    if (ground.kind === 'parking') group.add(parkingBays(ground.polygon, style.height));
    if (ground.kind === 'road') group.add(roadMarkings(ground.polygon, style.height));
  }

  /** Bay lines across a car park: a row of short white strokes down each long side. */
  function parkingBays(polygon: readonly Point[], top: number) {
    const xs = polygon.map((point) => point[0]);
    const ys = polygon.map((point) => point[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const lines: Point[][] = [];
    for (let x = x0 + 3; x < x1 - 2; x += 2.7) {
      for (const [from, to] of [
        [y0 + 1.2, y0 + 6],
        [y1 - 6, y1 - 1.2],
      ]) {
        lines.push([
          [x - 0.07, from],
          [x + 0.07, from],
          [x + 0.07, to],
          [x - 0.07, to],
        ]);
      }
    }
    return strokes(lines, top + 0.03);
  }

  /** A dashed line down the middle of a road. */
  function roadMarkings(polygon: readonly Point[], top: number) {
    const xs = polygon.map((point) => point[0]);
    const ys = polygon.map((point) => point[1]);
    const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
    const mid = (Math.min(...ys) + Math.max(...ys)) / 2;
    const lines: Point[][] = [];
    for (let x = x0 + 2; x < x1 - 4; x += 7) {
      lines.push([
        [x, mid - 0.09],
        [x + 3.4, mid - 0.09],
        [x + 3.4, mid + 0.09],
        [x, mid + 0.09],
      ]);
    }
    return strokes(lines, top + 0.03);
  }

  function strokes(lines: Point[][], top: number) {
    const marks = new Group();
    const material = surface(0xffffff, 0.9, 0.9);
    for (const line of lines) {
      const mark = new Mesh(tile(line, top, 0.03, 0), material);
      mark.renderOrder = -2;
      marks.add(mark);
    }
    return marks;
  }

  // ------------------------------------------------------------ the features
  const place = <G extends BufferGeometry>(
    geometry: G,
    material: MeshStandardMaterial,
    points: Point[],
    arrange: (object: Object3D, point: Point, index: number) => void,
  ) => {
    if (points.length === 0) return;
    disposables.push(geometry);
    const mesh = new InstancedMesh(geometry, material, points.length);
    const scratch = new Object3D();
    points.forEach((point, index) => {
      scratch.position.set(0, 0, 0);
      scratch.rotation.set(0, 0, 0);
      scratch.scale.set(1, 1, 1);
      arrange(scratch, point, index);
      scratch.updateMatrix();
      mesh.setMatrixAt(index, scratch.matrix);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  };

  const of = (kind: Site['features'][number]['kind']) =>
    site.features.filter((feature) => feature.kind === kind).map((feature) => feature.position);

  // A tree is a short trunk and a soft round crown. Each is a little different
  // in size, by its place in the list, so a grove does not look stamped out.
  const trees = of('tree');
  const size = (index: number) => 0.82 + ((index * 37) % 11) / 28;
  place(new CylinderGeometry(0.16, 0.22, 1.5, 8), surface(0xcbb9a2, 1, 0.95), trees, (o, p) =>
    o.position.copy(toWorld(p, 0.9)),
  );
  place(new IcosahedronGeometry(1.5, 1), surface(0xa9dab6, 0.96, 0.95), trees, (o, p, i) => {
    o.position.copy(toWorld(p, 1.7 + 1.35 * size(i)));
    o.scale.setScalar(size(i));
    o.rotation.y = i * 1.7;
  });
  // A second, smaller mass on one side makes the crown read as a cloud of
  // leaves and not a ball on a stick.
  place(new IcosahedronGeometry(1, 1), surface(0xb9e3c3, 0.96, 0.95), trees, (o, p, i) => {
    const angle = i * 2.4;
    const world = toWorld(p, 1.5 + 0.9 * size(i));
    o.position.set(world.x + Math.cos(angle) * 0.9, world.y, world.z + Math.sin(angle) * 0.9);
    o.scale.setScalar(size(i));
  });

  const white = surface(0xffffff, 1, 0.8);
  const fountains = of('fountain');
  place(new CylinderGeometry(3.3, 3.5, 0.55, 40), white, fountains, (o, p) =>
    o.position.copy(toWorld(p, 0.4)),
  );
  place(new CylinderGeometry(2.9, 2.9, 0.12, 40), surface(0x8ec7f7, 0.9, 0.1), fountains, (o, p) =>
    o.position.copy(toWorld(p, 0.66)),
  );
  place(new CylinderGeometry(0.9, 1.1, 0.5, 24), white, fountains, (o, p) =>
    o.position.copy(toWorld(p, 0.95)),
  );
  place(new CylinderGeometry(0.16, 0.22, 1.5, 12), white, fountains, (o, p) =>
    o.position.copy(toWorld(p, 1.9)),
  );
  place(new SphereGeometry(0.42, 16, 12), surface(0xbfe0fb, 0.9, 0.1), fountains, (o, p) =>
    o.position.copy(toWorld(p, 2.8)),
  );

  const statues = of('statue');
  place(new BoxGeometry(1.5, 1.1, 1.5), white, statues, (o, p) => o.position.copy(toWorld(p, 0.7)));
  place(new CylinderGeometry(0.28, 0.42, 1.9, 12), white, statues, (o, p) =>
    o.position.copy(toWorld(p, 2.2)),
  );
  place(new SphereGeometry(0.36, 14, 10), white, statues, (o, p) =>
    o.position.copy(toWorld(p, 3.45)),
  );

  place(new BoxGeometry(1.9, 0.34, 0.6), surface(0xe9eef6, 1, 0.9), of('bench'), (o, p) =>
    o.position.copy(toWorld(p, 0.4)),
  );

  const lamps = of('lamp');
  place(new CylinderGeometry(0.05, 0.07, 3, 8), surface(0xdfe6f0, 1, 0.6), lamps, (o, p) =>
    o.position.copy(toWorld(p, 1.6)),
  );
  const glow = surface(0xfff3d6, 1, 0.4);
  glow.emissive.setHex(0xffe9b8);
  glow.emissiveIntensity = 0.6;
  place(new SphereGeometry(0.2, 12, 8), glow, lamps, (o, p) => o.position.copy(toWorld(p, 3.15)));

  // ----------------------------------------------------------- the buildings
  const roofGroup = new Group();
  group.add(roofGroup);
  const roofMaterials: MeshStandardMaterial[] = [];
  const buildings: SiteBuildingView[] = [];

  for (const building of site.buildings) {
    const footprint = building.footprint as Point[];
    // The plinth: the building's own floor, a little above the grounds.
    const plinth = new Mesh(
      tile(roundCorners(insetPolygon(footprint, -0.5), 1.6, 6), 0.2, 0.24, 0.05),
      surface(0xffffff, 0.75, 0.9),
    );
    plinth.receiveShadow = true;
    plinth.renderOrder = -3;
    group.add(plinth);

    // The roof: the same outline, drawn up to the height of its storeys.
    const height = roofHeight(building.storeys);
    const material = new MeshStandardMaterial({
      color: 0xf4f8ff,
      roughness: 0.6,
      metalness: 0,
      transparent: true,
      opacity: ROOF_OPACITY,
    });
    roofMaterials.push(material);
    disposables.push(material);
    const roof = new Mesh(
      tile(roundCorners(insetPolygon(footprint, -0.3), 2, 7), height, height - 0.3, 0.3),
      material,
    );
    roof.castShadow = true;
    roof.receiveShadow = true;
    roof.userData.siteBuildingId = building.id;
    roofGroup.add(roof);

    // A lower, set-back tier on top, so the block reads as a roof with an
    // edge and not as a slab.
    const crown = new Mesh(
      tile(roundCorners(insetPolygon(footprint, 3), 1.6, 6), height + 0.7, 0.75, 0.2),
      material,
    );
    crown.castShadow = true;
    crown.userData.siteBuildingId = building.id;
    roofGroup.add(crown);

    const xs = footprint.map((point) => point[0]);
    const ys = footprint.map((point) => point[1]);
    buildings.push({
      id: building.id,
      name: building.name,
      anchor: toWorld(
        [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2],
        height + 1.2,
      ),
      footprint,
    });
  }

  let applied = -1;
  let appliedGhost: boolean | null = null;

  const buildingAt = (point: Point) =>
    buildings.find((building) => insideRing(point, building.footprint)) ?? null;

  return {
    group,
    materials,
    buildings,
    buildingAt,
    isIndoors: (point) => buildingAt(point) !== null,

    setView(metresVisible, routeShowing) {
      const far = Number(smoothstep(ROOF_NEAR_METRES, ROOF_FAR_METRES, metresVisible).toFixed(3));
      if (far === applied && routeShowing === appliedGhost) return { far, changed: false };
      applied = far;
      appliedGhost = routeShowing;
      const opacity = far * (routeShowing ? ROOF_GHOST_OPACITY : ROOF_OPACITY);
      for (const material of roofMaterials) {
        material.opacity = opacity;
        // A ghost must not hide what is inside it from the depth buffer.
        material.depthWrite = opacity > 0.6;
      }
      roofGroup.visible = opacity > 0.01;
      for (const roof of roofGroup.children) (roof as Mesh).castShadow = opacity > 0.6;
      return { far, changed: true };
    },

    dispose() {
      for (const item of disposables) item.dispose();
    },
  };
}
