import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useNavigation } from '../context/NavigationContext.jsx';
import { VISITOR_VIEW, visitorViewFor } from '../context/visitorView.ts';
import CameraPreview from './CameraPreview.jsx';
import CheckInToast from './CheckInToast.tsx';
import Header from './Header.jsx';
import LocationPicker from './LocationPicker.jsx';
import NavigationPanel from './NavigationPanel.jsx';
import POICard from './POICard.jsx';
import SearchPanel from './SearchPanel.jsx';
import StatusBar from './StatusBar.jsx';
import WelcomeScreen from './WelcomeScreen.jsx';

const VisitorMap = lazy(() => import('./VisitorMap.tsx'));

export default function VisitorApp() {
  const {
    state,
    onboardingComplete,
    completeOnboarding,
    showLocationPicker,
    setShowLocationPicker,
  } = useNavigation();
  const previousOnboardingCompleteRef = useRef(onboardingComplete);
  // Camera presentation survives a camera-preview visit, never a venue change.
  const mapViewMemory = useRef(null);
  const [expandedRoute, setExpandedRoute] = useState(null);
  const [mapRecoveryTarget, setMapRecoveryTarget] = useState(null);
  const mapExpanded = state.route?.found === true && expandedRoute === state.route;

  useEffect(() => {
    const previous = previousOnboardingCompleteRef.current;
    previousOnboardingCompleteRef.current = onboardingComplete;
    if (previous === onboardingComplete) return;

    // Both shells replace the focused control that initiated the transition.
    // A route path later focuses guidance; otherwise the map's primary action
    // is the useful successor. Returning to Welcome focuses its opening title.
    const targetId = onboardingComplete ? 'btn-search-open' : 'welcome-step-heading';
    document.getElementById(targetId)?.focus({ preventScroll: true });
  }, [onboardingComplete]);

  /*
   * The header's height is a layout fact other fixed elements need, and it is
   * not a constant: the control row wraps at narrow widths and the venue name
   * is as tall as the venue names it is given. The check-in toast used to
   * clear it with a hard-coded 74px, which stopped clearing it the moment the
   * header grew, and the toast then sat on top of the routing control and
   * swallowed its clicks. Measured and published instead of assumed.
   */
  useEffect(() => {
    const header = document.getElementById('app-header');
    if (header === null) return undefined;
    const publish = () => {
      const { height } = header.getBoundingClientRect();
      document.documentElement.style.setProperty('--visitor-header-height', `${height}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  if (!onboardingComplete) {
    return <WelcomeScreen onComplete={completeOnboarding} />;
  }

  return (
    <div className="visitor-shell">
      <Header />
      <CheckInToast />
      <main className="main-content visitor-map-stage" id="main-content">
        {visitorViewFor(state.activeView) === VISITOR_VIEW.MAP && (
          <>
            <Suspense fallback={<div className="map-loading">Loading the venue model…</div>}>
              <VisitorMap
                key={state.venueKey}
                viewMemory={mapViewMemory}
                recoveryTarget={mapExpanded ? null : mapRecoveryTarget}
              />
            </Suspense>
            <SearchPanel />
            <POICard />
            <div className="visitor-directions-layer" hidden={mapExpanded}>
              <NavigationPanel
                mapRecoveryRef={setMapRecoveryTarget}
                onExpandMap={() => {
                  setExpandedRoute(state.route);
                  window.requestAnimationFrame(() =>
                    document.getElementById('btn-show-directions')?.focus(),
                  );
                }}
              />
            </div>
            {mapExpanded && (
              <button
                id="btn-show-directions"
                className="visitor-map-return"
                type="button"
                onClick={() => {
                  setExpandedRoute(null);
                  window.requestAnimationFrame(() => document.getElementById('nav-panel')?.focus());
                }}
              >
                Show directions
              </button>
            )}
          </>
        )}
        <CameraPreview />
      </main>
      <StatusBar />
      <LocationPicker isOpen={showLocationPicker} onClose={() => setShowLocationPicker(false)} />
    </div>
  );
}
