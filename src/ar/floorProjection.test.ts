import { describe, expect, it } from 'vitest';
import type { GraphNode, RouteStep } from '../engine/routingCore';
import { buildRouteTrack } from '../navigation/routeProgress';
import { DEFAULT_CAMERA_MODEL, projectRouteAhead, type ViewerPose } from './floorProjection';

const node = (id: string, x: number, y: number, floor = 'g'): GraphNode => ({
  id,
  x,
  y,
  floor,
  type: 'junction',
});
const step = (type: RouteStep['type'], nodeId: string): RouteStep => ({
  type,
  instruction: type,
  distance: 0,
  nodeId,
  bearing: 0,
});

/* 30 m up the plan (north, bearing 0), then a right turn and 20 m east. */
const bend = buildRouteTrack(
  [node('a', 0, 30), node('b', 0, 0), node('c', 20, 0)],
  [step('start', 'a'), step('turn_right', 'b'), step('arrive', 'c')],
);
/* 10 m east to a lift, one storey up, then 8 m east upstairs. */
const lifted = buildRouteTrack(
  [node('a', 0, 0), node('lift-g', 10, 0), node('lift-1', 10, 0, 'l1'), node('d', 18, 0, 'l1')],
  [step('start', 'a'), step('elevator', 'lift-g'), step('arrive', 'd')],
);

const camera = { width: 400, height: 800, ...DEFAULT_CAMERA_MODEL };
const centreX = 200;
const centreY = 400;
const atStart = (facingDegrees: number, pitchDegrees = 0, rollDegrees = 0): ViewerPose => ({
  x: 0,
  y: 30,
  facingDegrees,
  pitchDegrees,
  rollDegrees,
});
const points = (projection: ReturnType<typeof projectRouteAhead>) => projection.ribbon.flat();

