import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import {
  azimuthForHeading,
  createVisitorCamera,
  defaultMapView,
  planToWorld,
  routeSegments,
} from './visitorCamera';

describe('one camera, two presentations', () => {
  it('projects plan +X right and +Y down, with no perspective scaling', () => {
    const rig = createVisitorCamera(100);
    rig.update(1000, 600, 0, true);
    const origin = new Vector3(0, 0, 0).project(rig.camera);
    const right = new Vector3(10, 0, 0).project(rig.camera);
    const down = new Vector3(0, 0, 10).project(rig.camera);
    const elevated = new Vector3(10, 10, 0).project(rig.camera);
    expect(right.x).toBeGreaterThan(origin.x);
    expect(down.y).toBeLessThan(origin.y);
    expect(elevated.x).toBeCloseTo(right.x, 12);
    expect(planToWorld(15, 27, [5, 7])).toEqual([10, 20]);
  });

  it('holds the inspected centre, bearing and zoom through round trips', () => {
    const rig = createVisitorCamera(100);
    rig.view.azimuth = 0.4;
    rig.view.target = [8, -12];
    rig.zoomBy(0.6);
    for (const mode of ['3d', '2d', '3d', '2d'] as const) {
      rig.view.mode = mode;
      const pose = rig.update(375, 812, 16, true);
      const centre = new Vector3(8, 0, -12).project(rig.camera);
      expect(centre.x).toBeCloseTo(0, 12);
      expect(centre.y).toBeCloseTo(0, 12);
      expect(rig.view.scale).toBe(0.6);
      expect(rig.view.azimuth).toBe(0.4);
      expect(pose.tilt).toBe(mode === '2d' ? 0 : 0.86);
    }
  });

  it('reverses an unfinished transition from its actual tilt', () => {
    const rig = createVisitorCamera(100);
    rig.view.mode = '3d';
    const toward3d = rig.update(800, 600, 16, false);
    expect(toward3d.tilt).toBeGreaterThan(0);
    expect(toward3d.tilt).toBeLessThan(0.86);
    rig.view.mode = '2d';
    const toward2d = rig.update(800, 600, 16, false);
    expect(toward2d.tilt).toBeGreaterThan(0);
    expect(toward2d.tilt).toBeLessThan(toward3d.tilt);
    for (let i = 0; i < 100; i++) rig.update(800, 600, 16, false);
    expect(rig.update(800, 600, 16, false)).toEqual({ tilt: 0, settled: true });
  });

  it('skips motion immediately when the preference changes mid-transition', () => {
    const rig = createVisitorCamera(100);
    rig.view.mode = '3d';
    rig.update(800, 600, 16, false);
    expect(rig.update(800, 600, 0, true)).toEqual({ tilt: 0.86, settled: true });
  });

  it('uses elapsed time, not frame count, for the same tilt', () => {
    const fast = createVisitorCamera(100);
    const slow = createVisitorCamera(100);
    fast.view.mode = slow.view.mode = '3d';
    for (let i = 0; i < 6; i++) fast.update(800, 600, 10, false);
    slow.update(800, 600, 60, false);
    expect(fast.update(800, 600, 0, false).tilt).toBeCloseTo(
      slow.update(800, 600, 0, false).tilt,
      12,
    );
  });

  it('pans in screen coordinates without changing the map bearing', () => {
    const rig = createVisitorCamera(100);
    rig.update(800, 600, 0, true);
    rig.pan(100, 50, 800, 600);
    const centre = new Vector3(0, 0, 0);
    rig.update(800, 600, 0, true);
    centre.project(rig.camera);
    expect(centre.x * 400).toBeCloseTo(100, 8);
    expect(-centre.y * 300).toBeCloseTo(50, 8);
    expect(rig.view.azimuth).toBe(0);
  });

  it('saves an independent presentation without journey or location fields', () => {
    const rig = createVisitorCamera(100);
    rig.view.mode = '3d';
    rig.view.overview = true;
    rig.view.target = [4, 5];
    const saved = rig.snapshot();
    rig.view.target[0] = 40;
    const restored = createVisitorCamera(100, saved);
    expect(restored.snapshot()).toEqual({
      ...defaultMapView(),
      mode: '3d',
      overview: true,
      target: [4, 5],
    });
    restored.view.target[1] = 50;
    expect(saved.target).toEqual([4, 5]);
  });

  it('keeps a finite projection across narrow resize and bounded zoom', () => {
    const rig = createVisitorCamera(100);
    for (const factor of [0.0001, 1e6, Infinity, NaN, -1]) {
      rig.zoomBy(factor);
      rig.update(320, 700, 16, true);
      expect(rig.camera.projectionMatrix.elements.every(Number.isFinite)).toBe(true);
      expect(rig.view.scale).toBeGreaterThanOrEqual(0.22);
      expect(rig.view.scale).toBeLessThanOrEqual(2.4);
    }
  });
});

it('does not join two disconnected visits to a floor or skip connector entries', () => {
  const points = [
    { x: 0, y: 0, floor: 'g' },
    { x: 8, y: 0, floor: 'g' },
    { x: 9, y: 1, floor: 'l1' },
    { x: 9, y: 8, floor: 'l1' },
    { x: 8, y: 9, floor: 'g' },
    { x: 0, y: 9, floor: 'g' },
  ];
  expect(routeSegments(points)).toEqual(
    points.slice(1).map((point, index) => [points[index], point]),
  );
  expect(routeSegments(points).filter(([a, b]) => a.floor === 'g' && b.floor === 'g')).toHaveLength(
    2,
  );
  expect(routeSegments([])).toEqual([]);
  expect(routeSegments(points.slice(0, 1))).toEqual([]);
});

