import { describe, expect, it } from 'vitest';
import { Matrix4 } from 'three';
import { FloorPlacement } from './floorPlacement';

const viewer = { x: 0, y: 1.4, z: 0 };
const hit = (y = 0) => new Matrix4().makeTranslation(0, y, -1).elements;
function observeSteady(floor: FloorPlacement, y = 0, from = 0) {
  for (let time = from; time <= from + 600; time += 50) floor.observe(hit(y), viewer, time);
}

describe('visitor-confirmed floor placement', () => {
  it('requires repeated fresh observations and confirmation, never just elapsed time', () => {
    const floor = new FloorPlacement();
    floor.observe(hit(), viewer, 0);
    expect(floor.confirm(0)).toBe(false);
    expect(floor.confirm(5_000)).toBe(false);
    observeSteady(floor);
    expect(floor.confirmedY).toBeNull();
    expect(floor.confirm(600)).toBe(true);
    expect(floor.confirmedY).toBe(0);
  });

  it('does not finish the stability window by waiting after a short burst of hits', () => {
    const floor = new FloorPlacement();
    for (let time = 0; time <= 250; time += 50) floor.observe(hit(), viewer, time);
    // Still fresh, but only 250 ms of observations, not 500 ms of stability.
    expect(floor.confirm(500)).toBe(false);
  });

  it.each(['wall', 'ceiling', 'steep', 'above', 'near-camera', 'far', 'malformed'])(
    'rejects a %s hit',
    (kind) => {
      const floor = new FloorPlacement();
      const matrix = new Matrix4();
      if (kind === 'wall') matrix.makeRotationX(Math.PI / 2);
      if (kind === 'ceiling') matrix.makeRotationX(Math.PI);
      if (kind === 'steep') matrix.makeRotationX(Math.PI / 6);
      matrix.setPosition(
        0,
        kind === 'above' ? 2 : kind === 'near-camera' ? 1.3 : 0,
        kind === 'far' ? -8 : -1,
      );
      if (kind === 'malformed') matrix.elements[5] = NaN;
      for (let time = 0; time < 1000; time += 50) floor.observe(matrix.elements, viewer, time);
      expect(floor.candidate(950)).toBeNull();
      expect(floor.confirm(950)).toBe(false);
    },
  );

  it('does not infer floor identity from a stable table, or from local-floor zero', () => {
    const floor = new FloorPlacement();
    observeSteady(floor, 0.7);
    expect(floor.candidate(600)?.ready).toBe(true);
    expect(floor.confirmedY).toBeNull();
  });

  it.each(['missing', 'gap', 'height', 'target', 'regression'])(
    'restarts qualification after a %s discontinuity',
    (kind) => {
      const floor = new FloorPlacement();
      observeSteady(floor);
      const time = kind === 'gap' ? 1000 : kind === 'regression' ? 550 : 650;
      const matrix = hit(kind === 'height' ? 0.1 : 0);
      if (kind === 'target') matrix[12] = 1;
      floor.observe(kind === 'missing' ? null : matrix, viewer, time);
      expect(floor.confirm(time)).toBe(false);
    },
  );

  it('locks confirmed height until recovery explicitly clears it', () => {
    const floor = new FloorPlacement();
    observeSteady(floor, -0.12);
    expect(floor.confirm(600)).toBe(true);
    observeSteady(floor, 0.6, 650);
    expect(floor.confirmedY).toBeCloseTo(-0.12);
    floor.reset();
    expect(floor.confirmedY).toBeNull();
    expect(floor.confirm(1250)).toBe(false);
  });
});
