import { describe, expect, it } from 'vitest';
import { ASTERION_RUNTIME } from '../test/venueFixtures';
import { createVenueScopedState } from '../data/venueSession';
import { calculateCompiledRoute } from '../engine/compiledRoutePolicy';
import { visitorJourneyReducer as reduce } from './visitorJourney';

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
});
