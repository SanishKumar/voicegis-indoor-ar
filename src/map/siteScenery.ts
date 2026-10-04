import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  RingGeometry,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
} from 'three';
import type { CompiledBuildingPackage } from '@voicegis/map-compiler';
import { insetPolygon, roundCorners, type Point } from './softGeometry';
import { createSiteArchitecture } from './siteArchitecture';

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
  lawn: { color: 0xaac9a6, opacity: 0.98, height: 0.16, radius: 2.4, roughness: 0.95 },
  planting: { color: 0x749a79, opacity: 1, height: 0.42, radius: 1.2, roughness: 0.95 },
  // Water lies in a lawn, so it is drawn a little above the grass round it.
  water: { color: 0x8ec7f7, opacity: 0.85, height: 0.2, radius: 4, roughness: 0.15 },
  paving: { color: 0xffffff, opacity: 0.7, height: 0.1, radius: 1, roughness: 0.9 },
  // Dark enough for the white bay lines to show.
  parking: { color: 0x7f8e9d, opacity: 1, height: 0.1, radius: 1.6, roughness: 0.9 },
  road: { color: 0x596978, opacity: 1, height: 0.06, radius: 0, roughness: 0.9 },
};

/** The roofs are fully on with this much of the site in view, and gone by the other. */
const ROOF_FAR_METRES = 115;
const ROOF_NEAR_METRES = 70;
const ROOF_OPACITY = 0.94;
/**
 * A building a route passes through, seen from outside it: there, but seen
 * through, so the line can be followed in and out of it. Solid enough to read
 * as a building the visitor is not in.
 */
const ROOF_ROUTE_OPACITY = 0.4;
/** How quickly a roof comes off or goes back on, as a visitor walks in or out. */
const ROOF_TAU_MS = 180;

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
   * Says how each building is to be drawn, and returns how far out the view
   * is: 1 from far off, 0 close to. The roofs then ease to it in `advance`.
   */
  setView(view: SiteView): { far: number };
  /** Whether a building is showing its rooms and not its roof. */
  isOpen(buildingId: string): boolean;
  /**
   * Moves every roof towards where it should be. True while any is still
   * moving, or moved this time: the scene has to be drawn again.
   */
  advance(elapsedMs: number, immediate?: boolean): boolean;
  dispose(): void;
}

/*
 * The grounds and each building are separate maps that share one drawing, the
 * way a game has an outside and interiors. Which of them is open is decided
 * by where the visitor is, not only by how close the camera has come.
 */
export interface SiteView {
  /** How many metres of the site are across the view. */
  metresVisible: number;
  /** The building the visitor is in, or has gone in to look at. Its roof is off. */
  entered?: string | null;
  /** Buildings a route passes through. Seen from outside, they are seen through. */
  onRoute?: ReadonlySet<string>;
  /**
   * With nobody on the map, any building opens when the camera comes close.
   * With a visitor on it, only the building they are in does: walking past a
   * building does not take its roof off.
   */
  opensOnApproach?: boolean;
  /** The ground floor's own opacity, when it is a ghost in the stack. */
  floorOpacity?: number;
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

export function createSiteScenery(
  site: Site,
  toWorld: ToWorld,
  portals: CompiledBuildingPackage['portals'] = [],
): SiteScenery {
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
    mesh.name = `site-ground-${ground.kind}`;
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
    // The bevel rises 4 cm above the nominal tile top. Markings must be above
    // that cap, not buried inside the opaque parking surface.
    return strokes(lines, top + 0.06);
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
    return strokes(lines, top + 0.06);
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
    disposables.push(geometry);
    if (points.length === 0) return;
    const mesh = new InstancedMesh(geometry, material, points.length);
    disposables.push(mesh);
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
    return mesh;
  };

  const of = (kind: Site['features'][number]['kind']) =>
    site.features.filter((feature) => feature.kind === kind).map((feature) => feature.position);

