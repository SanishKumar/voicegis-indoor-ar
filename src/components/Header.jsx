/**
 * Header.jsx
 * 
 * Top navigation bar with brand, view toggle, and floor selector.
 */

import { Map, Camera, Layers, Sun, Moon } from 'lucide-react';
import { useNavigation, VIEW_TYPE } from '../context/NavigationContext.jsx';
import { BUILDING_CONFIG } from '../data/buildingConfig.js';

export default function Header() {
  const { state, actions, theme, toggleTheme } = useNavigation();
  const { activeView } = state;

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
            className={`view-toggle-btn ${activeView === VIEW_TYPE.AR ? 'active' : ''}`}
            onClick={() => actions.setView(VIEW_TYPE.AR)}
            id="btn-ar-view"
            aria-label="Switch to AR view"
          >
            <Camera size={14} />
            AR
          </button>
        </div>

        {/* Theme Toggle */}
        <button 
          className="header-btn" 
          onClick={toggleTheme} 
          aria-label="Toggle theme" 
          title="Toggle theme"
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        {/* Floor Selector (future expansion) */}
        <button className="header-btn" id="btn-floor-select" aria-label="Select floor" title="Floor selector">
          <Layers size={18} />
        </button>
      </div>
    </header>
  );
}
