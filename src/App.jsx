/**
 * App.jsx
 *
 * Root application component.
 * Shows the WelcomeScreen on first visit, then the main navigation app.
 */

import { lazy, Suspense } from 'react';
import { NavigationProvider, useNavigation, VIEW_TYPE } from './context/NavigationContext.jsx';
import WelcomeScreen from './components/WelcomeScreen.jsx';
import Header from './components/Header.jsx';
import SearchPanel from './components/SearchPanel.jsx';
import POICard from './components/POICard.jsx';
import NavigationPanel from './components/NavigationPanel.jsx';
import LocationPicker from './components/LocationPicker.jsx';
import CameraPreview from './components/CameraPreview.jsx';
import StatusBar from './components/StatusBar.jsx';

const SpatialTwinViewer = lazy(() => import('./components/SpatialTwinViewer.tsx'));
const FloorplanViewer = lazy(() => import('./components/FloorplanViewer.tsx'));

function AppContent() {
  const {
    state,
    onboardingComplete,
    completeOnboarding,
    showLocationPicker,
    setShowLocationPicker,
  } = useNavigation();
  const { activeView } = state;

  // Show onboarding on first visit
  if (!onboardingComplete) {
    return <WelcomeScreen onComplete={completeOnboarding} />;
  }

  return (
    <>
      <Header />

      <main className="main-content" id="main-content">
        {/* Map View */}
        {activeView === VIEW_TYPE.MAP && (
          <>
            <Suspense
              fallback={
                <div className="map-loading" role="status">
                  Loading compiled floor map…
                </div>
              }
            >
              <FloorplanViewer />
            </Suspense>
            <SearchPanel />
            <POICard />
            <NavigationPanel />
          </>
        )}

        {activeView === VIEW_TYPE.SPATIAL_TWIN && (
          <Suspense
            fallback={
              <div className="twin-loading" role="status">
                <span />
                Loading compiled spatial package…
              </div>
            }
          >
            <SpatialTwinViewer />
          </Suspense>
        )}

        <CameraPreview />
      </main>

      <StatusBar />

      {/* Location Picker Modal */}
      <LocationPicker isOpen={showLocationPicker} onClose={() => setShowLocationPicker(false)} />
    </>
  );
}

export default function App() {
  return (
    <NavigationProvider>
      <AppContent />
    </NavigationProvider>
  );
}
