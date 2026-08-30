import { describe, expect, it } from 'vitest';
import { ASTERION_RUNTIME } from '../test/venueFixtures';
import { STEP_TYPE, calculateRoute, type RouteStep, type StepType } from './routingCore';
import { groupRouteLegs, legIndexForStep } from './routeLegs';

function step(type: StepType, instruction: string, distance = 0, floorId = 'g'): RouteStep {
  return { type, instruction, distance, nodeId: `${type}:${instruction}`, bearing: 0, floorId };
}

describe('route legs', () => {
  it('folds a run of turns into one walk', () => {
    const steps = [
      step(STEP_TYPE.START, 'Start at the entrance'),
      step(STEP_TYPE.STRAIGHT, 'Continue on the concourse', 20),
      step(STEP_TYPE.TURN_LEFT, 'Turn left onto the link', 8),
      step(STEP_TYPE.STRAIGHT, 'Continue on the link', 12),
      step(STEP_TYPE.ARRIVE, 'Arrive at Pharmacy'),
    ];
    const legs = groupRouteLegs(steps);

    expect(legs.map((leg) => leg.kind)).toEqual(['start', 'walk', 'arrive']);
    expect(legs[1].distanceMeters).toBe(40);
    expect(legs[1].turns).toBe(1);
    expect(legs[1].stepIndices).toEqual([1, 2, 3]);
    // The walk is read as its first instruction, not as three.
    expect(legs[1].headline).toBe('Continue on the concourse');
    // Grouping is an outline, not data loss: the UI can still render every
    // exact turn from the original route in order.
    expect(legs[1].stepIndices.map((index) => steps[index].instruction)).toEqual([
      'Continue on the concourse',
      'Turn left onto the link',
      'Continue on the link',
    ]);
  });

  it('gives a floor change a leg of its own', () => {
    const legs = groupRouteLegs([
      step(STEP_TYPE.START, 'Start at the entrance'),
      step(STEP_TYPE.STRAIGHT, 'Continue on the concourse', 20),
      step(STEP_TYPE.ELEVATOR, 'Take the lift to Level 2', 0, 'g'),
      step(STEP_TYPE.STRAIGHT, 'Continue on the overlook', 15, 'l2'),
      step(STEP_TYPE.ARRIVE, 'Arrive at Pediatrics', 0, 'l2'),
    ]);

    expect(legs.map((leg) => leg.kind)).toEqual(['start', 'walk', 'vertical', 'walk', 'arrive']);
    expect(legs[2].connector).toBe(STEP_TYPE.ELEVATOR);
    expect(legs[2].headline).toBe('Take the lift to Level 2');
    // The walk after the lift is a separate leg, not a continuation.
    expect(legs[3].floorId).toBe('l2');
    expect(legs[3].distanceMeters).toBe(15);
  });

  it('splits a walk that changes floor without a connector step', () => {
    const legs = groupRouteLegs([
      step(STEP_TYPE.STRAIGHT, 'Continue on the ground link', 10, 'g'),
      step(STEP_TYPE.STRAIGHT, 'Continue on the upper link', 10, 'l1'),
    ]);

    expect(legs).toHaveLength(2);
    expect(legs.map((leg) => leg.floorId)).toEqual(['g', 'l1']);
  });

  it('carries every step exactly once, in order', () => {
    const steps = [
      step(STEP_TYPE.START, 'Start'),
      step(STEP_TYPE.STRAIGHT, 'Walk', 5),
      step(STEP_TYPE.TURN_RIGHT, 'Turn right', 5),
      step(STEP_TYPE.STAIRS, 'Take the stairs'),
      step(STEP_TYPE.STRAIGHT, 'Walk again', 5, 'l1'),
      step(STEP_TYPE.ARRIVE, 'Arrive'),
    ];
    const covered = groupRouteLegs(steps).flatMap((leg) => leg.stepIndices);
    expect(covered).toEqual(steps.map((_, index) => index));
  });

  it('has no legs for an empty route', () => {
    expect(groupRouteLegs([])).toEqual([]);
    expect(legIndexForStep([], 0)).toBe(-1);
  });

  it('maps a step back to the leg that folded it', () => {
    const legs = groupRouteLegs([
      step(STEP_TYPE.START, 'Start'),
      step(STEP_TYPE.STRAIGHT, 'Walk', 5),
      step(STEP_TYPE.TURN_LEFT, 'Turn left', 5),
      step(STEP_TYPE.ARRIVE, 'Arrive'),
    ]);

    expect(legIndexForStep(legs, 0)).toBe(0);
    expect(legIndexForStep(legs, 1)).toBe(1);
    // The turn folded into the same walk, so it reports the same leg.
    expect(legIndexForStep(legs, 2)).toBe(1);
    expect(legIndexForStep(legs, 3)).toBe(2);
    expect(legIndexForStep(legs, 99)).toBe(-1);
  });

  it('reduces a real two-floor Asterion route to a handful of legs', () => {
    const route = calculateRoute(
      'poi:poi-main-entrance',
      'poi:poi-cardiology',
      ASTERION_RUNTIME.routingNodes,
      ASTERION_RUNTIME.routingEdges,
    );
    expect(route.found).toBe(true);
    if (!route.found) return;

    const legs = groupRouteLegs(route.steps);
    expect(route.steps.length).toBeGreaterThan(legs.length);
    expect(legs.length).toBeLessThanOrEqual(6);
    expect(legs[0].kind).toBe('start');
    expect(legs[legs.length - 1].kind).toBe('arrive');
    // A journey between floors must surface its connector as its own leg.
    expect(legs.some((leg) => leg.kind === 'vertical')).toBe(true);

    const walked = legs
      .filter((leg) => leg.kind === 'walk')
      .reduce((total, leg) => total + leg.distanceMeters, 0);
    expect(walked).toBeGreaterThan(0);
  });
});
