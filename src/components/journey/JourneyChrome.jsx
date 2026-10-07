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
  LocateFixed,
  Pause,
  Play,
  ScanLine,
  Square,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useNavigation, NAV_STATUS } from '../../context/NavigationContext.jsx';
import { startPointLabel } from '../../capture/startLabel.ts';
import { sharedOrientation } from '../../ar/sharedOrientation';
import { operationalProblem } from '../../navigation/operationalLease';
import { ROUTE_CLEARANCE_MESSAGE } from '../../engine/routeClearance';
import { guidanceAt, positionAt, trackForRoute } from '../../navigation/routeProgress';
import {
  bannerCopy,
  formatMeters,
  formatMinutes,
  stepSummary,
  withArrivalState,
} from './guidanceCopy';
import ManeuverIcon from './ManeuverIcon.jsx';
import { speechAvailable } from './useSpokenGuidance.js';
import { useJourneyLayout } from './useJourneyLayout.js';
import './journey.css';
import MobilePanelHandle from '../MobilePanelHandle';
import { useMobilePanel } from '../useMobilePanel';

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
 *
 * @param {object} props
 * @param {{ pause: () => void, toggle?: () => void, playing?: boolean }} props.walkthrough
 * @param {Pick<import('./useLiveTracking').LiveTracking, 'status' | 'snapshot' | 'start' | 'stop' | 'confirmFloor' | 'plausible'> | null} [props.tracking]
 * @param {boolean} [props.voice]
 * @param {((enabled: boolean) => void) | null} [props.onVoice]
 * @param {(element: HTMLDivElement | null) => void} [props.onRecoverySlot]
 */
