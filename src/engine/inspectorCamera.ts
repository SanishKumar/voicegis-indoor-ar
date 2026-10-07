import type { CompiledBuildingPackage } from '@voicegis/map-compiler';
import { computeBuildingBounds, visualFloorElevation } from './spatialTwinModel';

/** A semantic model must fit before orbiting, at either phone or workbench width. */
export function inspectorCameraView(
  buildingPackage: CompiledBuildingPackage,
  aspect = 1,
  targetY?: number,
) {
  const bounds = computeBuildingBounds(buildingPackage);
  const height = Math.max(
    ...buildingPackage.floors.map((floor) => visualFloorElevation(floor, true) + floor.clearHeight),
  );
  const centerY = targetY ?? height / 2;
  const radius = Math.max(
    1,
    Math.hypot(bounds.width / 2, bounds.depth / 2, Math.max(centerY, height - centerY)),
  );
  const fov = 42;
  const verticalHalfAngle = (fov * Math.PI) / 360;
  const halfAngle = Math.min(
    verticalHalfAngle,
    Math.atan(Math.tan(verticalHalfAngle) * Math.max(0.1, aspect)),
  );
  // Fit a bounding sphere, not just the floor width: the far corner and
  // exploded upper floors must fit too. The orbit limit cannot be closer than
  // this initial fit or OrbitControls immediately crops the campus again.
  const distance = Math.max(36, (radius * 1.12) / Math.sin(halfAngle));
  const directionLength = Math.hypot(0.6, 0.55, 1);
  const maxDistance = Math.max(128, distance * 2.5);
  return {
    position: [
      (distance * 0.6) / directionLength,
      centerY + (distance * 0.55) / directionLength,
      distance / directionLength,
    ] as [number, number, number],
    target: [0, centerY, 0] as [number, number, number],
    fov,
    far: maxDistance + radius * 2,
    maxDistance,
    groundSpan: Math.max(104, Math.ceil(Math.max(bounds.width, bounds.depth) * 1.15)),
    shadowSpan: Math.max(84, Math.max(bounds.width, bounds.depth) * 1.2),
    shadowHeight: Math.max(24, height + 5),
    aspect,
  };
}
