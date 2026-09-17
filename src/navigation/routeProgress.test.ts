import { describe, expect, it } from 'vitest';
import { ASTERION_RUNTIME } from '../test/venueFixtures';
import { createVenueScopedState } from '../data/venueSession';
import { calculateCompiledRoute } from '../engine/compiledRoutePolicy';
import type { GraphNode, RouteStep } from '../engine/routingCore';
import {
  VERTICAL_TRAVEL_METERS,
  buildRouteTrack,
  guidanceAt,
  positionAt,
  progressForStep,
  bearingAt,
  bearingsNear,
  nextVerticalRun,
  trackForRoute,
  walkedFloors,
} from './routeProgress';

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

/*
 * An L: ten metres east, then five metres south, then a lift up a storey and
 * three metres east on arrival.
 */
const path = [
  node('a', 0, 0),
  node('b', 10, 0),
  node('c', 10, 5),
  node('c-up', 10, 5, 'l1'),
  node('d', 13, 5, 'l1'),
];
const steps = [
  step('start', 'a'),
  step('turn_right', 'b'),
  step('elevator', 'c'),
  step('arrive', 'd'),
];

describe('route track', () => {
  const track = buildRouteTrack(path, steps);

  it('measures planar legs and counts a storey change as a fixed allowance', () => {
    expect(track.at).toEqual([0, 10, 15, 15 + VERTICAL_TRAVEL_METERS, 18 + VERTICAL_TRAVEL_METERS]);
    expect(track.length).toBe(18 + VERTICAL_TRAVEL_METERS);
  });

  it('places each manoeuvre where it happens and the arrival at the end', () => {
    expect(track.stepAt).toEqual([0, 10, 15, track.length]);
  });

  it('interpolates position and reports the direction of travel', () => {
    expect(positionAt(track, 4)).toMatchObject({ x: 4, y: 0, floor: 'g', vertical: false });
    expect(positionAt(track, 4).heading).toEqual([1, 0]);
    expect(positionAt(track, 12)).toMatchObject({ x: 10, y: 2, floor: 'g' });
    expect(positionAt(track, 12).heading).toEqual([0, 1]);
  });

  it('hands the visitor to the arrival floor half way up the shaft', () => {
    const riding = 15 + VERTICAL_TRAVEL_METERS * 0.25;
    const arriving = 15 + VERTICAL_TRAVEL_METERS * 0.75;
    expect(positionAt(track, riding)).toMatchObject({ floor: 'g', vertical: true });
    expect(positionAt(track, arriving)).toMatchObject({ floor: 'l1', vertical: true });
    // Riding a lift has no planar direction of its own; the last one walked stands.
    expect(positionAt(track, riding).heading).toEqual([0, 1]);
  });

  it('treats a lift that passes a storey as one ride', () => {
    const ride = buildRouteTrack(
      [
        node('lobby', 0, 0, 'g'),
        node('lift-g', 4, 0, 'g'),
        node('lift-1', 4, 0, 'l1'),
        node('lift-2', 4, 0, 'l2'),
        node('ward', 4, 9, 'l2'),
      ],
      [
        step('start', 'lobby'),
        step('elevator', 'lift-g'),
        step('turn_right', 'lift-2'),
        step('arrive', 'ward'),
      ],
    );
    const floorsSeen = new Set<string>();
    for (let meters = 4; meters <= 4 + 2 * VERTICAL_TRAVEL_METERS; meters += 0.25) {
      const position = positionAt(ride, meters);
      expect(position.vertical || meters >= 4 + 2 * VERTICAL_TRAVEL_METERS).toBe(true);
      floorsSeen.add(position.floor);
    }
    // Boarded on G, stepped out on L2 - never set down on Level 1 in between.
    expect([...floorsSeen].sort()).toEqual(['g', 'l2']);
    expect(positionAt(ride, 4 + VERTICAL_TRAVEL_METERS * 0.9).floor).toBe('g');
    expect(positionAt(ride, 4 + VERTICAL_TRAVEL_METERS * 1.1).floor).toBe('l2');
    // On arrival the heading is the corridor about to be walked.
    expect(positionAt(ride, 4 + VERTICAL_TRAVEL_METERS * 1.9).heading).toEqual([0, 1]);
  });

  it('clamps outside the route instead of extrapolating', () => {
    expect(positionAt(track, -5)).toMatchObject({ x: 0, y: 0 });
    expect(positionAt(track, 999)).toMatchObject({ x: 13, y: 5, floor: 'l1' });
    expect(positionAt(track, Number.NaN)).toMatchObject({ x: 0, y: 0 });
  });

  it('counts down to the manoeuvre ahead rather than the one just passed', () => {
    expect(guidanceAt(track, 0)).toMatchObject({ stepIndex: 0, nextIndex: 1, metersToNext: 10 });
    expect(guidanceAt(track, 7)).toMatchObject({ stepIndex: 0, nextIndex: 1, metersToNext: 3 });
    expect(guidanceAt(track, 10)).toMatchObject({ stepIndex: 1, nextIndex: 2, metersToNext: 5 });
    expect(guidanceAt(track, 7).remainingMeters).toBeCloseTo(track.length - 7);
  });

  it('only reports the end once the whole route is covered', () => {
    expect(guidanceAt(track, track.length - 1).atEnd).toBe(false);
    expect(guidanceAt(track, track.length)).toMatchObject({
      stepIndex: 3,
      nextIndex: 3,
      metersToNext: 0,
      atEnd: true,
    });
  });

  it('turns a manual step into the distance of that manoeuvre', () => {
    expect(progressForStep(track, 1)).toBe(10);
    expect(progressForStep(track, 99)).toBe(track.length);
    expect(progressForStep(track, -3)).toBe(0);
    expect(guidanceAt(track, progressForStep(track, 2)).stepIndex).toBe(2);
  });

  it('does not send a later manoeuvre back to an earlier visit of the same node', () => {
    const loop = [node('a', 0, 0), node('b', 4, 0), node('a', 0, 0), node('c', 0, 6)];
    const looped = buildRouteTrack(loop, [
      step('start', 'a'),
      step('u_turn', 'b'),
      step('turn_left', 'a'),
      step('arrive', 'c'),
    ]);
    expect(looped.stepAt).toEqual([0, 4, 8, 14]);
  });
});