export default function JourneyChrome({
  walkthrough,
  tracking = null,
  voice = false,
  onVoice = null,
  onRecoverySlot = undefined,
}) {
  const {
    state,
    actions,
    venue,
    checkIn,
    accessibleRouting,
    toggleAccessibleRouting,
    setShowLocationPicker,
    operationalFreshness,
  } = useNavigation();
  const { route, navStatus, destinationNodeId, progressMeters } = state;
  const panel = useMobilePanel(destinationNodeId);
  const [stepsOpen, setStepsOpen] = useState(false);
  const [offline, setOffline] = useState(() => navigator.onLine === false);
  const regionRef = useRef(null);
  const activeStepRef = useRef(null);

  const destination = venue.getNodeById(destinationNodeId);
  const destinationName = destination?.poi?.name || 'destination';
  const floorName = (floorId) => venue.getFloorById(floorId)?.name;
  const found = route?.found === true;
  const track = found ? trackForRoute(route) : null;
  const guidance = track ? guidanceAt(track, progressMeters) : null;
  const riding = track ? positionAt(track, progressMeters).vertical : false;
  const arrived = navStatus === NAV_STATUS.ARRIVED;
  const copy = found
    ? withArrivalState(
        bannerCopy(route.steps, track, guidance, progressMeters, floorName, riding),
        destinationName,
        {
          confirmed: arrived,
          nearDestination: tracking?.status === 'on' && tracking?.snapshot?.reason === 'arrived',
          atEnd: guidance.atEnd,
        },
      )
    : null;
  useJourneyLayout(
    regionRef,
    navStatus,
    route,
    arrived || (tracking?.status === 'on' && tracking?.snapshot?.reason === 'arrived')
      ? destinationName
      : copy?.text,
  );

  // Route creation replaces the control that launched it. Focus the new
  // calculation or guidance region once, rather than dropping the visitor on
  // <body> or stealing focus on every instruction change.
  useEffect(() => {
    if (navStatus !== NAV_STATUS.ROUTING && navStatus !== NAV_STATUS.PAUSED && !route) return;
    regionRef.current?.focus({ preventScroll: true });
  }, [navStatus, route]);

  useEffect(() => {
    const update = () => setOffline(navigator.onLine === false);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  // Keep the step being walked in view inside an open list.
  useEffect(() => {
    if (stepsOpen) activeStepRef.current?.scrollIntoView({ block: 'nearest' });
  }, [stepsOpen, guidance?.nextIndex]);

  const endRoute = () => {
    walkthrough.pause();
    tracking?.stop();
    actions.clearRoute();
    // Clearing guidance renders the map's search trigger again; restore focus
    // there only for this explicit dismissal.
    window.setTimeout(() => {
      document.getElementById('btn-search-open')?.focus();
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
          data-panel-collapsed={panel.collapsed}
          role="status"
          aria-label={`Calculating route to ${destinationName}`}
          aria-live="polite"
          tabIndex={-1}
        >
          <div className="map-recovery-slot" ref={onRecoverySlot} />
          <MobilePanelHandle panel={panel} label="route details" controls="route-pending-details" />
          <p id="route-pending-details" className="jr-note mobile-panel-details">
            Checking the venue paths.
          </p>
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

  if (navStatus === NAV_STATUS.PAUSED) {
    const available = operationalFreshness?.status === 'current';
    const reason = available
      ? 'location-required'
      : (operationalFreshness?.reason ?? state.policyPause?.reason);
    return (
      <div className="jr" data-journey="policy-paused" data-map-inset="">
        <section className="jr-banner is-problem" data-map-inset="" aria-hidden="true">
          <span className="jr-banner-icon">
            <AlertTriangle size={26} />
          </span>
          <div className="jr-banner-copy">
            <p className="jr-banner-lead">Directions paused</p>
            <p className="jr-banner-text">{destinationName}</p>
          </div>
        </section>
        <section
          ref={regionRef}
          className="jr-sheet"
          data-map-inset=""
          id="route-policy-panel"
          data-panel-collapsed={panel.collapsed}
          role="alert"
          aria-label="Directions paused"
          tabIndex={-1}
        >
          <div className="map-recovery-slot" ref={onRecoverySlot} />
          <MobilePanelHandle panel={panel} label="route details" controls="route-policy-details" />
          <p className="jr-trip-title mobile-panel-details">
            Your trip to {destinationName} is saved
          </p>
          <p className="jr-note mobile-panel-details" id="route-policy-details">
            {accessibleRouting ? 'Step-free route' : 'Fastest available route'}
          </p>
          <p className="jr-note">{operationalProblem(reason, offline)}</p>
          {!available && (
            <p className="jr-note">
              Scanning a code confirms location only; it cannot refresh closure information. Ask
              venue staff for assistance.
            </p>
          )}
          <div className="jr-actions">
            {available && (
              <>
                <button
                  type="button"
                  className="jr-pill"
                  onClick={() => {
                    void sharedOrientation.request();
                    setShowLocationPicker('scan');
                  }}
                >
                  <ScanLine size={16} aria-hidden="true" /> Scan a code
                </button>
                <button
                  type="button"
                  className="jr-pill"
                  onClick={() => setShowLocationPicker(true)}
                >
                  <LocateFixed size={16} aria-hidden="true" /> Choose current location
                </button>
              </>
            )}
            <button type="button" className="jr-pill" onClick={endRoute}>
              <X size={16} aria-hidden="true" /> End route
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
          data-panel-collapsed={panel.collapsed}
          role="alert"
          tabIndex={-1}
        >
          <div className="map-recovery-slot" ref={onRecoverySlot} />
          <MobilePanelHandle panel={panel} label="route details" controls="route-failure-details" />
          <p className="jr-trip-title mobile-panel-details" id="route-failure-details">
            No compliant route
          </p>
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
  const destinationLevel = destination
    ? venue.getFloorById(String(destination.floor))?.level
    : undefined;
  // Where there are several buildings, which of them the trip ends in is the
  // first thing to know; "Ground floor" is true of all of them.
  const destinationFloorLabel = venue.buildingPackage?.site
    ? (destination?.poi?.where ?? destinationFloor)
    : destinationLevel === 0
      ? 'Ground floor'
      : Number.isFinite(destinationLevel)
        ? `Level ${destinationLevel}`
        : destinationFloor;
  const destinationSpace =
    destination?.poi?.spaceName ??
    (destination?.poi?.spaceId ? venue.getSpaceById?.(destination.poi.spaceId)?.name : undefined);
  const destinationLocation = [
    ...new Set([destinationFloor, destinationSpace].filter(Boolean)),
  ].join(' · ');
  const description = destination?.poi?.description?.trim();
  // Compiled venues currently derive description from the space and floor.
  // Show authored description only when it adds something, not the same two
  // labels in reverse order. Nothing here invents a door, entrance or contact.
  const destinationDescription =
    description &&
    ![
      destinationLocation,
      [destinationSpace, destinationFloor].filter(Boolean).join(' · '),
    ].includes(description)
      ? description
      : null;
  const atEnd = guidance.atEnd;
  const live = tracking?.status === 'on';
  /*
   * A position the tracker has lost stays lost whatever supplies movement
   * next. Leaving AR, or motion access being refused, stops the live source;
   * it must not replace "scan a code" with a note about sensors.
   */
  const lost =
    !live &&
    tracking != null &&
    tracking.snapshot?.tier === 'frozen' &&
    ['off-route', 'ambiguous-position', 'uncertain'].includes(tracking.snapshot.reason);
  const shown = live || lost;
  const snap = shown ? tracking.snapshot : null;
  const liveState = shown ? describeTracking(snap, floorName) : null;
  const status = arrived
    ? 'Arrived'
    : shown
      ? liveState.label
      : walkthrough.playing
        ? 'Walk-through'
        : progressMeters > 0
          ? 'Preview'
          : 'Overview';
  const statusTitle = shown ? liveState.detail : statusExplanation(status);
  const statusClass = shown ? ` is-${snap?.tier ?? 'frozen'}` : '';

  /*
   * What the primary action should be depends on what the phone can do and
   * what it knows. A phone with sensors and a known start tracks the walk;
   * one with sensors and no known start asks for a scan first; anything else
   * gets the walk-through, which is also always available as a preview.
   */
  const locationBasis = state.locationBasis;
  const sensorsOut =
    tracking?.status === 'unsupported' ||
    tracking?.status === 'insecure' ||
    tracking?.status === 'requesting';
  const canTrack =
    Boolean(tracking?.plausible) && !live && !sensorsOut && locationBasis !== 'default';
  const needsScanToTrack =
    Boolean(tracking?.plausible) && !live && !sensorsOut && locationBasis === 'default';
  const trackLabel =
    tracking?.status === 'hidden'
      ? 'Resume tracking'
      : tracking?.status === 'denied' || tracking?.status === 'error'
        ? 'Try tracking again'
        : 'Track my walk';
  const scanFixes =
    shown &&
    [
      'no-anchor',
      'uncertain',
      'off-route',
      'ambiguous-position',
      'wrong-way',
      'floor-change',
      'no-heading',
      'pose-jump',
    ].includes(snap?.reason);
  const liveArrived = live && snap?.reason === 'arrived';
  const liveFloorChange = live && snap?.reason === 'floor-change' && snap.pendingFloor;

  const stepTo = (move) => {
    walkthrough.pause();
    // The expanded step list remains inspectable during a walk. Entering
    // preview there must release live progress just like the walk-through.
    tracking?.stop();
    move();
  };
  const startTracking = () => {
    walkthrough.pause();
    tracking.start();
  };
  const openScanner = () => {
    // Scanning a sign is what tells the app which way the visitor faces.
    sharedOrientation.request();
    setShowLocationPicker('scan');
  };

  return (
    <div
      className={`jr${stepsOpen ? ' has-steps' : ''}`}
      data-journey={arrived ? 'arrived' : 'guiding'}
      data-tracking={tracking?.status ?? 'off'}
      data-tier={snap?.tier ?? ''}
      data-tracking-reason={snap?.reason ?? ''}
      data-map-inset=""
    >
      <section
        className={`jr-banner${atEnd || arrived ? ' is-arriving' : ''}`}
        data-map-inset=""
        aria-label="Next step"
        tabIndex={0}
      >
        <span className="jr-banner-icon">
          {arrived ? <Check size={30} strokeWidth={2.5} /> : <ManeuverIcon type={copy.step.type} />}
        </span>
        <div className="jr-banner-copy" aria-live="polite">
          <p className="jr-banner-lead">
            {copy.lead}
            {status !== copy.lead && (
              <span className={`jr-banner-status${statusClass}`} title={statusTitle}>
                {status}
              </span>
            )}
          </p>
          <strong className="jr-banner-text">{copy.text}</strong>
          {copy.then && (
            <p className={`jr-banner-then${arrived ? ' jr-arrived' : ''}`}>{copy.then}</p>
          )}
        </div>
        {speechAvailable() && (
          <button
            type="button"
            className="jr-banner-voice"
            aria-pressed={voice}
            aria-label={voice ? 'Mute spoken directions' : 'Speak directions aloud'}
            onClick={() => onVoice?.(!voice)}
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
        data-panel-collapsed={panel.collapsed}
        role="region"
        aria-label={`Directions to ${destinationName}`}
        data-step-index={state.previewStepIndex}
        data-step-count={steps.length}
        tabIndex={-1}
      >
        <div className="map-recovery-slot" ref={onRecoverySlot} />
        <MobilePanelHandle
          panel={panel}
          label="route details"
          controls="route-meta nav-steps-list"
        />
        <div className="jr-venue">{venue.config.name}</div>

        {route.displayClearance?.status === 'withheld' && (
          <p className="jr-note" role="status">
            {ROUTE_CLEARANCE_MESSAGE}
          </p>
        )}

        <div className="jr-trip">
          <div className="jr-trip-main">
            <p className="jr-trip-title">
              <span className="jr-trip-time">
                {arrived
                  ? 'Arrival confirmed'
                  : `${formatMinutes(total, venue.config.walkSpeedMps)} · ${formatMeters(total)}`}
              </span>
            </p>
            <p className="jr-trip-to">
              to <strong>{destinationName}</strong>
              {destinationFloorLabel && <span> · {destinationFloorLabel}</span>}
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

        {(destinationLocation || destinationDescription) && (
          <details
            id="route-destination-details"
            className="jr-destination-context mobile-panel-details"
            open={arrived || atEnd || liveArrived}
          >
            <summary>Destination details</summary>
            {destinationLocation && <p className="jr-note">{destinationLocation}</p>}
            {destinationDescription && <p className="jr-note">{destinationDescription}</p>}
          </details>
        )}

        <div className="jr-meta mobile-panel-details" id="route-meta">
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

        {tracking && (tracking.status !== 'off' || lost) && (
          <div
            className="jr-tracking"
            role="status"
            data-tracking-state={shown ? (snap?.tier ?? 'starting') : tracking.status}
          >
            <p>
              <strong>{shown ? liveState.label : haltLabel(tracking.status)}</strong>
              {' · '}
              {shown ? liveState.detail : haltDetail(tracking.status)}
            </p>
            {scanFixes && (
              <button type="button" className="jr-pill" onClick={openScanner}>
                <ScanLine size={16} aria-hidden="true" /> Scan a code
              </button>
            )}
          </div>
        )}

        <div className="jr-actions">
          {arrived ? (
            <button type="button" className="jr-primary" onClick={endRoute}>
              Done
            </button>
          ) : liveFloorChange ? (
            <button type="button" className="jr-primary" onClick={tracking.confirmFloor}>
              <Check size={18} aria-hidden="true" /> I’m on{' '}
              {floorName(snap.pendingFloor.toFloorId) ?? 'the next floor'}
            </button>
          ) : atEnd || liveArrived ? (
            <button type="button" className="jr-primary" onClick={actions.confirmArrival}>
              <Check size={18} aria-hidden="true" /> I’m at my destination
            </button>
          ) : walkthrough.playing ? (
            <button
              type="button"
              className="jr-primary"
              aria-pressed="true"
              onClick={walkthrough.toggle}
            >
              <Pause size={18} aria-hidden="true" /> Pause
            </button>
          ) : live ? (
            <button
              type="button"
              className="jr-primary"
              aria-pressed="true"
              onClick={tracking.stop}
            >
              <Square size={16} aria-hidden="true" /> Stop tracking
            </button>
          ) : canTrack ? (
            <button type="button" className="jr-primary" onClick={startTracking}>
              <LocateFixed size={18} aria-hidden="true" /> {trackLabel}
            </button>
          ) : needsScanToTrack ? (
            <button type="button" className="jr-primary" onClick={openScanner}>
              <ScanLine size={18} aria-hidden="true" /> Scan a code to track
            </button>
          ) : (
            <button
              type="button"
              className="jr-primary"
              aria-pressed={walkthrough.playing}
              onClick={walkthrough.toggle}
            >
              <Play size={18} aria-hidden="true" />
              {progressMeters > 0 ? 'Continue walk-through' : 'Walk through route'}
            </button>
          )}
          {!arrived && !live && (
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
            onClick={() => {
              panel.setCollapsed(false);
              setStepsOpen((open) => !open);
            }}
          >
            {stepsOpen ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
          </button>
        </div>
        <div className="jr-steps mobile-panel-details" id="nav-steps-list" hidden={!stepsOpen}>
          {arrived ? (
            <p className="jr-note">
              Arrival was confirmed by you. These steps are a route preview, not your tracked
              location.
            </p>
          ) : !live ? (
            <p className="jr-note">
              Your position isn’t tracked yet.{' '}
              {!arrived && !walkthrough.playing && (canTrack || needsScanToTrack) ? (
                <>
                  Step through the route, or{' '}
                  <button type="button" className="jr-secondary" onClick={walkthrough.toggle}>
                    {progressMeters > 0
                      ? 'continue the walk-through preview'
                      : 'preview it as a walk-through'}
                  </button>
                  . Scan a check-in code to update where you are.
                </>
              ) : (
                'Guidance moves when you step through it or play the walk-through; scan a check-in code to update where you are.'
              )}
            </p>
          ) : null}
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
                    aria-label={`Preview step ${index + 1}: ${step.instruction}`}
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

/**
 * The tracker's state in the visitor's terms: a short label for the pill and
 * one sentence saying what is happening and what, if anything, would help.
 */
function describeTracking(snap, floorName) {
  if (!snap) return { label: 'Starting', detail: 'Waiting for the phone’s motion sensors.' };
  const caution = snap.tier === 'caution';
  switch (snap.reason) {
    case 'no-anchor':
      return {
        label: 'Scan needed',
        detail: 'Scan a check-in code so tracking has a known starting point.',
      };
    case 'awaiting-departure':
      return {
        label: 'Anchored',
        detail: 'At the check-in point. Set off along the route and the marker will follow.',
      };
    case 'following':
      return { label: 'Tracking', detail: 'Following your steps along the route.' };
    case 'uncertain':
      if (snap.poseGraph === 'unavailable')
        return {
          label: 'Position unverified',
          detail:
            'The venue paths could not be checked. Scan a check-in code to locate yourself again.',
        };
      return caution
        ? { label: 'Uncertain', detail: 'Your position has drifted. Scan the next code to fix it.' }
        : {
            label: 'Scan needed',
            detail: 'Too far since the last code to trust. Scan a code to continue.',
          };
    case 'wrong-way':
      return {
        label: 'Wrong way?',
        detail: 'Your steps head away from the route. Turn around, or scan the nearest code.',
      };
    case 'off-route':
      return caution
        ? {
            label: 'Off route?',
            detail: 'Your steps don’t match the route. Head back to it, or scan the nearest code.',
          }
        : { label: 'Off route', detail: 'Tracking paused. Return to the route and scan a code.' };
    case 'ambiguous-position':
      return {
        label: 'Which corridor?',
        detail:
          'More than one venue path fits your movement. Tracking is paused. Scan a check-in code to locate yourself.',
      };
    case 'no-heading':
      return {
        label: 'No direction',
        detail:
          'Direction is unavailable or its alignment was lost. Scan a sign where you are standing before continuing your walk.',
      };
    case 'pose-jump':
      return {
        label: 'Lost its place',
        detail:
          'The camera jumped rather than moved. Face along the corridor and re-align, or scan a code where you are.',
      };
    case 'floor-change':
      return {
        label: 'Changing floor',
        detail: `Take the lift or stairs to ${floorName(snap.pendingFloor?.toFloorId) ?? 'the next floor'}. Scan the code there, or tap when you arrive.`,
      };
    case 'arrived':
      return {
        label: 'Near destination',
        detail:
          'Tracking places you near the mapped destination. Check the sign before confirming.',
      };
    case 'sensors-silent':
      return { label: 'Paused', detail: 'Motion sensors stopped. Check the phone isn’t locked.' };
    default:
      return {
        label: 'Unavailable',
        detail: 'This phone can’t track your walk. The walk-through and the steps still work.',
      };
  }
}

function haltLabel(status) {
  return (
    {
      requesting: 'Asking for motion access',
      denied: 'Motion access refused',
      unsupported: 'No motion sensors',
      insecure: 'Secure connection needed',
      hidden: 'Tracking paused',
      error: 'Tracking stopped',
    }[status] ?? 'Tracking'
  );
}

function haltDetail(status) {
  return (
    {
      requesting: 'Allow motion and orientation access to track your walk.',
      denied: 'Tracking needs motion access. The walk-through and the steps still work.',
      unsupported: 'This browser offers no motion sensors.',
      insecure: 'Motion sensors are only available over a secure (https) connection.',
      hidden: 'Tracking stops while the app is in the background. Resume when you’re back.',
      error: 'Something went wrong reading the sensors. You can try again.',
    }[status] ?? ''
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
