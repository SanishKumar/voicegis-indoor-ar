/**
 * SearchPanel.jsx
 * 
 * Slide-up search panel with fuzzy POI search, category filtering,
 * and navigation start.
 */

import { useState, useRef, useMemo, useCallback } from 'react';
import { Search, X, Navigation, MapPin } from 'lucide-react';
import { useNavigation } from '../context/NavigationContext.jsx';
import { searchPOIs, getAvailableCategories } from '../engine/searchIndex.js';
import { CATEGORIES, getNodeById } from '../data/buildingGraph.js';
import { formatDistance } from '../data/buildingConfig.js';

export default function SearchPanel() {
  const { state, actions } = useNavigation();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState(null);
  const inputRef = useRef(null);
  const categories = getAvailableCategories();
  const results = useMemo(
    () => searchPOIs(query, { category: activeCategory }),
    [query, activeCategory],
  );

  const openPanel = useCallback(() => {
    setIsOpen(true);
    setTimeout(() => inputRef.current?.focus(), 350);
  }, []);

  const closePanel = useCallback(() => {
    setIsOpen(false);
    setQuery('');
    setActiveCategory(null);
  }, []);

  const handleResultClick = useCallback((node) => {
    actions.selectPOI(node);
    closePanel();
  }, [actions, closePanel]);

  const handleNavigate = useCallback((node, e) => {
    e.stopPropagation();
    actions.navigateTo(node.id);
    closePanel();
  }, [actions, closePanel]);

  const toggleCategory = useCallback((cat) => {
    setActiveCategory(prev => prev === cat ? null : cat);
  }, []);

  // Estimate distance from current position
  const getDistanceEstimate = useCallback((node) => {
    if (!state.startNodeId || state.startNodeId === node.id) return null;
    const startNode = getNodeById(state.startNodeId);
    if (startNode && node) {
      const dx = startNode.x - node.x;
      const dy = startNode.y - node.y;
      return Math.sqrt(dx * dx + dy * dy) * 0.15;
    }
    return null;
  }, [state.startNodeId]);

  // Don't show search trigger when navigating
  if (state.navStatus === 'navigating' || state.navStatus === 'arrived') {
    return null;
  }

  return (
    <>
      {/* Search Trigger Pill */}
      {!isOpen && (
        <div className="search-trigger">
          <div
            className="search-trigger-pill animate-slide-up"
            onClick={openPanel}
            id="btn-search-open"
            role="button"
          >
            <Search size={18} color="var(--color-accent-blue)" />
            <span>Search rooms, departments...</span>
          </div>
        </div>
      )}

      {/* Backdrop */}
      <div
        className={`search-overlay ${isOpen ? 'open' : ''}`}
        onClick={closePanel}
        id="search-overlay"
      />

      {/* Search Panel */}
      <div className={`search-panel ${isOpen ? 'open' : ''}`} id="search-panel">
        {/* Handle */}
        <div className="search-panel-handle" />

        {/* Search Input */}
        <div className="search-input-wrapper">
          <Search size={16} color="var(--color-text-muted)" />
          <input
            ref={inputRef}
            type="text"
            className="search-input"
            placeholder="Search rooms, departments..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            id="search-input"
          />
          {query && (
            <button
              className="search-clear-btn"
              onClick={() => setQuery('')}
              id="btn-search-clear"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Category Chips */}
        <div className="category-chips" id="category-chips">
          {categories.map(catId => {
            const cat = CATEGORIES[catId];
            if (!cat) return null;
            return (
              <button
                key={catId}
                className={`category-chip ${activeCategory === catId ? 'active' : ''}`}
                data-cat={catId}
                onClick={() => toggleCategory(catId)}
              >
                {cat.icon} {cat.label}
              </button>
            );
          })}
        </div>

        {/* Results */}
        <div className="search-results" id="search-results">
          {results.length > 0 ? (
            results.map(({ node }) => {
              const cat = CATEGORIES[node.poi.category];
              const dist = getDistanceEstimate(node);
              return (
                <div
                  key={node.id}
                  className="search-result-item"
                  onClick={() => handleResultClick(node)}
                  id={`search-result-${node.id}`}
                >
                  <div
                    className="search-result-icon"
                    style={{ background: cat?.bgColor, color: cat?.color }}
                  >
                    {node.poi.icon}
                  </div>
                  <div className="search-result-info">
                    <div className="search-result-name">{node.poi.name}</div>
                    <div className="search-result-desc">{node.poi.description}</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                    {dist !== null && (
                      <span className="search-result-distance">
                        {formatDistance(dist)}
                      </span>
                    )}
                    <button
                      className="btn btn-sm btn-success"
                      onClick={(e) => handleNavigate(node, e)}
                      style={{ padding: '4px 10px', fontSize: '11px' }}
                    >
                      <Navigation size={11} />
                      Go
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="search-empty">
              <div className="search-empty-icon">
                <MapPin size={32} />
              </div>
              <div>No rooms found matching "{query}"</div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
