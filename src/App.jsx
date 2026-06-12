/**
 * App.jsx
 * 
 * Root application component.
 * Shows the WelcomeScreen on first visit, then the main navigation app.
 */

import { NavigationProvider, useNavigation, VIEW_TYPE } from './context/NavigationContext.jsx';
import WelcomeScreen from './components/WelcomeScreen.jsx';
import Header from './components/Header.jsx';
import FloorplanViewer from './components/FloorplanViewer.jsx';
import SearchPanel from './components/SearchPanel.jsx';
import POICard from './components/POICard.jsx';
import NavigationPanel from './components/NavigationPanel.jsx';
import LocationPicker from './components/LocationPicker.jsx';
import ARView from './components/ARView.jsx';
import StatusBar from './components/StatusBar.jsx';

function AppContent() {
  const { state, onboardingComplete, completeOnboarding, showLocationPicker, setShowLocationPicker } = useNavigation();
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
            <FloorplanViewer />
            <SearchPanel />
            <POICard />
            <NavigationPanel />
          </>
        )}

        {/* AR View */}
        <ARView />
      </main>

      <StatusBar />

      {/* Location Picker Modal */}
      <LocationPicker
        isOpen={showLocationPicker}
        onClose={() => setShowLocationPicker(false)}
      />
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
