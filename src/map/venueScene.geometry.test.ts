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
} from 'three';
import type { CompiledBuildingPackage } from '@voicegis/map-compiler';
import referencePackage from '../../buildings/reference-medical-centre/compiled/building.package.json';
import { createVenueScene, type VenueScene } from './venueScene';

// Only the GPU is replaced. The scene, transforms and route geometries are real
// Three objects; these tests make no jsdom layout/visibility claims.
const observed = vi.hoisted(() => ({ scene: null as Scene | null }));
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  return {
    ...actual,
    WebGLRenderer: class {
      shadowMap = {};
      setPixelRatio() {}
      setSize() {}
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
    if (material.emissiveIntensity !== 0.45) return;
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

  it('removes interaction handlers when the scene is disposed', () => {
    const remove = vi.spyOn(canvas, 'removeEventListener');
    scene.dispose();
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'wheel']) {
      expect(remove.mock.calls.some(([event]) => event === type)).toBe(true);
    }
  });
});
