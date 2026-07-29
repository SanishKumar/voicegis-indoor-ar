import { lazy, Suspense, useEffect, useState } from 'react';
import { NavigationProvider, useNavigation, VIEW_TYPE } from './context/NavigationContext.jsx';
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

const SpatialTwinViewer = lazy(() => import('./components/SpatialTwinViewer.tsx'));
const FloorplanViewer = lazy(() => import('./components/FloorplanViewer.tsx'));
const BuildingSourceWorkspace = lazy(
  () => import('./components/BuildingSourceWorkspace.tsx'),
);

function currentSurface() {
  const value = window.location.hash.replace(/^#\/?/, '').split('/')[0];
  return ['visitor', 'inspector', 'studio'].includes(value) ? value : 'visitor';
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

  if (!onboardingComplete) {
    return <WelcomeScreen onComplete={completeOnboarding} />;
  }

  return (
    <div className="visitor-shell">
      <Header />
      <main className="main-content visitor-map-stage" id="main-content">
        {state.activeView === VIEW_TYPE.MAP && (
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
      <StatusBar />
      <LocationPicker isOpen={showLocationPicker} onClose={() => setShowLocationPicker(false)} />
    </div>
  );
}

function InspectorApp() {
  const { actions } = useNavigation();
  const setView = actions.setView;
  useEffect(() => {
    setView(VIEW_TYPE.SPATIAL_TWIN);
  }, [setView]);

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

function ActiveVenueApplication() {
  const { venue, status } = useVenue();
  const surface = useSurfaceRoute();

  if (!venue) {
    return (
      <main className="venue-bootstrap-state" role="status">
        <strong>
          {status.state === 'error' ? 'Venue bootstrap failed' : 'Loading VenuePackage'}
        </strong>
        <p>{status.error ?? status.detail}</p>
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
