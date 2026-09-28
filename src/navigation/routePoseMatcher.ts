import { positionAt, type RouteTrack } from './routeProgress';
import { planarRouteLegs } from './routePlanarLegs';

/** Provisional software guards, NOT surveyed corridor widths or pose accuracy. */
export const ROUTE_POSE_POLICY = Object.freeze({
  maximumDistanceMeters: 1.5,
  // Rounding a corner can switch between two projections, each up to the
  // distance guard from the measured point. Allow that fixed 2 * 1.5 m change,
  // never a budget accumulated during silence/rejection. Pose speed is checked
  // separately by the caller; this allowance is not extra measured movement.
  progressSlackMeters: 3,
  ambiguityDistanceMeters: 0.2,
  distinctProgressMeters: 0.5,
});

export type RoutePoseMatch =
  | { kind: 'matched'; progressMeters: number; distanceMeters: number }
  | { kind: 'held'; reason: 'invalid-input' | 'outside-route' | 'unreachable' | 'ambiguous' };

interface Candidate {
  segment: number;
  progressMeters: number;
  distanceMeters: number;
}

/**
 * Match a measured plan-frame point to the local, reachable route on this storey.
 * This does not estimate position or establish the building-to-camera transform.
 * Callers must retain the UNSNAPPED point between observations; feeding our
 * projected point back as position would erase lateral departure each frame.
 * No new route or floor is inferred from a nearby segment.
 */
export function matchRoutePose(
  track: RouteTrack,
  input: {
    x: number;
    y: number;
    previousProgressMeters: number;
    movementMeters: number;
    /** How far to the side a match may lie; the policy's own guard when omitted. */
    maximumDistanceMeters?: number;
  },
): RoutePoseMatch {
  const { x, y, previousProgressMeters: previous, movementMeters } = input;
  const limit = input.maximumDistanceMeters ?? ROUTE_POSE_POLICY.maximumDistanceMeters;
  if (
    ![x, y, previous, movementMeters, limit, track.length].every(Number.isFinite) ||
    limit <= 0 ||
    track.points.length === 0 ||
    previous < 0 ||
    previous > track.length ||
    movementMeters < 0
  )
    return { kind: 'held', reason: 'invalid-input' };

  // Only the contiguous floor run containing current progress is eligible.
  // A later visit to this same floor cannot bypass intervening stairs or lifts.
  let floorStart = 0;
  let floorEnd = track.length;
  for (let i = 0; i + 1 < track.points.length; i += 1) {
    if (track.points[i].floor === track.points[i + 1].floor) continue;
    if (track.at[i + 1] <= previous + 1e-6) floorStart = track.at[i + 1];
    else {
      floorEnd = track.at[i];
      break;
    }
  }
  if (previous < floorStart || previous > floorEnd + 1e-6)
    return { kind: 'held', reason: 'unreachable' };
  const floor = positionAt(track, previous).floor;
  const reach = movementMeters + ROUTE_POSE_POLICY.progressSlackMeters;
  const low = Math.max(floorStart, previous - reach);
  const high = Math.min(floorEnd, previous + reach);
  const candidates: Candidate[] = [];
  let nearButUnreachable = false;
  let planarLegs = 0;

  const consider = (candidate: Candidate) => {
    if (candidate.distanceMeters > limit) return;
    if (candidate.progressMeters < low - 1e-6 || candidate.progressMeters > high + 1e-6) {
      nearButUnreachable = true;
      return;
    }
    candidates.push(candidate);
  };
  for (const { startIndex, endIndex } of planarRouteLegs(track)) {
    const from = track.points[startIndex];
    const to = track.points[endIndex];
    if (
      from.floor !== floor ||
      to.floor !== floor ||
      track.at[startIndex] < floorStart ||
      track.at[endIndex] > floorEnd
    )
      continue;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const squared = dx * dx + dy * dy;
    if (squared <= 1e-12) continue;
    // Topological neighbours stay neighbours across duplicate/zero-length nodes.
    const segment = planarLegs++;
    // Project onto the actual leg, not an artificial end of the reachable window.
    const t = Math.max(0, Math.min(1, ((x - from.x) * dx + (y - from.y) * dy) / squared));
    consider({
      segment,
      progressMeters: track.at[startIndex] + t * (track.at[endIndex] - track.at[startIndex]),
      distanceMeters: Math.hypot(x - from.x - t * dx, y - from.y - t * dy),
    });
  }
  // Only an isolated point needs a fallback. Adding every vertex as a candidate
  // would mask an unreachable projection with a nearby but incorrect endpoint.
  for (let i = 0; planarLegs === 0 && i < track.points.length; i += 1) {
    const point = track.points[i];
    if (point.floor === floor && track.at[i] >= floorStart && track.at[i] <= floorEnd) {
      consider({
        segment: i,
        progressMeters: track.at[i],
        distanceMeters: Math.hypot(x - point.x, y - point.y),
      });
    }
  }
  if (candidates.length === 0)
    return { kind: 'held', reason: nearButUnreachable ? 'unreachable' : 'outside-route' };
  candidates.sort(
    (a, b) =>
      a.distanceMeters - b.distanceMeters ||
      Math.abs(a.progressMeters - previous) - Math.abs(b.progressMeters - previous) ||
      a.progressMeters - b.progressMeters ||
      a.segment - b.segment,
  );
  const best = candidates[0];
  const ambiguous = candidates.some(
    (candidate) =>
      Math.abs(candidate.segment - best.segment) > 1 &&
      Math.abs(candidate.progressMeters - best.progressMeters) >
        ROUTE_POSE_POLICY.distinctProgressMeters &&
      candidate.distanceMeters <= best.distanceMeters + ROUTE_POSE_POLICY.ambiguityDistanceMeters,
  );
  if (ambiguous) return { kind: 'held', reason: 'ambiguous' };
  return {
    kind: 'matched',
    progressMeters: best.progressMeters,
    distanceMeters: best.distanceMeters,
  };
}
