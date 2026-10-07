/**
 * SearchPanel.jsx
 *
 * Slide-up search panel with fuzzy POI search, category filtering,
 * and navigation start.
 */

import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { Search, X, Navigation, MapPin, ArrowRight } from 'lucide-react';
import { NAV_STATUS, useNavigation } from '../context/NavigationContext.jsx';
import { searchPOIs, getAvailableCategories } from '../engine/searchIndex.js';
import { formatDistance } from '../data/buildingConfig.js';
import { useDialogFocus } from './useDialogFocus.ts';
import './SearchPanel.css';
import MobilePanelHandle from './MobilePanelHandle';
import { useMobilePanel } from './useMobilePanel';

const RESULTS_PER_PAGE = 10;

export default function SearchPanel() {
  const { state, actions, previewRoute, venue } = useNavigation();
  const [isOpen, setIsOpen] = useState(false);
  const panel = useMobilePanel(isOpen);
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState(null);
  const [shownCount, setShownCount] = useState(RESULTS_PER_PAGE);
  const inputRef = useRef(null);
  const triggerRef = useRef(null);
  const restoreTriggerRef = useRef(false);
  const resultsRef = useRef(null);
  const nextResultFocusRef = useRef(null);
  const pois = useMemo(() => venue.getPOIs(), [venue]);
  const categories = useMemo(() => getAvailableCategories(pois), [pois]);
  const results = useMemo(
    () => searchPOIs(pois, query, { category: activeCategory, limit: pois.length }),
    [activeCategory, pois, query],
  );
  const visibleResults = useMemo(() => results.slice(0, shownCount), [results, shownCount]);
  const matchesOutsideCategory = useMemo(
    () =>
      activeCategory && results.length === 0
        ? searchPOIs(pois, query, { limit: pois.length }).length
        : 0,
    [activeCategory, pois, query, results.length],
  );
  const categoryLabel = activeCategory ? venue.getCategory(activeCategory)?.label : null;

  const resetResultPage = useCallback(() => {
    setShownCount(RESULTS_PER_PAGE);
    nextResultFocusRef.current = null;
    if (resultsRef.current) resultsRef.current.scrollTop = 0;
  }, []);

  const updateQuery = useCallback(
    (value) => {
      setQuery(value);
      resetResultPage();
    },
    [resetResultPage],
  );

  const clearQuery = useCallback(() => {
    updateQuery('');
    inputRef.current?.focus();
  }, [updateQuery]);

  const clearCategory = useCallback(() => {
    setActiveCategory(null);
    resetResultPage();
    inputRef.current?.focus();
  }, [resetResultPage]);

  const clearFilters = useCallback(() => {
    updateQuery('');
    setActiveCategory(null);
    inputRef.current?.focus();
  }, [updateQuery]);

  const openPanel = useCallback(() => {
    restoreTriggerRef.current = false;
    setIsOpen(true);
  }, []);

  const resetAndClose = useCallback(() => {
    setIsOpen(false);
    setQuery('');
    setActiveCategory(null);
    resetResultPage();
  }, [resetResultPage]);

  const dismissPanel = useCallback(() => {
    restoreTriggerRef.current = true;
    resetAndClose();
  }, [resetAndClose]);

  const replacePanel = useCallback(() => {
    restoreTriggerRef.current = false;
    resetAndClose();
  }, [resetAndClose]);

  // A route can begin in this drawer or in the POI dialog layered above it.
  // In either case the route/failure region owns focus next, and the drawer
  // must release its modal trap before its DOM is removed.
  const routeOwnsFocus = state.navStatus !== NAV_STATUS.IDLE || state.route !== null;

  const { containerRef } = useDialogFocus(isOpen && !routeOwnsFocus, {
    onEscape: dismissPanel,
    initialFocusRef: inputRef,
    trapFocus: !panel.collapsed,
  });

  const handleResultClick = useCallback(
    (node) => {
      actions.selectPOI(node);
    },
    [actions],
  );

  const handleNavigate = useCallback(
    (node, e) => {
      e.stopPropagation();
      actions.navigateTo(node.id);
      replacePanel();
    },
    [actions, replacePanel],
  );

  const toggleCategory = useCallback(
    (cat) => {
      setActiveCategory((prev) => (prev === cat ? null : cat));
      resetResultPage();
    },
    [resetResultPage],
  );

  const showMore = useCallback(() => {
    nextResultFocusRef.current = visibleResults.length;
    setShownCount((count) => count + RESULTS_PER_PAGE);
  }, [visibleResults.length]);

  const routePreviews = useMemo(
    () =>
      new Map(
        visibleResults.map(({ node }) => [
          node.id,
          state.startNodeId && state.startNodeId !== node.id ? previewRoute(node.id) : null,
        ]),
      ),
    [previewRoute, visibleResults, state.startNodeId],
  );

  useEffect(() => {
    const index = nextResultFocusRef.current;
    if (index === null) return;
    nextResultFocusRef.current = null;
    resultsRef.current?.querySelectorAll('.search-result-select')[index]?.focus();
  }, [visibleResults]);

  useEffect(() => {
    if (isOpen || !restoreTriggerRef.current) return;
    restoreTriggerRef.current = false;
    triggerRef.current?.focus({ preventScroll: true });
  }, [isOpen]);

  useEffect(() => {
    if (routeOwnsFocus && isOpen) {
      // The route state is external to this component. Its render already
      // removes the drawer and deactivates the focus trap; retire the local
      // session just after commit so it cannot reopen when guidance ends.
      const closeTask = window.setTimeout(replacePanel, 0);
      return () => window.clearTimeout(closeTask);
    }
    return undefined;
  }, [isOpen, replacePanel, routeOwnsFocus]);

  // Don't show search trigger when navigating
  if (routeOwnsFocus) {
    return null;
  }

  return (
    <>
      {/* Search Trigger Pill */}
      {!isOpen && (
        <div className="search-trigger">
          <button
            ref={triggerRef}
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
        className={`search-overlay ${isOpen ? 'open' : ''}${panel.collapsed ? ' mobile-panel-overlay-folded' : ''}`}
        onClick={dismissPanel}
        id="search-overlay"
        aria-hidden="true"
      />

      {/* Search Panel */}
      {/*
        `inert` while closed, not just invisible.

        The panel slides out of view with opacity 0 and pointer-events none, but
        it stayed in the document at full size with 33 focusable controls in it.
        A keyboard user tabbing across the map fell into a drawer they could not
        see and could not tell they were in. `inert` takes it out of the tab
        order and the accessibility tree in one attribute; the stylesheet also
        hides it once the slide finishes, for anything that does not honour it.
      */}
      <section
        ref={containerRef}
        className={`search-panel ${isOpen ? 'open' : ''}`}
        id="search-panel"
        data-panel-collapsed={panel.collapsed}
        role="dialog"
        aria-modal={isOpen && !state.selectedPOI && !panel.collapsed ? 'true' : undefined}
        aria-labelledby="search-panel-title"
        aria-hidden={state.selectedPOI ? 'true' : undefined}
        tabIndex={-1}
        inert={isOpen && !state.selectedPOI ? undefined : ''}
      >
        <MobilePanelHandle
          panel={panel}
          label="destination search"
          controls="search-input-wrapper category-chips search-results"
        />

        <div className="search-panel-heading">
          <div>
            <span>Explore {venue.config.name}</span>
            <h2 id="search-panel-title">Find a destination</h2>
          </div>
          <button type="button" onClick={dismissPanel} aria-label="Close destination search">
            <X size={18} />
          </button>
        </div>

        <div className="search-input-wrapper mobile-panel-details" id="search-input-wrapper">
          <Search size={18} aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            className="search-input"
            placeholder="Room, service, department…"
            value={query}
            onChange={(e) => updateQuery(e.target.value)}
            id="search-input"
            aria-label="Search rooms and departments"
            aria-controls="search-results"
            aria-describedby="search-results-summary"
            autoComplete="off"
            enterKeyHint="search"
          />
          {query && (
            <button
              type="button"
              className="search-clear-btn"
              onClick={clearQuery}
              id="btn-search-clear"
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="search-section-label mobile-panel-details">
          <span>Browse by category</span>
          {(query || activeCategory) && (
            <button type="button" className="search-reset-filters" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>

        <div
          className="category-chips mobile-panel-details"
          id="category-chips"
          role="group"
          aria-label="Destination categories"
        >
          {categories.map((catId) => {
            const cat = venue.getCategory(catId);
            if (!cat) return null;
            return (
              <button
                key={catId}
                type="button"
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

        <p
          className="search-results-summary mobile-panel-details"
          id="search-results-summary"
          role="status"
          aria-label="Search results"
          aria-live={isOpen && !state.selectedPOI ? 'polite' : 'off'}
          aria-atomic="true"
        >
          {results.length} {results.length === 1 ? 'destination' : 'destinations'}
          {query.trim() ? ` matching “${query.trim()}”` : ''}
          {categoryLabel ? ` in ${categoryLabel}` : ''}.
          {results.length > visibleResults.length
            ? ` Showing ${visibleResults.length}; more are available below.`
            : ''}
        </p>

        {/* Results */}
        <div className="search-results mobile-panel-details" id="search-results" ref={resultsRef}>
          {results.length > 0 ? (
            <>
              <ul className="search-result-list" aria-label="Destination results">
                {visibleResults.map(({ node }) => {
                  const routePreview = routePreviews.get(node.id);
                  return (
                    <li
                      key={node.id}
                      className="search-result-item"
                      id={`search-result-${node.id}`}
                    >
                      <button
                        type="button"
                        className="search-result-select"
                        onClick={() => handleResultClick(node)}
                        aria-label={`View details for ${node.poi.name}`}
                        aria-describedby={`search-meta-${node.id}`}
                      >
                        <div className="search-result-icon" aria-hidden="true">
                          {node.poi.icon}
                        </div>
                        <div className="search-result-info">
                          <div className="search-result-name">{node.poi.name}</div>
                          <div className="search-result-desc" id={`search-meta-${node.id}`}>
                            {node.poi.where ??
                              node.floorName ??
                              venue.getFloorById(node.floor)?.name ??
                              node.floor}{' '}
                            · {node.poi.accessible ? 'Accessible' : 'Not accessible'}
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
                          type="button"
                          className="search-route-button"
                          onClick={(e) => handleNavigate(node, e)}
                          aria-label={`Navigate to ${node.poi.name}`}
                        >
                          <Navigation size={13} aria-hidden="true" />
                          Route
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {results.length > visibleResults.length && (
                <button type="button" className="search-more-results" onClick={showMore}>
                  Show {Math.min(RESULTS_PER_PAGE, results.length - visibleResults.length)} more
                  destinations
                </button>
              )}
            </>
          ) : (
            <div className="search-empty">
              <div className="search-empty-icon" aria-hidden="true">
                <MapPin size={32} />
              </div>
              <h3>No destinations found</h3>
              <p>
                {matchesOutsideCategory > 0
                  ? `Your search has ${matchesOutsideCategory} ${matchesOutsideCategory === 1 ? 'match' : 'matches'} outside ${categoryLabel}.`
                  : 'Try a room name, department, service or a shorter spelling.'}
              </p>
              <div className="search-empty-actions">
                {activeCategory && (
                  <button type="button" onClick={clearCategory}>
                    Search all categories
                  </button>
                )}
                {query && (
                  <button type="button" onClick={clearQuery}>
                    Try another search
                  </button>
                )}
                {(query || activeCategory) && (
                  <button type="button" onClick={clearFilters}>
                    Browse all destinations
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
