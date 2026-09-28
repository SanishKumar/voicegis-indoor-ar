import { describe, expect, it } from 'vitest';
import { RouteTracker } from './liveTracker';
import { buildRouteTrack } from './routeProgress';
import { rotatePlanVector } from './poseHeadingCorrection';

/**
 * Deterministic guidance stress replays, NOT localization evidence or handset
 * accuracy measurements. These feed post-batching pose deltas, as AR does.
 */
const route = buildRouteTrack(
  [
    { id: 'a', x: 0, y: 0, floor: 'g' },
    { id: 'b', x: 100, y: 0, floor: 'g' },
  ],
  [],
);
const cases = [-20, 0, 15, 20].flatMap((error) =>
  [0.1, 0.2].flatMap((sway) =>
    [0.1, 0.25, 0.5].flatMap((spacing) =>
      [0, Math.PI / 2].map((phase) => ({ error, sway, spacing, phase })),
    ),
  ),
);

describe('pose guidance replay matrix', () => {
  it.each(cases)(
    'follows 55 m: yaw=$error sway=$sway spacing=$spacing phase=$phase',
    ({ error, sway, spacing, phase }) => {
      const tracker = new RouteTracker(route);
      tracker.anchor({ progressMeters: 0, sigmaMeters: 1, timeMs: 0 });
      tracker.attachDisplacement(0);
      const seen = (d: number) =>
        rotatePlanVector(d, sway * Math.sin((d * 2 * Math.PI) / 1.3 + phase), error);
      let previous = seen(0);
      const frames = Math.round(55 / spacing);
      for (let i = 1; i <= frames; i += 1) {
        const d = i * spacing;
        const next = seen(d);
        tracker.displace({
          dxMeters: next[0] - previous[0],
          dyMeters: next[1] - previous[1],
          timeMs: d * 1000,
        });
        previous = next;
      }
      expect(tracker.read(55_000)).toMatchObject({ reason: 'following', tier: 'tracking' });
      expect(tracker.poseCorrection().state).toBe('locked');
      expect(Math.abs(tracker.poseCorrection().biasDegrees - error)).toBeLessThan(1);
      expect(tracker.read(55_000).progressMeters).toBeGreaterThan(54);
    },
  );
});
