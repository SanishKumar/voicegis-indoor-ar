import type { Point } from './softGeometry';

interface WindowRun {
  at: Point;
  halfWidth: number;
  angle: number;
}

/** Illustrative daylight glazing where a room's wall follows the building envelope.
 * The clear portions between real doors are the only candidates. */
export function cutawayWindows(
  wallRuns: readonly (readonly Point[])[],
  envelope: readonly Point[],
): WindowRun[] {
  const windows: WindowRun[] = [];
  for (const line of wallRuns) {
    for (let index = 1; index < line.length; index++) {
      const [a, b] = [line[index - 1], line[index]];
      const dx = b[0] - a[0],
        dy = b[1] - a[1];
      const length = Math.hypot(dx, dy);
      if (length < 4) continue;
      const at: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const followsEnvelope = envelope.some((start, edge) => {
        const end = envelope[(edge + 1) % envelope.length];
        const ex = end[0] - start[0],
          ey = end[1] - start[1];
        const reach = Math.hypot(ex, ey);
        if (reach < length - 0.1 || Math.abs(ex * dy - ey * dx) > reach * length * 0.025) {
          return false;
        }
        const x = at[0] - start[0],
          y = at[1] - start[1];
        const offset = Math.abs(x * ey - y * ex) / reach;
        const along = (x * ex + y * ey) / reach;
        // Venue plans allow a service margin between the usable rooms and shell.
        return offset <= 4.4 && along >= length / 2 - 0.1 && along <= reach - length / 2 + 0.1;
      });
      if (followsEnvelope) {
        windows.push({ at, halfWidth: length / 2 - 0.7, angle: Math.atan2(dy, dx) });
      }
    }
  }
  return windows;
}