  // A tree is a short trunk and a soft round crown. Each is a little different
  // in size, by its place in the list, so a grove does not look stamped out.
  const trees = of('tree');
  const size = (index: number) => 0.82 + ((index * 37) % 11) / 28;
  place(new CylinderGeometry(0.2, 0.32, 2.8, 8), surface(0x998872, 1, 0.95), trees, (o, p) =>
    o.position.copy(toWorld(p, 1.6)),
  );
  const crowns = place(
    new IcosahedronGeometry(2.4, 2),
    surface(0xffffff, 1, 0.95),
    trees,
    (o, p, i) => {
      o.position.copy(toWorld(p, 3 + 1.6 * size(i)));
      o.scale.setScalar(size(i));
      o.rotation.y = i * 1.7;
    },
  );
  const leafColors = [0x779b75, 0x6a906e, 0x91aa7e, 0x7f9d89, 0x92ad92];
  trees.forEach((_, index) =>
    crowns?.setColorAt(index, new Color(leafColors[index % leafColors.length])),
  );
  // A second, smaller mass on one side makes the crown read as a cloud of
  // leaves and not a ball on a stick.
  place(new IcosahedronGeometry(1.65, 1), surface(0x84a586, 1, 0.95), trees, (o, p, i) => {
    const angle = i * 2.4;
    const world = toWorld(p, 3.3 + 0.7 * size(i));
    o.position.set(world.x + Math.cos(angle) * 1.25, world.y, world.z + Math.sin(angle) * 1.25);
    o.scale.setScalar(size(i));
  });

  const white = surface(0xffffff, 1, 0.8);
  const fountains = of('fountain');
  // A paved circular apron within the authored fountain island. It gives the
  // court a landmark without widening or obstructing its surrounding walks.
  const fountainAprons = fountains.filter(([x, y]) =>
    site.grounds.some(
      (ground) =>
        ground.kind === 'planting' &&
        (
          [
            [x - 5.7, y - 5.7],
            [x + 5.7, y - 5.7],
            [x + 5.7, y + 5.7],
            [x - 5.7, y + 5.7],
          ] as Point[]
        ).every((point) => insideRing(point, ground.polygon)),
    ),
  );
  const apron = new RingGeometry(3.65, 5.6, 64);
  apron.rotateX(-Math.PI / 2);
  place(apron, surface(0xe4dfd3, 1, 0.9), fountainAprons, (o, p) =>
    o.position.copy(toWorld(p, 0.49)),
  );
  const apronRim = new RingGeometry(5.4, 5.6, 64);
  apronRim.rotateX(-Math.PI / 2);
  place(apronRim, white, fountainAprons, (o, p) => o.position.copy(toWorld(p, 0.5)));
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
  const bronze = surface(0xa69379, 1, 0.4);
  bronze.metalness = 0.45;
  place(new TorusGeometry(1, 0.14, 8, 28), bronze, statues, (o, p) => {
    o.position.copy(toWorld(p, 2.35));
    o.rotation.y = 0.5;
  });

  place(new BoxGeometry(1.9, 0.34, 0.6), surface(0xe9eef6, 1, 0.9), of('bench'), (o, p) =>
    o.position.copy(toWorld(p, 0.4)),
  );
  place(new BoxGeometry(1.9, 0.55, 0.12), surface(0xab9e8c, 1, 0.9), of('bench'), (o, p) => {
    o.position.copy(toWorld([p[0], p[1] + 0.24], 0.83));
  });
  for (const side of [-0.65, 0.65]) {
    place(new BoxGeometry(0.16, 0.4, 0.5), surface(0x7e8a90, 1, 0.8), of('bench'), (o, p) =>
      o.position.copy(toWorld([p[0] + side, p[1]], 0.25)),
    );
  }

