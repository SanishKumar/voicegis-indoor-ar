import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useNavigation, NAV_STATUS } from '../context/NavigationContext.jsx';
import { VISITOR_VIEW, visitorViewFor } from '../context/visitorView.ts';
import { trackForRoute } from '../navigation/routeProgress';
import CameraPreview from './CameraPreview.jsx';
import CheckInToast from './CheckInToast.tsx';
import Header from './Header.jsx';
import JourneyChrome from './journey/JourneyChrome.jsx';
import { useLiveTracking } from './journey/useLiveTracking.js';
import { useWalkthrough } from './journey/useWalkthrough.js';
import LocationPicker from './LocationPicker.jsx';
import POICard from './POICard.jsx';
import SearchPanel from './SearchPanel.jsx';
import StatusBar from './StatusBar.jsx';
import WelcomeScreen from './WelcomeScreen.jsx';

const VisitorMap = lazy(() => import('./VisitorMap.tsx'));

export default function VisitorApp() {
  const {
    state,
    actions,
    venue,
    checkIn,
    onboardingComplete,
    completeOnboarding,
    showLocationPicker,
    setShowLocationPicker,
  } = useNavigation();
  const previousOnboardingCompleteRef = useRef(onboardingComplete);
  // Camera presentation survives a camera-preview visit, never a venue change.
  const mapViewMemory = useRef(null);
  const [mapRecoveryTarget, setMapRecoveryTarget] = useState(null);

  /*
   * A journey is on screen from the moment a route is asked for until it is
   * dismissed. While it is, the map belongs to the journey: the header and
   * status strip give their space to the instruction banner and trip sheet.
   */
  const journey = state.navStatus === NAV_STATUS.ROUTING || state.route !== null;
  const track = state.route?.found === true ? trackForRoute(state.route) : null;
  const walkthrough = useWalkthrough({
    track,
    progressMeters: state.progressMeters,
    setProgress: actions.setProgress,
    walkSpeedMps: venue.config.walkSpeedMps,
  });
  /*
   * Live tracking and the walk-through supply the same thing - a distance
   * along the route - from different sources. Only one runs at a time, and
   * the map follows the marker whenever either is moving it.
   */
  const tracking = useLiveTracking({
    track,
    locationBasis: state.locationBasis,
    checkInDistanceMeters: checkIn?.distanceMeters ?? 0,
    northOffsetDegrees: venue.buildingPackage.building?.coordinateSystem?.northOffsetDegrees ?? 0,
    setProgress: actions.setProgress,
    active: track !== null && state.navStatus === NAV_STATUS.NAVIGATING,
  });
  const live = tracking.status === 'on';
  const following = track !== null && (live || walkthrough.playing || state.progressMeters > 0);

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
   * is as tall as the venue names it is given. Measured and published instead
   * of assumed.
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
  }, [onboardingComplete]);

  if (!onboardingComplete) {
    return <WelcomeScreen onComplete={completeOnboarding} />;
  }

  return (
    <div className={`visitor-shell${journey ? ' is-journey' : ''}`}>
      <Header />
      <CheckInToast />
      <main className="main-content visitor-map-stage" id="main-content">
        {visitorViewFor(state.activeView) === VISITOR_VIEW.MAP && (
          <>
            <Suspense fallback={<div className="map-loading">Loading the venue model…</div>}>
              <VisitorMap
                key={state.venueKey}
                viewMemory={mapViewMemory}
                recoveryTarget={journey ? mapRecoveryTarget : null}
                journey={journey}
                following={following}
                sigmaMeters={live ? (tracking.snapshot?.sigmaMeters ?? null) : null}
              />
            </Suspense>
            <SearchPanel />
            <POICard />
            <JourneyChrome
              walkthrough={walkthrough}
              tracking={tracking}
              onRecoverySlot={setMapRecoveryTarget}
            />
          </>
        )}
        <CameraPreview />
      </main>
      <StatusBar />
      <LocationPicker isOpen={showLocationPicker} onClose={() => setShowLocationPicker(false)} />
    </div>
  );
}
