import { wrapDegrees } from '../navigation/coordinateFrames';

/**
 * How the building's plan and a WebXR session's world line up.
 *
 * An immersive session measures the phone's movement in its own frame: x to
 * the right, y up, z towards the viewer, with an origin and a yaw that mean
 * nothing to the building. The plan is metres too, x to the right and y down
 * the page, with bearings clockwise from the top. Both are right-handed as
 * seen from above, so one rotation and one offset relate them - and both come
 * from a single moment when the visitor's plan position and facing are
 * assumed: standing at their progress along the route, looking the way the
 * route goes. Everything the session measures after that is a displacement
 * from that assumption, not a fix of it.
 */

export interface PlanPose {
  x: number;
  y: number;
  /** Degrees clockwise from plan-up. */
  bearingDegrees: number;
}

export interface WorldPose {
  x: number;
  z: number;
  /** Degrees clockwise from the world's minus-z direction, seen from above. */
  bearingDegrees: number;
}

export interface PlanWorldAlignment {
  planX: number;
  planY: number;
  worldX: number;
  worldZ: number;
  /** World bearing minus plan bearing. */
  deltaDegrees: number;
  /** Height of the floor in the world frame. */
  floorY: number;
}

export function alignPlanToWorld(plan: PlanPose, world: WorldPose, floorY = 0): PlanWorldAlignment {
  return {
    planX: plan.x,
    planY: plan.y,
    worldX: world.x,
    worldZ: world.z,
    deltaDegrees: wrapDegrees(world.bearingDegrees - plan.bearingDegrees),
    floorY,
  };
}

/** A plan point as world coordinates on the floor: [x, y, z]. */
export function planToWorld(
  alignment: PlanWorldAlignment,
  planX: number,
  planY: number,
): [number, number, number] {
  const dx = planX - alignment.planX;
  const dy = planY - alignment.planY;
  const radians = (alignment.deltaDegrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [
    alignment.worldX + dx * cos - dy * sin,
    alignment.floorY,
    alignment.worldZ + dx * sin + dy * cos,
  ];
}

/** A world movement across the floor as a plan movement: [dx, dy]. */
export function worldDisplacementToPlan(
  alignment: PlanWorldAlignment,
  worldDx: number,
  worldDz: number,
): [number, number] {
  const radians = (alignment.deltaDegrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [worldDx * cos + worldDz * sin, -worldDx * sin + worldDz * cos];
}

export function worldBearingToPlan(alignment: PlanWorldAlignment, worldDegrees: number) {
  return wrapDegrees(worldDegrees - alignment.deltaDegrees);
}

export function planBearingToWorld(alignment: PlanWorldAlignment, planDegrees: number) {
  return wrapDegrees(planDegrees + alignment.deltaDegrees);
}

export interface ViewerReading {
  x: number;
  y: number;
  z: number;
  /** Which way the camera looks across the floor, degrees clockwise from minus-z. */
  bearingDegrees: number;
  /** Optical axis above the horizon, in degrees. */
  pitchDegrees: number;
}

/**
 * The camera's position and facing from a viewer pose's column-major 4x4
 * matrix. The camera looks along its local minus-z. A phone pointed at the
 * floor has almost no forward direction across it, so the screen's top -
 * which a person walking holds ahead of them - stands in.
 */
export function viewerFromMatrix(m: ArrayLike<number>): ViewerReading {
  const forwardX = -m[8];
  const forwardY = -m[9];
  const forwardZ = -m[10];
  let acrossX = forwardX;
  let acrossZ = forwardZ;
  if (Math.hypot(acrossX, acrossZ) < 0.25) {
    acrossX = m[4];
    acrossZ = m[6];
  }
  return {
    x: m[12],
    y: m[13],
    z: m[14],
    bearingDegrees: wrapDegrees((Math.atan2(acrossX, -acrossZ) * 180) / Math.PI),
    pitchDegrees: (Math.asin(Math.max(-1, Math.min(1, forwardY))) * 180) / Math.PI,
  };
}
