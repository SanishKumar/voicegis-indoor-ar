/**
 * Display and movement configuration derived from the active compiled package.
 */

import { BUILDING_PACKAGE, getDefaultStartNodeId } from './compiledBuilding';

export const BUILDING_CONFIG = {
  name: BUILDING_PACKAGE.building.name,
  subtitle: 'Two-floor compiled reference package',
  floors: BUILDING_PACKAGE.floors.map((floor) => ({
    id: floor.id,
    label: floor.name,
    level: floor.level,
    isDefault: floor.level === 0,
  })),
  viewBox: { width: 30, height: 18 },
  defaultStartNode: getDefaultStartNodeId(),
  defaultFloorId: BUILDING_PACKAGE.floors.find((floor) => floor.level === 0)?.id ?? 'g',
  walkSpeedMps: 1.2,
  metersPerUnit: 1,
};

export function formatDistance(meters) {
  if (meters < 1) return '< 1m';
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

export function estimateWalkTime(meters) {
  const seconds = meters / BUILDING_CONFIG.walkSpeedMps;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}
