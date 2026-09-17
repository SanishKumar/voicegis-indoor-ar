import { describe, expect, it } from 'vitest';
import type { GraphNode, RouteStep } from '../engine/routingCore';
import { buildRouteTrack, positionAt, positionShownOn } from './routeProgress';

const node = (id: string, x: number, y: number, floor = 'g'): GraphNode => ({
  id,
  x,
  y,
  floor,
  type: 'junction',
});
const step = (type: RouteStep['type'], nodeId: string): RouteStep => ({
  type,
  instruction: type,
  distance: 0,
  nodeId,
  bearing: 0,
});

/* 10 m east to a lift, one storey up, then 8 m east upstairs. */
const lifted = buildRouteTrack(
  [node('a', 0, 0), node('lift-g', 10, 0), node('lift-1', 10, 0, 'l1'), node('d', 18, 0, 'l1')],
  [step('start', 'a'), step('elevator', 'lift-g'), step('arrive', 'd')],
);
const boarding = lifted.at[1];
const alighting = lifted.at[2];

describe('the marker on the floor being read', () => {
  it('is where the guidance is, off a storey change', () => {
    expect(positionShownOn(lifted, 5, 'g')).toEqual(positionAt(lifted, 5));
    // Another floor shown does not move a marker that is not at a lift or stair.
    expect(positionShownOn(lifted, 5, 'l1')).toEqual(positionAt(lifted, 5));
  });

  it('stands at the end of the run that is on the floor being read', () => {
    const atLift = positionShownOn(lifted, boarding, 'g');
    expect(atLift.floor).toBe('g');
    expect([atLift.x, atLift.y]).toEqual([10, 0]);
    const upstairs = positionShownOn(lifted, boarding, 'l1');
    expect(upstairs.floor).toBe('l1');
    expect([upstairs.x, upstairs.y]).toEqual([10, 0]);
    expect(upstairs.vertical).toBe(true);
    // Heading on the alighting floor is the way the route goes on from there.
    expect(upstairs.heading).toEqual([1, 0]);
  });

  it('works from either half of the ride', () => {
    const late = (boarding + alighting) / 2 + 0.5;
    expect(positionAt(lifted, late).floor).toBe('l1');
    expect(positionShownOn(lifted, late, 'g').floor).toBe('g');
    expect(positionShownOn(lifted, late, 'l1').floor).toBe('l1');
  });

  it('leaves the position alone for a floor the run does not touch', () => {
    expect(positionShownOn(lifted, boarding, 'l2')).toEqual(positionAt(lifted, boarding));
  });
});
