/**
 * SearchPanel.jsx
 *
 * Slide-up search panel with fuzzy POI search, category filtering,
 * and navigation start.
 */

import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { Search, X, Navigation, MapPin } from 'lucide-react';
import { useNavigation } from '../context/NavigationContext.jsx';
import { searchPOIs, getAvailableCategories } from '../engine/searchIndex.js';
import { formatDistance } from '../data/buildingConfig.js';

export default function SearchPanel() {
  const { state, actions, previewRoute, venue } = useNavigation();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState(null);
  const inputRef = useRef(null);
  const pois = useMemo(() => venue.getPOIs(), [venue]);
  const categories = useMemo(() => getAvailableCategories(pois), [pois]);
  const results = useMemo(
    () => searchPOIs(pois, query, { category: activeCategory }),
    [activeCategory, pois, query],
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

  const handleResultClick = useCallback(
    (node) => {
      actions.selectPOI(node);
      closePanel();
    },
    [actions, closePanel],
  );

  const handleNavigate = useCallback(
    (node, e) => {
      e.stopPropagation();
      actions.navigateTo(node.id);
      closePanel();
    },
    [actions, closePanel],
  );

  const toggleCategory = useCallback((cat) => {
    setActiveCategory((prev) => (prev === cat ? null : cat));
  }, []);

  const routePreviews = useMemo(
    () =>
      new Map(
        results.map(({ node }) => [
          node.id,
          state.startNodeId && state.startNodeId !== node.id ? previewRoute(node.id) : null,
        ]),
      ),
    [previewRoute, results, state.startNodeId],
  );

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') closePanel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closePanel, isOpen]);

  // Don't show search trigger when navigating
  if (state.navStatus === 'navigating' || state.navStatus === 'arrived') {
    return null;
  }

  return (
    <>
      {/* Search Trigger Pill */}
      {!isOpen && (
        <div className="search-trigger">
          <button
            type="button"
            className="search-trigger-pill animate-slide-up"
            onClick={openPanel}
            id="btn-search-open"
            aria-label="Search rooms and departments"
          >
            <Search size={18} color="var(--color-accent-blue)" />
            <span>Search rooms, departments...</span>
          </button>
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
            aria-label="Search rooms and departments"
          />
          {query && (
            <button
              className="search-clear-btn"
              onClick={() => setQuery('')}
              id="btn-search-clear"
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Category Chips */}
        <div className="category-chips" id="category-chips">
          {categories.map((catId) => {
            const cat = venue.getCategory(catId);
            if (!cat) return null;
            return (
              <button
                key={catId}
                className={`category-chip ${activeCategory === catId ? 'active' : ''}`}
                data-cat={catId}
                onClick={() => toggleCategory(catId)}
                aria-pressed={activeCategory === catId}
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
              const cat = venue.getCategory(node.poi.category);
              const routePreview = routePreviews.get(node.id);
              return (
                <div key={node.id} className="search-result-item" id={`search-result-${node.id}`}>
                  <button
                    type="button"
                    className="search-result-select"
                    onClick={() => handleResultClick(node)}
                    aria-label={`View details for ${node.poi.name}`}
                  >
                    <div
                      className="search-result-icon"
                      style={{ background: cat?.bgColor, color: cat?.color }}
                    >
                      {node.poi.icon}
                    </div>
                    <div className="search-result-info">
                      <div className="search-result-name">{node.poi.name}</div>
                      <div className="search-result-desc">
                        {node.poi.description} ·{' '}
                        {node.poi.accessible ? 'Accessible' : 'Not accessible'}
                      </div>
                    </div>
                  </button>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-end',
                      gap: '4px',
                    }}
                  >
                    {routePreview?.found && (
                      <span className="search-result-distance">
                        {formatDistance(routePreview.totalDistance)}
                      </span>
                    )}
                    {routePreview && !routePreview.found && (
                      <span className="search-result-distance">No route</span>
                    )}
                    <button
                      className="btn btn-sm btn-success"
                      onClick={(e) => handleNavigate(node, e)}
                      style={{ padding: '4px 10px', fontSize: '11px' }}
                      aria-label={`Navigate to ${node.poi.name}`}
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
