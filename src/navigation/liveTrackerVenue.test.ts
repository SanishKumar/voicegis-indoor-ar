import { describe, expect, it } from 'vitest';
import type { GraphEdge, GraphNode } from '../engine/routingCore';
import { RouteTracker } from './liveTracker';
import { buildRouteTrack } from './routeProgress';
import { VenuePoseGuard } from './venuePoseGuard';

const node = (id: string, x: number, y: number): GraphNode => ({
  id,
  x,
  y,
  floor: 'g',
  type: 'junction',
});
const a = node('a', 0, 0);
const b = node('b', 30, 0);
const route = buildRouteTrack([a, b], []);
const edge = (from: GraphNode, to: GraphNode): GraphEdge => ({
  from: from.id,
  to: to.id,
  distance: Math.hypot(to.x - from.x, to.y - from.y),
});
function make(branchDegrees: number | null) {
  const c = node('c', 30, 30 * Math.tan(((branchDegrees ?? 20) * Math.PI) / 180));
  const guard = new VenuePoseGuard(
    [a, b, c],
    [edge(a, b), ...(branchDegrees === null ? [] : [edge(a, c)])],
  );
  const tracker = new RouteTracker(route, {}, guard);
  tracker.anchor({ progressMeters: 0, sigmaMeters: 1, timeMs: 0 });
  tracker.attachDisplacement(0);
  return tracker;
}
function walk(tracker: RouteTracker, degrees: number, count: number, from = 0) {
  for (let i = 1; i <= count; i += 1) {
    tracker.displace({
      dxMeters: 0.5 * Math.cos((degrees * Math.PI) / 180),
      dyMeters: 0.5 * Math.sin((degrees * Math.PI) / 180),
      timeMs: from + i * 250,
    });
  }
  return from + count * 250;
}

describe('venue-aware pose guidance', () => {
  it.each([10, 15, 20, 30, -20])(
    'does not learn a %s degree fork as placement error',
    (degrees) => {
      const tracker = make(degrees);
      const t = walk(tracker, degrees, 20);
      expect(tracker.read(t)).toMatchObject({
        tier: 'frozen',
        reason: 'ambiguous-position',
        moving: false,
        canStartPose: false,
        poseGraph: 'ambiguous',
      });
      expect(tracker.poseCorrection()).toMatchObject({ biasDegrees: 0, state: 'learning' });
      expect(tracker.read(t).progressMeters).toBeLessThan(4);
    },
  );

  it('still learns initial yaw error when no competing venue path explains it', () => {
    const tracker = make(null);
    const t = walk(tracker, 20, 30);
    expect(tracker.read(t)).toMatchObject({ reason: 'following', poseGraph: 'clear' });
    expect(tracker.poseCorrection().state).toBe('locked');
  });

  it('allows normal progress along the chosen side of a fork', () => {
    const tracker = make(20);
    const t = walk(tracker, 0, 40);
    expect(tracker.read(t)).toMatchObject({
      reason: 'following',
      progressMeters: 20,
      poseGraph: 'clear',
    });
  });

  it('cannot clear ambiguous position by waiting, changing sensors or re-aligning', () => {
    const tracker = make(20);
    const t = walk(tracker, 20, 10);
    const before = tracker.read(t).progressMeters;
    tracker.detachDisplacement(t);
    tracker.resume(t + 10_000);
    tracker.attachDisplacement(t + 10_000);
    expect(tracker.poseRestored(t + 10_000)).toBe(false);
    tracker.sensorsLost('sensors-unavailable');
    const heldAt = walk(tracker, 0, 20, t + 10_000);
    expect(tracker.read(heldAt)).toMatchObject({
      reason: 'ambiguous-position',
      progressMeters: before,
    });
    // A new independent position fix is the recovery, not camera placement.
    tracker.anchor({ progressMeters: 0, sigmaMeters: 1, timeMs: t + 20_000 });
    tracker.attachDisplacement(t + 20_000);
    const resumedAt = walk(tracker, 0, 10, t + 20_000);
    expect(tracker.read(resumedAt)).toMatchObject({ reason: 'following', poseGraph: 'clear' });
  });

  it('holds rather than silently ignoring mismatched venue geometry', () => {
    const tracker = new RouteTracker(route, {}, new VenuePoseGuard([], []));
    tracker.anchor({ progressMeters: 0, sigmaMeters: 1, timeMs: 0 });
    tracker.attachDisplacement(0);
    const t = walk(tracker, 0, 2);
    expect(tracker.read(t)).toMatchObject({
      tier: 'frozen',
      reason: 'uncertain',
      progressMeters: 0,
      poseGraph: 'unavailable',
    });
  });
});
