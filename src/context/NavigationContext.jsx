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
import { findRoute } from '../engine/routingEngine.js';
import { BUILDING_CONFIG } from '../data/buildingConfig.js';

// ── Action Types ──
const ACTION = {
  SET_START: 'SET_START',
  SET_DESTINATION: 'SET_DESTINATION',
  COMPUTE_ROUTE: 'COMPUTE_ROUTE',
  CLEAR_ROUTE: 'CLEAR_ROUTE',
  SET_VIEW: 'SET_VIEW',
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
  AR: 'ar',
};

// ── Initial State ──
const initialState = {
  startNodeId: BUILDING_CONFIG.defaultStartNode,
  destinationNodeId: null,
  route: null,           // { path, pathIds, totalDistance, steps, found }
  activeView: VIEW_TYPE.MAP,
  selectedPOI: null,     // node object for POI card
  currentStepIndex: 0,
  navStatus: NAV_STATUS.IDLE,
};

// ── Reducer ──
function navigationReducer(state, action) {
  switch (action.type) {
    case ACTION.SET_START:
      return {
        ...state,
        startNodeId: action.payload,
        route: null,
        currentStepIndex: 0,
        navStatus: NAV_STATUS.IDLE,
      };

    case ACTION.SET_DESTINATION:
      return {
        ...state,
        destinationNodeId: action.payload,
      };

    case ACTION.COMPUTE_ROUTE: {
      const { startId, endId } = action.payload;
      const route = findRoute(startId, endId);
      return {
        ...state,
        startNodeId: startId,
        destinationNodeId: endId,
        route,
        currentStepIndex: 0,
        navStatus: route.found ? NAV_STATUS.NAVIGATING : NAV_STATUS.IDLE,
        selectedPOI: null,
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

    case ACTION.SET_SELECTED_POI:
      return {
        ...state,
        selectedPOI: action.payload,
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
      };
    }

    case ACTION.PREV_STEP: {
      const prevIndex = Math.max(state.currentStepIndex - 1, 0);
      return {
        ...state,
        currentStepIndex: prevIndex,
        navStatus: NAV_STATUS.NAVIGATING,
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
export function NavigationProvider({ children }) {
  const [state, dispatch] = useReducer(navigationReducer, initialState);

  const [theme, setTheme] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('theme');
      if (saved) return saved;
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  }, []);

  const actions = {
    setStart: useCallback((nodeId) => {
      dispatch({ type: ACTION.SET_START, payload: nodeId });
    }, []),

    setDestination: useCallback((nodeId) => {
      dispatch({ type: ACTION.SET_DESTINATION, payload: nodeId });
    }, []),

    navigateTo: useCallback((destNodeId, startNodeId) => {
      const startId = startNodeId || state.startNodeId;
      dispatch({ type: ACTION.COMPUTE_ROUTE, payload: { startId, endId: destNodeId } });
    }, [state.startNodeId]),

    clearRoute: useCallback(() => {
      dispatch({ type: ACTION.CLEAR_ROUTE });
    }, []),

    setView: useCallback((view) => {
      dispatch({ type: ACTION.SET_VIEW, payload: view });
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
    <NavigationContext.Provider value={{ state, actions, theme, toggleTheme }}>
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
