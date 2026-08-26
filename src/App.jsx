import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { NavigationProvider, useNavigation } from './context/NavigationContext.jsx';
import { VenueProvider, useVenue } from './context/VenueContext.jsx';
import WelcomeScreen from './components/WelcomeScreen.jsx';
import Header from './components/Header.jsx';
import SearchPanel from './components/SearchPanel.jsx';
import POICard from './components/POICard.jsx';
import NavigationPanel from './components/NavigationPanel.jsx';
import LocationPicker from './components/LocationPicker.jsx';
import CameraPreview from './components/CameraPreview.jsx';
import StatusBar from './components/StatusBar.jsx';
import SurfaceNav from './components/SurfaceNav.jsx';
import VenuePackageManager from './components/VenuePackageManager.jsx';
import CheckInToast from './components/CheckInToast.tsx';
import { VISITOR_VIEW, visitorViewFor } from './context/visitorView.ts';

const SpatialTwinViewer = lazy(() => import('./components/SpatialTwinViewer.tsx'));
const FloorplanViewer = lazy(() => import('./components/FloorplanViewer.tsx'));
const BuildingSourceWorkspace = lazy(() => import('./components/BuildingSourceWorkspace.tsx'));
const WalkRecorder = lazy(() => import('./components/WalkRecorder.tsx'));

function currentSurface() {
  const value = window.location.hash.replace(/^#\/?/, '').split('/')[0];
  return ['visitor', 'inspector', 'studio', 'recorder'].includes(value) ? value : 'visitor';
}

function useSurfaceRoute() {
  const [surface, setSurface] = useState(currentSurface);
  useEffect(() => {
    const handleHashChange = () => setSurface(currentSurface());
    window.addEventListener('hashchange', handleHashChange);
    if (!window.location.hash) window.history.replaceState(null, '', '#/visitor');
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);
  return surface;
}

function VisitorApp() {
  const {
    state,
    onboardingComplete,
    completeOnboarding,
    showLocationPicker,
    setShowLocationPicker,
  } = useNavigation();
  const previousOnboardingCompleteRef = useRef(onboardingComplete);

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

  if (!onboardingComplete) {
    return <WelcomeScreen onComplete={completeOnboarding} />;
  }

  return (
    <div className="visitor-shell">
      <Header />
      <main className="main-content visitor-map-stage" id="main-content">
        {visitorViewFor(state.activeView) === VISITOR_VIEW.MAP && (
          <>
            <Suspense fallback={<div className="map-loading">Loading compiled floor map…</div>}>
              <FloorplanViewer />
            </Suspense>
            <SearchPanel />
            <POICard />
            <NavigationPanel />
          </>
        )}
        <CameraPreview />
      </main>
      <CheckInToast />
      <StatusBar />
      <LocationPicker isOpen={showLocationPicker} onClose={() => setShowLocationPicker(false)} />
    </div>
  );
}

function InspectorApp() {
  // Deliberately writes nothing to shared navigation state. It used to store
  // `spatial-twin` in `activeView`, which no surface reads and which the
  // visitor surface cannot render — returning to the map afterwards produced an
  // empty canvas. The twin below renders unconditionally, so the write bought
  // nothing and cost the visitor journey.
  return (
    <main className="inspector-surface" id="main-content">
      <Suspense
        fallback={
          <div className="twin-loading">
            <span />
            Loading active VenuePackage…
          </div>
        }
      >
        <SpatialTwinViewer />
      </Suspense>
      <VenuePackageManager />
    </main>
  );
}

function StudioApp() {
  return (
    <Suspense
      fallback={
        <main className="studio-boundary" id="main-content">
          Loading BuildingSource workspace…
        </main>
      }
    >
      <BuildingSourceWorkspace />
    </Suspense>
  );
}

function RecorderApp() {
  return (
    <Suspense
      fallback={
        <main className="walk-recorder" id="main-content">
          Loading capture surface…
        </main>
      }
    >
      <WalkRecorder />
    </Suspense>
  );
}

function ActiveVenueApplication() {
  const { venue, status, retryBootstrap, useDefaultVenue } = useVenue();
  const surface = useSurfaceRoute();

  if (!venue) {
    const failed = status.state === 'error';
    return (
      <main className="venue-bootstrap-state" role={failed ? 'alert' : 'status'}>
        <strong>{failed ? 'Venue bootstrap failed' : 'Loading VenuePackage'}</strong>
        <p>{status.error ?? status.detail}</p>
        {/*
          A failure used to end here, with the reason and nothing to do about
          it. Worse, a bad venue URL persists, so every reload retried exactly
          the source that had just failed and the visitor could not get back to
          a working venue by any action available to them.
        */}
        {status.failedSource && (
          <p className="venue-bootstrap-source">
            Tried <code>{status.failedSource}</code>
          </p>
        )}
        {failed && (
          <div className="venue-bootstrap-actions">
            <button type="button" className="venue-bootstrap-retry" onClick={retryBootstrap}>
              Retry venue loading
            </button>
            {status.failedSource && (
              <button type="button" className="venue-bootstrap-default" onClick={useDefaultVenue}>
                Use default venue
              </button>
            )}
          </div>
        )}
      </main>
    );
  }

  return (
    <NavigationProvider key={venue.key} venue={venue}>
      <SurfaceNav activeSurface={surface} />
      {surface === 'inspector' ? (
        <InspectorApp />
      ) : surface === 'studio' ? (
        <StudioApp />
      ) : surface === 'recorder' ? (
        <RecorderApp />
      ) : (
        <VisitorApp />
      )}
    </NavigationProvider>
  );
}

export default function App() {
  return (
    <VenueProvider>
      <ActiveVenueApplication />
    </VenueProvider>
  );
}
