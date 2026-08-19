/**
 * NavigationContext.jsx
 *
 * Global state management for the indoor navigation app.
 * Uses useReducer for predictable state transitions.
 *
 * Performance note: Volatile state (compass heading, camera frames) is kept
 * OUTSIDE this context to avoid unnecessary re-renders. Use refs for those.
 *
 * @module context/NavigationContext
 */

import { createContext, useContext, useReducer, useCallback, useState, useEffect } from 'react';
import { findRoute, shutdownRoutingWorker } from '../engine/routingEngine';
import { calculateCompiledRoute } from '../engine/compiledRoutePolicy';
import { useVenue } from './VenueContext.jsx';
import { createVenueScopedState } from '../data/venueSession';
import { checkInFromScan } from '../capture/anchorCheckIn.ts';

function routeOptionsFor(stepFree, operationalOverlay, evaluatedAt) {
  return {
    profile: stepFree ? 'wheelchair' : 'standard',
    ...(operationalOverlay ? { operationalOverlay, evaluatedAt } : {}),
  };
}

// ── Action Types ──
const ACTION = {
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
  SET_NAV_STATUS: 'SET_NAV_STATUS',
};

// ── Navigation Status ──
export const NAV_STATUS = {
  IDLE: 'idle',
  ROUTING: 'routing',
  NAVIGATING: 'navigating',
  ARRIVED: 'arrived',
};

// ── View Types ──
export const VIEW_TYPE = {
  MAP: 'map',
  SPATIAL_TWIN: 'spatial-twin',
  CAMERA_PREVIEW: 'camera-preview',
};

// ── Initial State ──
function createInitialState({ venue, urlCheckIn }) {
  const navigation = createVenueScopedState(venue).navigation;
  if (!urlCheckIn) return navigation;
  // A URL check-in names both where the visitor is and which floor that is on,
  // so the first render is already correct rather than starting at the venue
  // default and jumping.
  return {
    ...navigation,
    startNodeId: urlCheckIn.nodeId,
    activeFloorId: urlCheckIn.anchor.floorId,
  };
}

// ── Reducer ──
function navigationReducer(state, action) {
  switch (action.type) {
    case ACTION.SET_START:
      return {
        ...state,
        startNodeId: action.payload.nodeId,
        activeFloorId: action.payload.floorId ?? state.activeFloorId,
        route: null,
        currentStepIndex: 0,
        navStatus: NAV_STATUS.IDLE,
      };

    case ACTION.SET_DESTINATION:
      return {
        ...state,
        destinationNodeId: action.payload,
      };

    case ACTION.SET_ROUTE_START: {
      const { startId, endId, startFloorId } = action.payload;
      return {
        ...state,
        startNodeId: startId,
        destinationNodeId: endId,
        activeFloorId: startFloorId ?? state.activeFloorId,
        route: null,
        navStatus: NAV_STATUS.ROUTING,
        selectedPOI: null,
      };
    }

    case ACTION.SET_ROUTE_RESULT: {
      const route = action.payload;
      return {
        ...state,
        route,
        currentStepIndex: 0,
        navStatus: route.found ? NAV_STATUS.NAVIGATING : NAV_STATUS.IDLE,
      };
    }

    case ACTION.CLEAR_ROUTE:
      return {
        ...state,
        destinationNodeId: null,
        route: null,
        currentStepIndex: 0,
        navStatus: NAV_STATUS.IDLE,
      };

    case ACTION.SET_VIEW:
      return {
        ...state,
        activeView: action.payload,
      };

    case ACTION.SET_FLOOR:
      return {
        ...state,
        activeFloorId: action.payload,
      };

    case ACTION.SET_SELECTED_POI:
      return {
        ...state,
        selectedPOI: action.payload,
        activeFloorId: action.payload?.poi?.floorId ?? state.activeFloorId,
      };

    case ACTION.CLEAR_SELECTED_POI:
      return {
        ...state,
        selectedPOI: null,
      };

    case ACTION.NEXT_STEP: {
      if (!state.route) return state;
      const nextIndex = Math.min(state.currentStepIndex + 1, state.route.steps.length - 1);
      const isArrived = nextIndex === state.route.steps.length - 1;
      return {
        ...state,
        currentStepIndex: nextIndex,
        navStatus: isArrived ? NAV_STATUS.ARRIVED : NAV_STATUS.NAVIGATING,
        activeFloorId: state.route.steps[nextIndex]?.floorId ?? state.activeFloorId,
      };
    }

    case ACTION.PREV_STEP: {
      const prevIndex = Math.max(state.currentStepIndex - 1, 0);
      return {
        ...state,
        currentStepIndex: prevIndex,
        navStatus: NAV_STATUS.NAVIGATING,
        activeFloorId: state.route?.steps[prevIndex]?.floorId ?? state.activeFloorId,
      };
    }

    case ACTION.SET_NAV_STATUS:
      return {
        ...state,
        navStatus: action.payload,
      };

    default:
      return state;
  }
}

