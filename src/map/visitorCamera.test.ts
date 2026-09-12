import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { createVisitorCamera, defaultMapView, planToWorld, routeSegments } from './visitorCamera';

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
