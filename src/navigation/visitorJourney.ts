import type { GraphNode, RouteResult } from '../engine/routingCore';
import {
  ARRIVAL_METERS,
  PROGRESS_EPSILON,
  clampProgress,
  guidanceAt,
  positionAt,
  progressForStep,
  trackForRoute,
} from './routeProgress';

export const NAV_STATUS = {
  IDLE: 'idle',
  ROUTING: 'routing',
  NAVIGATING: 'navigating',
  ARRIVED: 'arrived',
} as const;

export type LocationBasis = 'default' | 'selected' | 'qr';

/**
 * A route can be explored without moving its visitor. Only an explicit start
 * selection or a verified check-in changes the location used for planning.
 * Displayed floor and instruction are presentation state, shared by every view.
 */
export interface VisitorJourneyState {
  venueKey: string;
  startNodeId: string;
  destinationNodeId: string | null;
  route: RouteResult | null;
  activeView: string;
  activeFloorId: string;
  locationFloorId: string;
  locationBasis: LocationBasis;
  selectedPOI: GraphNode | null;
  /** Step the guidance is on, derived from `progressMeters`. */
  previewStepIndex: number;
  /**
   * Distance along the route the guidance is showing. Supplied by a
   * walk-through today and by a matched position later; never by the planning
   * location, which only an explicit start or a check-in may change.
   */
  progressMeters: number;
  navStatus: (typeof NAV_STATUS)[keyof typeof NAV_STATUS];
  arrivalSource: 'user-confirmed' | null;
}

export const JOURNEY_ACTION = {
  SET_START: 'SET_START',
  SET_DESTINATION: 'SET_DESTINATION',
  SET_ROUTE_START: 'SET_ROUTE_START',
  SET_ROUTE_RESULT: 'SET_ROUTE_RESULT',
  CLEAR_ROUTE: 'CLEAR_ROUTE',
  SET_VIEW: 'SET_VIEW',
  SET_FLOOR: 'SET_FLOOR',
  SET_SELECTED_POI: 'SET_SELECTED_POI',
  CLEAR_SELECTED_POI: 'CLEAR_SELECTED_POI',
  NEXT_STEP: 'NEXT_STEP',
  PREV_STEP: 'PREV_STEP',
  PREVIEW_STEP: 'PREVIEW_STEP',
  SET_PROGRESS: 'SET_PROGRESS',
  CONFIRM_ARRIVAL: 'CONFIRM_ARRIVAL',
} as const;

type JourneyAction =
  | {
      type: 'SET_START';
      payload: { nodeId: string; floorId?: string; locationBasis?: LocationBasis };
    }
  | { type: 'SET_DESTINATION'; payload: string }
  | { type: 'SET_ROUTE_START'; payload: { startId: string; endId: string; startFloorId?: string } }
  | { type: 'SET_ROUTE_RESULT'; payload: RouteResult }
  | { type: 'PREVIEW_STEP'; payload: number }
  | { type: 'SET_PROGRESS'; payload: number }
  | { type: 'SET_VIEW' | 'SET_FLOOR'; payload: string }
  | { type: 'SET_SELECTED_POI'; payload: GraphNode & { poi?: { floorId?: string } } }
  | { type: 'CLEAR_ROUTE' | 'CLEAR_SELECTED_POI' | 'NEXT_STEP' | 'PREV_STEP' | 'CONFIRM_ARRIVAL' };