  // Parked cars are illustration inside existing bays, leaving the centre
  // aisle and the authored car-park connection clear. They never affect routes.
  const cars: Point[] = [];
  for (const parking of site.grounds.filter((ground) => ground.kind === 'parking')) {
    const xs = parking.polygon.map(([x]) => x);
    const ys = parking.polygon.map(([, y]) => y);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const y0 = Math.min(...ys);
    const y1 = Math.max(...ys);
    if (y1 - y0 < 18) continue;
    let index = 0;
    for (let x = x0 + 4.35; x < x1 - 4; x += 2.7) {
      for (const y of [y0 + 3.8, y1 - 3.8]) {
        index += 1;
        if (index % 5 === 1) continue;
        if (
          [
            [-1, -2.3],
            [1, -2.3],
            [1, 2.3],
            [-1, 2.3],
          ].every(([dx, dy]) => insideRing([x + dx, y + dy], parking.polygon))
        ) {
          cars.push([x, y]);
        }
      }
    }
  }
  const bodies = place(new BoxGeometry(1.8, 0.65, 4.25), surface(0xffffff, 1, 0.5), cars, (o, p) =>
    o.position.copy(toWorld(p, 0.72)),
  );
  const carColors = [0xe7ebeb, 0x708da0, 0xb7b9ad, 0x586a79, 0xc4d0cc];
  cars.forEach((_, index) =>
    bodies?.setColorAt(index, new Color(carColors[index % carColors.length])),
  );
  const cabins = place(new BoxGeometry(1.5, 0.6, 2.3), surface(0x456678, 1, 0.25), cars, (o, p) =>
    o.position.copy(toWorld(p, 1.32)),
  );
  if (bodies) bodies.name = 'parking-car-bodies';
  if (cabins) cabins.name = 'parking-car-cabins';

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
  /** One roof to a building, each with its own materials, so each can open alone. */
  const roofs = new Map<
    string,
    { group: Group; materials: MeshStandardMaterial[]; shown: number; wanted: number }
  >();
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

    const architecture = createSiteArchitecture(
      building,
      portals.filter((portal) => portal.floorId === site.floorId),
      toWorld,
    );
    const height = architecture.height;
    roofGroup.add(architecture.group);
    roofs.set(building.id, {
      group: architecture.group,
      materials: architecture.materials,
      shown: ROOF_OPACITY,
      wanted: ROOF_OPACITY,
    });
    disposables.push(architecture);

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

  let far = 1;
  let entered: string | null = null;
  let opensOnApproach = true;
  let floorOpacity = 1;
  /** What was last put on the materials, so an unchanged roof costs nothing. */
  let painted = '';

  const buildingAt = (point: Point) =>
    buildings.find((building) => insideRing(point, building.footprint)) ?? null;

  const isOpen = (buildingId: string) => buildingId === entered || (opensOnApproach && far <= 0.5);

  /** Puts each roof's present opacity on its materials. */
  const paint = () => {
    const key = [...roofs.values()].map((roof) => roof.shown.toFixed(3)).join() + floorOpacity;
    if (key === painted) return false;
    painted = key;
    for (const roof of roofs.values()) {
      const opacity = roof.shown * floorOpacity;
      for (const material of roof.materials) {
        material.opacity = opacity;
        // A ghost must not hide what is inside it from the depth buffer.
        material.depthWrite = opacity > 0.6;
      }
      roof.group.visible = opacity > 0.01;
      for (const part of roof.group.children) (part as Mesh).castShadow = opacity > 0.6;
    }
    return true;
  };

  return {
    group,
    materials,
    buildings,
    buildingAt,
    isIndoors: (point) => buildingAt(point) !== null,
    isOpen,

    setView(view) {
      far = Number(smoothstep(ROOF_NEAR_METRES, ROOF_FAR_METRES, view.metresVisible).toFixed(3));
      entered = view.entered ?? null;
      opensOnApproach = view.opensOnApproach ?? true;
      floorOpacity = view.floorOpacity ?? 1;
      for (const [id, roof] of roofs) {
        // From outside: on, unless the camera coming close is what opens it.
        const closed = opensOnApproach ? far : 1;
        roof.wanted =
          id === entered
            ? 0
            : view.onRoute?.has(id)
              ? closed * ROOF_ROUTE_OPACITY
              : closed * ROOF_OPACITY;
      }
      return { far };
    },

    advance(elapsedMs, immediate = false) {
      const ease = immediate ? 1 : 1 - Math.exp(-Math.max(0, elapsedMs) / ROOF_TAU_MS);
      let moving = false;
      for (const roof of roofs.values()) {
        if (roof.shown === roof.wanted) continue;
        const next = roof.shown + (roof.wanted - roof.shown) * ease;
        // Once what is left cannot be seen, it has arrived: an eased move that
        // only ever gets closer keeps the whole scene redrawing.
        roof.shown = Math.abs(roof.wanted - next) < 0.004 ? roof.wanted : next;
        if (roof.shown !== roof.wanted) moving = true;
      }
      return paint() || moving;
    },

    dispose() {
      for (const item of disposables) item.dispose();
    },
  };
}
