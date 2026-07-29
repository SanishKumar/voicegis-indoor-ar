/**
 * SearchPanel.jsx
 *
 * Slide-up search panel with fuzzy POI search, category filtering,
 * and navigation start.
 */

import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { Search, X, Navigation, MapPin, ArrowRight } from 'lucide-react';
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
            <span className="search-trigger-icon" aria-hidden="true">
              <Search size={19} />
            </span>
            <span className="search-trigger-copy">
              <strong>Where do you want to go?</strong>
              <small>Search rooms, services, and entrances</small>
            </span>
            <span className="search-trigger-action" aria-hidden="true">
              Search
              <ArrowRight size={15} />
            </span>
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
      <section
        className={`search-panel ${isOpen ? 'open' : ''}`}
        id="search-panel"
        aria-label="Find a destination"
      >
        <div className="search-panel-handle" />

        <div className="search-panel-heading">
          <div>
            <span>Explore {venue.config.name}</span>
            <h2>Find a destination</h2>
          </div>
          <button type="button" onClick={closePanel} aria-label="Close destination search">
            <X size={18} />
          </button>
        </div>

        <div className="search-input-wrapper">
          <Search size={18} />
          <input
            ref={inputRef}
            type="text"
            className="search-input"
            placeholder="Room, service, department…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            id="search-input"
            aria-label="Search rooms and departments"
          />
          {query && (
            <button
              type="button"
              className="search-clear-btn"
              onClick={() => setQuery('')}
              id="btn-search-clear"
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="search-section-label">
          <span>Browse by category</span>
          <span>{results.length} destinations</span>
        </div>

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
                  <div className="search-result-route">
                    {routePreview?.found && (
                      <span className="search-result-distance">
                        {formatDistance(routePreview.totalDistance)}
                      </span>
                    )}
                    {routePreview && !routePreview.found && (
                      <span className="search-result-distance">No route</span>
                    )}
                    <button
                      className="search-route-button"
                      onClick={(e) => handleNavigate(node, e)}
                      aria-label={`Navigate to ${node.poi.name}`}
                    >
                      <Navigation size={13} />
                      Route
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
      </section>
    </>
  );
}
