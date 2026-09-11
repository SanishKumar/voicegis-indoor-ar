/**
 * NavigationPanel.jsx
 *
 * The journey has two scales: legs a person can scan (walk, change floor,
 * walk), and the exact instruction they need now. Grouping never removes a
 * left/right instruction; the map path remains usable without camera access.
 */

import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUp,
  Building2,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Footprints,
  MapPin,
  Navigation,
  X,
} from 'lucide-react';
import { useNavigation, NAV_STATUS } from '../context/NavigationContext.jsx';
import { formatDistance, estimateWalkTime } from '../data/buildingConfig.js';
import { STEP_TYPE } from '../engine/routingEngine';
import { groupRouteLegs, legIndexForStep } from '../engine/routeLegs';
import './visitorJourney.css';

function shortFloorLabel(venue, floorId) {
  const floor = venue.getFloorById(String(floorId));
  return floor?.level === 0 ? 'G' : `L${floor?.level ?? floorId}`;
}

function LegIcon({ leg, size = 18 }) {
  if (leg.kind === 'start') return <CircleDot size={size} strokeWidth={2} />;
  if (leg.kind === 'arrive') return <MapPin size={size} strokeWidth={2} />;
  if (leg.connector === STEP_TYPE.ELEVATOR) return <Building2 size={size} strokeWidth={2} />;
  if (leg.kind === 'vertical') return <Footprints size={size} strokeWidth={2} />;
  return <ArrowUp size={size} strokeWidth={2} />;
}

