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
    (payload) => {
      const result = actions.checkInWithPayload(payload);
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

  return (
    <div className="wf-screen">
      <div className="wf-stage" aria-hidden="true" />

      <div className="wf-content">
        {step === STEP.DESTINATION && (
          <section className="wf-step" aria-labelledby="welcome-step-heading">
            <p className="wf-eyebrow">{venue.buildingPackage.building.name}</p>
            <h2 ref={stepHeadingRef} className="wf-title" id="welcome-step-heading" tabIndex={-1}>
              Where are you going?
            </h2>
            <p className="wf-sub">Search, or pick from the list.</p>

            <div className="wf-field">
              <Search size={15} strokeWidth={1.25} aria-hidden="true" />
              <input
                type="text"
                placeholder="Search rooms, clinics and services"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label="Search destination rooms"
              />
            </div>

            <p className="wf-label">{query ? 'Results' : 'Destinations'}</p>
            {suggestions.length > 0 ? (
              <ul className="wf-list">
                {suggestions.map(({ node }) => (
                  <li key={node.id}>
                    <button
                      type="button"
                      className="wf-row"
                      aria-label={`${node.poi.name}, ${floorNameFor(node)}`}
                      onClick={() => chooseDestination(node)}
                    >
                      <span className="wf-row-text">
                        <span className="wf-row-name">{node.poi.name}</span>
                        <span className="wf-row-meta">{floorNameFor(node)}</span>
                      </span>
                      <ChevronRight size={15} strokeWidth={1.25} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="wf-empty">Nothing here matches that. Try a shorter word.</p>
            )}

            <button type="button" className="wf-text-action" onClick={onComplete}>
              Browse the map instead
            </button>
          </section>
        )}

        {step === STEP.POSITION && (
          <section className="wf-step" aria-labelledby="welcome-step-heading">
            <p className="wf-eyebrow">Going to</p>
            <p className="wf-chip">{destination?.name}</p>
            <h2 ref={stepHeadingRef} className="wf-title" id="welcome-step-heading" tabIndex={-1}>
              Now, where are you?
            </h2>
            <p className="wf-sub">A code gives your exact spot. It is the accurate way.</p>

            <button
              type="button"
              className="wf-primary"
              onClick={() => {
                setScanProblem(null);
                setScanning(true);
              }}
            >
              <QrCode size={16} strokeWidth={1.25} aria-hidden="true" />
              Scan a check-in code
            </button>

            {scanning && (
              <QrCheckIn
                onPayload={handleScannedPayload}
                onClose={() => setScanning(false)}
                hint={scanProblem}
              />
            )}

            <p className="wf-label">Or start from a landmark</p>
            <ul className="wf-list">
              {landmarks.map((node) => (
                <li key={node.id}>
                  <button
                    type="button"
                    className="wf-row"
                    aria-label={`Start from ${node.poi.name}, ${floorNameFor(node)}`}
                    onClick={() => startFrom(node.id)}
                  >
                    <span className="wf-row-text">
                      <span className="wf-row-name">{node.poi.name}</span>
                      <span className="wf-row-meta">{floorNameFor(node)}</span>
                    </span>
                    <ChevronRight size={15} strokeWidth={1.25} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>

            <button
              type="button"
              className="wf-secondary"
              onClick={() => setStep(STEP.DESTINATION)}
            >
              Back
            </button>
          </section>
        )}
      </div>
    </div>
  );
}
