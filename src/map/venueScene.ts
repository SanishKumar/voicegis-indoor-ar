import {
  ACESFilmicToneMapping,
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Object3D,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PCFShadowMap,
  Raycaster,
  Scene,
  DoubleSide,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CompiledBuildingPackage } from '@voicegis/map-compiler';
import { resolveCartographicLabels, type CartographicBounds } from '../engine/floorplanCartography';
import type { VisitorLocation } from '../navigation/visitorLocation';
import { cumulativeDistances } from '../navigation/routeProgress';
import {
  azimuthForHeading,
  createVisitorCamera,
  planToWorld,
  type MapInsets,
  type MapMode,
  type VisitorMapView,
} from './visitorCamera';

/**
 * One authored scene, seen from a top-down plan or an orbitable 3D camera.
 * Neither presentation owns or advances the journey.
 *
 * Colour lives in the model. The interface around it stays cream, ink and one
 * blue, so the two never compete.
 */

type Coordinate = [number, number];

const SPACE_FILL: Record<string, number> = {
  entrance: 0xf2ddbe,
  lobby: 0xf7f1e4,
  corridor: 0xfbf8f0,
  room: 0xe4d2b1,
  service: 0xc3d5a8,
  restricted: 0xdfa79a,
  'vertical-circulation': 0xeb9a68,
};
const SPACE_PRIORITY: Record<string, number> = {
  entrance: 8,
  lobby: 6,
  corridor: 2,
  room: 5,
  service: 5,
  restricted: 3,
  'vertical-circulation': 9,
};

/*
 * How far in the map has to be before a label competes for space. Destinations
 * and the ways between floors are what someone is hunting for, so they are
 * always eligible; room names arrive once you have zoomed to a wing; corridor
 * names last, because at an overview they are noise the eye has to step over.
 */
const SPACE_MIN_SCALE: Record<string, number> = {
  entrance: 0,
  'vertical-circulation': 0,
  lobby: 0.9,
  room: 1.25,
  service: 1.25,
  restricted: 1.25,
  corridor: 1.8,
};
const WALL_FILL = 0xfdfaf3;
const SLAB_TOP = 0xdccfb6;
const SLAB_SIDE = 0x9b8e76;
/*
 * The route is the one thing on the model a visitor is actually following, so
 * it carries the accent the rest of the product uses for the thing you act on.
 * It was a green that appears nowhere else, beside orange connector shafts and
 * orange destination markers - three saturated hues competing on a surface
 * whose interface has exactly one. The shafts drop back to a neutral: which
 * lift you take is stated in words in the route summary, and the model only
 * has to show that a way up exists there.
 */
const ROUTE_COLOR = 0x0a65db;
/** Route already covered: still legible, clearly behind you. */
const TRAVELLED_COLOR = 0x9aa6b4;
/** A walk-through marker stays this many CSS pixels across at any zoom. */
const PUCK_PIXELS = 30;
const SHAFT_COLOR = 0xb3aca0;
const SELECTED_FILL = 0x0a65db;

const WALL_THICKNESS = 0.22;
const WALL_HEIGHT = 1.4;

/*
 * How far apart the storeys are pulled when a route crosses between them.
 * Real storey heights are about four metres and the walls are 1.4, so at true
 * elevation the slab above hides the floor below completely. This is a way of
 * reading a building, not a model of one.
 */
const EXPLODE = 3.1;

/** Where the guidance is, and which way the route runs from there. */
export interface ScenePuck {
  x: number;
  y: number;
  floorId: string;
  /** Unit direction of travel in plan coordinates. */
  heading: readonly [number, number];
}

export interface SceneFollow {
  /** Turn the map so the way ahead points up the screen. */
  headingUp: boolean;
  scale: number;
  /** Share of the visible height kept ahead of the marker. */
  lookahead: number;
}

export interface VenueScene {
  setMode(mode: MapMode): void;
  /** Screen space covered by interface, so framing avoids it. */
  setInsets(insets: MapInsets): void;
  /**
   * Ease the camera to show the route on the floors being read, clear of the
   * interface. `northUp` also undoes a bearing that following turned.
   */
  frameRoute(options?: { northUp?: boolean }): void;
  /** Split the route into covered and ahead at this distance, or show it whole. */
  setProgress(meters: number | null): void;
  /** Show the walk-through marker, or remove it. */
  setPuck(puck: ScenePuck | null): void;
  /** Keep the marker in view every frame until the visitor moves the map. */
  setFollow(follow: SceneFollow | null): void;
  /** Undo the visitor's own camera moves: follow again, or reframe the route. */
  recenter(): void;
  /** Told whenever the visitor starts or stops owning the camera. */
  onUserMove(listener: (moved: boolean) => void): () => void;
  /** Whether the visitor owns the camera. */
  wasMovedByUser(): boolean;
  /** Hand the camera back to the visitor, for a scene rebuilt around their view. */
  restoreUserMove(): void;
  /** Canvas-relative rectangles labels must stay out of: buttons drawn over the map. */
  setLabelObstacles(
    rects: ReadonlyArray<{ x: number; y: number; width: number; height: number }>,
  ): void;
  setOverview(enabled: boolean): void;
  getView(): VisitorMapView;
  setLocation(location: Omit<VisitorLocation, 'label'> | null): void;
  focusLocation(): void;
  setActiveFloor(floorId: string): void;
  setRoute(points: ReadonlyArray<{ x: number; y: number; floor: string }>): void;
  setSelectedSpace(spaceId: string | null): void;
  /** POI id under a client point, or null. */
  pickPoi(clientX: number, clientY: number): string | null;
  /** True when the last pointer sequence was a drag rather than a tap. */
  wasDragged(): boolean;
  zoomBy(factor: number): void;
  resetView(): void;
  frame(): void;
  dispose(): void;
}

/**
 * Whether the WebGL drawing buffer still represents the canvas's CSS size.
 *
 * `WebGLRenderer.setSize()` stores physical pixels on the canvas, so comparing
 * those attributes directly with `clientWidth/clientHeight` is only correct at
 * DPR 1. On a DPR 2 handset that comparison forced a backbuffer allocation on
 * every animation frame even when the layout had not changed.
 */
export function venueDrawingBufferNeedsResize(
  bufferWidth: number,
  bufferHeight: number,
  cssWidth: number,
  cssHeight: number,
  pixelRatio: number,
): boolean {
  return (
    bufferWidth !== Math.floor(cssWidth * pixelRatio) ||
    bufferHeight !== Math.floor(cssHeight * pixelRatio)
  );
}