export default function NavigationPanel() {
  const { state, actions, venue, setShowLocationPicker } = useNavigation();
  const { route, navStatus, previewStepIndex: currentStepIndex, destinationNodeId } = state;
  const panelRef = useRef(null);
  /*
   * On a phone the whole strip covered four fifths of the map, which is the
   * one thing a visitor came to look at. Collapsed, the panel shows the leg in
   * hand and nothing else - which is what the journey is meant to be read as
   * anyway. Desktop uses the same compact, map-first presentation.
   */
  const [expanded, setExpanded] = useState(false);
  const destNode = venue.getNodeById(destinationNodeId);

  const clearRouteAndReturnToSearch = () => {
    actions.clearRoute();
    // Clearing guidance renders the stable map trigger again. Restore only for
    // this explicit dismissal; inferring intent from every route clear stole
    // focus from unrelated flows such as changing the starting location.
    window.setTimeout(() => {
      document.getElementById('btn-search-open')?.focus({ preventScroll: true });
    }, 0);
  };

  /*
   * The panel's height is a layout fact the map's own controls need. As a
   * bottom sheet it sits over the floor stack and the zoom column, and those
   * have to move above it - so it is measured and published rather than
   * guessed at, the same way the header is. Cleared on unmount so the controls
   * fall back to their normal places once guidance ends.
   */
  useEffect(() => {
    const panel = panelRef.current;
    const root = document.documentElement;
    if (panel === null) {
      root.style.removeProperty('--visitor-sheet-height');
      return undefined;
    }
    const publish = () => {
      root.style.setProperty('--visitor-sheet-height', `${panel.getBoundingClientRect().height}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(panel);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--visitor-sheet-height');
    };
  }, [route, navStatus, expanded]);

  // Route creation replaces the control that launched it. Focus the new
  // calculation/guidance region once, rather than dropping the visitor on
  // <body> or stealing focus again on every instruction change.
  useEffect(() => {
    if (navStatus !== NAV_STATUS.ROUTING && !route) return;
    panelRef.current?.focus({ preventScroll: true });
  }, [navStatus, route]);

  if (navStatus === NAV_STATUS.ROUTING && !route) {
    const destinationName = destNode?.poi?.name || 'destination';
    return (
      <div
        ref={panelRef}
        className="nav-panel route-pending-panel open"
        id="route-pending-panel"
        role="status"
        aria-label={`Calculating route to ${destinationName}`}
        aria-live="polite"
        tabIndex={-1}
      >
        <div className="route-failure-message">
          <div className="nav-panel-dest-icon" aria-hidden="true">
            <Navigation size={18} strokeWidth={2} />
          </div>
          <div>
            <strong>Calculating route</strong>
            <p>Checking the active venue paths to {destinationName}…</p>
          </div>
          <button className="nav-panel-close-btn" onClick={clearRouteAndReturnToSearch}>
            <X size={14} strokeWidth={2} /> Cancel
          </button>
        </div>
      </div>
    );
  }

  if (!route) return null;

  if (!route.found) {
    const isClosureFailure =
      route.receipt?.profile === 'wheelchair' && route.receipt?.excludedEdges.closed > 0;
    const failureMessage = isClosureFailure
      ? 'No step-free route is available under the active operational closures.'
      : route.error;

    return (
      <div
        ref={panelRef}
        className="nav-panel route-failure-panel open"
        id="route-failure-panel"
        role="alert"
        tabIndex={-1}
      >
        <div className="route-failure-message">
          <div className="route-failure-icon" aria-hidden="true">
            <AlertTriangle size={20} strokeWidth={2} />
          </div>
          <div>
            <strong>No compliant route</strong>
            <p>{failureMessage}</p>
          </div>
          <button className="nav-panel-close-btn" onClick={clearRouteAndReturnToSearch}>
            <X size={14} strokeWidth={2} /> Dismiss
          </button>
        </div>
      </div>
    );
  }

  const steps = route.steps;
  const legs = groupRouteLegs(steps);
  const currentLegIndex = legIndexForStep(legs, currentStepIndex);
  const currentStep = steps[currentStepIndex] ?? steps[0];
  const isArrived = navStatus === NAV_STATUS.ARRIVED;

  // Browsing directions is not measured progress. Totals stay tied to the
  // route's planning start until a new location produces a new route.
  const totalDistance = steps.reduce((total, step) => total + (step.distance || 0), 0);

  const connectorReceipt = route.receipt?.selectedConnectors?.[0];
  const connector = connectorReceipt
    ? venue.buildingPackage.verticalConnectors.find(
        (candidate) => candidate.id === connectorReceipt.sourceId,
      )
    : null;
  const routeProfile =
    route.receipt?.profile === 'wheelchair' ? 'Step-free route' : 'Fastest available route';
  const journeyLabel = connectorReceipt
    ? `${shortFloorLabel(venue, connectorReceipt.fromFloorId)} → ${connector?.name ?? connectorReceipt.sourceId} → ${shortFloorLabel(venue, connectorReceipt.toFloorId)}`
    : `${shortFloorLabel(venue, destNode?.floor)} · same floor`;

  return (
    <div
      ref={panelRef}
      className={`nav-panel journey-panel open ${expanded ? 'is-expanded' : 'is-collapsed'}`}
      id="nav-panel"
      role="region"
      aria-label={`Directions to ${destNode?.poi?.name || 'destination'}`}
      tabIndex={-1}
    >
      <div className="nav-panel-header">
        <div className="nav-panel-destination">
          <p className="nav-panel-dest-eyebrow">Route preview</p>
          <h2 className="nav-panel-dest-name">{destNode?.poi?.name || 'Destination'}</h2>
        </div>
        <button
          className="nav-panel-close-btn"
          onClick={clearRouteAndReturnToSearch}
          id="btn-cancel-nav"
        >
          <X size={14} strokeWidth={2} /> Cancel
        </button>
      </div>

      <div className="journey-overview">
        <dl className="nav-journey-facts">
          <div>
            <dt>Estimated trip</dt>
            <dd>{estimateWalkTime(totalDistance, venue.config.walkSpeedMps)}</dd>
          </div>
          <div>
            <dt>Total route</dt>
            <dd>{formatDistance(totalDistance)}</dd>
          </div>
        </dl>
        {legs.length > 1 && (
          <button
            type="button"
            className="nav-legs-toggle"
            aria-expanded={expanded}
            aria-controls="nav-steps-list"
            aria-label={expanded ? 'Hide route details' : `Show all ${legs.length} legs`}
            onClick={() => setExpanded((open) => !open)}
          >
            {expanded ? 'Hide details' : 'Route details'}
          </button>
        )}
      </div>

      <p className="nav-route-summary" aria-label={routeProfile}>
        <span>{routeProfile}</span>
        <strong>{journeyLabel}</strong>
      </p>

      <div className="journey-location-note">
        <span>
          {state.locationBasis === 'qr'
            ? 'From last check-in'
            : state.locationBasis === 'selected'
              ? 'From selected start'
              : 'From default start'}{' '}
          · Not live tracking
        </span>
        <button type="button" onClick={() => setShowLocationPicker(true)}>
          Update location
        </button>
      </div>

      {isArrived && (
        <p className="nav-arrived" aria-live="assertive">
          Arrival confirmed by you at {destNode?.poi?.name}.
        </p>
      )}

      {!isArrived && currentStep && (
        <div className="nav-current-instruction" aria-live="polite">
          <span className="nav-current-instruction-label">
            Instruction {currentStepIndex + 1} of {steps.length}
          </span>
          <strong>{currentStep.instruction}</strong>
          {currentStep.distance > 0 && <span>{formatDistance(currentStep.distance)}</span>}
        </div>
      )}

      <ol className="nav-legs" id="nav-steps-list" hidden={!expanded}>
        {legs.map((leg, index) => {
          const floor = leg.floorId ? venue.getFloorById(leg.floorId) : null;
          const legState = index === currentLegIndex ? 'current' : 'ahead';
          return (
            <li
              key={`${leg.kind}-${leg.stepIndices[0]}`}
              className={`nav-leg nav-leg-${leg.kind} is-${legState}`}
              aria-current={legState === 'current' && !isArrived ? 'step' : undefined}
            >
              <span className="nav-leg-mark" aria-hidden="true">
                <LegIcon leg={leg} />
              </span>
              <div className="nav-leg-body">
                <span className="nav-leg-headline">{leg.headline}</span>
                <span className="nav-leg-meta">
                  {floor?.name}
                  {leg.distanceMeters > 0 && ` · ${formatDistance(leg.distanceMeters)}`}
                  {leg.turns > 0 && ` · ${leg.turns} ${leg.turns === 1 ? 'turn' : 'turns'}`}
                </span>
                {leg.stepIndices.length > 1 && (
                  <ol
                    className="nav-leg-instructions"
                    aria-label={`Instructions for ${leg.headline}`}
                  >
                    {leg.stepIndices.slice(1).map((stepIndex) => {
                      const step = steps[stepIndex];
                      return (
                        <li
                          key={stepIndex}
                          className={stepIndex === currentStepIndex ? 'is-current' : undefined}
                          aria-current={stepIndex === currentStepIndex ? 'step' : undefined}
                        >
                          <span>{step.instruction}</span>
                          {step.distance > 0 && <small>{formatDistance(step.distance)}</small>}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {!isArrived && (
        <div className="nav-leg-controls">
          <button
            className="nav-leg-step"
            onClick={actions.prevStep}
            disabled={currentStepIndex <= 0}
            aria-label="Previous instruction"
            id="btn-prev-step"
          >
            <ChevronLeft size={16} strokeWidth={2} />
            Preview back
          </button>
          <button
            className="nav-leg-step"
            onClick={actions.nextStep}
            disabled={currentStepIndex >= steps.length - 1}
            aria-label="Next instruction"
            id="btn-next-step"
          >
            Preview next
            <ChevronRight size={16} strokeWidth={2} />
          </button>
        </div>
      )}
      {!isArrived && currentStepIndex === steps.length - 1 && (
        <button type="button" className="journey-arrival-button" onClick={actions.confirmArrival}>
          I’m at my destination
        </button>
      )}
      {isArrived && (
        <button
          type="button"
          className="journey-arrival-button"
          onClick={clearRouteAndReturnToSearch}
        >
          Done
        </button>
      )}
    </div>
  );
}
