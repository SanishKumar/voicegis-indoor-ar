/**
 * Header.jsx
 * 
 * Top navigation bar with brand, view toggle, location setter, and floor selector.
 */

import { Map, Camera, Sun, Moon, MapPin, Home, Eye, Settings } from 'lucide-react';
import { useNavigation, VIEW_TYPE } from '../context/NavigationContext.jsx';
import { BUILDING_CONFIG } from '../data/buildingConfig.js';
import { getNodeById } from '../data/buildingGraph.js';

export default function Header() {
  const { state, actions, theme, toggleTheme, setShowLocationPicker, resetOnboarding, highContrast, toggleHighContrast, accessibleRouting, toggleAccessibleRouting } = useNavigation();
  const { activeView, startNodeId } = state;

  const startNode = getNodeById(startNodeId);
  const locationLabel = startNode?.poi?.name || 'Set Location';

  return (
    <header className="app-header" id="app-header">
      {/* Brand */}
      <div className="header-brand">
        <div className="header-logo">🏥</div>
        <div>
          <div className="header-title">{BUILDING_CONFIG.name}</div>
          <div className="header-subtitle">{BUILDING_CONFIG.subtitle}</div>
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
            Map
          </button>
          <button
            className={`view-toggle-btn ${activeView === VIEW_TYPE.CAMERA_PREVIEW ? 'active' : ''}`}
            onClick={() => actions.setView(VIEW_TYPE.CAMERA_PREVIEW)}
            id="btn-camera-preview"
            aria-label="Switch to camera preview"
          >
            <Camera size={14} />
            Preview
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
          className="header-btn" 
          onClick={toggleAccessibleRouting} 
          aria-label="Toggle accessible routing" 
          title="Toggle wheelchair accessible routing"
          style={{ color: accessibleRouting ? 'var(--color-accent-green)' : 'inherit' }}
        >
          <Settings size={18} />
        </button>
      </div>
    </header>
  );
}
