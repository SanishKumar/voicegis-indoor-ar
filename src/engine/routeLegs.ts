import { STEP_TYPE, type RouteStep, type StepType } from './routingCore';

/**
 * Route steps, grouped into the legs a person actually holds in their head.
 *
 * A compiled route for a two-floor journey is eleven steps, and eleven is more
 * than anyone carries down a corridor. Almost all of them are turns inside one
 * continuous walk; what a visitor needs to know is that they walk, then take a
 * lift, then walk again. The turns are not discarded - they are counted, so the
 * leg can say how much is folded into it - but they stop being the unit.
 *
 * Vertical moves always get their own leg. Changing floor is the part of an
 * indoor journey people get wrong, and burying it inside a walk is what makes
 * it easy to miss.
 */

export type RouteLegKind = 'start' | 'walk' | 'vertical' | 'arrive';

export interface RouteLeg {
  kind: RouteLegKind;
  /** The single line this leg is read as. */
  headline: string;
  /** Metres covered by every step folded into this leg. */
  distanceMeters: number;
  /** Turn instructions folded into this leg, so it can say how many. */
  turns: number;
  floorId: string | null;
  /** Indices into the original step list, so progress maps back onto it. */
  stepIndices: number[];
  /** For a vertical leg, which kind of connector it uses. */
  connector: StepType | null;
}

const VERTICAL_STEPS: readonly StepType[] = [
  STEP_TYPE.ELEVATOR,
  STEP_TYPE.STAIRS,
  STEP_TYPE.RAMP,
  STEP_TYPE.ESCALATOR,
];

const TURN_STEPS: readonly StepType[] = [
  STEP_TYPE.TURN_LEFT,
  STEP_TYPE.TURN_RIGHT,
  STEP_TYPE.SLIGHT_LEFT,
  STEP_TYPE.SLIGHT_RIGHT,
  STEP_TYPE.U_TURN,
];

function kindOf(step: RouteStep): RouteLegKind {
  if (step.type === STEP_TYPE.START) return 'start';
  if (step.type === STEP_TYPE.ARRIVE) return 'arrive';
  if (VERTICAL_STEPS.includes(step.type)) return 'vertical';
  return 'walk';
}

function floorOf(step: RouteStep): string | null {
  return step.floorId === undefined ? null : String(step.floorId);
}

export function groupRouteLegs(steps: readonly RouteStep[]): RouteLeg[] {
  const legs: RouteLeg[] = [];

  steps.forEach((step, index) => {
    const kind = kindOf(step);
    const floorId = floorOf(step);
    const previous = legs[legs.length - 1];

    // Only walking accumulates, and only while it stays on one floor. Every
    // other kind is a leg in its own right.
    const continues =
      previous !== undefined &&
      kind === 'walk' &&
      previous.kind === 'walk' &&
      previous.floorId === floorId;

    if (continues) {
      previous.distanceMeters += step.distance;
      previous.stepIndices.push(index);
      if (TURN_STEPS.includes(step.type)) previous.turns += 1;
      return;
    }

    legs.push({
      kind,
      headline: step.instruction,
      distanceMeters: step.distance,
      turns: 0,
      floorId,
      stepIndices: [index],
      connector: kind === 'vertical' ? step.type : null,
    });
  });

  return legs;
}

/**
 * Which leg a step index falls in, or -1 when the route has no legs.
 *
 * Progress is still tracked per step, because that is what the runtime moves;
 * the strip only needs to know which leg that step is inside.
 */
export function legIndexForStep(legs: readonly RouteLeg[], stepIndex: number): number {
  return legs.findIndex((leg) => leg.stepIndices.includes(stepIndex));
}
