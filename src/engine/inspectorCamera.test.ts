import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import type { CompiledBuildingPackage } from '@voicegis/map-compiler';
import campusJson from '../../buildings/meridian-park-campus/compiled/building.package.json';
import referenceJson from '../../buildings/reference-medical-centre/compiled/building.package.json';
import { inspectorCameraView } from './inspectorCamera';
import {
  computeBuildingBounds,
  mapCoordinateToWorld,
  visualFloorElevation,
} from './spatialTwinModel';

const campus = campusJson as unknown as CompiledBuildingPackage;

describe('Inspector camera framing', () => {
  it.each([0.5, 1, 1.8])('keeps every campus floor corner in the camera at aspect %s', (aspect) => {
    const view = inspectorCameraView(campus, aspect);
    const camera = new PerspectiveCamera(view.fov, aspect, 0.1, view.far);
    camera.position.set(...view.position);
    camera.lookAt(...view.target);
    camera.updateMatrixWorld();
    const bounds = computeBuildingBounds(campus);
    for (const floor of campus.floors) {
      for (const point of floor.outline) {
        const projected = new Vector3(
          ...mapCoordinateToWorld(point, visualFloorElevation(floor, true), bounds),
        ).project(camera);
        expect(projected.z, `${floor.id} ${point} is beyond the far plane`).toBeLessThan(1);
        expect(
          Math.abs(projected.x),
          `${floor.id} ${point} leaves the side of the map`,
        ).toBeLessThan(1);
        expect(
          Math.abs(projected.y),
          `${floor.id} ${point} leaves the top of the map`,
        ).toBeLessThan(1);
      }
    }
  });

  it.each([campus, referenceJson as unknown as CompiledBuildingPackage])(
    'does not make OrbitControls clamp the starting view inward',
    (buildingPackage) => {
      const view = inspectorCameraView(buildingPackage);
      const distance = new Vector3(...view.position).distanceTo(new Vector3(...view.target));
      expect(view.maxDistance).toBeGreaterThanOrEqual(distance);
      expect(view.far).toBeGreaterThan(view.maxDistance);
    },
  );
});
