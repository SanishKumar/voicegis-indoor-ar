import { lazy, Suspense, useEffect, useRef } from 'react';
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

const FloorplanViewer = lazy(() => import('./FloorplanViewer.tsx'));

export default function VisitorApp() {
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
