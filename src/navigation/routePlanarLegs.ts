import { planBearing, signedHeadingDifference } from './coordinateFrames';
import type { RouteTrack } from './routeProgress';

export interface PlanarRouteLeg {
  startIndex: number;
  endIndex: number;
  bearing: number;
}

/**
 * Straight route geometry, independent of how many map nodes divide a corridor.
 * Merge only collinear forward edges (within floating-point tolerance), never
 * a bend, reversal, floor transition or a later visit to the same corridor.
 * This describes the chosen route, not surveyed walls or alternate corridors.
 */
export function planarRouteLegs(track: RouteTrack): PlanarRouteLeg[] {
  const legs: PlanarRouteLeg[] = [];
  let current: PlanarRouteLeg | null = null;
  for (let i = 0; i + 1 < track.points.length; i += 1) {
    const from = track.points[i];
    const to = track.points[i + 1];
    if (from.floor !== to.floor) {
      current = null;
      continue;
    }
    const bearing = planBearing([from.x, from.y], [to.x, to.y]);
    if (bearing === null) continue; // Duplicate vertices have no direction.
    if (current !== null && Math.abs(signedHeadingDifference(current.bearing, bearing)) < 1e-6) {
      current.endIndex = i + 1;
    } else {
      current = { startIndex: i, endIndex: i + 1, bearing };
      legs.push(current);
    }
  }
  return legs;
}
