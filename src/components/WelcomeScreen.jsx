import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Map, MapPin, QrCode, Search, X } from 'lucide-react';
import { useNavigation } from '../context/NavigationContext.jsx';
import { useVenue } from '../context/VenueContext.jsx';
import { searchPOIs } from '../engine/searchIndex.js';
import QrCheckIn from './QrCheckIn.tsx';
import { sharedOrientation } from '../ar/sharedOrientation';
import { scanProblemText } from '../capture/scanProblemText.ts';
import PlaceIcon from './PlaceIcon';

const STEP = { DESTINATION: 0, POSITION: 1, PLACE: 2 };
const DESTINATIONS_PER_PAGE = 5;
// A changed venue package gets the plain directory until its illustration is refreshed.
const venueIllustrations = {
  abbedcc0418e2f68ed709648693feee4c4c4a11c9c1ccbe7794919303ac5b177: 'campus',
  '9a9c9d37907c78ec1b72bed95658ec248c43d96a891ae4109ac8eebfad144a13': 'floor',
};

export default function WelcomeScreen({ onComplete }) {
  const { actions, venue, checkIn } = useNavigation();
  const { catalog, activateFromUrl } = useVenue();
  const [placeProblem, setPlaceProblem] = useState(null);
  const [openingPlace, setOpeningPlace] = useState(null);
  const [step, setStep] = useState(STEP.DESTINATION);
  const [destination, setDestination] = useState(null);
  const [query, setQuery] = useState('');
  const [startQuery, setStartQuery] = useState('');
  const [shownCount, setShownCount] = useState(DESTINATIONS_PER_PAGE);
  const [scanning, setScanning] = useState(false);
  const [scanProblem, setScanProblem] = useState(null);
  const stepHeadingRef = useRef(null);
  const previousStepRef = useRef(step);
  const searchRef = useRef(null);
  const startSearchRef = useRef(null);
  const resultsRef = useRef(null);
  const nextResultFocusRef = useRef(null);

  // A step replaces the control that had focus. Without an explicit target the
  // browser falls back to <body>, so the visitor has to rediscover where the
  // flow moved. Focus only transitions after a real step change; the first
  // screen keeps normal document-entry behavior.
  useEffect(() => {
    if (previousStepRef.current === step) return;
    previousStepRef.current = step;
    stepHeadingRef.current?.focus();
  }, [step]);

  const pois = useMemo(() => venue.getPOIs(), [venue]);

  const suggestions = useMemo(
    () => searchPOIs(pois, query, { limit: pois.length }),
    [pois, query],
  );
  const suggestedDestinations = suggestions.slice(0, shownCount);
  const setSearch = (value) => {
    setQuery(value);
    setShownCount(DESTINATIONS_PER_PAGE);
    nextResultFocusRef.current = null;
  };

  useEffect(() => {
    const index = nextResultFocusRef.current;
    if (index === null) return;
    nextResultFocusRef.current = null;
    resultsRef.current?.querySelectorAll('button')[index]?.focus();
  }, [shownCount]);

  const landmarks = useMemo(() => {
    const preferred = pois
      .filter((node) => node.poi.category === 'entrance' || node.poi.category === 'service')
      .sort(
        (a, b) => Number(b.poi.category === 'entrance') - Number(a.poi.category === 'entrance'),
      );
    return (preferred.length > 0 ? preferred : pois).slice(0, 4);
  }, [pois]);
  const starts = useMemo(
    () => startQuery.trim()
      ? searchPOIs(pois, startQuery, { limit: pois.length }).map(({ node }) => node)
      : landmarks,
    [pois, startQuery, landmarks],
  );

  const floorNameFor = useCallback(
    (node) => node.poi?.where ?? venue.getFloorById(node.floor)?.name ?? '',
    [venue],
  );

  // Where a sign already put the visitor, by the name of the place it hangs in.
  const checkedInAt = checkIn
    ? (venue.getSpaceById(checkIn.spaceId)?.name ?? venue.getFloorById(checkIn.floorId)?.name)
    : null;

  const thisPlace = venue.buildingPackage.building.id;
  const otherPlaces = catalog.length > 1;

  /** Opens another published place. The app starts again on its map. */
  const choosePlace = async (entry) => {
    if (entry.id === thisPlace) {
      setStep(STEP.DESTINATION);
      return;
    }
    setPlaceProblem(null);
    setOpeningPlace(entry.id);
    try {
      await activateFromUrl(entry.packageUrl, {
        expectation: { buildingId: entry.id, contentHash: entry.defaultRelease.contentHash },
      });
      // A link that named a place would otherwise bring it back on the next
      // reload, over the one just chosen.
      const url = new URL(window.location.href);
      if (url.searchParams.has('venue')) {
        url.searchParams.delete('venue');
        window.history.replaceState(null, '', url);
      }
    } catch {
      setPlaceProblem(`${entry.name} could not be opened. The map you had is still here.`);
      setOpeningPlace(null);
    }
  };

  const chooseDestination = (node) => {
    if (checkIn) {
      // Both halves are known: the sign gave the start.
      void actions.navigateTo(node.id, checkIn.nodeId);
      onComplete();
      return;
    }
    setDestination({ id: node.id, name: node.poi.name });
    setStartQuery('');
    setStep(STEP.POSITION);
  };

  /** Both halves are known here, so the route is requested in one move. */
  const startFrom = useCallback(
    (startNodeId) => {
      actions.setStart(startNodeId);
      if (destination !== null) void actions.navigateTo(destination.id, startNodeId);
      onComplete();
    },
    [actions, destination, onComplete],
  );

  const handleScannedPayload = useCallback(
    (payload, observation) => {
      const result = actions.checkInWithPayload(payload, observation);
      if (!result.ok) {
        // Reported as refused so the scanner keeps its camera running and the
        // visitor can try another sign.
        setScanProblem(scanProblemText(result.reason));
        return false;
      }
      setScanProblem(null);
      setScanning(false);
      // The check-in has already set the start; only the route is still owed.
      if (destination !== null) void actions.navigateTo(destination.id, result.nodeId);
      onComplete();
      return true;
    },
    [actions, destination, onComplete],
  );

  const destinationRow = (node, label, onClick) => (
    <li key={node.id}>
      <button type="button" className="onboard-row" aria-label={label} onClick={onClick}>
        <span className="onboard-row-icon"><PlaceIcon category={node.poi.category} /></span>
        <span className="onboard-row-text">
          <span className="onboard-row-name">{node.poi.name}</span>
          <span className="onboard-row-meta">{floorNameFor(node)}</span>
        </span>
        <ChevronRight size={18} strokeWidth={2} aria-hidden="true" />
      </button>
    </li>
  );

  return (
    <div
      className="onboard"
      data-illustration={
        step === STEP.DESTINATION
          ? venueIllustrations[venue.buildingPackage.manifest?.contentHash]
          : undefined
      }
    >
      <div className="onboard-canvas" aria-hidden="true" />

      <div className="onboard-content">
        {step === STEP.DESTINATION && (
          <section className="onboard-step" aria-labelledby="welcome-step-heading">
            <div className="onboard-venue">
              <p className="onboard-eyebrow">
                <MapPin size={18} aria-hidden="true" />
                {venue.buildingPackage.building.name}
              </p>
              {otherPlaces && (
                <button
                  type="button"
                  className="onboard-ghost onboard-change"
                  aria-label="Change venue"
                  onClick={() => {
                    setPlaceProblem(null);
                    setStep(STEP.PLACE);
                  }}
                >
                  Change venue
                </button>
              )}
            </div>
            <h2
              ref={stepHeadingRef}
              className="onboard-title"
              id="welcome-step-heading"
              tabIndex={-1}
            >
              Where are you going?
            </h2>
            {checkedInAt && (
              <p className="onboard-sub">Checked in at <strong>{checkedInAt}</strong></p>
            )}

            <div className="onboard-pane">
              <div className="onboard-field">
                <Search size={18} strokeWidth={2} aria-hidden="true" />
                <input
                  ref={searchRef}
                  type="text"
                  placeholder="Search rooms, clinics and services"
                  value={query}
                  onChange={(event) => setSearch(event.target.value)}
                  aria-label="Search destination rooms"
                  autoComplete="off"
                  enterKeyHint="search"
                />
                {query && (
                  <button
                    type="button"
                    className="onboard-clear"
                    aria-label="Clear destination search"
                    onClick={() => {
                      setSearch('');
                      searchRef.current?.focus();
                    }}
                  >
                    <X size={18} aria-hidden="true" />
                  </button>
                )}
              </div>

              <div className="onboard-links">
                <button type="button" className="onboard-ghost onboard-browse" onClick={onComplete}>
                  <Map size={18} aria-hidden="true" />
                  Browse the map instead
                </button>
              </div>
              <p className="onboard-label" aria-live={query.trim() ? 'polite' : undefined}>
                {query.trim() ? `${suggestions.length} matching destinations` : 'Destinations'}
              </p>
              {suggestions.length > 0 ? (
                <ul className="onboard-list" ref={resultsRef}>
                  {suggestedDestinations.map(({ node }) =>
                    destinationRow(node, `${node.poi.name}, ${floorNameFor(node)}`, () =>
                      chooseDestination(node),
                    ),
                  )}
                </ul>
              ) : (
                <p className="onboard-empty">Try a room name, department or service.</p>
              )}

              {suggestions.length > shownCount && (
                <button
                  type="button"
                  className="onboard-ghost"
                  onClick={() => {
                    nextResultFocusRef.current = shownCount;
                    setShownCount(shownCount + DESTINATIONS_PER_PAGE);
                  }}
                >
                  Show more destinations
                </button>
              )}
            </div>
          </section>
        )}

        {step === STEP.PLACE && (
          <section className="onboard-step" aria-labelledby="welcome-step-heading">
            <p className="onboard-eyebrow">Showing</p>
            <p className="onboard-chip">{venue.buildingPackage.building.name}</p>
            <h2
              ref={stepHeadingRef}
              className="onboard-title"
              id="welcome-step-heading"
              tabIndex={-1}
            >
              Which place?
            </h2>
            <p className="onboard-sub">Each place has its own map and its own signs.</p>

            <div className="onboard-pane">
              <p className="onboard-label">Places</p>
              <ul className="onboard-list">
                {catalog.map((entry) => {
                  const { floors, pois } = entry.defaultRelease.summary;
                  const size = `${floors} ${floors === 1 ? 'floor' : 'floors'} · ${pois} places`;
                  const showing = entry.id === thisPlace;
                  return (
                    <li key={entry.id}>
                      <button
                        type="button"
                        className="onboard-row"
                        aria-label={`${entry.name}, ${size}${showing ? ', showing now' : ''}`}
                        aria-current={showing ? 'true' : undefined}
                        disabled={openingPlace !== null}
                        onClick={() => void choosePlace(entry)}
                      >
                        <span className="onboard-row-text">
                          <span className="onboard-row-name">{entry.name}</span>
                          <span className="onboard-row-meta">
                            {showing ? `Showing now · ${size}` : size}
                          </span>
                        </span>
                        <ChevronRight size={18} strokeWidth={2} aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
              {placeProblem && (
                <p className="onboard-empty" role="alert">
                  {placeProblem}
                </p>
              )}

              <button
                type="button"
                className="onboard-ghost"
                onClick={() => setStep(STEP.DESTINATION)}
              >
                <ChevronLeft size={16} aria-hidden="true" />
                Back
              </button>
            </div>
          </section>
        )}

        {step === STEP.POSITION && (
          <section className="onboard-step" aria-labelledby="welcome-step-heading">
            <p className="onboard-eyebrow">Going to</p>
            <p className="onboard-chip">{destination?.name}</p>
            <h2
              ref={stepHeadingRef}
              className="onboard-title"
              id="welcome-step-heading"
              tabIndex={-1}
            >
              Now, where are you?
            </h2>
            <p className="onboard-sub">Scan a nearby sign or look up your starting point.</p>

            <div className="onboard-pane">
              <button
                type="button"
                className="onboard-pill"
                onClick={() => {
                  setScanProblem(null);
                  // Scanning a sign is what tells the app which way the visitor faces.
                  sharedOrientation.request();
                  setScanning(true);
                }}
              >
                <QrCode size={18} strokeWidth={2} aria-hidden="true" />
                Scan a check-in code
              </button>

              <div className="onboard-field">
                <Search size={18} aria-hidden="true" />
                <input
                  ref={startSearchRef}
                  type="text"
                  placeholder="Search starting locations"
                  value={startQuery}
                  onChange={(event) => setStartQuery(event.target.value)}
                  aria-label="Search starting locations"
                  autoComplete="off"
                  enterKeyHint="search"
                />
                {startQuery && (
                  <button type="button" className="onboard-clear" aria-label="Clear starting location search"
                    onClick={() => { setStartQuery(''); startSearchRef.current?.focus(); }}>
                    <X size={18} aria-hidden="true" />
                  </button>
                )}
              </div>
              <p className="onboard-label" aria-live="polite">
                {startQuery.trim() ? `${starts.length} matching locations` : 'Suggested starting points'}
              </p>
              <ul className="onboard-list">
                {starts.map((node) =>
                  destinationRow(node, `Start from ${node.poi.name}, ${floorNameFor(node)}`, () =>
                    startFrom(node.id),
                  ),
                )}
              </ul>
              {starts.length === 0 && <p className="onboard-empty">Try a room, service or entrance.</p>}

              <button
                type="button"
                className="onboard-ghost"
                onClick={() => setStep(STEP.DESTINATION)}
              >
                <ChevronLeft size={16} aria-hidden="true" />
                Back
              </button>
            </div>

            {scanning && (
              <QrCheckIn
                onPayload={handleScannedPayload}
                onClose={() => setScanning(false)}
                hint={scanProblem}
              />
            )}
          </section>
        )}
      </div>
    </div>
  );
}
