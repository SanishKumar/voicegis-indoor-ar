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

import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useState,
  useEffect,
  useRef,
} from 'react';
import { findRoute, shutdownRoutingWorker } from '../engine/routingEngine';
import { calculateCompiledRoute } from '../engine/compiledRoutePolicy';
import { useVenue } from './VenueContext.jsx';
import { createVenueScopedState } from '../data/venueSession';
import { checkInFromScan } from '../capture/anchorCheckIn.ts';
import { bindVisualCheckIn } from '../capture/visualCheckIn';
import { sharedOrientation } from '../ar/sharedOrientation';
import { SIGN_READING_MAX_SKEW_MS, signHeadingFrom } from '../ar/signHeading';
import { logField } from '../fieldTest/fieldLog';
import {
  copyOperationalOverlay,
  createOperationalLease,
  NO_OPERATIONAL_POLICY,
} from '../navigation/operationalLease';
import {
  canConfirmArrival,
  JOURNEY_ACTION as ACTION,
  NAV_STATUS,
  visitorJourneyReducer,
} from '../navigation/visitorJourney';

export { NAV_STATUS };

function routeOptionsFor(stepFree, operationalOverlay, evaluatedAt) {
  return {
    profile: stepFree ? 'wheelchair' : 'standard',
    ...(operationalOverlay ? { operationalOverlay, evaluatedAt } : {}),
  };
}

// ── View Types ──
export const VIEW_TYPE = {
  MAP: 'map',
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
    locationFloorId: urlCheckIn.anchor.floorId,
    locationBasis: 'qr',
  };
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
  // A link that did not resolve is reported rather than discarded. It used to
  // return null here and the parameter was stripped regardless, so a code for
  // another venue - the obvious mistake, since every venue's codes look alike -
  // opened the app at the default start with no indication that anything had
  // been asked for at all.
  return result.ok ? { ok: true, result } : { ok: false, reason: result.reason, payload };
}

