import {
  ACESFilmicToneMapping,
  AmbientLight,
  BoxGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  DirectionalLight,
  ExtrudeGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Object3D,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  Raycaster,
  Scene,
  DoubleSide,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CompiledBuildingPackage } from '@voicegis/map-compiler';
import { resolveCartographicLabels } from '../engine/floorplanCartography';

/**
 * The visitor map as a lit model rather than a drawing.
 *
 * The floor being read is built once per venue and shown flat; the previous
 * renderer offered a "Tilted" mode that rotated the plan seven degrees and
 * squashed it to 72% height, which is an oblique squash rather than a
 * projection - no camera, no vanishing point, no depth ordering - and it is
 * gone. Perspective here comes from an actual camera.
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
const ROUTE_COLOR = 0x0f8f74;
const SHAFT_COLOR = 0xc9743f;
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

export interface VenueScene {
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
): VenueScene {
  const outline = buildingPackage.floors.flatMap((floor) => floor.outline as Coordinate[]);
  const xs = outline.map((point) => point[0]);
  const ys = outline.map((point) => point[1]);
  const centre: Coordinate = [
    (Math.min(...xs) + Math.max(...xs)) / 2,
    (Math.min(...ys) + Math.max(...ys)) / 2,
  ];
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));

  /** Plan metres to world space: plan +Y (north) becomes -Z, centred on origin. */
  const wx = (x: number) => x - centre[0];
  const wz = (y: number) => -(y - centre[1]);
  const vec = ([x, y]: Coordinate, height = 0) => new Vector3(wx(x), height, wz(y));

  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  const pixelRatio = Math.min(window.devicePixelRatio, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.toneMapping = ACESFilmicToneMapping;

  const scene = new Scene();
  const camera = new PerspectiveCamera(34, 1, 0.5, span * 12);

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

    addInstances(new BoxGeometry(1.5, 0.42, 0.6), surface(0xb98d63), seats, (object, point) => {
      object.position.copy(vec(point, 0.24));
      object.rotation.set(0, random() > 0.5 ? 0 : Math.PI / 2, 0);
    });
    addInstances(
      new CylinderGeometry(0.32, 0.38, 0.42, 6),
      surface(0xc0714f),
      planters,
      (object, point) => object.position.copy(vec(point, 0.24)),
    );
    addInstances(new IcosahedronGeometry(0.5, 0), surface(0x6f9556), planters, (object, point) => {
      object.position.copy(vec(point, 0.78));
      object.scale.set(1, 1.25, 1);
      object.rotation.set(0, random() * Math.PI, 0);
    });

    const poiTargets: FloorView['poiTargets'] = [];
    for (const poi of pois) {
      const head = new Mesh(
        new SphereGeometry(0.5, 12, 10),
        track(surface(0xc86b4a, { emissive: 0xc86b4a, emissiveIntensity: 0.25 })),
      );
      head.position.copy(vec(poi.position as Coordinate, 1.6));
      head.userData.poiId = poi.id;
      group.add(head);
      poiTargets.push({ id: poi.id, object: head });

      const stem = new Mesh(new CylinderGeometry(0.06, 0.06, 1.5, 6), track(surface(0x4a4034)));
      stem.position.copy(vec(poi.position as Coordinate, 0.8));
      group.add(stem);

      labels.push({
        id: `poi:${poi.id}`,
        text: poi.name,
        priority: 12,
        minScale: 0,
        anchor: vec(poi.position as Coordinate, 2.2),
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

  const HOME_DISTANCE = span * 1.55;
  const MIN_DISTANCE = span * 0.32;
  const MAX_DISTANCE = span * 2.4;
  const camera3 = { azimuth: -0.62, polar: 0.86, distance: HOME_DISTANCE };
  const target = new Vector3(0, 0, 0);

  function applyCamera() {
    camera.position.set(
      target.x + camera3.distance * Math.sin(camera3.polar) * Math.sin(camera3.azimuth),
      target.y + camera3.distance * Math.cos(camera3.polar),
      target.z + camera3.distance * Math.sin(camera3.polar) * Math.cos(camera3.azimuth),
    );
    camera.lookAt(target);
  }

  function emptyGroup(group: Group) {
    for (const child of [...group.children]) {
      group.remove(child);
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

  /** Where a floor sits when the stack is showing, relative to the active one. */
  function stackY(view: FloorView) {
    const active = floors.get(activeFloorId);
    if (active === undefined) return 0;
    return (view.elevation - active.elevation) * EXPLODE;
  }

  /*
   * The stack is not a mode with a switch. It appears when the route crosses
   * storeys, because that is the only time the other floors are answering a
   * question the visitor has, and it collapses again the moment they are not.
   */
  const stacked = () => routeFloors.length > 1;

  function rebuildRoute() {
    clearRoute();
    if (routePoints.length < 2) return;

    const showing = stacked() ? routeFloors : [activeFloorId];
    for (const floorId of showing) {
      const view = floors.get(floorId);
      if (view === undefined) continue;
      const leg = routePoints.filter((point) => String(point.floor) === floorId);
      if (leg.length < 2) continue;
      const curve = new CatmullRomCurve3(
        leg.map((point) => vec([point.x, point.y], 0.2)),
        false,
        'catmullrom',
        0.12,
      );
      const tube = new Mesh(
        new TubeGeometry(curve, leg.length * 12, 0.28, 8, false),
        routeMaterial(),
      );
      tube.castShadow = true;
      view.routeGroup.add(tube);
    }

    if (!stacked()) return;

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

    for (let index = 0; index < routeFloors.length - 1; index += 1) {
      const from = floors.get(routeFloors[index]);
      const to = floors.get(routeFloors[index + 1]);
      if (from === undefined || to === undefined) continue;
      // The point the path leaves this floor from is where the climb starts.
      const exit = [...routePoints].reverse().find((point) => String(point.floor) === from.id);
      if (exit === undefined) continue;
      const bottom = Math.min(stackY(from), stackY(to));
      const height = Math.abs(stackY(to) - stackY(from));
      if (height <= 0) continue;
      const hop = new Mesh(new CylinderGeometry(0.3, 0.3, height, 8), routeMaterial());
      hop.position.copy(vec([exit.x, exit.y], bottom + height / 2 + 0.2));
      hopsGroup.add(hop);
    }
  }

  /** Target height and opacity for every floor, given route and active floor. */
  function layout() {
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
  const labelSizes = new Map<string, [number, number]>();
  const projected = new Vector3();

  /*
   * Sizes are cached, but the first frame measures them before the webfont has
   * settled, and a pill measured in the fallback face is narrower than the one
   * finally drawn. The collision pass then packs labels that really do overlap.
   * Throw the cache away once the fonts are done and measure again.
   */
  if (typeof document !== 'undefined' && document.fonts !== undefined) {
    void document.fonts.ready.then(() => labelSizes.clear());
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
    const scale = HOME_DISTANCE / camera3.distance;
    for (const label of resolveCartographicLabels(candidates, [], 6, scale).placed) {
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
  const pointers = new Map<number, { x: number; y: number }>();
  let dragged = false;
  let panning = false;
  let pinchDistance = 0;

  const clampDistance = (value: number) => Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, value));

  const spread = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  canvas.addEventListener('pointerdown', (event) => {
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    dragged = false;
    panning = event.shiftKey || event.button === 1;
    if (pointers.size === 2) pinchDistance = spread();
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener('pointermove', (event) => {
    const previous = pointers.get(event.pointerId);
    if (previous === undefined) return;
    const dx = event.clientX - previous.x;
    const dy = event.clientY - previous.y;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (Math.abs(dx) > DRAG_SLOP || Math.abs(dy) > DRAG_SLOP) dragged = true;

    if (pointers.size === 2) {
      const next = spread();
      if (pinchDistance > 0 && next > 0) {
        camera3.distance = clampDistance(camera3.distance * (pinchDistance / next));
        dragged = true;
      }
      pinchDistance = next;
      return;
    }

    if (panning) {
      const scale = camera3.distance * 0.0016;
      target.x -= (dx * Math.cos(camera3.azimuth) - dy * Math.sin(camera3.azimuth)) * scale;
      target.z += (dx * Math.sin(camera3.azimuth) + dy * Math.cos(camera3.azimuth)) * scale;
      return;
    }

    camera3.azimuth -= dx * 0.005;
    camera3.polar = Math.min(1.45, Math.max(0.2, camera3.polar - dy * 0.005));
  });

  const releasePointer = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinchDistance = 0;
    if (pointers.size === 0) panning = false;
  };
  canvas.addEventListener('pointerup', releasePointer);
  canvas.addEventListener('pointercancel', releasePointer);

  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      camera3.distance = clampDistance(camera3.distance * (1 + Math.sign(event.deltaY) * 0.12));
    },
    { passive: false },
  );

  const raycaster = new Raycaster();
  const pointer = new Vector2();

  const handle: VenueScene = {
    setActiveFloor(floorId) {
      if (!floors.has(floorId)) return;
      activeFloorId = floorId;
      // Stack heights are relative to whichever floor is being read, so the
      // one in hand stays put and the others move around it.
      layout();
      rebuildRoute();
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
      camera3.distance = clampDistance(camera3.distance * factor);
    },

    resetView() {
      camera3.azimuth = -0.62;
      camera3.polar = 0.86;
      camera3.distance = HOME_DISTANCE;
      target.set(0, 0, 0);
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
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      }
      for (const view of floors.values()) {
        view.group.position.y += (view.targetY - view.group.position.y) * 0.16;
        const ghosted = view.targetOpacity < 0.995;
        for (const material of view.materials) {
          material.opacity += (view.targetOpacity - material.opacity) * 0.16;
          material.transparent = material.opacity < 0.995;
          material.depthWrite = material.opacity > 0.6;
        }
        // A ghosted storey must not throw shadows across the one being read.
        view.group.traverse((object) => {
          const mesh = object as Mesh;
          if (mesh.isMesh === true) mesh.castShadow = !ghosted;
        });
      }
      applyCamera();
      renderer.render(scene, camera);
      drawLabels(width, height);
    },

    dispose() {
      clearRoute();
      for (const element of labelElements.values()) element.remove();
      labelElements.clear();
      scene.traverse((object) => {
        const mesh = object as Mesh;
        mesh.geometry?.dispose();
        const material = mesh.material;
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
        else material?.dispose();
      });
      renderer.dispose();
    },
  };

  handle.setActiveFloor(activeFloorId);
  layout();
  applyCamera();
  return handle;
}
