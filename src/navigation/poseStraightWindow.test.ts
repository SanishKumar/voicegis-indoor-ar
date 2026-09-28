import { describe, expect, it } from 'vitest';
import { straightCourse } from './poseStraightWindow';

describe('heading-only straight-window fitting', () => {
  it.each([0, Math.PI / 2, Math.PI])(
    'fits 20 cm sway at phase %s without treating it as a turn',
    (phase) => {
      const points = Array.from({ length: 61 }, (_, i) => ({
        x: i / 10,
        y: 0.2 * Math.sin(((i / 10) * 2 * Math.PI) / 1.3 + phase),
      }));
      const before = structuredClone(points);
      const course = straightCourse(points, 5.9);
      expect(course).not.toBeNull();
      expect(Math.abs(course!.bearing - 90)).toBeLessThan(0.6);
      expect(points).toEqual(before); // No smoothing of the live pose data.
    },
  );

  it('does not count stationary hand movement as a walking baseline', () => {
    const points = Array.from({ length: 80 }, (_, i) => ({ x: 0, y: i % 2 ? 0.2 : -0.2 }));
    expect(straightCourse(points, 3)).toBeNull();
  });

  it('rejects a turn inside a stretch and a sustained zigzag', () => {
    const angle = (20 * Math.PI) / 180;
    const turning = Array.from({ length: 33 }, (_, i) => {
      const d = i / 10;
      return d <= 1.6
        ? { x: d, y: 0 }
        : { x: 1.6 + (d - 1.6) * Math.cos(angle), y: (d - 1.6) * Math.sin(angle) };
    });
    expect(straightCourse(turning, 3)).toBeNull();
    expect(
      straightCourse(
        Array.from({ length: 41 }, (_, i) => ({
          x: i / 10,
          y: 0.6 * Math.sin(((i / 10) * 2 * Math.PI) / 1.3),
        })),
        3,
      ),
    ).toBeNull();
  });

  it('rejects backtracking even when all observations lie on one line', () => {
    const points = [0, 1, 2, 3, 4, 3, 2, 3, 4].map((x) => ({ x, y: 0 }));
    expect(straightCourse(points, 3)).toBeNull();
  });

  it('rejects incomplete and invalid input', () => {
    expect(straightCourse([], 3)).toBeNull();
    expect(
      straightCourse(
        [
          { x: 0, y: 0 },
          { x: NaN, y: 0 },
        ],
        3,
      ),
    ).toBeNull();
    expect(straightCourse([{ x: 0, y: 0 }], NaN)).toBeNull();
  });
});
