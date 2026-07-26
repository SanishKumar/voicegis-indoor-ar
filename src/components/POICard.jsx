/**
 * POICard.jsx
 *
 * Detail popup when a user taps a POI on the floorplan.
 * Shows room info and a "Navigate Here" CTA.
 */

import { X, Navigation, MapPin, Clock } from 'lucide-react';
import { useEffect } from 'react';
import { useNavigation } from '../context/NavigationContext.jsx';
import { CATEGORIES } from '../data/compiledBuilding';
import { formatDistance, estimateWalkTime } from '../data/buildingConfig.js';

export default function POICard() {
  const { state, actions, previewRoute } = useNavigation();
  const { selectedPOI, startNodeId } = state;

  useEffect(() => {
    if (!selectedPOI) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') actions.clearSelectedPOI();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [actions, selectedPOI]);

  if (!selectedPOI) return null;

  const poi = selectedPOI.poi;
  const cat = CATEGORIES[poi.category];

  const routePreview =
    startNodeId && startNodeId !== selectedPOI.id ? previewRoute(selectedPOI.id) : null;
  const distanceInfo = routePreview?.found
    ? {
        distance: routePreview.totalDistance,
        walkTime: estimateWalkTime(routePreview.totalDistance),
      }
    : null;

  const handleNavigate = () => {
    actions.navigateTo(selectedPOI.id);
  };

  const handleSetAsStart = () => {
    actions.setStart(selectedPOI.id);
    actions.clearSelectedPOI();
  };

  return (
    <div
      className={`poi-card-overlay ${selectedPOI ? 'open' : ''}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) actions.clearSelectedPOI();
      }}
      id="poi-card-overlay"
    >
      <div
        className="poi-card animate-slide-up"
        id="poi-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="poi-card-title"
      >
        {/* Close Button */}
        <button
          className="poi-card-close"
          onClick={() => actions.clearSelectedPOI()}
          id="btn-poi-close"
          aria-label="Close destination details"
          style={{
            position: 'relative',
            marginLeft: 'auto',
            display: 'block',
            marginBottom: '-24px',
          }}
        >
          <X size={16} />
        </button>

        {/* Header */}
        <div className="poi-card-header">
          <div className="poi-card-icon" style={{ background: cat?.bgColor, color: cat?.color }}>
            {poi.icon}
          </div>
          <div>
            <h2 className="poi-card-title" id="poi-card-title">
              {poi.name}
            </h2>
            <span
              className="poi-card-category"
              style={{ background: cat?.bgColor, color: cat?.color }}
            >
              {cat?.icon} {cat?.label}
            </span>
          </div>
        </div>

        {/* Description */}
        <p className="poi-card-desc">
          {poi.description} · {poi.accessible ? 'Accessible' : 'Not accessible'}
        </p>

        {/* Meta Info */}
        {distanceInfo && (
          <div className="poi-card-meta">
            <div className="poi-card-meta-item">
              <MapPin size={14} />
              {formatDistance(distanceInfo.distance)} by route
            </div>
            <div className="poi-card-meta-item">
              <Clock size={14} />~{distanceInfo.walkTime} walk
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="poi-card-actions">
          <button
            className="btn btn-success btn-lg"
            onClick={handleNavigate}
            id="btn-navigate-to"
            style={{ flex: 1 }}
          >
            <Navigation size={18} />
            Navigate Here
          </button>
          {selectedPOI.id !== startNodeId && (
            <button
              className="btn btn-ghost"
              onClick={handleSetAsStart}
            id="btn-set-start"
            title="Set as starting point"
            aria-label={`Set ${poi.name} as starting point`}
            >
              <MapPin size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