// ── Context ──
const NavigationContext = createContext(null);

// ── Provider ──
/**
 * A check-in carried in the URL: `/?checkin=<payload>`
 *
 * The same payload a sticker encodes, so a printed sign can be a link rather
 * than a bare code, a demo does not die with a flaky camera, and the check-in
 * path can be exercised on a machine that has no camera at all.
 *
 * Resolved before any state exists rather than in an effect, so the app opens
 * already checked in instead of rendering somewhere else first and correcting
 * itself.
 *
 * Strictly a read. Stripping the parameter here as well looked tidier and was
 * wrong: this runs inside a state initialiser, which StrictMode deliberately
 * invokes twice, so the first call removed the parameter and the second found
 * nothing and returned null — a check-in that vanished in development only.
 * Removing it is a side effect and belongs in one.
 */
function checkInFromUrl(venue) {
  if (typeof window === 'undefined') return null;
  const payload = new URLSearchParams(window.location.search).get('checkin');
  if (!payload) return null;

  const pkg = venue.buildingPackage;
  const result = checkInFromScan(payload, pkg.localizationAnchors, pkg.routing.nodes);
  return result.ok ? result : null;
}

export function NavigationProvider({ children, venue }) {
  // Read once, before the reducer, so both the start node and the confirmation
  // can be seeded from it.
  const [urlCheckIn] = useState(() => checkInFromUrl(venue));
  const [state, dispatch] = useReducer(navigationReducer, { venue, urlCheckIn }, createInitialState);
  const { packageCacheStatus } = useVenue();

  const [theme, setTheme] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('theme');
      if (saved) return saved;
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'light';
  });

  const [onboardingComplete, setOnboardingComplete] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('onboarding_complete') === 'true';
    }
    return false;
  });

  const [highContrast, setHighContrast] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('high_contrast') === 'true';
    }
    return false;
  });

  const [accessibleRouting, setAccessibleRouting] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('accessible_routing') === 'true';
    }
    return false;
  });

  // Consumed once. Left in place, a refresh would silently move the visitor
  // back to a code they walked away from. Stripped whenever the parameter is
  // present, including when it named nothing, so a bad link does not persist.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has('checkin')) return;
    url.searchParams.delete('checkin');
    window.history.replaceState(null, '', url.toString());
  }, []);

  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [operationalOverlay, setOperationalOverlayState] = useState(null);
  // The last successful QR check-in. Held here rather than inside whichever
  // modal performed the scan, because each of those unmounts the moment the
  // scan succeeds and the visitor would never see the confirmation.
  const [checkIn, setCheckIn] = useState(() =>
    urlCheckIn === null
      ? null
      : {
          anchorId: urlCheckIn.anchor.id,
          floorId: urlCheckIn.anchor.floorId,
          spaceId: urlCheckIn.anchor.spaceId,
          nodeId: urlCheckIn.nodeId,
          distanceMeters: urlCheckIn.distanceMeters,
          scannedAt: Date.now(),
        },
  );
  const [operationalEvaluatedAt, setOperationalEvaluatedAt] = useState(null);

  const completeOnboarding = useCallback(() => {
    setOnboardingComplete(true);
    if (typeof window !== 'undefined') {
      localStorage.setItem('onboarding_complete', 'true');
    }
  }, []);

  const resetOnboarding = useCallback(() => {
    setOnboardingComplete(false);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('onboarding_complete');
    }
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => () => shutdownRoutingWorker(), []);

  useEffect(() => {
    if (highContrast) {
      document.documentElement.setAttribute('data-contrast', 'high');
    } else {
      document.documentElement.removeAttribute('data-contrast');
    }
    localStorage.setItem('high_contrast', String(highContrast));
  }, [highContrast]);

  const requestRoute = useCallback(
    async (destNodeId, startId, stepFree, startFloorId) => {
      dispatch({
        type: ACTION.SET_ROUTE_START,
        payload: {
          startId,
          endId: destNodeId,
          startFloorId,
        },
      });
      try {
        const route = await findRoute(
          venue,
          startId,
          destNodeId,
          routeOptionsFor(stepFree, operationalOverlay, operationalEvaluatedAt),
        );
        dispatch({ type: ACTION.SET_ROUTE_RESULT, payload: route });
      } catch (err) {
        console.error('Routing error:', err);
        dispatch({
          type: ACTION.SET_ROUTE_RESULT,
          payload: { found: false, error: 'Routing failed' },
        });
      }
    },
    [operationalEvaluatedAt, operationalOverlay, venue],
  );

  const previewRoute = useCallback(
    (destNodeId, startNodeId = state.startNodeId) =>
      calculateCompiledRoute(
        venue,
        startNodeId,
        destNodeId,
        routeOptionsFor(accessibleRouting, operationalOverlay, operationalEvaluatedAt),
      ),
    [accessibleRouting, operationalEvaluatedAt, operationalOverlay, state.startNodeId, venue],
  );

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  }, []);

  const toggleHighContrast = useCallback(() => {
    setHighContrast((prev) => !prev);
  }, []);

  const toggleAccessibleRouting = useCallback(() => {
    const next = !accessibleRouting;
    setAccessibleRouting(next);
    localStorage.setItem('accessible_routing', String(next));
    if (state.route && state.startNodeId && state.destinationNodeId) {
      void requestRoute(state.destinationNodeId, state.startNodeId, next, undefined);
    }
  }, [accessibleRouting, requestRoute, state.destinationNodeId, state.route, state.startNodeId]);

  const setOperationalOverlay = useCallback((overlay, evaluatedAt = new Date().toISOString()) => {
    setOperationalOverlayState(overlay);
    setOperationalEvaluatedAt(overlay ? evaluatedAt : null);
    dispatch({ type: ACTION.CLEAR_ROUTE });
  }, []);

  /**
   * Resolves a scanned payload and, when it names a check-in point, starts the
   * next route from there.
   *
   * Lives in the context so the onboarding flow and the location picker share
   * one implementation. They each held their own copy first, which is two
   * places that can drift about what counts as a valid code.
   */
  const checkInWithPayload = useCallback(
    (payload) => {
      const pkg = venue.buildingPackage;
      const result = checkInFromScan(payload, pkg.localizationAnchors, pkg.routing.nodes);
      if (!result.ok) return result;

      const node = venue.getNodeById(result.nodeId);
      dispatch({
        type: ACTION.SET_START,
        payload: { nodeId: result.nodeId, floorId: node ? String(node.floor) : undefined },
      });
      setCheckIn({
        anchorId: result.anchor.id,
        floorId: result.anchor.floorId,
        spaceId: result.anchor.spaceId,
        nodeId: result.nodeId,
        distanceMeters: result.distanceMeters,
        scannedAt: Date.now(),
      });
      return result;
    },
    [venue],
  );

  const actions = {
    setStart: useCallback(
      (nodeId) => {
        const node = venue.getNodeById(nodeId);
        dispatch({
          type: ACTION.SET_START,
          payload: { nodeId, floorId: node ? String(node.floor) : undefined },
        });
      },
      [venue],
    ),

    checkInWithPayload,

    dismissCheckIn: useCallback(() => setCheckIn(null), []),

    setDestination: useCallback((nodeId) => {
      dispatch({ type: ACTION.SET_DESTINATION, payload: nodeId });
    }, []),

    navigateTo: async (destNodeId, startNodeId) => {
      const startId = startNodeId || state.startNodeId;
      const startNode = venue.getNodeById(startId);
      return requestRoute(
        destNodeId,
        startId,
        accessibleRouting,
        startNode ? String(startNode.floor) : undefined,
      );
    },

    clearRoute: useCallback(() => {
      dispatch({ type: ACTION.CLEAR_ROUTE });
    }, []),

    setView: useCallback((view) => {
      dispatch({ type: ACTION.SET_VIEW, payload: view });
    }, []),

    setFloor: useCallback((floorId) => {
      dispatch({ type: ACTION.SET_FLOOR, payload: floorId });
    }, []),

    selectPOI: useCallback((node) => {
      dispatch({ type: ACTION.SET_SELECTED_POI, payload: node });
    }, []),

    clearSelectedPOI: useCallback(() => {
      dispatch({ type: ACTION.CLEAR_SELECTED_POI });
    }, []),

    nextStep: useCallback(() => {
      dispatch({ type: ACTION.NEXT_STEP });
    }, []),

    prevStep: useCallback(() => {
      dispatch({ type: ACTION.PREV_STEP });
    }, []),
  };

  return (
    <NavigationContext.Provider
      value={{
        state,
        actions,
        theme,
        toggleTheme,
        onboardingComplete,
        completeOnboarding,
        resetOnboarding,
        showLocationPicker,
        setShowLocationPicker,
        highContrast,
        toggleHighContrast,
        accessibleRouting,
        toggleAccessibleRouting,
        checkIn,
        operationalOverlay,
        operationalEvaluatedAt,
        setOperationalOverlay,
        packageCacheStatus,
        previewRoute,
        venue,
      }}
    >
      {children}
    </NavigationContext.Provider>
  );
}

// ── Hook ──
export function useNavigation() {
  const context = useContext(NavigationContext);
  if (!context) {
    throw new Error('useNavigation must be used within a NavigationProvider');
  }
  return context;
}
