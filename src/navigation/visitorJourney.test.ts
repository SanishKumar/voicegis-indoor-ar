import { describe, expect, it } from 'vitest';
import { ASTERION_RUNTIME } from '../test/venueFixtures';
import { createVenueScopedState } from '../data/venueSession';
import { calculateCompiledRoute } from '../engine/compiledRoutePolicy';
import { visitorJourneyReducer as reduce } from './visitorJourney';
import { ARRIVAL_METERS, guidanceAt, positionAt, trackForRoute } from './routeProgress';

function journey() {
  const initial = createVenueScopedState(ASTERION_RUNTIME).navigation;
  const planning = reduce(initial, {
    type: 'SET_ROUTE_START',
    payload: { startId: initial.startNodeId, endId: 'poi:poi-cardiology' },
  });
  const route = calculateCompiledRoute(ASTERION_RUNTIME, initial.startNodeId, 'poi:poi-cardiology');
  if (!route.found) throw new Error('Fixture route must exist');
  return { state: reduce(planning, { type: 'SET_ROUTE_RESULT', payload: route }), route };
}

describe('visitor journey presentation versus location', () => {
  it('starts without a measured location', () => {
    expect(createVenueScopedState(ASTERION_RUNTIME).navigation).toMatchObject({
      locationBasis: 'default',
      previewStepIndex: 0,
      arrivalSource: null,
    });
  });

  it('browsing every instruction never moves the visitor or confirms arrival', () => {
    const { state: initial, route } = journey();
    let state = initial;
    for (let index = 0; index < route.steps.length + 3; index += 1) {
      state = reduce(state, { type: 'NEXT_STEP' });
      expect(state.startNodeId).toBe(initial.startNodeId);
      expect(state.locationFloorId).toBe(initial.locationFloorId);
      expect(state.locationBasis).toBe('default');
      expect(state.route).toBe(route);
      expect(state.navStatus).toBe('navigating');
      expect(state.arrivalSource).toBeNull();
    }
    expect(state.previewStepIndex).toBe(route.steps.length - 1);
    expect(state.activeFloorId).toBe(String(route.steps.at(-1)?.floorId));
  });

  it('view and displayed-floor changes preserve the shared preview and location floor', () => {
    const { state } = journey();
    const preview = reduce(state, { type: 'NEXT_STEP' });
    const camera = reduce(preview, { type: 'SET_VIEW', payload: 'camera-preview' });
    const upstairs = reduce(camera, { type: 'SET_FLOOR', payload: 'l3' });
    expect(upstairs).toMatchObject({
      previewStepIndex: preview.previewStepIndex,
      locationFloorId: state.locationFloorId,
      startNodeId: state.startNodeId,
      activeFloorId: 'l3',
    });
  });

  it.each([-100, 10000, Number.NaN, 1.5])('bounds or ignores invalid preview index %s', (index) => {
    const { state, route } = journey();
    const next = reduce(state, { type: 'PREVIEW_STEP', payload: index });
    expect(next.previewStepIndex).toBeGreaterThanOrEqual(0);
    expect(next.previewStepIndex).toBeLessThan(route.steps.length);
    expect(next.navStatus).toBe('navigating');
  });

  it('only an explicit confirmation at the final preview records arrival', () => {
    const { state, route } = journey();
    expect(reduce(state, { type: 'CONFIRM_ARRIVAL' })).toBe(state);
    const last = reduce(state, { type: 'PREVIEW_STEP', payload: route.steps.length - 1 });
    const arrived = reduce(last, { type: 'CONFIRM_ARRIVAL' });
    expect(arrived).toMatchObject({
      navStatus: 'arrived',
      arrivalSource: 'user-confirmed',
      startNodeId: state.startNodeId,
    });
    expect(reduce(arrived, { type: 'CLEAR_ROUTE' })).toMatchObject({
      navStatus: 'idle',
      arrivalSource: null,
    });
  });

  it('a check-in establishes its own floor independently of the displayed floor', () => {
    const { state } = journey();
    const next = reduce(state, {
      type: 'SET_START',
      payload: { nodeId: 'checkpoint-node', floorId: 'l2', locationBasis: 'qr' },
    });
    expect(next).toMatchObject({
      startNodeId: 'checkpoint-node',
      locationFloorId: 'l2',
      activeFloorId: 'l2',
      locationBasis: 'qr',
      route: null,
      previewStepIndex: 0,
    });
  });

  it('progress drives the step and the displayed floor, never the planning location', () => {
    const { state, route } = journey();
    const track = trackForRoute(route);
    const halfway = reduce(state, { type: 'SET_PROGRESS', payload: track.length / 2 });
    expect(halfway.progressMeters).toBeCloseTo(track.length / 2);
    expect(halfway.previewStepIndex).toBe(guidanceAt(track, track.length / 2).stepIndex);
    expect(halfway.activeFloorId).toBe(positionAt(track, track.length / 2).floor);
    expect(halfway).toMatchObject({
      startNodeId: state.startNodeId,
      locationFloorId: state.locationFloorId,
      locationBasis: state.locationBasis,
      navStatus: 'navigating',
      arrivalSource: null,
    });

    const end = reduce(halfway, { type: 'SET_PROGRESS', payload: track.length + 50 });
    expect(end.progressMeters).toBe(track.length);
    expect(end.previewStepIndex).toBe(route.steps.length - 1);
    // Reaching the end of a walk-through is not arriving.
    expect(end.navStatus).toBe('navigating');
    expect(reduce(end, { type: 'CONFIRM_ARRIVAL' }).navStatus).toBe('arrived');
  });

  it('believes a confirmation from within the arrival radius and lands the visitor at the door', () => {
    const { state, route } = journey();
    const track = trackForRoute(route);
    const last = route.steps.length - 1;
    // Live tracking says "arrived" this far out; from any further the button is not offered.
    const outside = reduce(state, {
      type: 'SET_PROGRESS',
      payload: track.length - ARRIVAL_METERS - 1,
    });
    expect(outside.previewStepIndex).toBeLessThan(last);
    expect(reduce(outside, { type: 'CONFIRM_ARRIVAL' })).toBe(outside);
    const atDoor = reduce(state, { type: 'SET_PROGRESS', payload: track.length - ARRIVAL_METERS });
    expect(atDoor.previewStepIndex).toBeLessThan(last);
    expect(reduce(atDoor, { type: 'CONFIRM_ARRIVAL' })).toMatchObject({
      navStatus: 'arrived',
      arrivalSource: 'user-confirmed',
      progressMeters: track.length,
      previewStepIndex: last,
    });
  });

  it('manual steps and progress describe the same place', () => {
    const { state, route } = journey();
    const track = trackForRoute(route);
    const stepped = reduce(reduce(state, { type: 'NEXT_STEP' }), { type: 'NEXT_STEP' });
    expect(stepped.progressMeters).toBe(track.stepAt[2]);
    const back = reduce(stepped, { type: 'PREV_STEP' });
    expect(back.progressMeters).toBe(track.stepAt[1]);
    const moved = reduce(back, { type: 'SET_PROGRESS', payload: track.stepAt[1] + 0.2 });
    expect(reduce(moved, { type: 'NEXT_STEP' }).previewStepIndex).toBe(moved.previewStepIndex + 1);
  });

  it('progress is ignored without a route and reset by every route change', () => {
    const initial = createVenueScopedState(ASTERION_RUNTIME).navigation;
    expect(reduce(initial, { type: 'SET_PROGRESS', payload: 12 })).toBe(initial);
    expect(
      reduce(journey().state, { type: 'SET_PROGRESS', payload: Number.NaN }).progressMeters,
    ).toBe(0);
    const { state } = journey();
    const moved = reduce(state, { type: 'SET_PROGRESS', payload: 10 });
    expect(reduce(moved, { type: 'CLEAR_ROUTE' }).progressMeters).toBe(0);
    expect(reduce(moved, { type: 'SET_ROUTE_RESULT', payload: state.route! }).progressMeters).toBe(
      0,
    );
    const arrived = reduce(
      reduce(state, {
        type: 'PREVIEW_STEP',
        payload: state.route!.found ? state.route!.steps.length - 1 : 0,
      }),
      { type: 'CONFIRM_ARRIVAL' },
    );
    expect(reduce(arrived, { type: 'SET_PROGRESS', payload: 3 })).toBe(arrived);
  });
});
