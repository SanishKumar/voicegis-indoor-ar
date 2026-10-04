/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Mesh,
  Scene,
  TubeGeometry,
  Vector3,
  CylinderGeometry,
  MeshStandardMaterial,
  DirectionalLight,
  WebGLRenderTarget,
  Box3,
  type InstancedMesh,
} from 'three';
import type { CompiledBuildingPackage } from '@voicegis/map-compiler';
import referencePackage from '../../buildings/reference-medical-centre/compiled/building.package.json';
import campusPackage from '../../buildings/meridian-park-campus/compiled/building.package.json';
import { createVenueScene, type VenueScene } from './venueScene';

// Only the GPU is replaced. The scene, transforms and route geometries are real
// Three objects; these tests make no jsdom layout/visibility claims.
const observed = vi.hoisted(() => ({
  scene: null as Scene | null,
  pixelRatio: 1,
  shadowMap: {} as { enabled?: boolean },
}));
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  return {
    ...actual,
    WebGLRenderer: class {
      shadowMap = observed.shadowMap;
      canvas: HTMLCanvasElement;
      ratio = 1;
      constructor({ canvas }: { canvas: HTMLCanvasElement }) {
        this.canvas = canvas;
      }
      setPixelRatio(ratio: number) {
        this.ratio = ratio;
        observed.pixelRatio = ratio;
      }
      setSize(width: number, height: number) {
        this.canvas.width = Math.floor(width * this.ratio);
        this.canvas.height = Math.floor(height * this.ratio);
      }
      dispose() {}
      render(scene: Scene) {
        scene.updateMatrixWorld(true);
        observed.scene = scene;
      }
    },
  };
});

let scene: VenueScene;
let canvas: HTMLCanvasElement;
beforeEach(() => {
  observed.shadowMap = {};
  vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(2);
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    isContextLost: () => false,
  } as unknown as WebGL2RenderingContext);
  canvas = document.createElement('canvas');
  Object.defineProperties(canvas, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  scene = createVenueScene(
    canvas,
    document.createElement('div'),
    referencePackage as CompiledBuildingPackage,
  );
});
afterEach(() => {
  scene.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function routeCentreLines(): Vector3[][] {
  scene.frame();
  const lines: Vector3[][] = [];
  observed.scene!.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const material = object.material as MeshStandardMaterial;
    if (material.name !== 'route-ahead') return;
    if (object.geometry instanceof TubeGeometry) {
      lines.push(
        object.geometry.parameters.path.getPoints(80).map((point) => object.localToWorld(point)),
      );
    } else if (object.geometry instanceof CylinderGeometry) {
      const half = object.geometry.parameters.height / 2;
      lines.push([-half, 0, half].map((y) => object.localToWorld(new Vector3(0, y, 0))));
    }
  });
  return lines;
}

