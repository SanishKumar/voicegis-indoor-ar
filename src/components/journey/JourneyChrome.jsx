import { useEffect, useRef, useState } from 'react';
import {
  Accessibility,
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Loader2,
  Pause,
  Play,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useNavigation, NAV_STATUS } from '../../context/NavigationContext.jsx';
import { startPointLabel } from '../../capture/startLabel.ts';
import { guidanceAt, positionAt, trackForRoute } from '../../navigation/routeProgress';
import { bannerCopy, formatMeters, formatMinutes, stepSummary } from './guidanceCopy';
import ManeuverIcon from './ManeuverIcon.jsx';
import { speechAvailable, useSpokenGuidance } from './useSpokenGuidance.js';
import './journey.css';

/**
 * Everything on screen while a route exists: an instruction banner across the
 * top and a trip sheet across the bottom (a side panel on a wide screen).
 *
 * This replaced a single directions panel that tried to be all of it at once.
 * On a phone it covered 43% of the screen, left the map 29%, and framed the
 * route behind itself. Here the banner holds the one thing to do next, the
 * sheet holds the trip, the full step list waits behind one tap, and both
 * panels mark themselves as map insets so the camera keeps the route in the
 * space between them.
 */
export default function JourneyChrome({ walkthrough, onRecoverySlot }) {
  const {
    state,
    actions,
    venue,
    checkIn,
    accessibleRouting,
    toggleAccessibleRouting,
    setShowLocationPicker,
  } = useNavigation();
  const { route, navStatus, destinationNodeId, progressMeters } = state;
  const [stepsOpen, setStepsOpen] = useState(false);
  const [voice, setVoice] = useState(false);
  const regionRef = useRef(null);
  const activeStepRef = useRef(null);

  const destination = venue.getNodeById(destinationNodeId);
  const destinationName = destination?.poi?.name || 'destination';
  const floorName = (floorId) => venue.getFloorById(floorId)?.name;
  const found = route?.found === true;
  const track = found ? trackForRoute(route) : null;
  const guidance = track ? guidanceAt(track, progressMeters) : null;
  const riding = track ? positionAt(track, progressMeters).vertical : false;
  const copy = found
    ? bannerCopy(route.steps, track, guidance, progressMeters, floorName, riding)
    : null;
  const arrived = navStatus === NAV_STATUS.ARRIVED;
  useSpokenGuidance(copy, voice && navStatus === NAV_STATUS.NAVIGATING);

  // Route creation replaces the control that launched it. Focus the new
  // calculation or guidance region once, rather than dropping the visitor on
  // <body> or stealing focus on every instruction change.
  useEffect(() => {
    if (navStatus !== NAV_STATUS.ROUTING && !route) return;
    regionRef.current?.focus({ preventScroll: true });
  }, [navStatus, route]);

  // Keep the step being walked in view inside an open list.
  useEffect(() => {
    if (stepsOpen) activeStepRef.current?.scrollIntoView({ block: 'nearest' });
  }, [stepsOpen, guidance?.nextIndex]);

  const endRoute = () => {
    walkthrough.pause();
    actions.clearRoute();
    // Clearing guidance renders the map's search trigger again; restore focus
    // there only for this explicit dismissal.
    window.setTimeout(() => {
      document.getElementById('btn-search-open')?.focus({ preventScroll: true });
    }, 0);
  };

  if (navStatus === NAV_STATUS.ROUTING && !route) {
    return (
      <div className="jr" data-journey="pending" data-map-inset="">
        <section className="jr-banner" data-map-inset="" aria-hidden="true">
          <span className="jr-banner-icon">
            <Loader2 size={26} className="jr-spin" />
          </span>
          <div className="jr-banner-copy">
            <p className="jr-banner-lead">Finding a route</p>
            <p className="jr-banner-text">{destinationName}</p>
          </div>
        </section>
        <section
          ref={regionRef}
          className="jr-sheet"
          data-map-inset=""
          id="route-pending-panel"
          role="status"
          aria-label={`Calculating route to ${destinationName}`}
          aria-live="polite"
          tabIndex={-1}
        >
          <div className="map-recovery-slot" ref={onRecoverySlot} />
          <div className="jr-trip">
            <div className="jr-trip-main">
              <p className="jr-trip-title">Checking the paths to {destinationName}…</p>
            </div>
            <button type="button" className="jr-pill" onClick={endRoute}>
              <X size={16} aria-hidden="true" /> Cancel
            </button>
          </div>
        </section>
      </div>
    );
  }

  if (!route) return null;

  if (!found) {
    const closure =
      route.receipt?.profile === 'wheelchair' && route.receipt?.excludedEdges.closed > 0;
    return (
      <div className="jr" data-journey="failed" data-map-inset="">
        <section className="jr-banner is-problem" data-map-inset="" aria-hidden="true">
          <span className="jr-banner-icon">
            <AlertTriangle size={26} />
          </span>
          <div className="jr-banner-copy">
            <p className="jr-banner-lead">{closure ? 'No step-free route' : 'No route'}</p>
            <p className="jr-banner-text">{destinationName}</p>
          </div>
        </section>
        <section
          ref={regionRef}
          className="jr-sheet"
          data-map-inset=""
          id="route-failure-panel"
          role="alert"
          tabIndex={-1}
        >
          <div className="map-recovery-slot" ref={onRecoverySlot} />
          <p className="jr-trip-title">No compliant route</p>
          <p className="jr-note">
            {closure
              ? 'No step-free route is available under the active operational closures.'
              : route.error}
          </p>
          <div className="jr-actions">
            {closure && (
              <button type="button" className="jr-pill" onClick={toggleAccessibleRouting}>
                Try the fastest route
              </button>
            )}
            <button type="button" className="jr-pill" onClick={endRoute}>
              <X size={16} aria-hidden="true" /> Dismiss
            </button>
          </div>
        </section>
      </div>
    );
  }

  const steps = route.steps;
  const total = track.length;
  const startNode = venue.getNodeById(state.startNodeId);
  const locationLabel = startPointLabel(
    startNode,
    checkIn,
    {
      space: (id) => venue.getSpaceById(id)?.name ?? null,
      floor: (id) => venue.getFloorById(id)?.name ?? null,
    },
    'Choose a starting point',
  );
  const basis =
    state.locationBasis === 'qr'
      ? 'Last check-in'
      : state.locationBasis === 'selected'
        ? 'Selected start'
        : 'Default start';
  const connectorReceipt = route.receipt?.selectedConnectors?.[0];
  const connector = connectorReceipt
    ? venue.buildingPackage.verticalConnectors.find(
        (candidate) => candidate.id === connectorReceipt.sourceId,
      )
    : null;
  const shortFloor = (floorId) => {
    const floor = venue.getFloorById(String(floorId));
    return floor?.level === 0 ? 'G' : `L${floor?.level ?? floorId}`;
  };
  const routeProfile =
    route.receipt?.profile === 'wheelchair' ? 'Step-free route' : 'Fastest available route';
  const via = connectorReceipt
    ? `${shortFloor(connectorReceipt.fromFloorId)} → ${connector?.name ?? connectorReceipt.sourceId} → ${shortFloor(connectorReceipt.toFloorId)}`
    : `${shortFloor(destination?.floor)} · same floor`;
  const destinationFloor = destination ? floorName(String(destination.floor)) : undefined;
  const atEnd = guidance.atEnd;
  const status = arrived
    ? 'Arrived'
    : walkthrough.playing
      ? 'Walk-through'
      : progressMeters > 0
        ? 'Preview'
        : 'Overview';

  const stepTo = (move) => {
    walkthrough.pause();
    move();
  };

  return (
    <div
      className={`jr${stepsOpen ? ' has-steps' : ''}`}
      data-journey={arrived ? 'arrived' : 'guiding'}
      data-map-inset=""
    >
      <section
        className={`jr-banner${atEnd || arrived ? ' is-arriving' : ''}`}
        data-map-inset=""
        aria-label="Next step"
      >
        <span className="jr-banner-icon">
          {arrived ? <Check size={30} strokeWidth={2.5} /> : <ManeuverIcon type={copy.step.type} />}
        </span>
        <div className="jr-banner-copy" aria-live="polite">
          <p className="jr-banner-lead">
            {arrived ? 'You’re here' : copy.lead}
            <span className="jr-banner-status" title={statusExplanation(status)}>
              {status}
            </span>
          </p>
          <strong className="jr-banner-text">{arrived ? destinationName : copy.text}</strong>
          {arrived ? (
            <p className="jr-banner-then jr-arrived">
              Arrival confirmed by you at {destinationName}.
            </p>
          ) : (
            copy.then && <p className="jr-banner-then">{copy.then}</p>
          )}
        </div>
        {speechAvailable() && (
          <button
            type="button"
            className="jr-banner-voice"
            aria-pressed={voice}
            aria-label={voice ? 'Mute spoken directions' : 'Speak directions aloud'}
            onClick={() => setVoice((on) => !on)}
          >
            {voice ? <Volume2 size={20} /> : <VolumeX size={20} />}
          </button>
        )}
      </section>

      <section
        ref={regionRef}
        className="jr-sheet"
        data-map-inset=""
        id="nav-panel"
        role="region"
        aria-label={`Directions to ${destinationName}`}
        data-step-index={state.previewStepIndex}
        data-step-count={steps.length}
        tabIndex={-1}
      >
        <div className="map-recovery-slot" ref={onRecoverySlot} />
        <div className="jr-venue">{venue.config.name}</div>

        <div className="jr-trip">
          <div className="jr-trip-main">
            <p className="jr-trip-title">
              <span className="jr-trip-time">
                {formatMinutes(total, venue.config.walkSpeedMps)} · {formatMeters(total)}
              </span>
            </p>
            <p className="jr-trip-to">
              to <strong>{destinationName}</strong>
              {destinationFloor && <span> · {destinationFloor}</span>}
            </p>
          </div>
          <button
            type="button"
            className="jr-icon-button"
            id="btn-cancel-nav"
            aria-label="End route"
            title="End route"
            onClick={endRoute}
          >
            <X size={20} />
          </button>
        </div>

        <div className="jr-meta">
          <div className="jr-meta-copy">
            <p className="jr-via" aria-label={routeProfile}>
              <span>{routeProfile === 'Step-free route' ? 'Step-free' : 'Fastest'}</span>
              <span aria-hidden="true">·</span>
              <strong>{via}</strong>
            </p>
            <p className="jr-from" aria-label="Planning location">
              <span>{basis}</span>
              <span aria-hidden="true">·</span>
              <strong>{locationLabel}</strong>
              <button
                type="button"
                className="jr-link"
                aria-label={`Change start location. Current: ${locationLabel}`}
                onClick={() => setShowLocationPicker(true)}
              >
                Change
              </button>
            </p>
          </div>
          <button
            type="button"
            className={`jr-chip${accessibleRouting ? ' is-on' : ''}`}
            aria-label={
              accessibleRouting
                ? 'Use fastest available routing'
                : 'Use step-free accessible routing'
            }
            aria-pressed={accessibleRouting}
            title="Switch between fastest and step-free routing"
            onClick={toggleAccessibleRouting}
          >
            <Accessibility size={16} aria-hidden="true" />
            Step-free
          </button>
        </div>

        <div className="jr-actions">
          {arrived ? (
            <button type="button" className="jr-primary" onClick={endRoute}>
              Done
            </button>
          ) : atEnd ? (
            <button type="button" className="jr-primary" onClick={actions.confirmArrival}>
              <Check size={18} aria-hidden="true" /> I’m at my destination
            </button>
          ) : (
            <button
              type="button"
              className="jr-primary"
              aria-pressed={walkthrough.playing}
              onClick={walkthrough.toggle}
            >
              {walkthrough.playing ? (
                <Pause size={18} aria-hidden="true" />
              ) : (
                <Play size={18} aria-hidden="true" />
              )}
              {walkthrough.playing
                ? 'Pause'
                : progressMeters > 0
                  ? 'Continue walk-through'
                  : 'Walk through route'}
            </button>
          )}
          {!arrived && (
            <>
              <button
                type="button"
                className="jr-icon-button"
                id="btn-prev-step"
                aria-label="Previous instruction"
                disabled={state.previewStepIndex <= 0 && progressMeters <= 0}
                onClick={() => stepTo(actions.prevStep)}
              >
                <ChevronLeft size={20} />
              </button>
              <button
                type="button"
                className="jr-icon-button"
                id="btn-next-step"
                aria-label="Next instruction"
                disabled={atEnd}
                onClick={() => stepTo(actions.nextStep)}
              >
                <ChevronRight size={20} />
              </button>
            </>
          )}
          <button
            type="button"
            className="jr-icon-button jr-steps-toggle"
            aria-expanded={stepsOpen}
            aria-controls="nav-steps-list"
            aria-label={stepsOpen ? 'Hide all steps' : `Show all ${steps.length} steps`}
            onClick={() => setStepsOpen((open) => !open)}
          >
            {stepsOpen ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
          </button>
        </div>

        <div className="jr-steps" id="nav-steps-list" hidden={!stepsOpen}>
          <p className="jr-note">
            Your position isn’t tracked yet. Guidance moves when you step through it or play the
            walk-through; scan a check-in code to update where you are.
          </p>
          <ol className="jr-step-list">
            {steps.map((step, index) => {
              const done = guidance.stepIndex >= index && index !== steps.length - 1;
              const next = !arrived && index === guidance.nextIndex;
              return (
                <li
                  key={`${step.nodeId}-${index}`}
                  ref={next ? activeStepRef : undefined}
                  className={`jr-step${done ? ' is-done' : ''}${next ? ' is-next' : ''}`}
                  aria-current={next ? 'step' : undefined}
                >
                  <button
                    type="button"
                    onClick={() => stepTo(() => actions.previewStep(index))}
                    aria-label={`Go to step ${index + 1}: ${step.instruction}`}
                  >
                    <span className="jr-step-icon">
                      <ManeuverIcon type={step.type} size={20} />
                    </span>
                    <span className="jr-step-copy">
                      <span className="jr-step-text">{step.instruction}</span>
                      <small>{stepSummary(step, floorName)}</small>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </section>
    </div>
  );
}

function statusExplanation(status) {
  switch (status) {
    case 'Walk-through':
      return 'Playing the route at three times walking pace. Your position is not being tracked.';
    case 'Preview':
      return 'Showing a point on the route. Your position is not being tracked.';
    case 'Overview':
      return 'The whole route. Play the walk-through or step through it.';
    default:
      return 'You confirmed your arrival.';
  }
}