describe('the route ahead on the floor of the camera image', () => {
  it('draws a straight corridor up the centre, below the horizon, receding towards it', () => {
    const projection = projectRouteAhead(bend, 0, atStart(0), camera);
    expect(projection.ribbon).toHaveLength(1);
    const line = projection.ribbon[0];
    expect(line.length).toBeGreaterThan(10);
    for (const point of line) {
      expect(point.x).toBeCloseTo(centreX, 6);
      expect(point.y).toBeGreaterThan(centreY);
    }
    for (let index = 1; index < line.length; index += 1) {
      expect(line[index].alongMeters).toBeGreaterThan(line[index - 1].alongMeters);
      expect(line[index].y).toBeLessThan(line[index - 1].y);
    }
    expect(projection.horizonY).toBeCloseTo(centreY, 6);
    expect(projection.drawnMeters).toBe(25);
    expect(projection.endsAtVerticalRun).toBe(false);
  });

  it('points its chevrons up the screen along a straight corridor', () => {
    const projection = projectRouteAhead(bend, 0, atStart(0), camera);
    expect(projection.chevrons.length).toBeGreaterThan(5);
    for (const chevron of projection.chevrons) {
      expect(chevron.angleRadians).toBeCloseTo(-Math.PI / 2, 6);
      expect(chevron.pixelsPerMeter).toBeGreaterThan(0);
    }
    const scales = projection.chevrons.map((chevron) => chevron.pixelsPerMeter);
    for (let index = 1; index < scales.length; index += 1) {
      expect(scales[index]).toBeLessThan(scales[index - 1]);
    }
  });

  it('bends to the right where the route turns right', () => {
    const projection = projectRouteAhead(bend, 0, atStart(0), camera, { aheadMeters: 40 });
    const before = points(projection).filter((point) => point.alongMeters <= 30);
    const after = points(projection).filter((point) => point.alongMeters > 30.5);
    expect(after.length).toBeGreaterThan(5);
    for (const point of before) expect(point.x).toBeCloseTo(centreX, 6);
    for (const point of after) expect(point.x).toBeGreaterThan(centreX + 1);
  });

  it('moves the floor up the screen as the phone tilts down', () => {
    // The nearest sample to five metres along, whatever the sampling lands on.
    const at = (pitch: number) =>
      points(projectRouteAhead(bend, 0, atStart(0, pitch), camera)).reduce(
        (best, point) =>
          best === null || Math.abs(point.alongMeters - 5) < Math.abs(best.alongMeters - 5)
            ? point
            : best,
        null as ReturnType<typeof points>[number] | null,
      );
    const level = at(0);
    const down = at(-30);
    expect(level && down).toBeTruthy();
    expect(down!.y).toBeLessThan(level!.y);
    expect(projectRouteAhead(bend, 0, atStart(0, -15), camera).horizonY).toBeLessThan(centreY);
    // Looking well above the horizon puts it off the bottom of the screen.
    expect(projectRouteAhead(bend, 0, atStart(0, 80), camera).horizonY).toBeNull();
  });

  it('puts the corridor on the left when the phone faces to the right of it', () => {
    const projection = projectRouteAhead(bend, 0, atStart(45), camera);
    const seen = points(projection);
    expect(seen.length).toBeGreaterThan(5);
    for (const point of seen) expect(point.x).toBeLessThan(centreX);
  });

  it('begins the path ahead of the visitor rather than under their feet', () => {
    const projection = projectRouteAhead(bend, 0, atStart(0), camera);
    const nearest = points(projection).reduce(
      (least, point) => Math.min(least, point.alongMeters),
      Number.POSITIVE_INFINITY,
    );
    expect(nearest).toBeCloseTo(1.2, 6);
    // Asked for none, it runs right up to the lens, which is the near end
    // filling the bottom of the frame that the offset exists to avoid.
    const underfoot = projectRouteAhead(bend, 0, atStart(0), camera, { startOffsetMeters: 0 });
    expect(points(underfoot)[0].alongMeters).toBeLessThan(0.5);
    expect(points(underfoot)[0].depthMeters).toBeLessThan(points(projection)[0].depthMeters);
    // The distance still counts from the visitor, not from where drawing starts.
    expect(projection.drawnMeters).toBe(25);
  });

  it('draws nothing when the whole route is behind the camera', () => {
    const projection = projectRouteAhead(bend, 0, atStart(180), camera);
    expect(projection.ribbon).toEqual([]);
    expect(projection.chevrons).toEqual([]);
    expect(projection.destination).toBeNull();
  });

  it('shows the destination ahead once it is within range', () => {
    const pose: ViewerPose = { x: 10, y: 0, facingDegrees: 90, pitchDegrees: 0, rollDegrees: 0 };
    const projection = projectRouteAhead(bend, 40, pose, camera);
    expect(projection.destination).not.toBeNull();
    expect(projection.destination!.x).toBeCloseTo(centreX, 6);
    expect(projection.destination!.y).toBeGreaterThan(centreY);
    expect(projection.destination!.alongMeters).toBe(50);
    expect(projection.drawnMeters).toBe(10);
    expect(projectRouteAhead(bend, 0, atStart(0), camera).destination).toBeNull();
  });

  it('stops at a lift rather than drawing the floor above', () => {
    const pose: ViewerPose = { x: 0, y: 0, facingDegrees: 90, pitchDegrees: 0, rollDegrees: 0 };
    const projection = projectRouteAhead(lifted, 0, pose, camera);
    expect(projection.endsAtVerticalRun).toBe(true);
    expect(projection.drawnMeters).toBe(10);
    for (const point of points(projection)) expect(point.alongMeters).toBeLessThanOrEqual(10);
    expect(projection.destination).toBeNull();
  });

  it('swings the floor round with the roll of the phone', () => {
    const projection = projectRouteAhead(bend, 0, atStart(0, 0, 90), camera);
    const seen = points(projection);
    expect(seen.length).toBeGreaterThan(5);
    for (const point of seen) {
      expect(point.y).toBeCloseTo(centreY, 6);
      expect(point.x).toBeGreaterThan(centreX);
    }
  });

  it('draws nothing for an empty image or an empty route', () => {
    const empty = projectRouteAhead(bend, 0, atStart(0), { ...camera, width: 0 });
    expect(empty.ribbon).toEqual([]);
    expect(empty.drawnMeters).toBe(0);
    const none = buildRouteTrack([], []);
    expect(projectRouteAhead(none, 0, atStart(0), camera).ribbon).toEqual([]);
  });
});
