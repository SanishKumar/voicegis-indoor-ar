/**
 * Header.jsx
 *
 * Top navigation bar with brand, view toggle, location setter, and floor selector.
 */

import {
  Accessibility,
  Box,
  Map,
  Camera,
  Sun,
  Moon,
  MapPin,
  Home,
  Eye,
  Building2,
} from 'lucide-react';
import { useNavigation, VIEW_TYPE } from '../context/NavigationContext.jsx';
import { BUILDING_CONFIG } from '../data/buildingConfig.js';
import { getNodeById } from '../data/compiledBuilding';

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
  } = useNavigation();
  const { activeView, startNodeId } = state;

  const startNode = getNodeById(startNodeId);
  const locationLabel = startNode?.poi
    ? `${startNode.poi.name} · ${startNode.poi.floorName}`
    : 'Set Location';

  return (
    <header className="app-header" id="app-header">
      {/* Brand */}
      <div className="header-brand">
        <div className="header-logo" aria-hidden="true">
          <Building2 size={17} strokeWidth={1.8} />
        </div>
        <div>
          <div className="header-title">{BUILDING_CONFIG.name}</div>
          <div className="header-subtitle">Indoor navigation / simulation package</div>
        </div>
      </div>

      {/* Actions */}
      <div className="header-actions">
        {/* Location Button */}
        <button
          className="header-location-btn"
          onClick={() => setShowLocationPicker(true)}
          id="btn-set-location"
          title="Change your current location"
        >
          <MapPin size={14} />
          <span className="header-location-text">{locationLabel}</span>
        </button>

        {/* View Toggle */}
        <div className="view-toggle" id="view-toggle">
          <button
            className={`view-toggle-btn ${activeView === VIEW_TYPE.MAP ? 'active' : ''}`}
            onClick={() => actions.setView(VIEW_TYPE.MAP)}
            id="btn-map-view"
            aria-label="Switch to map view"
          >
            <Map size={14} />
            Plan
          </button>
          <button
            className={`view-toggle-btn ${activeView === VIEW_TYPE.SPATIAL_TWIN ? 'active' : ''}`}
            onClick={() => actions.setView(VIEW_TYPE.SPATIAL_TWIN)}
            id="btn-spatial-twin"
            aria-label="Switch to compiled 3D spatial twin"
          >
            <Box size={14} />
            Spatial
          </button>
          <button
            className={`view-toggle-btn ${activeView === VIEW_TYPE.CAMERA_PREVIEW ? 'active' : ''}`}
            onClick={() => actions.setView(VIEW_TYPE.CAMERA_PREVIEW)}
            id="btn-camera-preview"
            aria-label="Switch to camera preview"
          >
            <Camera size={14} />
            Guide
          </button>
        </div>

        {/* Home / Welcome Button */}
        <button
          className="header-btn"
          onClick={resetOnboarding}
          aria-label="Go to Welcome Screen"
          title="Welcome Screen"
        >
          <Home size={18} />
        </button>

        {/* Theme Toggle */}
        <button
          className="header-btn"
          onClick={toggleTheme}
          aria-label="Toggle theme"
          title="Toggle theme"
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        {/* High Contrast Toggle */}
        <button
          className="header-btn"
          onClick={toggleHighContrast}
          aria-label="Toggle high contrast mode"
          title="Toggle high contrast mode"
          style={{ color: highContrast ? 'var(--color-accent-blue)' : 'inherit' }}
        >
          <Eye size={18} />
        </button>

        {/* Accessible Routing Toggle */}
        <button
          className={`header-route-profile ${accessibleRouting ? 'active' : ''}`}
          onClick={toggleAccessibleRouting}
          aria-label={
            accessibleRouting
              ? 'Use fastest available routing'
              : 'Use step-free accessible routing'
          }
          aria-pressed={accessibleRouting}
          title="Switch between fastest and step-free routing"
        >
          <Accessibility size={16} />
          <span>{accessibleRouting ? 'Step-free' : 'Fastest'}</span>
        </button>
      </div>
    </header>
  );
}
