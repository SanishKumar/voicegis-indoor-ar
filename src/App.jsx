import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { NavigationProvider } from './context/NavigationContext.jsx';
import { VenueProvider, useVenue } from './context/VenueContext.jsx';
import SurfaceNav from './components/SurfaceNav.jsx';
import VenuePackageManager from './components/VenuePackageManager.jsx';
import VenueBootstrapState from './components/VenueBootstrapState.jsx';
import VisitorApp from './components/VisitorApp.jsx';

const SpatialTwinViewer = lazy(() => import('./components/SpatialTwinViewer.tsx'));
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
  const previousSurfaceRef = useRef(surface);

  useEffect(() => {
    const previousSurface = previousSurfaceRef.current;
    previousSurfaceRef.current = surface;
    if (previousSurface === 'visitor' || surface !== 'visitor') return;

    // Entering the visitor preview from the workbench should start in the
    // visitor task, not leave keyboard focus behind on the operator rail.
    const visitorTarget =
      document.getElementById('btn-search-open') ?? document.getElementById('welcome-step-heading');
    visitorTarget?.focus({ preventScroll: true });
  }, [surface]);

  if (!venue) {
    return (
      <VenueBootstrapState
        status={status}
        retryBootstrap={retryBootstrap}
        useDefaultVenue={useDefaultVenue}
      />
    );
  }

  return (
    <NavigationProvider key={venue.key} venue={venue}>
      {/*
        The operator build carries this nav on every surface, the visitor one
        included: an operator checking their work on the visitor view needs a
        way back to the studio that is not the address bar.

        This is not the boundary that matters. The public build never contains
        any of it - `SurfaceNav` is on the compiler's forbidden-module list, so
        a build that reached it fails outright - and the public shell is tested
        for its absence separately, including when the route is guessed.
      */}
      <div className="operator-shell">
        <SurfaceNav activeSurface={surface} />
        <div className="operator-workspace">
          {surface === 'inspector' ? (
            <InspectorApp />
          ) : surface === 'studio' ? (
            <StudioApp />
          ) : surface === 'recorder' ? (
            <RecorderApp />
          ) : (
            <VisitorApp />
          )}
        </div>
      </div>
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