export function visitorJourneyReducer(
  state: VisitorJourneyState,
  action: JourneyAction,
): VisitorJourneyState {
  switch (action.type) {
    case 'SET_START': {
      const floorId = action.payload.floorId ?? state.locationFloorId;
      return {
        ...state,
        startNodeId: action.payload.nodeId,
        destinationNodeId: null,
        activeFloorId: floorId,
        locationFloorId: floorId,
        locationBasis: action.payload.locationBasis ?? 'selected',
        route: null,
        previewStepIndex: 0,
        progressMeters: 0,
        navStatus: NAV_STATUS.IDLE,
        arrivalSource: null,
      };
    }
    case 'SET_DESTINATION':
      return { ...state, destinationNodeId: action.payload };
    case 'SET_ROUTE_START': {
      const { startId, endId, startFloorId } = action.payload;
      const changedStart = startId !== state.startNodeId;
      return {
        ...state,
        startNodeId: startId,
        destinationNodeId: endId,
        activeFloorId: startFloorId ?? state.locationFloorId,
        locationFloorId: startFloorId ?? state.locationFloorId,
        locationBasis: changedStart ? 'selected' : state.locationBasis,
        route: null,
        previewStepIndex: 0,
        progressMeters: 0,
        navStatus: NAV_STATUS.ROUTING,
        arrivalSource: null,
        selectedPOI: null,
      };
    }
    case 'SET_ROUTE_RESULT':
      return {
        ...state,
        route: action.payload,
        previewStepIndex: 0,
        progressMeters: 0,
        navStatus: action.payload.found ? NAV_STATUS.NAVIGATING : NAV_STATUS.IDLE,
        arrivalSource: null,
      };
    case 'CLEAR_ROUTE':
      return {
        ...state,
        destinationNodeId: null,
        route: null,
        previewStepIndex: 0,
        progressMeters: 0,
        navStatus: NAV_STATUS.IDLE,
        arrivalSource: null,
      };
    case 'SET_VIEW':
      return { ...state, activeView: action.payload };
    case 'SET_FLOOR':
      return { ...state, activeFloorId: action.payload };
    case 'SET_SELECTED_POI':
      return {
        ...state,
        selectedPOI: action.payload,
        activeFloorId: action.payload.poi?.floorId ?? state.activeFloorId,
      };
    case 'CLEAR_SELECTED_POI':
      return { ...state, selectedPOI: null };
    case 'NEXT_STEP':
    case 'PREV_STEP':
    case 'PREVIEW_STEP': {
      if (!state.route?.found || state.route.steps.length === 0) return state;
      if (action.type === 'PREVIEW_STEP' && !Number.isInteger(action.payload)) return state;
      const offset = action.type === 'NEXT_STEP' ? 1 : -1;
      const previewStepIndex = Math.max(
        0,
        Math.min(
          action.type === 'PREVIEW_STEP' ? action.payload : state.previewStepIndex + offset,
          state.route.steps.length - 1,
        ),
      );
      const floorId = state.route.steps[previewStepIndex].floorId;
      return {
        ...state,
        previewStepIndex,
        progressMeters: progressForStep(trackForRoute(state.route), previewStepIndex),
        activeFloorId: floorId === undefined ? state.activeFloorId : String(floorId),
      };
    }
    case 'SET_PROGRESS': {
      if (!state.route?.found || state.route.steps.length === 0) return state;
      if (state.navStatus !== NAV_STATUS.NAVIGATING) return state;
      const track = trackForRoute(state.route);
      const progressMeters = clampProgress(track, action.payload);
      if (progressMeters === state.progressMeters) return state;
      const { floor } = positionAt(track, progressMeters);
      return {
        ...state,
        progressMeters,
        previewStepIndex: guidanceAt(track, progressMeters).stepIndex,
        // The displayed storey follows the guidance, as it does for a manual step.
        activeFloorId: floor || state.activeFloorId,
      };
    }
    case 'CONFIRM_ARRIVAL': {
      const route = state.route;
      if (!route?.found || !canConfirmArrival(state)) return state;
      // Confirming from within the arrival radius lands the visitor at the
      // door, so the map and the step list agree with what they just said.
      return {
        ...state,
        navStatus: NAV_STATUS.ARRIVED,
        arrivalSource: 'user-confirmed',
        progressMeters: trackForRoute(route).length,
        previewStepIndex: route.steps.length - 1,
      };
    }
    default:
      return state;
  }
}
/**
 * Whether the visitor may confirm they have arrived: at the final step, or
 * within the arrival radius of the end of the route, which is where live
 * tracking reports arrival from. Published progress can trail the tracker by
 * a fraction, so the radius is read with that much slack.
 */
export function canConfirmArrival(state: VisitorJourneyState): boolean {
  const route = state.route;
  if (!route?.found || route.steps.length === 0 || state.navStatus !== NAV_STATUS.NAVIGATING) {
    return false;
  }
  if (state.previewStepIndex === route.steps.length - 1) return true;
  return trackForRoute(route).length - state.progressMeters <= ARRIVAL_METERS + PROGRESS_EPSILON;
}
