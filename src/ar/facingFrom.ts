import { wrapDegrees } from '../navigation/coordinateFrames';
import type { TrackerSnapshot } from '../navigation/liveTracker';
import { bearingAt, type RouteTrack } from '../navigation/routeProgress';

/** Where a drawn facing came from, in the order they are trusted. */
export type FacingSource = 'ar' | 'tracker' | 'aligned' | 'assumed' | 'off';

/** A yaw straight from the phone, whose zero means nothing on its own. */
export interface YawReading {
  degrees: number;
  /** The feed's epoch; a restart makes an anchor taken against it stale. */
  epoch: number;
}

/**
 * What the yaw's arbitrary zero was taken to mean: at this yaw, the camera
 * was looking along this plan bearing. Every later yaw is read as a turn
 * away from it.
 */
export interface FacingAnchor {
  yawDegrees: number;
  planBearing: number;
  epoch: number;
  /** The visitor said so, or the route was assumed. */
  source: 'visitor' | 'route';
}

export interface Facing {
  source: FacingSource;
  /** Plan bearing the camera is taken to look along. */
  facing: number;
  /** Progress the facing was read at: the tracker's while live, otherwise the guidance's. */
  progress: number;
}

export interface FacingInput {
  track: RouteTrack;
  live: boolean;
  snapshot: TrackerSnapshot | null;
  yaw: YawReading | null;
  anchor: FacingAnchor | null;
  fallbackProgress: number;
}

/**
 * Which way the route is drawn as facing, and where that came from.
 *
 * An immersive session's world tracking comes first, then an explicit camera
 * alignment, then the direction the tracker learned by watching a walk. The phone's
 * own yaw carries the turn and something has to fix its zero: the visitor
 * saying they are looking along the corridor, or - said plainly as an
 * assumption - the route's own bearing where they stand. With no yaw at all
 * the view cannot know where the phone points. An assumed/off facing is only
 * a setup value: the camera must not paint it as a route on the floor.
 *
 * A compass never enters into it. The venue's north offset is not surveyed,
 * and magnetic north indoors is not to be trusted with a heading.
 */
export function facingFrom(input: FacingInput): Facing {
  const { track, live, snapshot, yaw, anchor, fallbackProgress } = input;
  const progress = live && snapshot ? snapshot.progressMeters : fallbackProgress;
  const routeBearing = bearingAt(track, progress);

  if (live && snapshot?.displacementAttached && snapshot.headingDegrees !== null) {
    return { source: 'ar', facing: snapshot.headingDegrees, progress };
  }
  // A camera can turn while the person keeps travelling straight. An explicit
  // camera alignment must not be overwritten by the walking estimator.
  if (yaw !== null && anchor?.source === 'visitor' && anchor.epoch === yaw.epoch) {
    return {
      source: 'aligned',
      facing: wrapDegrees(anchor.planBearing + yaw.degrees - anchor.yawDegrees),
      progress,
    };
  }
  if (live && snapshot && snapshot.headingDegrees !== null) {
    return { source: 'tracker', facing: snapshot.headingDegrees, progress };
  }
  if (yaw !== null && anchor !== null && anchor.epoch === yaw.epoch) {
    return {
      source: anchor.source === 'visitor' ? 'aligned' : 'assumed',
      facing: wrapDegrees(anchor.planBearing + (yaw.degrees - anchor.yawDegrees)),
      progress,
    };
  }
  return { source: 'off', facing: routeBearing, progress };
}
