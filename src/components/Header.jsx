/**
 * Header.jsx
 *
 * Visitor navigation shell with venue context, guidance mode, and preferences.
 */

import {
  Accessibility,
  Map,
  Camera,
  Sun,
  Moon,
  MapPin,
  Home,
  Eye,
  Navigation2,
} from 'lucide-react';
import { useNavigation, VIEW_TYPE } from '../context/NavigationContext.jsx';
import { startPointLabel } from '../capture/startLabel.ts';
import { VISITOR_VIEW, visitorViewFor } from '../context/visitorView.ts';

export default function Header() {
  const {
    state,
    actions,
    theme,
    toggleTheme,
    setShowLocationPicker,
    resetOnboarding,
    highContrast,
    toggleHighContrast,
    accessibleRouting,
    toggleAccessibleRouting,
    checkIn,
    venue,
  } = useNavigation();
  const { activeFloorId, startNodeId } = state;
  // Derived, so the two toggles can never both read unpressed.
  const activeView = visitorViewFor(state.activeView);

  const startNode = venue.getNodeById(startNodeId);
  const activeFloor = venue.getFloorById(activeFloorId);
  const labelNames = {
    space: (id) => venue.getSpaceById(id)?.name ?? null,
    floor: (id) => venue.getFloorById(id)?.name ?? null,
  };
  const locationLabel = startPointLabel(startNode, checkIn, labelNames, 'Choose a starting point');

  return (
    <header className="app-header visitor-header" id="app-header">
      <div className="visitor-brand">
        <div className="visitor-brand-mark" aria-hidden="true">
          <Navigation2 size={19} strokeWidth={2} />
        </div>
        <div className="visitor-brand-copy">
          <span>Indoor wayfinding</span>
          <strong>{venue.config.name}</strong>
        </div>
        {activeFloor && <span className="visitor-floor-context">{activeFloor.name}</span>}
      </div>

      <nav className="visitor-header-actions" aria-label="Visitor controls">
        <button
          className="visitor-location-control"
          onClick={() => setShowLocationPicker(true)}
          id="btn-set-location"
          title="Change your current location"
          aria-label={`Change start location. Current: ${locationLabel}`}
        >
          <span className="visitor-location-icon" aria-hidden="true">
            <MapPin size={16} />
          </span>
          <span className="visitor-location-copy">
            <small>Starting at</small>
            <strong>{locationLabel}</strong>
          </span>
        </button>

        <div className="visitor-mode-switch" id="view-toggle" aria-label="Guidance mode">
          <button
            className={activeView === VISITOR_VIEW.MAP ? 'active' : ''}
            onClick={() => actions.setView(VIEW_TYPE.MAP)}
            id="btn-map-view"
            aria-label="Switch to map view"
            aria-pressed={activeView === VISITOR_VIEW.MAP}
          >
            <Map size={14} />
            Plan
          </button>
          <button
            className={activeView === VISITOR_VIEW.CAMERA_PREVIEW ? 'active' : ''}
            onClick={() => actions.setView(VIEW_TYPE.CAMERA_PREVIEW)}
            id="btn-camera-preview"
            aria-label="Switch to camera preview"
            aria-pressed={activeView === VISITOR_VIEW.CAMERA_PREVIEW}
          >
            <Camera size={14} />
            Guide
          </button>
        </div>

        <button
          className={`visitor-access-profile ${accessibleRouting ? 'active' : ''}`}
          onClick={toggleAccessibleRouting}
          aria-label={
            accessibleRouting ? 'Use fastest available routing' : 'Use step-free accessible routing'
          }
          aria-pressed={accessibleRouting}
          title="Switch between fastest and step-free routing"
        >
          <Accessibility size={16} />
          <span>{accessibleRouting ? 'Step-free' : 'Fastest'}</span>
        </button>

        <div className="visitor-utility-actions">
          <button
            onClick={toggleHighContrast}
            aria-label="Toggle high contrast mode"
            aria-pressed={highContrast}
            title="High contrast"
            className={highContrast ? 'active' : ''}
          >
            <Eye size={17} />
          </button>
          <button onClick={toggleTheme} aria-label="Toggle theme" title="Theme">
            {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <button
            onClick={resetOnboarding}
            aria-label="Go to welcome screen"
            title="Welcome screen"
          >
            <Home size={17} />
          </button>
        </div>
      </nav>
    </header>
  );
}