describe('visitor route geometry', () => {
  it('keeps the campus base below lawns, paving and markings instead of burying them in its bevel', () => {
    scene.dispose();
    scene = createVenueScene(
      canvas,
      document.createElement('div'),
      campusPackage as unknown as CompiledBuildingPackage,
    );
    scene.frame();
    const base = observed.scene!.getObjectByName('campus-base')!;
    expect(new Box3().setFromObject(base).max.y).toBeCloseTo(0, 5);
    for (const name of ['site-ground-road', 'site-ground-parking', 'site-ground-lawn']) {
      expect(
        new Box3().setFromObject(observed.scene!.getObjectByName(name)!).max.y,
      ).toBeGreaterThan(0);
    }
  });
  it('furnishes every room as a few meshes a floor, however many pieces there are', () => {
    scene.dispose();
    scene = createVenueScene(
      canvas,
      document.createElement('div'),
      campusPackage as unknown as CompiledBuildingPackage,
    );
    scene.frame();
    const furniture: InstancedMesh[] = [];
    observed.scene!.traverse((object) => {
      if (object.name.startsWith('furniture-')) furniture.push(object as InstancedMesh);
    });
    // One mesh for each kind of solid on each of three floors, not one a chair.
    expect(furniture.length).toBeGreaterThanOrEqual(3);
    expect(furniture.length).toBeLessThanOrEqual(3 * 4);
    expect(furniture.reduce((total, mesh) => total + mesh.count, 0)).toBeGreaterThan(1500);
    // Each piece in its own colour, on the one material.
    for (const mesh of furniture) expect(mesh.instanceColor).not.toBeNull();
  });
  it('moves from the grounds map to a building map as the marker goes through a door', () => {
    scene.dispose();
    scene = createVenueScene(
      canvas,
      document.createElement('div'),
      campusPackage as unknown as CompiledBuildingPackage,
    );
    const changes: Array<[string | null, string]> = [];
    scene.onZoneChange((zone, why) => changes.push([zone?.id ?? null, why]));
    const walkTo = (x: number, y: number, floorId = 'g') => {
      scene.setPuck({ x, y, floorId, heading: [1, 0] });
      scene.frame();
    };

    // Nobody on the map yet: the grounds.
    expect(scene.getZone()).toBeNull();
    expect(canvas.dataset.zone).toBe('grounds');

    // Along the Emergency Centre's corridor: its map, and it has one floor.
    walkTo(30, 84);
    expect(scene.getZone()).toEqual({
      id: 'emergency-centre',
      name: 'Emergency Centre',
      floorIds: ['g'],
    });
    // Several strides inside one building are one building.
    walkTo(34, 84);
    walkTo(38, 84);

    // Out at its door on to the West Garden Walk.
    walkTo(70, 84);
    expect(scene.getZone()).toBeNull();
    expect(canvas.dataset.zone).toBe('grounds');

    // In at the hospital's entrance: its map, with the floors above it.
    walkTo(105, 40);
    expect(scene.getZone()).toMatchObject({ id: 'main-hospital', floorIds: ['g', 'l1', 'l2'] });
    // Up the stairs is still the hospital.
    walkTo(103, 15, 'l2');
    expect(scene.getZone()?.id).toBe('main-hospital');

    // Told once at each door, and each time as a walk and not a choice.
    expect(changes).toEqual([
      ['emergency-centre', 'walked'],
      [null, 'walked'],
      ['main-hospital', 'walked'],
    ]);
  });
  it('leaves a venue of one building with no maps to move between', () => {
    const changes: unknown[] = [];
    scene.onZoneChange((zone) => changes.push(zone));
    scene.setPuck({ x: 4, y: 4, floorId: 'g', heading: [1, 0] });
    scene.frame();
    expect(scene.getZone()).toBeNull();
    expect(canvas.dataset.zone).toBeUndefined();
    expect(changes).toEqual([]);
  });
  it('opens the stack with the grounds readable under ghosted storeys, and names where the trip ends', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(80);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(24);
    const labels = document.createElement('div');
    scene.dispose();
    scene = createVenueScene(canvas, labels, campusPackage as unknown as CompiledBuildingPackage);
    // From upstairs in the hospital, down its stairs, and across to the pavilion.
    scene.setActiveFloor('l2');
    scene.setRoute([
      { x: 119, y: 17, floor: 'l2' },
      { x: 103, y: 15, floor: 'l2' },
      { x: 103, y: 15, floor: 'l1' },
      { x: 103, y: 15, floor: 'g' },
      { x: 105, y: 60, floor: 'g' },
      { x: 186, y: 84, floor: 'g' },
    ]);
    scene.setDestination('poi:poi-w-gym');
    scene.setMode('3d');
    scene.setOverview(true);
    scene.frame();
    scene.frame();

    // The furniture of each floor fades with its floor, so it says how each is drawn.
    const opacity = new Map<number, number>();
    observed.scene!.traverse((object) => {
      if (object.name !== 'furniture-box') return;
      const material = (object as InstancedMesh).material as MeshStandardMaterial;
      opacity.set(Math.round(object.parent!.position.y), material.opacity);
    });
    const byHeight = [...opacity.entries()].sort((a, b) => a[0] - b[0]).map((entry) => entry[1]);
    expect(byHeight).toHaveLength(3);
    const [ground, between, inHand] = byHeight;
    // The floor in hand is solid, the one passed through on the stairs a ghost,
    // and the grounds - where most of the walk is - stay readable beneath.
    expect(inHand).toBe(1);
    expect(between).toBeLessThan(0.3);
    expect(ground).toBeGreaterThan(0.6);
    expect(ground).toBeLessThan(1);

    const destination = [...labels.children].find(
      (label) => label.textContent === 'Rehabilitation Gym',
    ) as HTMLElement | undefined;
    expect(destination?.style.visibility).toBe('visible');
    expect(destination?.classList.contains('map-pill-destination')).toBe(true);
  });
  it('observes drawn frames, not idle RAFs, and publishes one automatic downshift', () => {
    // jsdom has no font layout. Nonzero sizes let the scene cache labels instead
    // of deliberately retrying their pending layout on every frame.
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(80);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(24);
    // Use no device hint, so this isolates feedback from actual drawn frames.
    scene.dispose();
    vi.spyOn(navigator, 'hardwareConcurrency', 'get').mockReturnValue(8);
    scene = createVenueScene(
      canvas,
      document.createElement('div'),
      referencePackage as CompiledBuildingPackage,
    );
    let clock = performance.now();
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    scene.frame();
    const idleDraws = canvas.dataset.draws;
    for (let i = 0; i < 100; i++) {
      clock += 50;
      scene.frame();
    }
    expect(canvas.dataset.draws).toBe(idleDraws);
    expect(scene.getGraphics().level).toBe('full');
    const changed = vi.fn();
    scene.onGraphicsChange(changed);
    for (let i = 0; i < 40; i++) {
      clock += 50;
      scene.setPuck({ x: 4 + i / 10, y: 4, floorId: 'g', heading: [1, 0] });
      scene.frame();
    }
    expect(scene.getGraphics()).toEqual({ setting: 'auto', level: 'low', reason: 'slow-frames' });
    expect(canvas.dataset.graphicsDetail).toBe('low');
    expect(canvas.width).toBe(800);
    expect(changed).toHaveBeenCalledOnce();
  });
  it('stops drawing once the marker has arrived and turned, and does not ease for ever', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(80);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(24);
    // Motion is wanted here, so the marker eases to its place instead of jumping.
    scene.dispose();
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    scene = createVenueScene(
      canvas,
      document.createElement('div'),
      referencePackage as CompiledBuildingPackage,
    );
    let clock = performance.now();
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const run = (frames: number) => {
      for (let i = 0; i < frames; i++) {
        clock += 16;
        scene.frame();
      }
    };
    scene.setFollow({ headingUp: true, scale: 0.36, lookahead: 0.2 });
    scene.setPuck({ x: 4, y: 4, floorId: 'g', heading: [1, 0] });
    run(10);
    // A step on and a quarter turn, to a heading whose bearing is zero: the
    // one an eased turn can go on approaching without ever reaching.
    scene.setPuck({ x: 6, y: 5, floorId: 'g', heading: [0, -1] });
    run(10);
    const moving = Number(canvas.dataset.draws);
    // Three seconds is long past the end of the move.
    run(190);
    const arrived = Number(canvas.dataset.draws);
    expect(arrived).toBeGreaterThan(moving);
    run(120);
    expect(Number(canvas.dataset.draws)).toBe(arrived);
    expect(canvas.dataset.cameraBearing).toBe('0.0000');
  });
  it('changes only render detail, preserves geometry/camera/progress and releases shadow targets', () => {
    scene.setGraphics('full');
    scene.setMode('3d');
    scene.setRoute([
      { x: 4, y: 4, floor: 'g' },
      { x: 10, y: 4, floor: 'g' },
    ]);
    scene.setProgress(2);
    const lines = routeCentreLines();
    const view = scene.getView();
    const light = observed.scene!.children.find(
      (o) => o instanceof DirectionalLight,
    ) as DirectionalLight;
    const target = new WebGLRenderTarget(4, 4);
    const pass = new WebGLRenderTarget(4, 4);
    light.shadow.map = target;
    light.shadow.mapPass = pass;
    const dispose = vi.spyOn(target, 'dispose');
    const disposePass = vi.spyOn(pass, 'dispose');
    const changed = vi.fn();
    const unsubscribe = scene.onGraphicsChange(changed);
    scene.setGraphics('low');
    expect(dispose).toHaveBeenCalledOnce();
    expect(disposePass).toHaveBeenCalledOnce();
    expect(light.shadow.map).toBeNull();
    expect(light.shadow.mapPass).toBeNull();
    expect(light.castShadow).toBe(false);
    expect(observed.shadowMap.enabled).toBe(false);
    expect(observed.pixelRatio).toBe(1);
    expect(routeCentreLines()).toEqual(lines);
    expect(scene.getView()).toEqual(view);
    expect(canvas.dataset.routeProgress).toBe('2.00');
    expect(changed).toHaveBeenCalledWith({ setting: 'low', level: 'low', reason: 'manual' });
    scene.setGraphics('full');
    expect(light.castShadow).toBe(true);
    expect(observed.shadowMap.enabled).toBe(true);
    expect(observed.pixelRatio).toBe(2);
    expect(routeCentreLines()).toEqual(lines);
    unsubscribe();
    changed.mockClear();
    scene.setGraphics('low');
    expect(changed).not.toHaveBeenCalled();
  });
  it('restores an auto-downshift before the first draw', () => {
    scene.dispose();
    scene = createVenueScene(
      canvas,
      document.createElement('div'),
      referencePackage as CompiledBuildingPackage,
      undefined,
      { setting: 'auto', level: 'low', reason: 'slow-frames' },
    );
    expect(scene.getGraphics()).toEqual({ setting: 'auto', level: 'low', reason: 'slow-frames' });
    expect(canvas.dataset.graphicsPixelRatio).toBe('1');
    expect(observed.shadowMap.enabled).toBe(false);
  });
  it('resizes for changed device-pixel ratio without changing graphics choice', () => {
    scene.setGraphics('full');
    const view = scene.getView();
    vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(1.5);
    scene.frame();
    expect(observed.pixelRatio).toBe(1.5);
    expect(canvas.dataset.graphicsPixelRatio).toBe('1.5');
    expect(scene.getGraphics().setting).toBe('full');
    expect(scene.getView()).toEqual(view);
  });
  it('releases shadow render targets as well as scene meshes', () => {
    scene.frame();
    const light = observed.scene!.children.find(
      (object) => object instanceof DirectionalLight,
    ) as DirectionalLight;
    const dispose = vi.spyOn(light.shadow, 'dispose');
    scene.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });
  it('keeps right-angle route centre lines on the authored edges', () => {
    scene.setRoute([
      { x: 4, y: 4, floor: 'g' },
      { x: 10, y: 4, floor: 'g' },
      { x: 10, y: 12, floor: 'g' },
    ]);
    const lines = routeCentreLines();
    expect(lines.length).toBeGreaterThan(0);
    // Deliberately tolerate either plan-Z reflection to isolate corner smoothing.
    // The reference outline centre is (15, 9).
    for (const point of lines.flat()) {
      const distanceToAuthoredAxes = Math.min(
        Math.abs(point.x + 5),
        Math.abs(Math.abs(point.z) - 5),
      );
      expect(distanceToAuthoredAxes).toBeLessThan(0.00001);
    }
  });

  it('does not invent an edge between two separate visits to ground floor', () => {
    scene.setRoute([
      { x: 4, y: 4, floor: 'g' },
      { x: 10, y: 4, floor: 'g' },
      { x: 10, y: 4, floor: 'l1' },
      { x: 10, y: 12, floor: 'l1' },
      { x: 10, y: 12, floor: 'g' },
      { x: 4, y: 12, floor: 'g' },
    ]);
    const lines = routeCentreLines().filter((line) =>
      line.every((point) => Math.abs(point.y - line[0].y) < 0.00001),
    );
    const groundLines = lines.filter((line) => line.every((point) => Math.abs(point.y) < 1));
    expect(groundLines).toHaveLength(2);
    for (const line of groundLines)
      expect(
        Math.max(...line.map((point) => point.z)) - Math.min(...line.map((point) => point.z)),
      ).toBeLessThan(0.00001);
  });

  it('answers a tap anywhere within a fingertip of a place, not only on its marker', () => {
    // The marker is a pin a few pixels across. Sweep the whole canvas and see
    // how much of it answers for each place.
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 800,
      height: 600,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    scene.frame();
    const reach = new Map<string, { minX: number; maxX: number; minY: number; maxY: number }>();
    for (let y = 2; y < 600; y += 4) {
      for (let x = 2; x < 800; x += 4) {
        const id = scene.pickPoi(x, y);
        if (id === null) continue;
        const box = reach.get(id) ?? { minX: x, maxX: x, minY: y, maxY: y };
        reach.set(id, {
          minX: Math.min(box.minX, x),
          maxX: Math.max(box.maxX, x),
          minY: Math.min(box.minY, y),
          maxY: Math.max(box.maxY, y),
        });
      }
    }
    expect(reach.size).toBeGreaterThan(1);
    for (const [id, box] of reach) {
      expect(box.maxX - box.minX, `${id} is too narrow to tap`).toBeGreaterThanOrEqual(44);
      expect(box.maxY - box.minY, `${id} is too short to tap`).toBeGreaterThanOrEqual(44);
    }
    // The open sky beside the building is not a place.
    expect(scene.pickPoi(3, 3)).toBeNull();
  });

  it('removes interaction handlers when the scene is disposed', () => {
    const remove = vi.spyOn(canvas, 'removeEventListener');
    scene.dispose();
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'wheel']) {
      expect(remove.mock.calls.some(([event]) => event === type)).toBe(true);
    }
  });
});
