import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { ChevronRight, QrCode, Search } from 'lucide-react';
import { useNavigation } from '../context/NavigationContext.jsx';
import { searchPOIs } from '../engine/searchIndex.js';
import QrCheckIn from './QrCheckIn.tsx';
import { scanProblemText } from '../capture/scanProblemText.ts';

const STEP = { DESTINATION: 0, POSITION: 1 };

/**
 * Onboarding, asked in the order a visitor can actually answer.
 *
 * This used to run welcome -> location -> destination, which opens by asking
 * "Where are you right now?" - the one question a lost visitor cannot answer,
 * and the reason they opened the app at all. They can always name where they
 * are going, so that is asked first; the position question then arrives with
 * the destination already on screen, which is what makes it worth answering.
 *
 * There is no longer a "Skip". Skipping used to leave the runtime with no start
 * and therefore no route, so it was an exit that led nowhere. Browsing the map
 * without a route is still available, but it is named for what it does.
 *
 * Class names describe the part, not the visual language dressing it. The first
 * styling of this screen was named after its design system, so replacing that
 * system meant editing markup that had not changed - the stylesheet owns the
 * look, and a later change of direction should not reach this file at all.
 */
export default function WelcomeScreen({ onComplete }) {
  const { actions, venue } = useNavigation();
  const [step, setStep] = useState(STEP.DESTINATION);
  const [destination, setDestination] = useState(null);
  const [query, setQuery] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanProblem, setScanProblem] = useState(null);
  const stepHeadingRef = useRef(null);
  const previousStepRef = useRef(step);

  // A step replaces the control that had focus. Without an explicit target the
  // browser falls back to <body>, so the visitor has to rediscover where the
  // flow moved. Focus only transitions after a real step change; the first
  // screen keeps normal document-entry behavior.
  useEffect(() => {
    if (previousStepRef.current === step) return;
    previousStepRef.current = step;
    stepHeadingRef.current?.focus({ preventScroll: true });
  }, [step]);

  const pois = useMemo(() => venue.getPOIs(), [venue]);

  const suggestions = useMemo(() => searchPOIs(pois, query).slice(0, 5), [pois, query]);

  const landmarks = useMemo(() => {
    const preferred = pois
      .filter((node) => node.poi.category === 'entrance' || node.poi.category === 'service')
      .sort(
        (a, b) => Number(b.poi.category === 'entrance') - Number(a.poi.category === 'entrance'),
      );
    return (preferred.length > 0 ? preferred : pois).slice(0, 4);
  }, [pois]);

  const floorNameFor = useCallback((node) => venue.getFloorById(node.floor)?.name ?? '', [venue]);

  const chooseDestination = (node) => {
    setDestination({ id: node.id, name: node.poi.name });
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
        <span className="onboard-row-text">
          <span className="onboard-row-name">{node.poi.name}</span>
          <span className="onboard-row-meta">{floorNameFor(node)}</span>
        </span>
        <ChevronRight size={18} strokeWidth={2} aria-hidden="true" />
      </button>
    </li>
  );

  return (
    <div className="onboard">
      <div className="onboard-canvas" aria-hidden="true" />

      <div className="onboard-content">
        {step === STEP.DESTINATION && (
          <section className="onboard-step" aria-labelledby="welcome-step-heading">
            <p className="onboard-eyebrow">{venue.buildingPackage.building.name}</p>
            <h2
              ref={stepHeadingRef}
              className="onboard-title"
              id="welcome-step-heading"
              tabIndex={-1}
            >
              Where are you <span className="onboard-title-accent">going?</span>
            </h2>
            <p className="onboard-sub">Search, or pick from the list.</p>

            <div className="onboard-field">
              <Search size={18} strokeWidth={2} aria-hidden="true" />
              <input
                type="text"
                placeholder="Search rooms, clinics and services"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label="Search destination rooms"
              />
            </div>

            <p className="onboard-label">{query ? 'Results' : 'Destinations'}</p>
            {suggestions.length > 0 ? (
              <ul className="onboard-list">
                {suggestions.map(({ node }) =>
                  destinationRow(node, `${node.poi.name}, ${floorNameFor(node)}`, () =>
                    chooseDestination(node),
                  ),
                )}
              </ul>
            ) : (
              <p className="onboard-empty">Nothing here matches that. Try a shorter word.</p>
            )}

            <button type="button" className="onboard-ghost" onClick={onComplete}>
              Browse the map instead
              <span className="onboard-ghost-mark" aria-hidden="true" />
            </button>
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
              Now, where <span className="onboard-title-accent">are you?</span>
            </h2>
            <p className="onboard-sub">A code gives your exact spot. It is the accurate way.</p>

            <button
              type="button"
              className="onboard-pill"
              onClick={() => {
                setScanProblem(null);
                setScanning(true);
              }}
            >
              <QrCode size={18} strokeWidth={2} aria-hidden="true" />
              Scan a check-in code
            </button>

            {scanning && (
              <QrCheckIn
                onPayload={handleScannedPayload}
                onClose={() => setScanning(false)}
                hint={scanProblem}
              />
            )}

            <p className="onboard-label">Or start from a landmark</p>
            <ul className="onboard-list">
              {landmarks.map((node) =>
                destinationRow(node, `Start from ${node.poi.name}, ${floorNameFor(node)}`, () =>
                  startFrom(node.id),
                ),
              )}
            </ul>

            <button
              type="button"
              className="onboard-ghost"
              onClick={() => setStep(STEP.DESTINATION)}
            >
              Back
              <span className="onboard-ghost-mark" aria-hidden="true" />
            </button>
          </section>
        )}
      </div>
    </div>
  );
}