describe('a camera that knows what covers it', () => {
  /** Where a world point lands, in CSS pixels from the top-left of the canvas. */
  const pixel = (
    rig: ReturnType<typeof createVisitorCamera>,
    point: [number, number, number],
    width: number,
    height: number,
  ) => {
    const projected = new Vector3(...point).project(rig.camera);
    return [(projected.x * 0.5 + 0.5) * width, (-projected.y * 0.5 + 0.5) * height] as const;
  };

  const settle = (rig: ReturnType<typeof createVisitorCamera>, width: number, height: number) => {
    for (let frame = 0; frame < 400 && rig.isAnimating(); frame++)
      rig.update(width, height, 16, false);
    return rig.update(width, height, 16, false);
  };

  it('draws its centre in the middle of the uncovered area', () => {
    const rig = createVisitorCamera(100);
    rig.setInsets({ top: 100, right: 0, bottom: 300, left: 60 });
    rig.view.target = [5, 5];
    rig.update(400, 800, 0, true);
    const [x, y] = pixel(rig, [5, 0, 5], 400, 800);
    expect(x).toBeCloseTo(60 + (400 - 60) / 2, 6);
    expect(y).toBeCloseTo(100 + (800 - 400) / 2, 6);
  });

  it('fits a route inside the uncovered area on a phone', () => {
    const rig = createVisitorCamera(80);
    const width = 375;
    const height = 700;
    rig.setInsets({ top: 110, right: 0, bottom: 190, left: 0 });
    // Taller than wide, as a route up a hospital wing is on a phone: height is
    // the constraint, which is exactly where a sheet over the map bites.
    const route: Array<[number, number, number]> = [
      [-6, 0, 34],
      [-6, 0, 4],
      [5, 0, 4],
      [5, 0, -30],
    ];
    rig.fit(route, width, height);
    expect(settle(rig, width, height).settled).toBe(true);
    for (const point of route) {
      const [x, y] = pixel(rig, point, width, height);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(width);
      expect(y).toBeGreaterThanOrEqual(110);
      expect(y).toBeLessThanOrEqual(height - 190);
    }
    expect(rig.wasMovedByUser()).toBe(false);
  });

  it('fits a tilted, rotated view as well as a plan', () => {
    const rig = createVisitorCamera(80);
    rig.view.mode = '3d';
    rig.setInsets({ top: 0, right: 0, bottom: 0, left: 380 });
    const route: Array<[number, number, number]> = [
      [-20, 0, -20],
      [20, 0, 20],
      [20, 9, 20],
    ];
    rig.fit(route, 1280, 720, { azimuth: 0.7 });
    settle(rig, 1280, 720);
    expect(rig.view.azimuth).toBeCloseTo(0.7, 6);
    for (const point of route) {
      const [x, y] = pixel(rig, point, 1280, 720);
      expect(x).toBeGreaterThanOrEqual(380);
      expect(x).toBeLessThanOrEqual(1280);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(720);
    }
  });

  it('stops easing the moment the visitor takes over', () => {
    const rig = createVisitorCamera(80);
    rig.fit([[40, 0, 40]], 800, 600);
    rig.update(800, 600, 16, false);
    expect(rig.isAnimating()).toBe(true);
    rig.pan(10, 0, 800, 600);
    expect(rig.isAnimating()).toBe(false);
    expect(rig.wasMovedByUser()).toBe(true);
    rig.follow([0, 0]);
    expect(rig.wasMovedByUser()).toBe(false);
  });

  it('follows by turning the short way round', () => {
    const rig = createVisitorCamera(80);
    rig.view.azimuth = 3;
    rig.follow([0, 0], { azimuth: -3 });
    const before = rig.view.azimuth;
    rig.update(800, 600, 16, false);
    // -3 is 0.28 rad clockwise of 3 through pi, not 6 rad the other way.
    expect(rig.view.azimuth).toBeGreaterThan(before);
    settle(rig, 800, 600);
    expect(Math.cos(rig.view.azimuth)).toBeCloseTo(Math.cos(-3), 6);
    expect(Math.sin(rig.view.azimuth)).toBeCloseTo(Math.sin(-3), 6);
  });

  it('puts the direction of travel at the top of the screen', () => {
    for (const heading of [
      [1, 0],
      [0, 1],
      [-0.6, 0.8],
    ] as Array<[number, number]>) {
      const rig = createVisitorCamera(80);
      rig.view.azimuth = azimuthForHeading(heading);
      rig.update(400, 400, 0, true);
      const [, fromY] = pixel(rig, [0, 0, 0], 400, 400);
      const [aheadX, aheadY] = pixel(rig, [heading[0] * 10, 0, heading[1] * 10], 400, 400);
      expect(aheadX).toBeCloseTo(200, 6);
      expect(aheadY).toBeLessThan(fromY);
    }
  });

  it('snaps instead of easing when motion is reduced', () => {
    const rig = createVisitorCamera(80);
    rig.fit(
      [
        [30, 0, 30],
        [35, 0, 35],
      ],
      800,
      600,
    );
    expect(rig.update(800, 600, 16, true).settled).toBe(true);
    expect(rig.view.target[0]).toBeCloseTo(32.5, 6);
  });

  it('ignores nonsense insets', () => {
    const rig = createVisitorCamera(80);
    rig.setInsets({ top: Number.NaN, right: -20, bottom: Infinity, left: 10 });
    expect(rig.getInsets()).toEqual({ top: 0, right: 0, bottom: 0, left: 10 });
    rig.setInsets({ top: 5000, right: 5000, bottom: 5000, left: 5000 });
    rig.update(320, 600, 16, true);
    expect(rig.camera.projectionMatrix.elements.every(Number.isFinite)).toBe(true);
  });
});