export function NavigationProvider({ children, venue }) {
  // Read once, before the reducer, so both the start node and the confirmation
  // can be seeded from it.
  const [urlCheckIn] = useState(() => checkInFromUrl(venue));
  const resolvedUrlCheckIn = urlCheckIn?.ok ? urlCheckIn.result : null;
  const [state, dispatch] = useReducer(
    visitorJourneyReducer,
    { venue, urlCheckIn: resolvedUrlCheckIn },
    createInitialState,
  );
  // A route calculation is asynchronous, but clearing or replacing it is an
  // immediate user action. Results from an older generation must not resurrect
  // guidance after Cancel, a changed start, or a return to onboarding.
  const routeRequestGenerationRef = useRef(0);
  // Synchronous intent survives scans delivered before React renders a route
  // request, while clearing it makes cancellation final for subsequent scans.
  const routeDestinationRef = useRef(null);
  const routeStartRef = useRef(state.startNodeId);
  const acceptedRouteRef = useRef(null);
  const policyRef = useRef({
    overlay: null,
    lease: null,
    revision: 0,
    required: false,
    needsLocation: false,
    pauseReason: null,
    pauseDestination: null,
  });
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
  const accessibleRoutingRef = useRef(accessibleRouting);

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
  const [checkInToastVisible, setCheckInToastVisible] = useState(Boolean(resolvedUrlCheckIn));
  const [operationalOverlay, setOperationalOverlayState] = useState(null);
  // The last successful QR check-in. Held here rather than inside whichever
  // modal performed the scan, because each of those unmounts the moment the
  // scan succeeds and the visitor would never see the confirmation.
  const [checkIn, setCheckIn] = useState(() =>
    resolvedUrlCheckIn === null
      ? null
      : {
          anchorId: resolvedUrlCheckIn.anchor.id,
          floorId: resolvedUrlCheckIn.anchor.floorId,
          spaceId: resolvedUrlCheckIn.anchor.spaceId,
          nodeId: resolvedUrlCheckIn.nodeId,
          distanceMeters: resolvedUrlCheckIn.distanceMeters,
          scannedAt: Date.now(),
        },
  );
  // A check-in link this venue could not honour, kept so the visitor is told.
  const [checkInProblem, setCheckInProblem] = useState(() =>
    urlCheckIn !== null && !urlCheckIn.ok
      ? {
          reason: urlCheckIn.reason,
          venueName: venue.config?.name ?? venue.buildingPackage.building.id,
        }
      : null,
  );
  const [operationalEvaluatedAt, setOperationalEvaluatedAt] = useState(null);
  const [operationalFreshness, setOperationalFreshness] = useState(NO_OPERATIONAL_POLICY);
  const freshnessRef = useRef(NO_OPERATIONAL_POLICY);
  const [policyConfirmationRequired, setPolicyConfirmationRequired] = useState(false);

  const pausePolicy = useCallback((reason) => {
    const policy = policyRef.current;
    const destinationNodeId = routeDestinationRef.current;
    if (!destinationNodeId) return;
    if (!policy.needsLocation) {
      policy.needsLocation = true;
      setPolicyConfirmationRequired(true);
    }
    acceptedRouteRef.current = null;
    if (policy.pauseReason === reason && policy.pauseDestination === destinationNodeId) return;
    policy.pauseReason = reason;
    policy.pauseDestination = destinationNodeId;
    routeRequestGenerationRef.current += 1;
    dispatch({ type: ACTION.PAUSE_POLICY, payload: { reason, destinationNodeId } });
    logField('closure-policy', { status: 'paused', reason });
  }, []);

  const ensureOperationalPolicy = useCallback(() => {
    const policy = policyRef.current;
    const report = policy.lease
      ? policy.lease.read(Date.now(), performance.now())
      : policy.required
        ? { status: 'unavailable', overlayId: null, reason: 'overlay-removed' }
        : NO_OPERATIONAL_POLICY;
    const previous = freshnessRef.current;
    if (
      previous.status !== report.status ||
      previous.reason !== report.reason ||
      previous.overlayId !== report.overlayId
    ) {
      freshnessRef.current = report;
      setOperationalFreshness(report);
      logField('closure-policy', {
        status: report.status,
        overlay: report.overlayId,
        reason: report.reason ?? 'none',
      });
    }
    if (report.status === 'unavailable') pausePolicy(report.reason);
    return report;
  }, [pausePolicy]);

  // Timers alone are insufficient in a backgrounded mobile tab. Every resume
  // and every route/frame action also checks the lease before doing work.
  useEffect(() => {
    let timer;
    let disposed = false;
    const check = () => {
      if (disposed) return;
      clearTimeout(timer);
      const report = ensureOperationalPolicy();
      const lease = policyRef.current.lease;
      if (lease && (report.status === 'current' || report.reason === 'overlay-not-active')) {
        timer = setTimeout(check, lease.delay(Date.now(), performance.now()));
      }
    };
    check();
    window.addEventListener('focus', check);
    window.addEventListener('pageshow', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      disposed = true;
      clearTimeout(timer);
      window.removeEventListener('focus', check);
      window.removeEventListener('pageshow', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [ensureOperationalPolicy, operationalOverlay]);

  const isRouteCurrent = useCallback(
    (route) => {
      const report = ensureOperationalPolicy();
      return (
        report.status !== 'unavailable' &&
        !policyRef.current.needsLocation &&
        acceptedRouteRef.current !== null &&
        (route === undefined || route === acceptedRouteRef.current)
      );
    },
    [ensureOperationalPolicy],
  );

  const completeOnboarding = useCallback(() => {
    setOnboardingComplete(true);
    if (typeof window !== 'undefined') {
      localStorage.setItem('onboarding_complete', 'true');
    }
  }, []);

  const resetOnboarding = useCallback(() => {
    // Welcome is a map-first planning flow. Leaving the visitor in Guide view
    // made every non-routing completion render CameraPreview with no search
    // target, defeating both the button's meaning and the focus handoff.
    routeRequestGenerationRef.current += 1;
    routeDestinationRef.current = null;
    acceptedRouteRef.current = null;
    policyRef.current.pauseReason = null;
    dispatch({ type: ACTION.CLEAR_ROUTE });
    dispatch({ type: ACTION.SET_VIEW, payload: VIEW_TYPE.MAP });
    setOnboardingComplete(false);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('onboarding_complete');
    }
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(
    () => () => {
      routeRequestGenerationRef.current += 1;
      shutdownRoutingWorker();
    },
    [],
  );

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
      routeDestinationRef.current = destNodeId;
      const report = ensureOperationalPolicy();
      if (report.status === 'unavailable') return;
      if (policyRef.current.needsLocation) {
        pausePolicy('location-required');
        return;
      }
      const policyRevision = policyRef.current.revision;
      const requestGeneration = routeRequestGenerationRef.current + 1;
      routeRequestGenerationRef.current = requestGeneration;
      acceptedRouteRef.current = null;
      policyRef.current.pauseReason = null;
      routeStartRef.current = startId;
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
          routeOptionsFor(stepFree, policyRef.current.overlay, new Date().toISOString()),
        );
        if (
          routeRequestGenerationRef.current !== requestGeneration ||
          policyRef.current.revision !== policyRevision
        )
          return;
        if (ensureOperationalPolicy().status === 'unavailable') return;
        acceptedRouteRef.current = route.found ? route : null;
        // A failed compliant route still owns the trip intent. The visitor may
        // explicitly choose another profile/start; only dismissal cancels it.
        dispatch({ type: ACTION.SET_ROUTE_RESULT, payload: route });
      } catch (err) {
        if (routeRequestGenerationRef.current !== requestGeneration) return;
        if (ensureOperationalPolicy().status === 'unavailable') return;
        console.error('Routing error:', err);
        dispatch({
          type: ACTION.SET_ROUTE_RESULT,
          payload: { found: false, error: 'Routing failed' },
        });
      }
    },
    [ensureOperationalPolicy, pausePolicy, venue],
  );

  const previewRoute = useCallback(
    (destNodeId, startNodeId = state.startNodeId) => {
      if (operationalFreshness.status === 'unavailable' || policyConfirmationRequired) {
        return {
          found: false,
          error: 'Current closure information and a confirmed start are required',
        };
      }
      return calculateCompiledRoute(
        venue,
        startNodeId,
        destNodeId,
        routeOptionsFor(accessibleRouting, operationalOverlay, new Date().toISOString()),
      );
    },
    [
      accessibleRouting,
      operationalFreshness,
      operationalOverlay,
      policyConfirmationRequired,
      state.startNodeId,
      venue,
    ],
  );

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  }, []);

  const toggleHighContrast = useCallback(() => {
    setHighContrast((prev) => !prev);
  }, []);

  const toggleAccessibleRouting = useCallback(() => {
    const next = !accessibleRoutingRef.current;
    accessibleRoutingRef.current = next;
    setAccessibleRouting(next);
    localStorage.setItem('accessible_routing', String(next));
    if (routeDestinationRef.current && routeStartRef.current) {
      const startNode = venue.getNodeById(routeStartRef.current);
      void requestRoute(
        routeDestinationRef.current,
        routeStartRef.current,
        next,
        startNode ? String(startNode.floor) : undefined,
      );
    }
  }, [requestRoute, venue]);

  const setOperationalOverlay = useCallback(
    (overlay, evaluatedAt = new Date().toISOString()) => {
      const policy = policyRef.current;
      if (overlay === null && !policy.required) return;
      const ownedOverlay = copyOperationalOverlay(overlay);
      policy.overlay = ownedOverlay;
      policy.required ||= overlay !== null;
      policy.revision += 1;
      policy.lease =
        overlay === null
          ? null
          : createOperationalLease(
              ownedOverlay,
              venue.buildingPackage,
              Date.now(),
              performance.now(),
            );
      routeRequestGenerationRef.current += 1;
      acceptedRouteRef.current = null;
      setOperationalOverlayState(ownedOverlay);
      // Historical import diagnostics only. Live routing always uses its own clock.
      setOperationalEvaluatedAt(overlay ? evaluatedAt : null);
      const report = ensureOperationalPolicy();
      if (report.status !== 'unavailable' && routeDestinationRef.current) {
        pausePolicy('overlay-changed');
      }
    },
    [ensureOperationalPolicy, pausePolicy, venue],
  );

  const confirmPlanningStart = useCallback(() => {
    if (ensureOperationalPolicy().status === 'unavailable') return;
    policyRef.current.needsLocation = false;
    policyRef.current.pauseReason = null;
    setPolicyConfirmationRequired(false);
  }, [ensureOperationalPolicy]);

  /**
   * A scan changes the planning location and resumes an active journey to the
   * same destination. It is a position checkpoint, never continuous tracking.
   *
   * Lives in the context so the onboarding flow and the location picker share
   * one implementation. They each held their own copy first, which is two
   * places that can drift about what counts as a valid code.
   */
  const checkInWithPayload = useCallback(
    (payload, observation = null) => {
      const pkg = venue.buildingPackage;
      const result = checkInFromScan(payload, pkg.localizationAnchors, pkg.routing.nodes);
      if (!result.ok) return result;

      const destinationNodeId = routeDestinationRef.current;
      acceptedRouteRef.current = null;
      policyRef.current.pauseReason = null;
      routeStartRef.current = result.nodeId;
      routeRequestGenerationRef.current += 1;
      dispatch({
        type: ACTION.SET_START,
        payload: {
          nodeId: result.nodeId,
          floorId: result.anchor.floorId,
          locationBasis: 'qr',
        },
      });
      setCheckInProblem(null);
      setCheckInToastVisible(true);
      /*
       * Scanning a sign means facing it, roughly: the phone's rotation at the
       * decoded frame, paired with the way the sign faces, says which way the
       * visitor looks - approximately, and only while the same orientation
       * readings keep arriving. A link carries no frame and sets no direction.
       */
      const frameTimeMs = observation?.frame?.copiedAtMs ?? null;
      const sign = signHeadingFrom({
        anchor: result.anchor,
        venueKey: state.venueKey,
        frameTimeMs,
        reading:
          frameTimeMs === null
            ? null
            : sharedOrientation.readNear(frameTimeMs, SIGN_READING_MAX_SKEW_MS),
      });
      logField(
        'sign-heading',
        sign.heading
          ? { accepted: true, anchor: result.anchor.id, bearing: sign.heading.planBearing }
          : { accepted: false, anchor: result.anchor.id, why: sign.refusal },
      );
      setCheckIn({
        anchorId: result.anchor.id,
        floorId: result.anchor.floorId,
        spaceId: result.anchor.spaceId,
        nodeId: result.nodeId,
        distanceMeters: result.distanceMeters,
        scannedAt: Date.now(),
        visualCandidate: bindVisualCheckIn(
          observation,
          result.anchor,
          state.venueKey,
          performance.now(),
        ),
        signHeading: sign.heading,
        signHeadingRefusal: sign.refusal,
      });
      confirmPlanningStart();
      if (destinationNodeId) {
        void requestRoute(
          destinationNodeId,
          result.nodeId,
          accessibleRoutingRef.current,
          result.anchor.floorId,
        );
      }
      return result;
    },
    [confirmPlanningStart, requestRoute, venue, state.venueKey],
  );

  const actions = {
    setStart: useCallback(
      (nodeId) => {
        const node = venue.getNodeById(nodeId);
        if (!node) return;
        // Changing the start in the middle of directions means "route me from
        // here instead", as it does in every map app. Dropping the route made
        // the visitor search for their destination a second time.
        const destination = routeDestinationRef.current;
        routeRequestGenerationRef.current += 1;
        acceptedRouteRef.current = null;
        policyRef.current.pauseReason = null;
        routeStartRef.current = nodeId;
        setCheckIn(null);
        setCheckInProblem(null);
        dispatch({
          type: ACTION.SET_START,
          payload: { nodeId, floorId: node ? String(node.floor) : undefined },
        });
        confirmPlanningStart();
        if (destination === nodeId) routeDestinationRef.current = null;
        if (destination && destination !== nodeId) {
          void requestRoute(
            destination,
            nodeId,
            accessibleRoutingRef.current,
            node ? String(node.floor) : undefined,
          );
        }
      },
      [confirmPlanningStart, venue, requestRoute],
    ),

    checkInWithPayload,

    dismissCheckIn: useCallback(() => {
      // Dismissing feedback must not erase the last known location.
      setCheckInToastVisible(false);
      setCheckInProblem(null);
    }, []),

    setDestination: useCallback((nodeId) => {
      dispatch({ type: ACTION.SET_DESTINATION, payload: nodeId });
    }, []),

    navigateTo: async (destNodeId, startNodeId) => {
      const startId = startNodeId || routeStartRef.current;
      if (startId !== routeStartRef.current) {
        setCheckIn(null);
        setCheckInProblem(null);
      }
      const startNode = venue.getNodeById(startId);
      return requestRoute(
        destNodeId,
        startId,
        accessibleRoutingRef.current,
        startNode ? String(startNode.floor) : undefined,
      );
    },

    clearRoute: useCallback(() => {
      routeRequestGenerationRef.current += 1;
      routeDestinationRef.current = null;
      acceptedRouteRef.current = null;
      policyRef.current.pauseReason = null;
      dispatch({ type: ACTION.CLEAR_ROUTE });
    }, []),

    setView: useCallback(
      (view) => {
        if (
          view === VIEW_TYPE.CAMERA_PREVIEW &&
          (ensureOperationalPolicy().status === 'unavailable' || policyRef.current.needsLocation)
        )
          return;
        dispatch({ type: ACTION.SET_VIEW, payload: view });
      },
      [ensureOperationalPolicy],
    ),

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
      if (!isRouteCurrent()) return;
      dispatch({ type: ACTION.NEXT_STEP });
    }, [isRouteCurrent]),

    prevStep: useCallback(() => {
      if (!isRouteCurrent()) return;
      dispatch({ type: ACTION.PREV_STEP });
    }, [isRouteCurrent]),

    previewStep: useCallback(
      (index) => {
        if (!isRouteCurrent()) return;
        dispatch({ type: ACTION.PREVIEW_STEP, payload: index });
      },
      [isRouteCurrent],
    ),

    setProgress: useCallback(
      (meters) => {
        if (!isRouteCurrent()) return;
        dispatch({ type: ACTION.SET_PROGRESS, payload: meters });
      },
      [isRouteCurrent],
    ),

    confirmArrival: useCallback(() => {
      if (!isRouteCurrent()) return;
      if (canConfirmArrival(state)) routeDestinationRef.current = null;
      dispatch({ type: ACTION.CONFIRM_ARRIVAL });
    }, [isRouteCurrent, state]),

    isRouteCurrent,
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
        checkInToastVisible,
        checkInProblem,
        operationalOverlay,
        operationalEvaluatedAt,
        operationalFreshness,
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
