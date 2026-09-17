import { describe, expect, it } from 'vitest';
import {
  alignPlanToWorld,
  planBearingToWorld,
  planToWorld,
  viewerFromMatrix,
  worldBearingToPlan,
  worldDisplacementToPlan,
} from './planWorld';

const close = (actual: number, expected: number) => expect(actual).toBeCloseTo(expected, 6);

describe('plan and world alignment', () => {
  // The visitor stands at plan (10, 20) facing east; the session sees them at
  // world (1, -2) facing minus-z. East on the plan is therefore minus-z in the world.
  const alignment = alignPlanToWorld(
    { x: 10, y: 20, bearingDegrees: 90 },
    { x: 1, z: -2, bearingDegrees: 0 },
    -1.4,
  );

  it('rotates plan offsets into the world and keeps them on the floor', () => {
    const [x, y, z] = planToWorld(alignment, 15, 20); // five metres east
    close(x, 1);
    close(y, -1.4);
    close(z, -7);
    const [sx, , sz] = planToWorld(alignment, 10, 25); // five metres south, to the visitor's right
    close(sx, 6);
    close(sz, -2);
  });

  it('turns world movement back into plan movement', () => {
    const [dx, dy] = worldDisplacementToPlan(alignment, 0, -3); // three metres forward
    close(dx, 3);
    close(dy, 0);
    const [rx, ry] = worldDisplacementToPlan(alignment, 2, 0); // two metres to the right
    close(rx, 0);
    close(ry, 2);
  });

  it('maps bearings both ways', () => {
    close(worldBearingToPlan(alignment, 0), 90);
    close(worldBearingToPlan(alignment, 90), 180);
    close(planBearingToWorld(alignment, 0), 270);
    close(planBearingToWorld(alignment, worldBearingToPlan(alignment, 123)), 123);
  });

  it('round-trips a point through the world and back as a displacement', () => {
    const [x, , z] = planToWorld(alignment, 13, 17);
    const [dx, dy] = worldDisplacementToPlan(alignment, x - alignment.worldX, z - alignment.worldZ);
    close(alignment.planX + dx, 13);
    close(alignment.planY + dy, 17);
  });
});

describe('a viewer pose matrix', () => {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const rotatedAboutY = (degrees: number) => {
    const radians = (degrees * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    // Column-major: the columns are the local axes in world space.
    return [cos, 0, -sin, 0, 0, 1, 0, 0, sin, 0, cos, 0, 3, 1.5, -4, 1];
  };
  const pitchedAboutX = (degrees: number) => {
    const radians = (degrees * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return [1, 0, 0, 0, 0, cos, sin, 0, 0, -sin, cos, 0, 0, 0, 0, 1];
  };

  it('reads position, facing and level pitch from an untransformed viewer', () => {
    const viewer = viewerFromMatrix(identity);
    expect([viewer.x, viewer.y, viewer.z]).toEqual([0, 0, 0]);
    close(viewer.bearingDegrees, 0);
    close(viewer.pitchDegrees, 0);
  });

  it('turns clockwise as seen from above when yawed to the right', () => {
    // Right-handed: a negative rotation about y turns the viewer to the right.
    const viewer = viewerFromMatrix(rotatedAboutY(-90));
    expect([viewer.x, viewer.y, viewer.z]).toEqual([3, 1.5, -4]);
    close(viewer.bearingDegrees, 90);
    close(viewerFromMatrix(rotatedAboutY(90)).bearingDegrees, 270);
  });

  it('reports pitch and keeps a facing from the screen when pointed at the floor', () => {
    close(viewerFromMatrix(pitchedAboutX(-30)).pitchDegrees, -30);
    const down = viewerFromMatrix(pitchedAboutX(-89));
    close(down.pitchDegrees, -89);
    close(down.bearingDegrees, 0);
    // Pointed straight down with the screen's top towards plus-x.
    const downTurned = viewerFromMatrix([0, 0, 1, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 0, 1]);
    close(downTurned.pitchDegrees, 90);
    const facingDown = viewerFromMatrix([0, 0, -1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1]);
    close(facingDown.pitchDegrees, -90);
    close(facingDown.bearingDegrees, 90);
  });
});
