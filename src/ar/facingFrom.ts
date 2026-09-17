import { wrapDegrees } from '../navigation/coordinateFrames';
import type { TrackerSnapshot } from '../navigation/liveTracker';
import { bearingAt, type RouteTrack } from '../navigation/routeProgress';

/** Where a drawn facing came from, in the order they are trusted. */
export type FacingSource = 'ar' | 'tracker' | 'aligned' | 'assumed' | 'off';

/** The visitor's word that they were looking along the corridor, and the gyroscope reading then. */
export interface CorridorAlignment {
  /** The gyroscope zero the reading was taken against; a reset makes the word stale. */
  epoch: number;
  relative: number;
  /** Plan bearing of the route where they stood. */
  facing: number;
}

export interface Facing {
  source: FacingSource;
  /** Plan bearing the camera is taken to look along. */
  facing: number;
  /** Progress the facing was read at: the tracker's while live, otherwise the guidance's. */
  progress: number;
}

/**
 * Which way the route is drawn as facing, and where that came from. The
 * tracker's own direction of travel comes first; then the visitor's word that
 * they were looking along the corridor, kept only while the gyroscope's zero
 * has not been reset since; otherwise the route's own bearing, and honestly
 * called an assumption. A compass never enters into it.
 */
export function facingFrom(
  track: RouteTrack,
  live: boolean,
  snapshot: TrackerSnapshot | null,
  alignment: CorridorAlignment | null,
  fallbackProgress: number,
): Facing {
  const progress = live && snapshot ? snapshot.progressMeters : fallbackProgress;
  const routeBearing = bearingAt(track, progress);
  if (!live) return { source: 'off', facing: routeBearing, progress };
  if (snapshot?.displacementAttached && snapshot.headingDegrees !== null) {
    return { source: 'ar', facing: snapshot.headingDegrees, progress };
  }
  if (snapshot && snapshot.headingDegrees !== null) {
    return { source: 'tracker', facing: snapshot.headingDegrees, progress };
  }
  if (
    alignment &&
    snapshot &&
    snapshot.headingEpoch === alignment.epoch &&
    snapshot.relativeHeadingDegrees !== null
  ) {
    return {
      source: 'aligned',
      facing: wrapDegrees(
        alignment.facing + (snapshot.relativeHeadingDegrees - alignment.relative),
      ),
      progress,
    };
  }
  return { source: 'assumed', facing: routeBearing, progress };
}
