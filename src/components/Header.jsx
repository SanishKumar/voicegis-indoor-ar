/**
 * Header.jsx
 *
 * Visitor navigation shell with venue context and preferences.
 */

import { Accessibility, Compass, MapPin, Home, Navigation2 } from 'lucide-react';
import { useNavigation, VIEW_TYPE } from '../context/NavigationContext.jsx';
import { startPointLabel } from '../capture/startLabel.ts';

export default function Header() {
  const {
    state,
    actions,
    setShowLocationPicker,
    resetOnboarding,
    accessibleRouting,
    toggleAccessibleRouting,
    checkIn,
    venue,
  } = useNavigation();
  const { activeFloorId, startNodeId } = state;

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
          <Navigation2 size={18} strokeWidth={2} />
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
            <MapPin size={16} strokeWidth={2} />
          </span>
          <span className="visitor-location-copy">
            <small>
              {state.locationBasis === 'qr'
                ? 'Last check-in'
                : state.locationBasis === 'selected'
                  ? 'Selected start'
                  : 'Default start'}
            </small>
            <strong>{locationLabel}</strong>
          </span>
        </button>

        {/*
          A momentary check, not a mode. This was a Plan/Guide segmented switch,
          which asked the visitor to hold a piece of application state that only
          ever had one useful direction: the camera view answers "which way am I
          facing" and is then left. It exits through its own controls, so there
          is nothing to switch back to here.
        */}
        <button
          className="visitor-heading-check"
          onClick={() => actions.setView(VIEW_TYPE.CAMERA_PREVIEW)}
          id="btn-camera-preview"
          aria-label="Which way?"
          title="Point the camera to check which way you are facing"
        >
          <Compass size={16} strokeWidth={2} />
          <span>Which way?</span>
        </button>

        <button
          className={`visitor-access-profile ${accessibleRouting ? 'active' : ''}`}
          onClick={toggleAccessibleRouting}
          aria-label={
            accessibleRouting ? 'Use fastest available routing' : 'Use step-free accessible routing'
          }
          aria-pressed={accessibleRouting}
          title="Switch between fastest and step-free routing"
        >
          <Accessibility size={16} strokeWidth={2} />
          <span>{accessibleRouting ? 'Step-free' : 'Fastest'}</span>
        </button>

        <div className="visitor-utility-actions">
          <button
            onClick={resetOnboarding}
            aria-label="Go to welcome screen"
            title="Welcome screen"
          >
            <Home size={17} strokeWidth={2} />
          </button>
        </div>
      </nav>
    </header>
  );
}
