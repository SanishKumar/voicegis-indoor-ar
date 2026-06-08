/**
 * App.jsx
 * 
 * Root application component.
 * Assembles the layout: Header → Main (Floorplan / AR) → StatusBar
 * with Search, POICard, and NavigationPanel overlays.
 */

import { NavigationProvider, useNavigation, VIEW_TYPE } from './context/NavigationContext.jsx';
import Header from './components/Header.jsx';
import FloorplanViewer from './components/FloorplanViewer.jsx';
import SearchPanel from './components/SearchPanel.jsx';
import POICard from './components/POICard.jsx';
import NavigationPanel from './components/NavigationPanel.jsx';
import ARView from './components/ARView.jsx';
import StatusBar from './components/StatusBar.jsx';

function AppContent() {
  const { state } = useNavigation();
  const { activeView } = state;

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