/*
 * Furniture placement is seeded, not random: the same venue must draw the same
 * room every time it is opened, or the map appears to rearrange itself between
 * visits.
 */
function seededRandom(seed: number) {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

function pointInPolygon([x, y]: Coordinate, polygon: readonly Coordinate[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function surface(color: number, extra: Record<string, unknown> = {}) {
  return new MeshStandardMaterial({
    color,
    flatShading: true,
    roughness: 0.92,
    metalness: 0,
    ...extra,
  });
}

export function createVenueScene(
  canvas: HTMLCanvasElement,
  labelLayer: HTMLElement,
  buildingPackage: CompiledBuildingPackage,
  initialView?: VisitorMapView,
): VenueScene {
  const outline = buildingPackage.floors.flatMap((floor) => floor.outline as Coordinate[]);
  const xs = outline.map((point) => point[0]);
  const ys = outline.map((point) => point[1]);
  const centre: Coordinate = [
    (Math.min(...xs) + Math.max(...xs)) / 2,
    (Math.min(...ys) + Math.max(...ys)) / 2,
  ];
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));

  /** Plan +X right, +Y down; world +Y is elevation. */
  const wx = (x: number) => x - centre[0];
  const wz = (y: number) => planToWorld(centre[0], y, centre)[1];
  const vec = ([x, y]: Coordinate, height = 0) => new Vector3(wx(x), height, wz(y));

  // Fail before constructing Three's listeners/resources on unsupported devices.
  const context = canvas.getContext('webgl2', { antialias: true, alpha: true });
  if (!context || context.isContextLost()) throw new Error('Map graphics are unavailable');
  const renderer = new WebGLRenderer({ canvas, context, antialias: true, alpha: true });
  const pixelRatio = Math.min(window.devicePixelRatio, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.toneMapping = ACESFilmicToneMapping;

  const scene = new Scene();
  const cameraRig = createVisitorCamera(span, initialView);
  const { camera, view: cameraView } = cameraRig;

  /*
   * The scene is drawn only when something visible has changed. It used to be
   * redrawn - lit, shadowed and relabelled - sixty times a second while the
   * map sat still, which on a phone is battery and heat for a picture that is
   * not changing. Every mutation below marks the frame as needed; the camera
   * is compared with the pose last drawn, so gestures and easing need nothing.
   */
  let needsDraw = true;
  const invalidate = () => {
    needsDraw = true;
  };
  const drawnView = new Float64Array(16);
  const drawnProjection = new Float64Array(16);
  function cameraChanged() {
    const view = camera.matrixWorld.elements;
    const projection = camera.projectionMatrix.elements;
    let changed = false;
    for (let index = 0; index < 16; index += 1) {
      if (drawnView[index] !== view[index] || drawnProjection[index] !== projection[index]) {
        changed = true;
        drawnView[index] = view[index];
        drawnProjection[index] = projection[index];
      }
    }
    return changed;
  }
  const onContextRestored = invalidate;
  canvas.addEventListener('webglcontextrestored', onContextRestored);
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');

  scene.add(new HemisphereLight(0xd6e7f5, 0xbfae92, 1.5));
  const key = new DirectionalLight(0xfff2df, 2.4);
  key.position.set(span * 0.55, span * 1.2, span * 0.45);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0015;
  const shadowSpan = span * 0.8;
  Object.assign(key.shadow.camera, {
    left: -shadowSpan,
    right: shadowSpan,
    top: shadowSpan,
    bottom: -shadowSpan,
    near: 1,
    far: span * 5,
  });
  key.shadow.camera.updateProjectionMatrix();
  scene.add(key);
  scene.add(new AmbientLight(0xffffff, 0.28));

  function shapeFrom(polygon: readonly Coordinate[]) {
    const shape = new Shape();
    polygon.forEach(([x, y], index) => {
      if (index === 0) shape.moveTo(wx(x), wz(y));
      else shape.lineTo(wx(x), wz(y));
    });
    shape.closePath();
    return shape;
  }

  function wallGeometries(
    a: Coordinate,
    b: Coordinate,
    portals: readonly { position: Coordinate; width: number }[],
  ) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    if (length < 0.05) return [];
    const ux = dx / length;
    const uy = dy / length;

    // A doorway is a gap in the wall, not decoration: the portal's own width
    // is removed and the wall is built from what is left.
    const gaps = portals
      .map((portal) => {
        const px = portal.position[0] - a[0];
        const py = portal.position[1] - a[1];
        return {
          along: px * ux + py * uy,
          across: Math.abs(px * -uy + py * ux),
          half: portal.width / 2 + 0.15,
        };
      })
      .filter((hit) => hit.across < 0.6 && hit.along > -hit.half && hit.along < length + hit.half)
      .map((hit) => [Math.max(0, hit.along - hit.half), Math.min(length, hit.along + hit.half)])
      .sort((left, right) => left[0] - right[0]);

    let cursor = 0;
    const runs: Array<[number, number]> = [];
    for (const [from, to] of gaps) {
      if (from > cursor) runs.push([cursor, from]);
      cursor = Math.max(cursor, to);
    }
    if (cursor < length) runs.push([cursor, length]);

    const built = [];
    for (const [from, to] of runs) {
      const run = to - from;
      if (run < 0.12) continue;
      const t = (from + to) / 2 / length;
      const geometry = new BoxGeometry(run, WALL_HEIGHT, WALL_THICKNESS);
      geometry.translate(0, WALL_HEIGHT / 2 + 0.03, 0);
      geometry.rotateY(Math.atan2(-dy, dx));
      geometry.translate(wx(a[0] + dx * t), 0, wz(a[1] + dy * t));
      built.push(geometry);
    }
    return built;
  }

  interface FloorView {
    id: string;
    elevation: number;
    /** Where this floor is easing toward, so the stack opens rather than cuts. */
    targetY: number;
    targetOpacity: number;
    group: Group;
    materials: MeshStandardMaterial[];
    routeGroup: Group;
    spaceMeshes: Map<string, Mesh>;
    poiTargets: Array<{ id: string; object: Object3D }>;
    labels: Array<{
      id: string;
      text: string;
      priority: number;
      minScale: number;
      anchor: Vector3;
    }>;
  }

  const floors = new Map<string, FloorView>();

  for (const floor of buildingPackage.floors) {
    const group = new Group();
    group.visible = false;
    const spaces = buildingPackage.spaces.filter((space) => space.floorId === floor.id);
    const portals = buildingPackage.portals
      .filter((portal) => portal.floorId === floor.id)
      .map((portal) => ({ position: portal.position as Coordinate, width: portal.width }));
    const pois = buildingPackage.pois.filter((poi) => poi.floorId === floor.id);
    const materials: MeshStandardMaterial[] = [];
    const track = <T extends MeshStandardMaterial>(material: T) => {
      materials.push(material);
      return material;
    };
    // A room containing a destination is already named by that destination's
    // pill. Labelling both draws the same words twice, a few pixels apart.
    const spacesNamedByAPoi = new Set(pois.map((poi) => poi.spaceId));
    const labels: FloorView['labels'] = [];

    const slab = new ExtrudeGeometry(shapeFrom(floor.outline as Coordinate[]), {
      depth: 0.9,
      bevelEnabled: true,
      bevelSize: 0.16,
      bevelThickness: 0.16,
      bevelSegments: 1,
    });
    // rotateX sends the extrusion to -Y, so the slab already hangs below zero
    // with its top face at zero. Lifting it would bury everything on it.
    slab.rotateX(Math.PI / 2);
    const slabMesh = new Mesh(slab, [track(surface(SLAB_TOP)), track(surface(SLAB_SIDE))]);
    slabMesh.receiveShadow = true;
    group.add(slabMesh);

    const spaceMeshes = new Map<string, Mesh>();
    for (const space of spaces) {
      const polygon = space.polygon as Coordinate[];
      const geometry = new ShapeGeometry(shapeFrom(polygon));
      geometry.rotateX(Math.PI / 2);
      geometry.translate(0, 0.24, 0);
      const mesh = new Mesh(
        geometry,
        track(surface(SPACE_FILL[space.type] ?? SPACE_FILL.room, { side: DoubleSide })),
      );
      mesh.receiveShadow = true;
      mesh.userData.spaceId = space.id;
      group.add(mesh);
      spaceMeshes.set(space.id, mesh);

      if (spacesNamedByAPoi.has(space.id)) continue;
      const sx = polygon.map((point) => point[0]);
      const sy = polygon.map((point) => point[1]);
      labels.push({
        id: `space:${space.id}`,
        text: space.name,
        priority: SPACE_PRIORITY[space.type] ?? 5,
        minScale: SPACE_MIN_SCALE[space.type] ?? 1.25,
        anchor: vec(
          [(Math.min(...sx) + Math.max(...sx)) / 2, (Math.min(...sy) + Math.max(...sy)) / 2],
          1.5,
        ),
      });
    }

    // Merged per colour: one mesh per wall colour rather than one per segment,
    // which is the difference between tens of draw calls and hundreds.
    const wallsByColor = new Map<number, ReturnType<typeof wallGeometries>>();
    const addWalls = (points: readonly Coordinate[], color: number) => {
      const bucket = wallsByColor.get(color) ?? [];
      points.forEach((point, index) => {
        bucket.push(...wallGeometries(point, points[(index + 1) % points.length], portals));
      });
      wallsByColor.set(color, bucket);
    };
    for (const space of spaces) {
      if (space.type === 'corridor') continue;
      addWalls(space.polygon as Coordinate[], WALL_FILL);
    }
    addWalls(floor.outline as Coordinate[], WALL_FILL);
    for (const [color, geometries] of wallsByColor) {
      if (geometries.length === 0) continue;
      const mesh = new Mesh(mergeGeometries(geometries), track(surface(color)));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }

    /*
     * The furniture is what stops a floor plate reading as an empty diagram.
     * It is illustration, not survey: the package does not record where chairs
     * are, so these are placed inside the right rooms and never claimed to be
     * anything more.
     */
    const random = seededRandom(20260828);
    const seats: Coordinate[] = [];
    const planters: Coordinate[] = [];
    for (const space of spaces) {
      if (!['lobby', 'entrance', 'room', 'service'].includes(space.type)) continue;
      const polygon = space.polygon as Coordinate[];
      const px = polygon.map((point) => point[0]);
      const py = polygon.map((point) => point[1]);
      const wanted = space.type === 'lobby' || space.type === 'entrance' ? 8 : 3;
      let tries = 0;
      let placed = 0;
      while (placed < wanted && tries < 120) {
        tries += 1;
        const candidate: Coordinate = [
          Math.min(...px) + 1 + random() * (Math.max(...px) - Math.min(...px) - 2),
          Math.min(...py) + 1 + random() * (Math.max(...py) - Math.min(...py) - 2),
        ];
        if (!pointInPolygon(candidate, polygon)) continue;
        (random() > 0.62 ? planters : seats).push(candidate);
        placed += 1;
      }
    }

    const addInstances = (
      geometry: ConstructorParameters<typeof InstancedMesh>[0],
      material: MeshStandardMaterial,
      points: Coordinate[],
      place: (object: Object3D, point: Coordinate) => void,
    ) => {
      if (points.length === 0) return;
      const mesh = new InstancedMesh(geometry, track(material), points.length);
      const scratch = new Object3D();
      points.forEach((point, index) => {
        place(scratch, point);
        scratch.updateMatrix();
        mesh.setMatrixAt(index, scratch.matrix);
      });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    };

    /*
     * Furniture is scenery and is coloured like scenery. In tan, terracotta
     * and olive it competed with the markers for attention and, at a metre
     * across and head height, the planters read as trees growing indoors. Warm
     * neutrals put it back where it belongs - enough to stop a floor plate
     * looking like an empty diagram, quiet enough that the only saturated
     * things on the model are the route and the destinations.
     */
    addInstances(new BoxGeometry(1.5, 0.42, 0.6), surface(0xc4bfb4), seats, (object, point) => {
      object.position.copy(vec(point, 0.24));
      object.rotation.set(0, random() > 0.5 ? 0 : Math.PI / 2, 0);
    });
    addInstances(
      new CylinderGeometry(0.22, 0.26, 0.46, 10),
      surface(0xada79c),
      planters,
      (object, point) => object.position.copy(vec(point, 0.23)),
    );
    addInstances(new IcosahedronGeometry(0.3, 0), surface(0x8d9c84), planters, (object, point) => {
      object.position.copy(vec(point, 0.62));
      object.scale.set(1, 1.15, 1);
      object.rotation.set(0, random() * Math.PI, 0);
    });

    /*
     * A destination is a pin: a tapered body with its point on the floor and a
     * head on top, in the one accent the system carries.
     *
     * It used to be a 0.5m orange sphere floating at 1.6m on a thin brown
     * stem. At the scale a room is drawn, that is a lollipop - and standing in
     * a row inside a hospital ward next to green blobs on pots, it read as a
     * potted tree rather than a marker. Nothing about the old shape said
     * "destination", and the orange was the largest off-palette surface left
     * in the product.
     */
    const poiTargets: FloorView['poiTargets'] = [];
    for (const poi of pois) {
      const pinMaterial = track(surface(0x0a65db, { emissive: 0x0a65db, emissiveIntensity: 0.18 }));

      const body = new Mesh(new ConeGeometry(0.32, 0.8, 14), pinMaterial);
      body.rotation.x = Math.PI;
      body.position.copy(vec(poi.position as Coordinate, 0.45));
      body.userData.poiId = poi.id;
      body.castShadow = true;
      group.add(body);
      poiTargets.push({ id: poi.id, object: body });

      const head = new Mesh(new SphereGeometry(0.3, 16, 12), pinMaterial);
      head.position.copy(vec(poi.position as Coordinate, 0.95));
      head.userData.poiId = poi.id;
      head.castShadow = true;
      group.add(head);
      // Both halves answer a tap. The head is the part a finger actually lands
      // on, and picking resolves through userData rather than identity, so a
      // second entry for the same POI costs nothing.
      poiTargets.push({ id: poi.id, object: head });

      labels.push({
        id: `poi:${poi.id}`,
        text: poi.name,
        priority: 12,
        minScale: 0,
        anchor: vec(poi.position as Coordinate, 1.45),
      });
    }

    const routeGroup = new Group();
    group.add(routeGroup);

    scene.add(group);
    floors.set(floor.id, {
      id: floor.id,
      elevation: floor.elevation,
      targetY: 0,
      targetOpacity: 1,
      group,
      materials,
      routeGroup,
      spaceMeshes,
      poiTargets,
      labels,
    });
  }

  /* The climbs between storeys belong to no single floor. */
  const hopsGroup = new Group();
  scene.add(hopsGroup);

  /* The lifts and stairs themselves, drawn as the shafts they are. They only
     mean anything once the stack is open, because that is the only time there
     is a gap between storeys for them to cross. */
  const shaftsGroup = new Group();
  scene.add(shaftsGroup);

  let activeFloorId = buildingPackage.floors[0]?.id ?? '';
  let routePoints: ReadonlyArray<{ x: number; y: number; floor: string }> = [];
  let routeFloors: string[] = [];
  let selectedSpaceId: string | null = null;

  const locationGroup = new Group();
  let location: Omit<VisitorLocation, 'label'> | null = null;

  function emptyGroup(group: Group) {
    for (const child of [...group.children]) {
      group.remove(child);
      // Route tubes share one geometry and two materials; those outlive a rebuild.
      if (child.userData.sharedResources === true) continue;
      const mesh = child as Mesh;
      mesh.geometry?.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
      else material?.dispose();
    }
  }

  function clearRoute() {
    emptyGroup(hopsGroup);
    emptyGroup(shaftsGroup);
    for (const view of floors.values()) emptyGroup(view.routeGroup);
  }

  const routeMaterial = () =>
    new MeshStandardMaterial({
      color: ROUTE_COLOR,
      emissive: ROUTE_COLOR,
      emissiveIntensity: 0.45,
      roughness: 0.4,
      flatShading: true,
    });

  /*
   * Every tube is the same unit cylinder, stretched and turned into place, and
   * every tube is one of two materials. Moving along the route then only swaps
   * materials and re-stretches the one segment being walked, instead of
   * allocating geometry on every frame of a walk-through.
   */
  const tubeGeometry = new CylinderGeometry(0.26, 0.26, 1, 10);
  const aheadMaterial = routeMaterial();
  const travelledMaterial = new MeshStandardMaterial({
    color: TRAVELLED_COLOR,
    roughness: 0.6,
    flatShading: true,
  });
  const up = new Vector3(0, 1, 0);
  const scratchDirection = new Vector3();

  function placeTube(mesh: Mesh, from: Vector3, to: Vector3) {
    scratchDirection.copy(to).sub(from);
    const length = scratchDirection.length();
    mesh.visible = length > 0.001;
    if (!mesh.visible) return;
    mesh.position.copy(from).add(to).multiplyScalar(0.5);
    mesh.scale.set(1, length, 1);
    mesh.quaternion.setFromUnitVectors(up, scratchDirection.normalize());
  }

  function tubeMesh(material: MeshStandardMaterial) {
    const mesh = new Mesh(tubeGeometry, material);
    mesh.userData.sharedResources = true;
    return mesh;
  }

  interface RouteTube {
    mesh: Mesh;
    from: Vector3;
    to: Vector3;
    start: number;
    end: number;
    /** Only floor segments are split; a climb is either done or not. */
    splittable: boolean;
  }
  let tubes: RouteTube[] = [];
  let routeProgress: number | null = null;
  const splitBehind = tubeMesh(travelledMaterial);
  const splitAhead = tubeMesh(aheadMaterial);

  function routeTube(from: Vector3, to: Vector3) {
    if (from.distanceTo(to) < 0.001) return null;
    const tube = tubeMesh(aheadMaterial);
    placeTube(tube, from, to);
    return tube;
  }

  function applyProgress() {
    invalidate();
    splitBehind.removeFromParent();
    splitAhead.removeFromParent();
    for (const tube of tubes) {
      if (routeProgress === null || routeProgress <= tube.start) {
        tube.mesh.material = aheadMaterial;
        tube.mesh.visible = true;
      } else if (routeProgress >= tube.end || !tube.splittable) {
        tube.mesh.material = travelledMaterial;
        tube.mesh.visible = true;
      } else {
        // The segment underfoot: covered up to here, ahead from here.
        const t = (routeProgress - tube.start) / Math.max(1e-6, tube.end - tube.start);
        const split = tube.from.clone().lerp(tube.to, t);
        tube.mesh.visible = false;
        const parent = tube.mesh.parent;
        if (parent) {
          parent.add(splitBehind, splitAhead);
          placeTube(splitBehind, tube.from, split);
          placeTube(splitAhead, split, tube.to);
        }
      }
    }
  }

  /** Where a floor sits when the stack is showing, relative to the active one. */
  function stackY(view: FloorView) {
    const active = floors.get(activeFloorId);
    if (active === undefined) return 0;
    return (view.elevation - active.elevation) * EXPLODE;
  }

  // A route crossing floors does not itself change the visitor's camera.
  const stacked = () => cameraView.mode === '3d' && cameraView.overview && routeFloors.length > 1;

  function rebuildRoute() {
    invalidate();
    clearRoute();
    tubes = [];
    if (routePoints.length < 2) return;

    const distances = cumulativeDistances(routePoints);
    const showing = stacked() ? routeFloors : [activeFloorId];
    routePoints.forEach((from, index) => {
      const to = routePoints[index + 1];
      if (to === undefined || from.floor !== to.floor || !showing.includes(from.floor)) return;
      const view = floors.get(from.floor);
      if (!view) return;
      // Actual graph edges, never a spline that cuts across a corner.
      const start = vec([from.x, from.y], 0.52);
      const end = vec([to.x, to.y], 0.52);
      const tube = routeTube(start, end);
      if (!tube) return;
      view.routeGroup.add(tube);
      tubes.push({
        mesh: tube,
        from: start,
        to: end,
        start: distances[index],
        end: distances[index + 1],
        splittable: true,
      });
    });

    if (stacked()) {
      // Every connector that touches the storeys on show, not only the one the
      // route picked: seeing the alternatives is half of reading a stack.
      for (const connector of buildingPackage.verticalConnectors) {
        const stops = connector.stops
          .filter((stop) => routeFloors.includes(stop.floorId))
          .map((stop) => ({ stop, view: floors.get(stop.floorId) }))
          .filter(
            (entry): entry is { stop: typeof entry.stop; view: FloorView } =>
              entry.view !== undefined,
          )
          .sort((left, right) => stackY(left.view) - stackY(right.view));
        if (stops.length < 2) continue;
        const bottom = stackY(stops[0].view);
        const height = stackY(stops[stops.length - 1].view) - bottom;
        if (height <= 0) continue;
        const shaft = new Mesh(
          new CylinderGeometry(0.5, 0.5, height, connector.kind === 'elevator' ? 12 : 4),
          new MeshStandardMaterial({
            color: SHAFT_COLOR,
            flatShading: true,
            roughness: 0.8,
            transparent: true,
            opacity: 0.4,
          }),
        );
        shaft.position.copy(vec(stops[0].stop.position as Coordinate, bottom + height / 2));
        shaftsGroup.add(shaft);
      }

      routePoints.forEach((exit, index) => {
        const entry = routePoints[index + 1];
        if (entry === undefined || exit.floor === entry.floor) return;
        const from = floors.get(exit.floor);
        const to = floors.get(entry.floor);
        if (from === undefined || to === undefined) return;
        const start = vec([exit.x, exit.y], stackY(from) + 0.52);
        const end = vec([entry.x, entry.y], stackY(to) + 0.52);
        const hop = routeTube(start, end);
        if (!hop) return;
        hopsGroup.add(hop);
        tubes.push({
          mesh: hop,
          from: start,
          to: end,
          start: distances[index],
          end: distances[index + 1],
          splittable: false,
        });
      });
    }
    applyProgress();
  }

  /*
   * The walk-through marker: a disc with an arrow along the route. It shows
   * where the guidance is, not where a handset is, so it carries no accuracy
   * halo - there is no measurement for one to describe. Drawn over everything
   * and at a constant screen size, as a location puck is.
   */
  const puck = new Group();
  const overlay = (color: number, opacity = 1) =>
    new MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthTest: false,
      depthWrite: false,
      side: DoubleSide,
    });
  const puckDiscs = new Group();
  puckDiscs.rotation.x = -Math.PI / 2;
  const puckShadow = new Mesh(new CircleGeometry(0.6, 40), overlay(0x000609, 0.16));
  puckShadow.position.set(0.03, -0.05, 0);
  const puckRim = new Mesh(new CircleGeometry(0.54, 40), overlay(0xfff9f0));
  const puckCore = new Mesh(new CircleGeometry(0.42, 40), overlay(ROUTE_COLOR));
  puckDiscs.add(puckShadow, puckRim, puckCore);
  const arrowGeometry = new BufferGeometry();
  // A chevron pointing along -Z, which the pivot turns onto the route.
  arrowGeometry.setAttribute(
    'position',
    new Float32BufferAttribute(
      [0, 0, -0.3, -0.22, 0, 0.22, 0, 0, 0.08, 0, 0, -0.3, 0, 0, 0.08, 0.22, 0, 0.22],
      3,
    ),
  );
  const arrowPivot = new Group();
  const arrow = new Mesh(arrowGeometry, overlay(0xfff9f0));
  arrowPivot.add(arrow);
  puck.add(puckDiscs, arrowPivot);
  // Painted in this order, last on top, regardless of depth.
  [puckShadow, puckRim, puckCore, arrow].forEach((mesh, index) => {
    mesh.renderOrder = 1000 + index;
  });

  const appliedFloors = new Map<string, { y: number; opacity: number }>();
  let puckTarget: ScenePuck | null = null;
  const puckShown = { x: 0, y: 0, angle: 0, floorId: '' };
  let follow: SceneFollow | null = null;
  const userMoveListeners = new Set<(moved: boolean) => void>();
  let reportedUserMove = false;

  function placePuck(immediate: boolean, elapsedMs: number) {
    const floor = puckTarget ? floors.get(puckTarget.floorId) : undefined;
    // Only drawn on the storey being read; a marker floating over the wrong
    // floor is worse than none.
    if (puckTarget === null || floor === undefined || !floor.group.visible) {
      puck.removeFromParent();
      return;
    }
    const wanted = azimuthForHeading(puckTarget.heading);
    if (immediate || puckShown.floorId !== puckTarget.floorId) {
      puckShown.x = puckTarget.x;
      puckShown.y = puckTarget.y;
      puckShown.angle = wanted;
      puckShown.floorId = puckTarget.floorId;
    } else {
      const step = Math.min(100, Math.max(0, elapsedMs));
      const k = 1 - Math.exp(-step / 90);
      puckShown.x += (puckTarget.x - puckShown.x) * k;
      puckShown.y += (puckTarget.y - puckShown.y) * k;
      let turn = (wanted - puckShown.angle) % (Math.PI * 2);
      if (turn > Math.PI) turn -= Math.PI * 2;
      if (turn < -Math.PI) turn += Math.PI * 2;
      puckShown.angle += turn * (1 - Math.exp(-step / 120));
    }
    if (puck.parent !== floor.group) floor.group.add(puck);
    puck.position.copy(vec([puckShown.x, puckShown.y], 0.72));
    arrowPivot.rotation.y = puckShown.angle;
  }

  /** Target height and opacity for every floor, given route and active floor. */
  function layout() {
    invalidate();
    let shown = 0;
    for (const view of floors.values()) {
      const inStack = stacked() && routeFloors.includes(view.id);
      const active = view.id === activeFloorId;
      view.group.visible = active || inStack;
      if (view.group.visible) shown += 1;
      view.targetY = inStack ? stackY(view) : 0;
      view.targetOpacity = active ? 1 : 0.22;
    }
    hopsGroup.visible = stacked();
    shaftsGroup.visible = stacked();
    // What the scene decided, published where it can be observed. Asserting on
    // the route's floor count instead would only prove the input.
    canvas.parentElement?.setAttribute('data-floors-shown', String(shown));
  }

  /*
   * Labels are HTML over the canvas, placed by the same collision pass the
   * previous renderer used. Everything is measured once and cached: reading
   * offsetWidth per label per frame forces a layout on every one of them.
   */
  const labelElements = new Map<string, HTMLElement>();
  let labelObstacles: CartographicBounds[] = [];
  const labelSizes = new Map<string, [number, number]>();
  const projected = new Vector3();

  /*
   * Sizes are cached, but the first frame measures them before the webfont has
   * settled, and a pill measured in the fallback face is narrower than the one
   * finally drawn. The collision pass then packs labels that really do overlap.
   * Throw the cache away once the fonts are done and measure again.
   */
  if (typeof document !== 'undefined' && document.fonts !== undefined) {
    void document.fonts.ready.then(() => {
      labelSizes.clear();
      invalidate();
    });
  }

  function elementFor(id: string, text: string) {
    const existing = labelElements.get(id);
    if (existing !== undefined) return existing;
    const element = document.createElement('span');
    element.className = id.startsWith('poi:') ? 'map-pill map-pill-poi' : 'map-pill';
    element.textContent = text;
    element.style.opacity = '0';
    labelLayer.appendChild(element);
    labelElements.set(id, element);
    return element;
  }

  /** The marker's footprint on screen, so no label is placed over it. */
  function puckObstacle(width: number, height: number) {
    if (puck.parent === null) return [];
    const centre = puck.getWorldPosition(projected).project(camera);
    if (centre.z > 1) return [];
    const x = (centre.x * 0.5 + 0.5) * width;
    const y = (-centre.y * 0.5 + 0.5) * height;
    const half = PUCK_PIXELS * 0.7;
    return [
      {
        minX: x - half,
        minY: y - half,
        maxX: x + half,
        maxY: y + half,
        width: half * 2,
        height: half * 2,
        center: [x, y] as [number, number],
      },
    ];
  }

  function drawLabels(width: number, height: number) {
    const view = floors.get(activeFloorId);
    for (const [id, element] of labelElements) {
      if (view === undefined || !view.labels.some((label) => label.id === id)) {
        element.style.opacity = '0';
      }
    }
    if (view === undefined) return;

    const candidates = [];
    for (const label of view.labels) {
      const element = elementFor(label.id, label.text);
      let size = labelSizes.get(label.id);
      if (size === undefined || size[0] === 0) {
        element.style.opacity = '0.001';
        size = [element.offsetWidth, element.offsetHeight];
        if (size[0] > 0) labelSizes.set(label.id, size);
        else invalidate();
      }
      projected.copy(label.anchor).project(camera);
      if (projected.z > 1) {
        element.style.opacity = '0';
        continue;
      }
      candidates.push({
        id: label.id,
        center: [(projected.x * 0.5 + 0.5) * width, (-projected.y * 0.5 + 0.5) * height] as [
          number,
          number,
        ],
        width: size[0],
        height: size[1],
        priority: label.priority,
        minScale: label.minScale,
      });
    }

    const placed = new Set<string>();
    // Scale is how far in the camera has come from its opening distance, which
    // is what decides which tier of labels is allowed to compete.
    const scale = 1 / cameraView.scale;
    // Nothing is labelled under the interface: the covered strips and the
    // map's own buttons are taken before any label competes for space.
    const insets = cameraRig.getInsets();
    const strip = (minX: number, minY: number, maxX: number, maxY: number) => ({
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX,
      height: maxY - minY,
      center: [(minX + maxX) / 2, (minY + maxY) / 2] as [number, number],
    });
    const reserved = [
      ...labelObstacles,
      ...puckObstacle(width, height),
      ...(insets.top > 0 ? [strip(0, 0, width, insets.top)] : []),
      ...(insets.bottom > 0 ? [strip(0, height - insets.bottom, width, height)] : []),
      ...(insets.left > 0 ? [strip(0, 0, insets.left, height)] : []),
      ...(insets.right > 0 ? [strip(width - insets.right, 0, width, height)] : []),
    ];
    for (const label of resolveCartographicLabels(candidates, reserved, 6, scale).placed) {
      const element = labelElements.get(label.id);
      if (element === undefined) continue;
      // `bounds`, not `center`. The placer moves a colliding label to whichever
      // anchor is free and reports where it put it; drawing at the original
      // centre throws that away and puts the labels back on top of each other -
      // which is exactly what a room and its POI of the same name did.
      const { minX, minY, maxX, maxY } = label.bounds;
      // Anything that would leave the canvas is dropped rather than clipped.
      if (minX < 2 || minY < 2 || maxX > width - 2 || maxY > height - 2) {
        element.style.opacity = '0';
        continue;
      }
      element.style.transform = `translate(${Math.round(minX)}px, ${Math.round(minY)}px)`;
      element.style.opacity = '1';
      placed.add(label.id);
    }
    for (const [id, element] of labelElements) {
      if (!placed.has(id)) element.style.opacity = '0';
    }
  }

  /*
   * Orbit, pan and zoom, on pointer events so a mouse and a finger take the
   * same path. A drag must not also select: the pointer is only treated as a
   * click if it barely moved, otherwise letting go over a destination after
   * dragging the map would open something the visitor never aimed at.
   */
  const DRAG_SLOP = 6;
  const pointers = new Map<number, { x: number; y: number; startX: number; startY: number }>();
  let dragged = false;
  let panning = false;
  let pinchDistance = 0;

  const spread = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const pointerDown = (event: PointerEvent) => {
    if (pointers.size === 0) dragged = false;
    pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
    });
    panning = cameraView.mode === '2d' || event.shiftKey || event.button === 1;
    if (pointers.size === 2) {
      pinchDistance = spread();
      dragged = true;
    }
    canvas.setPointerCapture(event.pointerId);
  };

  const pointerMove = (event: PointerEvent) => {
    const previous = pointers.get(event.pointerId);
    if (previous === undefined) return;
    const dx = event.clientX - previous.x;
    const dy = event.clientY - previous.y;
    pointers.set(event.pointerId, { ...previous, x: event.clientX, y: event.clientY });
    if (Math.hypot(event.clientX - previous.startX, event.clientY - previous.startY) > DRAG_SLOP)
      dragged = true;

    if (pointers.size === 2) {
      cameraRig.pan(dx / 2, dy / 2, canvas.clientWidth, canvas.clientHeight);
      const next = spread();
      if (pinchDistance > 0 && next > 0) {
        cameraRig.zoomBy(pinchDistance / next);
        dragged = true;
      }
      pinchDistance = next;
      return;
    }

    if (panning) {
      cameraRig.pan(dx, dy, canvas.clientWidth, canvas.clientHeight);
      return;
    }

    cameraRig.orbit(dx * 0.005, dy * 0.005);
  };

  const releasePointer = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinchDistance = 0;
    if (pointers.size === 0) panning = false;
  };
  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', releasePointer);
  canvas.addEventListener('pointercancel', releasePointer);
  canvas.addEventListener('lostpointercapture', releasePointer);

  const wheel = (event: WheelEvent) => {
    event.preventDefault();
    cameraRig.zoomBy(1 + Math.sign(event.deltaY) * 0.12);
  };
  canvas.addEventListener('wheel', wheel, { passive: false });
  const keyDown = (event: KeyboardEvent) => {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [40, 0],
      ArrowRight: [-40, 0],
      ArrowUp: [0, 40],
      ArrowDown: [0, -40],
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    cameraRig.pan(move[0], move[1], canvas.clientWidth, canvas.clientHeight);
  };
  canvas.addEventListener('keydown', keyDown);

  const raycaster = new Raycaster();
  const pointer = new Vector2();

  /** World points for the part of the route being read, stack heights included. */
  function routeFramePoints() {
    const showing = stacked() ? routeFloors : [activeFloorId];
    const points: Array<[number, number, number]> = [];
    for (const point of routePoints) {
      if (!showing.includes(point.floor)) continue;
      const view = floors.get(point.floor);
      const world = vec([point.x, point.y], view && stacked() ? stackY(view) : 0);
      points.push([world.x, world.y, world.z]);
    }
    if (location && showing.includes(location.floorId)) {
      const world = vec(location.position);
      points.push([world.x, 0, world.z]);
    }
    return points;
  }

  const handle: VenueScene = {
    setInsets(insets) {
      cameraRig.setInsets(insets);
      invalidate();
    },

    frameRoute(options = {}) {
      let points = routeFramePoints();
      if (points.length === 0) {
        const floor = buildingPackage.floors.find((entry) => entry.id === activeFloorId);
        points = ((floor?.outline ?? []) as Coordinate[]).map((point) => {
          const world = vec(point);
          return [world.x, 0, world.z] as [number, number, number];
        });
      }
      cameraRig.fit(points, canvas.clientWidth, canvas.clientHeight, {
        azimuth: options.northUp ? 0 : undefined,
      });
    },

    setProgress(meters) {
      routeProgress = meters === null || !Number.isFinite(meters) ? null : meters;
      applyProgress();
    },

    setPuck(next) {
      invalidate();
      const immediate = puckTarget === null;
      puckTarget = next;
      placePuck(immediate, 0);
    },

    setFollow(next) {
      follow = next;
      if (next === null) cameraRig.stop();
    },

    recenter() {
      if (follow && puckTarget) {
        // Following resumes on the next frame, now the visitor no longer owns the camera.
        const world = vec([puckTarget.x, puckTarget.y]);
        cameraRig.follow([world.x, world.z]);
        return;
      }
      handle.frameRoute();
    },

    setLabelObstacles(rects) {
      invalidate();
      labelObstacles = rects.map((rect) => ({
        minX: rect.x,
        minY: rect.y,
        maxX: rect.x + rect.width,
        maxY: rect.y + rect.height,
        width: rect.width,
        height: rect.height,
        center: [rect.x + rect.width / 2, rect.y + rect.height / 2] as [number, number],
      }));
    },

    wasMovedByUser() {
      return cameraRig.wasMovedByUser();
    },

    restoreUserMove() {
      cameraRig.markMovedByUser();
    },

    onUserMove(listener) {
      userMoveListeners.add(listener);
      return () => {
        userMoveListeners.delete(listener);
      };
    },

    setMode(mode) {
      cameraView.mode = mode;
      pointers.clear();
      layout();
      rebuildRoute();
    },
    setOverview(enabled) {
      cameraView.overview = enabled;
      layout();
      rebuildRoute();
    },
    getView: cameraRig.snapshot,
    setLocation(nextLocation) {
      invalidate();
      emptyGroup(locationGroup);
      locationGroup.removeFromParent();
      location = nextLocation;
      if (!location) return;
      const floor = floors.get(location.floorId);
      if (!floor) return;
      // Fixed-size checkpoint symbol: no heading cone or invented accuracy halo.
      const rim = new Mesh(
        new CylinderGeometry(0.85, 0.85, 0.12, 32),
        new MeshStandardMaterial({ color: 0xffffff }),
      );
      const dot = new Mesh(
        new CylinderGeometry(0.59, 0.59, 0.17, 32),
        new MeshStandardMaterial({ color: location.basis === 'qr' ? 0x0967df : 0x536779 }),
      );
      dot.position.y = 0.1;
      locationGroup.add(rim, dot);
      locationGroup.position.copy(vec(location.position, 1.65));
      floor.group.add(locationGroup);
    },

    focusLocation() {
      if (!location) return;
      handle.setActiveFloor(location.floorId);
      const [x, z] = planToWorld(location.position[0], location.position[1], centre);
      cameraRig.fit(
        [
          [x - 12, 0, z - 12],
          [x + 12, 0, z + 12],
        ],
        canvas.clientWidth,
        canvas.clientHeight,
      );
    },

    setActiveFloor(floorId) {
      if (!floors.has(floorId)) return;
      activeFloorId = floorId;
      // Stack heights are relative to whichever floor is being read, so the
      // one in hand stays put and the others move around it.
      layout();
      rebuildRoute();
      placePuck(true, 0);
    },

    setRoute(points) {
      routePoints = points;
      routeFloors = [];
      for (const point of points) {
        const floorId = String(point.floor);
        if (routeFloors[routeFloors.length - 1] !== floorId) routeFloors.push(floorId);
      }
      // A route that leaves a floor and comes back is still those two floors.
      routeFloors = [...new Set(routeFloors)];
      layout();
      rebuildRoute();
    },

    setSelectedSpace(spaceId) {
      invalidate();
      const view = floors.get(activeFloorId);
      if (view === undefined) return;
      if (selectedSpaceId !== null) {
        const previous = view.spaceMeshes.get(selectedSpaceId);
        const space = buildingPackage.spaces.find((entry) => entry.id === selectedSpaceId);
        if (previous && space) {
          (previous.material as MeshStandardMaterial).color.setHex(
            SPACE_FILL[space.type] ?? SPACE_FILL.room,
          );
        }
      }
      selectedSpaceId = spaceId;
      if (spaceId === null) return;
      const mesh = view.spaceMeshes.get(spaceId);
      if (mesh) (mesh.material as MeshStandardMaterial).color.setHex(SELECTED_FILL);
    },

    wasDragged() {
      return dragged;
    },

    zoomBy(factor) {
      cameraRig.zoomBy(factor);
    },

    resetView() {
      cameraRig.reset();
      layout();
      rebuildRoute();
    },

    pickPoi(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      pointer.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const view = floors.get(activeFloorId);
      if (view === undefined) return null;
      const hits = raycaster.intersectObjects(
        view.poiTargets.map((entry) => entry.object),
        false,
      );
      return hits.length > 0 ? (hits[0].object.userData.poiId as string) : null;
    },

    frame() {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width === 0 || height === 0) return;
      if (venueDrawingBufferNeedsResize(canvas.width, canvas.height, width, height, pixelRatio)) {
        renderer.setSize(width, height, false);
        invalidate();
      }
      for (const view of floors.values()) {
        const last = appliedFloors.get(view.id);
        if (last && last.y === view.targetY && last.opacity === view.targetOpacity) continue;
        appliedFloors.set(view.id, { y: view.targetY, opacity: view.targetOpacity });
        invalidate();
        // Connector segments and floors must share exact endpoints while the
        // camera animates. Moving only floors would detach routes from stops.
        view.group.position.y = view.targetY;
        const ghosted = view.targetOpacity < 0.995;
        for (const material of view.materials) {
          material.opacity = view.targetOpacity;
          material.transparent = material.opacity < 0.995;
          material.depthWrite = material.opacity > 0.6;
        }
        // A ghosted storey must not throw shadows across the one being read.
        // Walked once when that changes, not across every mesh every frame.
        view.group.traverse((object) => {
          const mesh = object as Mesh;
          if (mesh.isMesh === true) mesh.castShadow = !ghosted;
        });
      }
      const now = performance.now();
      const elapsed = now - lastFrame;
      const puckBefore = `${puckShown.x},${puckShown.y},${puckShown.angle},${puck.parent?.id}`;
      placePuck(motionPreference.matches, elapsed);
      if (`${puckShown.x},${puckShown.y},${puckShown.angle},${puck.parent?.id}` !== puckBefore)
        invalidate();
      if (follow && puckTarget && !cameraRig.wasMovedByUser()) {
        // The marker sits low in the view so the way ahead has the room.
        const ahead =
          cameraRig.worldUnitsPerPixel(width, height) *
          cameraRig.visibleHeight(width, height) *
          follow.lookahead;
        const world = vec([
          puckShown.x + puckTarget.heading[0] * ahead,
          puckShown.y + puckTarget.heading[1] * ahead,
        ]);
        cameraRig.follow([world.x, world.z], {
          azimuth: follow.headingUp ? puckShown.angle : undefined,
          scale: follow.scale,
        });
      }
      const moved = cameraRig.wasMovedByUser();
      if (moved !== reportedUserMove) {
        reportedUserMove = moved;
        for (const listener of userMoveListeners) listener(moved);
      }
      const pose = cameraRig.update(width, height, elapsed, motionPreference.matches);
      lastFrame = now;
      if (puckTarget)
        puck.scale.setScalar(cameraRig.worldUnitsPerPixel(width, height) * PUCK_PIXELS);
      if (cameraChanged()) invalidate();

      const diagnostics = {
        cameraMode: cameraView.mode,
        cameraTilt: pose.tilt.toFixed(4),
        cameraTransition: pose.settled ? 'settled' : 'moving',
        cameraScale: cameraView.scale.toFixed(4),
        cameraTarget: cameraView.target.map((value) => value.toFixed(4)).join(','),
        cameraBearing: cameraView.azimuth.toFixed(4),
        cameraFollow: follow && !moved ? 'following' : 'free',
        routeProgress: routeProgress === null ? 'none' : routeProgress.toFixed(2),
        labelObstacles: String(labelObstacles.length),
      };
      for (const [key, value] of Object.entries(diagnostics))
        if (canvas.dataset[key] !== value) canvas.dataset[key] = value;
      if (!needsDraw) return;
      needsDraw = false;
      canvas.dataset.draws = String(Number(canvas.dataset.draws ?? 0) + 1);
      renderer.render(scene, camera);
      drawLabels(width, height);
    },

    dispose() {
      canvas.removeEventListener('pointerdown', pointerDown);
      canvas.removeEventListener('pointermove', pointerMove);
      canvas.removeEventListener('pointerup', releasePointer);
      canvas.removeEventListener('pointercancel', releasePointer);
      canvas.removeEventListener('lostpointercapture', releasePointer);
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('keydown', keyDown);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      clearRoute();
      puck.removeFromParent();
      userMoveListeners.clear();
      tubeGeometry.dispose();
      aheadMaterial.dispose();
      travelledMaterial.dispose();
      puck.traverse((object) => {
        const mesh = object as Mesh;
        mesh.geometry?.dispose();
        (mesh.material as MeshBasicMaterial | undefined)?.dispose();
      });
      for (const element of labelElements.values()) element.remove();
      labelElements.clear();
      scene.traverse((object) => {
        const mesh = object as Mesh;
        mesh.geometry?.dispose();
        const material = mesh.material;
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
        else material?.dispose();
      });
      key.shadow.dispose();
      renderer.dispose();
    },
  };

  handle.setActiveFloor(activeFloorId);
  layout();
  let lastFrame = performance.now();
  cameraRig.update(Math.max(1, canvas.clientWidth), Math.max(1, canvas.clientHeight), 0, true);
  return handle;
}
