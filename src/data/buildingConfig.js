/**
 * buildingConfig.js
 * 
 * Building-level configuration and metadata.
 * Separating this from the graph data allows easy swapping of buildings.
 * 
 * @module data/buildingConfig
 */

export const BUILDING_CONFIG = {
  name: 'City General Hospital',
  subtitle: 'Ground Floor — Wing A',
  floors: [
    { id: 1, label: 'Ground Floor', isDefault: true },
    // Future floors:
    // { id: 2, label: 'First Floor', isDefault: false },
  ],
  
  // SVG viewBox dimensions for the floorplan
  viewBox: { width: 3000, height: 2000 },
  
  // Default entrance node — where users start
  defaultStartNode: 'lobby',
  
  // Walk speed in meters per second (average indoor walking)
  walkSpeedMps: 1.2,
  
  // Meters per SVG unit (for distance calculations display)
  metersPerUnit: 0.15,
};

/**
 * Format distance for display.
 */
export function formatDistance(meters) {
  if (meters < 1) return '< 1m';
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

/**
 * Estimate walk time from distance in meters.
 */
export function estimateWalkTime(meters) {
  const seconds = meters / BUILDING_CONFIG.walkSpeedMps;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}