describe('bearings and storey changes along a track', () => {
  const track = buildRouteTrack(path, steps);

  it('reports the plan bearing of travel, clockwise from plan-up', () => {
    expect(bearingAt(track, 4)).toBeCloseTo(90, 6); // east
    expect(bearingAt(track, 12)).toBeCloseTo(180, 6); // south
  });

  it('offers every direction near a corner and one direction away from it', () => {
    expect(bearingsNear(track, 4, 3)).toEqual([90]);
    expect(bearingsNear(track, 10, 3).sort()).toEqual([180, 90]);
    // A storey change has no direction of its own.
    expect(bearingsNear(track, 15 + VERTICAL_TRAVEL_METERS / 2, 1)).toEqual([]);
  });

  it('finds the next storey change ahead, and not one already completed', () => {
    const run = {
      boardingMeters: 15,
      alightingMeters: 15 + VERTICAL_TRAVEL_METERS,
      fromFloorId: 'g',
      toFloorId: 'l1',
    };
    expect(nextVerticalRun(track, 0)).toEqual(run);
    expect(nextVerticalRun(track, 15)).toEqual(run);
    expect(nextVerticalRun(track, 15 + VERTICAL_TRAVEL_METERS / 2)).toEqual(run);
    // Standing exactly where the lift was left, the ride is behind.
    expect(nextVerticalRun(track, 15 + VERTICAL_TRAVEL_METERS)).toBeNull();
    expect(nextVerticalRun(track, 17 + VERTICAL_TRAVEL_METERS)).toBeNull();
  });

  it('treats a lift passing a storey as one run from boarding to alighting', () => {
    const ride = buildRouteTrack(
      [
        node('a', 0, 0),
        node('lift-g', 4, 0),
        node('lift-1', 4, 0, 'l1'),
        node('lift-2', 4, 0, 'l2'),
        node('b', 4, 9, 'l2'),
      ],
      [step('start', 'a'), step('elevator', 'lift-g'), step('arrive', 'b')],
    );
    expect(nextVerticalRun(ride, 1)).toEqual({
      boardingMeters: 4,
      alightingMeters: 4 + 2 * VERTICAL_TRAVEL_METERS,
      fromFloorId: 'g',
      toFloorId: 'l2',
    });
  });
});

describe('route track on a compiled venue route', () => {
  const start = createVenueScopedState(ASTERION_RUNTIME).navigation.startNodeId;
  const route = calculateCompiledRoute(ASTERION_RUNTIME, start, 'poi:poi-maternity');
  if (!route.found) throw new Error('Fixture route must exist');
  const track = trackForRoute(route);

  it('is built once per route', () => {
    expect(trackForRoute(route)).toBe(track);
  });

  it('keeps every manoeuvre in order and inside the route', () => {
    expect(track.stepAt).toHaveLength(route.steps.length);
    for (let index = 1; index < track.stepAt.length; index += 1) {
      expect(track.stepAt[index]).toBeGreaterThanOrEqual(track.stepAt[index - 1]);
    }
    expect(track.stepAt.at(-1)).toBe(track.length);
  });

  it('walks the whole route onto the destination floor', () => {
    const floors = new Set<string>();
    for (let meters = 0; meters <= track.length; meters += 0.5) {
      floors.add(positionAt(track, meters).floor);
    }
    const destination = route.path.at(-1)!;
    expect(floors.size).toBeGreaterThan(1);
    // Only floors the route actually walks on - a lift passing a storey is not a stop.
    const walked = new Set(
      route.path
        .slice(1)
        .filter((point, index) => String(point.floor) === String(route.path[index].floor))
        .map((point) => String(point.floor)),
    );
    expect([...floors].sort()).toEqual([...walked].sort());
    expect([...walkedFloors(track)].sort()).toEqual([...walked].sort());
    expect(positionAt(track, track.length).floor).toBe(String(destination.floor));
    expect(guidanceAt(track, track.length).nextIndex).toBe(route.steps.length - 1);
  });
});
