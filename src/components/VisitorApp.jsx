import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useNavigation, NAV_STATUS } from '../context/NavigationContext.jsx';
import { VISITOR_VIEW, visitorViewFor } from '../context/visitorView.ts';
import { guidanceAt, positionAt, trackForRoute } from '../navigation/routeProgress';
import CameraPreview from './CameraPreview.jsx';
import CheckInToast from './CheckInToast.tsx';
import FieldTestPanel from './FieldTestPanel.tsx';
import Header from './Header.jsx';
import { bannerCopy } from './journey/guidanceCopy';
import JourneyChrome from './journey/JourneyChrome.jsx';
import { useLiveTracking } from './journey/useLiveTracking.js';
import { useSpokenGuidance } from './journey/useSpokenGuidance.js';
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
  const [voice, setVoice] = useState(false);

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
  /*
   * Only one of them may write progress at a time, and that is enforced here,
   * once, rather than trusted to every button that starts one. The map's own
   * control paused the walk-through first; the camera's did not, and a preview
   * went on counting down underneath a real walk. Starting either now stops
   * the other, whichever view the tap came from. A preview is never where the
   * visitor physically is, so stopping a walk to preview keeps the tracker's
   * own position for when tracking resumes.
   */
  const trackingControl = {
    ...tracking,
    start: () => {
      walkthrough.pause();
      tracking.start();
    },
  };
  const walkthroughControl = {
    ...walkthrough,
    play: () => {
      tracking.stop();
      walkthrough.play();
    },
    toggle: () => {
      if (!walkthrough.playing) tracking.stop();
      walkthrough.toggle();
    },
  };

  /*
   * Spoken turns belong to the journey, not to a view: the same instruction
   * is read aloud whether the map or the camera is on screen, and the mute
   * choice survives switching between them.
   */
  const spokenCopy =
    track !== null && state.route?.found === true
      ? bannerCopy(
          state.route.steps,
          track,
          guidanceAt(track, state.progressMeters),
          state.progressMeters,
          (floorId) => venue.getFloorById(floorId)?.name,
          positionAt(track, state.progressMeters).vertical,
        )
      : null;
  useSpokenGuidance(spokenCopy, voice && state.navStatus === NAV_STATUS.NAVIGATING);

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
              walkthrough={walkthroughControl}
              tracking={trackingControl}
              voice={voice}
              onVoice={setVoice}
              onRecoverySlot={setMapRecoveryTarget}
            />
          </>
        )}
        <CameraPreview tracking={trackingControl} voice={voice} onVoice={setVoice} />
      </main>
      <StatusBar />
      <LocationPicker isOpen={showLocationPicker} onClose={() => setShowLocationPicker(false)} />
      <FieldTestPanel />
    </div>
  );
}
