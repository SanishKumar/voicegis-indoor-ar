import { Vector3 } from 'three';
import type { CompiledBuildingPackage } from '@voicegis/map-compiler';
import { createSiteScenery } from './siteScenery';
import {
  computeBuildingBounds,
  mapCoordinateToWorld,
  visualFloorElevation,
} from '../engine/spatialTwinModel';

/** The same authored grounds, without envelopes covering rooms under inspection. */
export function createInspectorSiteScenery(
  buildingPackage: CompiledBuildingPackage,
  exploded = true,
) {
  if (!buildingPackage.site) return null;
  const bounds = computeBuildingBounds(buildingPackage);
  const siteFloor = buildingPackage.floors.find(
    (floor) => floor.id === buildingPackage.site!.floorId,
  );
  const groundElevation = siteFloor ? visualFloorElevation(siteFloor, exploded) : 0;
  const scenery = createSiteScenery(
    buildingPackage.site,
    (point, height = 0) => new Vector3(...mapCoordinateToWorld([...point], height, bounds)),
    buildingPackage.portals.filter((portal) => portal.floorId === buildingPackage.site!.floorId),
  );
  scenery.group.name = 'inspector-site-grounds';
  scenery.group.position.y = groundElevation;
  // Authoring shows semantic geometry at every zoom, never a visitor's closed
  // building. This changes only drawing state, not the venue or route state.
  scenery.setView({ metresVisible: 0, opensOnApproach: true });
  scenery.advance(0, true);
  let disposed = false;
  return {
    group: scenery.group,
    dispose() {
      if (disposed) return;
      disposed = true;
      scenery.group.removeFromParent();
      scenery.dispose();
    },
  };
}
