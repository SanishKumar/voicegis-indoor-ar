import { describe, expect, it } from 'vitest';
import type { GraphNode, RouteStep } from '../../engine/routingCore';
import { buildRouteTrack, guidanceAt } from '../../navigation/routeProgress';
import { bannerCopy, formatMeters, formatMinutes, stepSummary } from './guidanceCopy';

const node = (id: string, x: number, y: number, floor = 'g'): GraphNode => ({
  id,
  x,
  y,
  floor,
  type: 'junction',
});
const step = (
  type: RouteStep['type'],
  nodeId: string,
  instruction: string,
  floorId = 'g',
  distance = 0,
): RouteStep => ({ type, instruction, distance, nodeId, bearing: 0, floorId });

// 20 m east, a turn, 8 m south, a second turn, 30 m west to the destination.
const path = [node('a', 0, 0), node('b', 20, 0), node('c', 20, 8), node('d', -10, 8)];
const steps = [
  step('start', 'a', 'Start at Civic Plaza Entrance', 'g', 20),
  step('turn_right', 'b', 'Turn right onto Central Concourse', 'g', 8),
  step('turn_right', 'c', 'Turn right onto West Wing', 'g', 30),
  step('arrive', 'd', 'Arrive at Outpatient Pharmacy'),
];
const track = buildRouteTrack(path, steps);
const floors = (id: string) => ({ g: 'Ground' })[id];
const copyAt = (meters: number) =>
  bannerCopy(steps, track, guidanceAt(track, meters), meters, floors)!;

describe('instruction banner', () => {
  it('opens with the start instruction and what follows it', () => {
    expect(copyAt(0)).toMatchObject({
      lead: 'Start',
      text: 'Start at Civic Plaza Entrance',
      then: 'In 20 m, turn right onto Central Concourse',
    });
    expect(copyAt(0).step.type).toBe('start');
  });

  it('counts down to the next manoeuvre once moving', () => {
    expect(copyAt(6)).toMatchObject({
      lead: 'In 14 m',
      text: 'Turn right onto Central Concourse',
    });
    expect(copyAt(6).speech).toBe('In 14 m, turn right onto Central Concourse');
  });

  it('says "Now" at the manoeuvre rather than a meaningless distance', () => {
    expect(copyAt(18.5)).toMatchObject({ lead: 'Now', text: 'Turn right onto Central Concourse' });
    expect(copyAt(18.5).speech).toBe('Turn right onto Central Concourse');
  });

  it('warns about a second manoeuvre that follows closely', () => {
    // The two turns are 8 m apart, so the second is mentioned with the first.
    expect(copyAt(10).then).toBe('Then turn right onto West Wing');
    // Past the first turn, 30 m of corridor after the second is not "then".
    expect(copyAt(23)).toMatchObject({ lead: 'In 5 m', text: 'Turn right onto West Wing' });
    expect(copyAt(29).then).toBeNull();
  });

  it('keeps a manoeuvre on screen when it is reached, including by stepping to it', () => {
    expect(copyAt(20)).toMatchObject({
      lead: 'Now',
      text: 'Turn right onto Central Concourse',
      then: 'Then turn right onto West Wing',
    });
    expect(copyAt(22).text).toBe('Turn right onto Central Concourse');
    // Every instruction is shown by stepping through them in order.
    const shown = track.stepAt.slice(1).map((meters) => copyAt(meters).text);
    expect(shown).toEqual(steps.slice(1).map((entry) => entry.instruction));
  });

  it('keeps the ride as the instruction until the lift arrives', () => {
    const lift = buildRouteTrack(
      [node('a', 0, 0), node('lift-g', 5, 0), node('lift-2', 5, 0, 'l2'), node('b', 5, 6, 'l2')],
      [
        step('start', 'a', 'Start at Reception'),
        step('elevator', 'lift-g', 'Take South Lift to Level 2', 'l2'),
        step('turn_left', 'lift-2', 'Turn left onto Ward Corridor', 'l2'),
        step('arrive', 'b', 'Arrive at Maternity Clinic', 'l2'),
      ],
    );
    const riding = 5 + 2;
    const copy = bannerCopy(
      [
        step('start', 'a', 'Start at Reception'),
        step('elevator', 'lift-g', 'Take South Lift to Level 2', 'l2'),
        step('turn_left', 'lift-2', 'Turn left onto Ward Corridor', 'l2'),
        step('arrive', 'b', 'Arrive at Maternity Clinic', 'l2'),
      ],
      lift,
      guidanceAt(lift, riding),
      riding,
      floors,
      true,
    )!;
    expect(copy).toMatchObject({
      lead: 'Now',
      text: 'Take South Lift to Level 2',
      then: 'Then turn left onto Ward Corridor',
    });
  });

  it('ends on the destination and its floor', () => {
    expect(copyAt(track.length)).toMatchObject({
      lead: 'Arriving',
      text: 'Arrive at Outpatient Pharmacy',
      then: 'Ground',
    });
  });

  it('has nothing to say about an empty route', () => {
    expect(bannerCopy([], track, guidanceAt(track, 0), 0, floors)).toBeNull();
  });

  it('formats distances for people rather than for surveyors', () => {
    expect(formatMeters(0.2)).toBe('1 m');
    expect(formatMeters(12.4)).toBe('12 m');
    expect(formatMeters(1460)).toBe('1.5 km');
    expect(formatMeters(Number.NaN)).toBe('0 m');
    expect(formatMinutes(20)).toBe('Under 1 min');
    expect(formatMinutes(82)).toBe('1 min');
    expect(formatMinutes(400)).toBe('6 min');
    expect(formatMinutes(Number.NaN)).toBe('Under 1 min');
    expect(formatMinutes(100, 0)).toBe('Under 1 min');
    expect(stepSummary(steps[1], floors)).toBe('Ground · then 8 m');
    expect(stepSummary(steps[3], floors)).toBe('Ground');
  });
});
