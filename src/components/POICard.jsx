/**
 * POICard.jsx
 *
 * Detail popup when a user taps a POI on the floorplan.
 * Shows room info and a "Navigate Here" CTA.
 */

import { X, Navigation, MapPin, Clock } from 'lucide-react';
import { useNavigation } from '../context/NavigationContext.jsx';
import { CATEGORIES, getFloorById, getNodeById } from '../data/compiledBuilding';
import { formatDistance, estimateWalkTime } from '../data/buildingConfig.js';

export default function POICard() {
  const { state, actions } = useNavigation();
  const { selectedPOI, startNodeId } = state;

  if (!selectedPOI) return null;

  const poi = selectedPOI.poi;
  const cat = CATEGORIES[poi.category];

  // Calculate straight-line approximate distance (no async call)
  let distanceInfo = null;
  if (startNodeId && startNodeId !== selectedPOI.id) {
    const startNode = getNodeById(startNodeId);
    const endNode = getNodeById(selectedPOI.id);
    if (startNode && endNode) {
      const dx = startNode.x - endNode.x;
      const dy = startNode.y - endNode.y;
      const startElevation = getFloorById(String(startNode.floor))?.elevation ?? 0;
      const endElevation = getFloorById(String(endNode.floor))?.elevation ?? 0;
      const approxDist = Math.hypot(dx, dy, endElevation - startElevation);
      distanceInfo = {
        distance: approxDist,
        walkTime: estimateWalkTime(approxDist),
      };
    }
  }

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
      <div className="poi-card animate-slide-up" id="poi-card">
        {/* Close Button */}
        <button
          className="poi-card-close"
          onClick={() => actions.clearSelectedPOI()}
          id="btn-poi-close"
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
            <h2 className="poi-card-title">{poi.name}</h2>
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
              <MapPin size={14} />~{formatDistance(distanceInfo.distance)} away
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
            >
              <MapPin size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
