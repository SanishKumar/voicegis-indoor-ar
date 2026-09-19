import { describe, expect, it } from 'vitest';
import type { GraphNode, RouteStep } from '../engine/routingCore';
import type { TrackerSnapshot } from '../navigation/liveTracker';
import { buildRouteTrack } from '../navigation/routeProgress';
import { facingFrom, type FacingAnchor } from './facingFrom';

const node = (id: string, x: number, y: number): GraphNode => ({
  id,
  x,
  y,
  floor: 'g',
  type: 'junction',
});
const step = (type: RouteStep['type'], nodeId: string): RouteStep => ({
  type,
  instruction: type,
  distance: 0,
  nodeId,
  bearing: 0,
});

/* Twenty metres east: plan bearing 90 the whole way. */
const track = buildRouteTrack(
  [node('a', 0, 0), node('b', 20, 0)],
  [step('start', 'a'), step('arrive', 'b')],
);

function snapshotWith(overrides: Partial<TrackerSnapshot> = {}): TrackerSnapshot {
  return {
    tier: 'tracking',
    reason: 'following',
    progressMeters: 4,
    sigmaMeters: 1,
    floorId: 'g',
    headingDegrees: null,
    relativeHeadingDegrees: 0,
    headingEpoch: 1,
    displacementAttached: false,
    walkedSinceAnchorMeters: 0,
    stridesSinceAnchor: 0,
    strideMeters: 0.72,
    lastMotionMs: 0,
    pendingFloor: null,
    moving: true,
    ...overrides,
  };
}

const routeAnchor: FacingAnchor = {
  yawDegrees: 200,
  planBearing: 90,
  epoch: 1,
  source: 'route',
};

describe('which way the camera is taken to be looking', () => {
  it('keeps an explicit camera alignment responsive even when the walk tracker has a different heading', () => {
    const facing = facingFrom({
      track,
      live: true,
      snapshot: snapshotWith({ headingDegrees: 123 }),
      yaw: { degrees: 290, epoch: 1 },
      anchor: { ...routeAnchor, source: 'visitor' },
      fallbackProgress: 2,
    });
    expect(facing).toEqual({ source: 'aligned', facing: 180, progress: 4 });
  });
  it('has no idea without a yaw, and says so rather than pretending', () => {
    const facing = facingFrom({
      track,
      live: false,
      snapshot: null,
      yaw: null,
      anchor: null,
      fallbackProgress: 2,
    });
    expect(facing).toEqual({ source: 'off', facing: 90, progress: 2 });
  });

  it('turns with the phone once a zero has been assumed for its yaw', () => {
    const at = (degrees: number) =>
      facingFrom({
        track,
        live: false,
        snapshot: null,
        yaw: { degrees, epoch: 1 },
        anchor: routeAnchor,
        fallbackProgress: 2,
      });
    expect(at(200)).toMatchObject({ source: 'assumed', facing: 90 });
    // A quarter turn of the phone is a quarter turn of the drawn route.
    expect(at(290).facing).toBe(180);
    expect(at(110).facing).toBe(0);
    // And it wraps rather than running off the end of the circle.
    expect(at(20).facing).toBe(270);
  });

  it('calls it aligned when the visitor set the zero themselves', () => {
    const facing = facingFrom({
      track,
      live: false,
      snapshot: null,
      yaw: { degrees: 215, epoch: 1 },
      anchor: { ...routeAnchor, source: 'visitor' },
      fallbackProgress: 2,
    });
    expect(facing).toMatchObject({ source: 'aligned', facing: 105 });
  });

  it('drops an anchor taken against a yaw zero that has since restarted', () => {
    const facing = facingFrom({
      track,
      live: false,
      snapshot: null,
      yaw: { degrees: 300, epoch: 2 },
      anchor: routeAnchor,
      fallbackProgress: 2,
    });
    expect(facing.source).toBe('off');
    expect(facing.facing).toBe(90);
  });

  it('prefers the direction of travel the tracker learned by watching a walk', () => {
    const facing = facingFrom({
      track,
      live: true,
      snapshot: snapshotWith({ headingDegrees: 123 }),
      yaw: { degrees: 300, epoch: 1 },
      anchor: routeAnchor,
      fallbackProgress: 2,
    });
    // The tracker's own progress, not the guidance's.
    expect(facing).toEqual({ source: 'tracker', facing: 123, progress: 4 });
  });

  it('prefers an immersive session’s world tracking over everything', () => {
    const facing = facingFrom({
      track,
      live: true,
      snapshot: snapshotWith({ headingDegrees: 45, displacementAttached: true }),
      yaw: { degrees: 300, epoch: 1 },
      anchor: routeAnchor,
      fallbackProgress: 2,
    });
    expect(facing).toMatchObject({ source: 'ar', facing: 45 });
  });

  it('falls back to the phone’s own yaw when tracking has no heading yet', () => {
    const facing = facingFrom({
      track,
      live: true,
      snapshot: snapshotWith({ tier: 'anchored', reason: 'awaiting-departure' }),
      yaw: { degrees: 260, epoch: 1 },
      anchor: routeAnchor,
      fallbackProgress: 2,
    });
    expect(facing).toMatchObject({ source: 'assumed', facing: 150, progress: 4 });
  });
});
