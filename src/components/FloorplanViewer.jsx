/**
 * FloorplanViewer.jsx
 * 
 * Interactive SVG floorplan with pan/zoom, POI markers, and route overlay.
 * Uses CSS transforms for performance (no SVG attribute recalculation).
 * Touch and mouse events for pan/zoom gestures.
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import { Plus, Minus, Locate } from 'lucide-react';
import { useNavigation, NAV_STATUS } from '../context/NavigationContext.jsx';
import { NODES, EDGES, getNodeById, CATEGORIES } from '../data/buildingGraph.js';
import { BUILDING_CONFIG } from '../data/buildingConfig.js';

export default function FloorplanViewer() {
  const { state, actions } = useNavigation();
  const { route, startNodeId, navStatus, currentStepIndex } = state;

  const containerRef = useRef(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const lastTransform = useRef({ x: 0, y: 0 });

  // ── Pan/Zoom Handlers ──
  const handleMouseDown = useCallback((e) => {
    if (e.target.closest('.poi-marker')) return; // Don't drag when clicking POIs
    isDragging.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY };
    lastTransform.current = { x: transform.x, y: transform.y };
  }, [transform.x, transform.y]);

  const handleMouseMove = useCallback((e) => {
    if (!isDragging.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setTransform(prev => ({
      ...prev,
      x: lastTransform.current.x + dx,
      y: lastTransform.current.y + dy,
    }));
  }, []);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setTransform(prev => ({
      ...prev,
      scale: Math.max(0.5, Math.min(3, prev.scale + delta)),
    }));
  }, []);

  // Touch support
  const touchStart = useRef(null);
  const initialPinchDist = useRef(null);
  const initialScale = useRef(1);

  const handleTouchStart = useCallback((e) => {
    if (e.touches.length === 1) {
      if (e.target.closest('.poi-marker')) return;
      isDragging.current = true;
      dragStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      lastTransform.current = { x: transform.x, y: transform.y };
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      initialPinchDist.current = Math.sqrt(dx * dx + dy * dy);
      initialScale.current = transform.scale;
    }
  }, [transform.x, transform.y, transform.scale]);

  const handleTouchMove = useCallback((e) => {
    if (e.touches.length === 1 && isDragging.current) {
      const dx = e.touches[0].clientX - dragStart.current.x;
      const dy = e.touches[0].clientY - dragStart.current.y;
      setTransform(prev => ({
        ...prev,
        x: lastTransform.current.x + dx,
        y: lastTransform.current.y + dy,
      }));
    } else if (e.touches.length === 2 && initialPinchDist.current) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const scaleRatio = dist / initialPinchDist.current;
      setTransform(prev => ({
        ...prev,
        scale: Math.max(0.5, Math.min(3, initialScale.current * scaleRatio)),
      }));
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    isDragging.current = false;
    initialPinchDist.current = null;
  }, []);

  // Attach wheel event with passive: false
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  const zoomIn = () => setTransform(prev => ({ ...prev, scale: Math.min(3, prev.scale + 0.3) }));
  const zoomOut = () => setTransform(prev => ({ ...prev, scale: Math.max(0.5, prev.scale - 0.3) }));
  const resetView = () => setTransform({ x: 0, y: 0, scale: 1 });

  // ── POI Click ──
  const handlePOIClick = useCallback((node) => {
    actions.selectPOI(node);
  }, [actions]);

  // ── Render Helpers ──
  const pois = NODES.filter(n => n.type === 'poi' && n.poi);
  const vb = BUILDING_CONFIG.viewBox;

  // Build room rectangles for POIs
  const getRoomRect = (node) => {
    const w = 60;
    const h = 40;
    return { x: node.x - w / 2, y: node.y - h / 2, width: w, height: h };
  };

  // Route polyline points
  const routePoints = route?.path
    ? route.path.map(n => `${n.x},${n.y}`).join(' ')
    : '';

  return (
    <div
      className="floorplan-container"
      ref={containerRef}
      id="floorplan-container"
    >
      <div
        className="floorplan-svg-wrapper"
        style={{
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          transformOrigin: 'center center',
          transition: isDragging.current ? 'none' : 'transform 0.2s ease-out',
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <svg
          viewBox={`0 0 ${vb.width} ${vb.height}`}
          xmlns="http://www.w3.org/2000/svg"
          style={{ width: '100%', height: '100%' }}
        >
          <defs>
            {/* Dot Grid pattern */}
            <pattern id="dotGrid" width="20" height="20" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="1.5" fill="var(--map-grid)" />
            </pattern>
            
            {/* Glow filter for route */}
            <filter id="route-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Background grid */}
          <rect width={vb.width} height={vb.height} fill="url(#dotGrid)" />

          {/* ── Building outline ── */}
          <rect
            x="60" y="80" width="680" height="410"
            rx="12" ry="12"
            fill="none"
            stroke="rgba(148, 163, 219, 0.08)"
            strokeWidth="1"
            strokeDasharray="4 2"
          />

          {/* ── Corridor Base (Borders) ── */}
          {EDGES.map((edge, i) => {
            const fromNode = getNodeById(edge.from);
            const toNode = getNodeById(edge.to);
            if (!fromNode || !toNode) return null;
            return (
              <line
                key={`edge-base-${i}`}
                x1={fromNode.x} y1={fromNode.y}
                x2={toNode.x} y2={toNode.y}
                stroke="var(--map-room-stroke)"
                strokeWidth="26"
                strokeLinecap="round"
              />
            );
          })}

          {/* ── Corridor Fill ── */}
          {EDGES.map((edge, i) => {
            const fromNode = getNodeById(edge.from);
            const toNode = getNodeById(edge.to);
            if (!fromNode || !toNode) return null;
            return (
              <line
                key={`edge-fill-${i}`}
                x1={fromNode.x} y1={fromNode.y}
                x2={toNode.x} y2={toNode.y}
                stroke="var(--map-room-fill)"
                strokeWidth="24"
                strokeLinecap="round"
              />
            );
          })}

          {/* ── Corridor center lines ── */}
          {EDGES.map((edge, i) => {
            const fromNode = getNodeById(edge.from);
            const toNode = getNodeById(edge.to);
            if (!fromNode || !toNode) return null;
            return (
              <line
                key={`edge-center-${i}`}
                x1={fromNode.x} y1={fromNode.y}
                x2={toNode.x} y2={toNode.y}
                stroke="rgba(148, 163, 219, 0.04)"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
            );
          })}

          {/* ── Room Rectangles ── */}
          {pois.map(node => {
            const rect = getRoomRect(node);
            const cat = CATEGORIES[node.poi.category];
            const isStart = node.id === startNodeId;
            const isDest = node.id === state.destinationNodeId;
            
            let className = 'room-fill';
            if (isDest) className += ' destination';
            else if (isStart) className += ' selected';

            return (
              <g key={`room-${node.id}`} className="poi-marker" onClick={() => handlePOIClick(node)}>
                {/* Room background */}
                <rect
                  {...rect}
                  rx="8" ry="8"
                  className={className}
                  style={isDest ? { stroke: cat?.color } : isStart ? { stroke: '#3b82f6' } : {}}
                />
                {/* Room label */}
                <text
                  x={node.x}
                  y={node.y - 6}
                  className="room-label"
                  style={{ fontSize: '5.5px' }}
                >
                  {node.poi.name}
                </text>
                {/* Category icon */}
                <text
                  x={node.x}
                  y={node.y + 8}
                  className="poi-marker-icon"
                  style={{ fontSize: '10px' }}
                >
                  {node.poi.icon}
                </text>
              </g>
            );
          })}

          {/* ── Route Overlay ── */}
          {route?.found && routePoints && (
            <g>
              {/* Route glow background */}
              <polyline
                points={routePoints}
                className="route-path-bg"
              />
              {/* Route line */}
              <polyline
                points={routePoints}
                className="route-path route-path-animated"
                filter="url(#route-glow)"
              />
            </g>
          )}

          {/* ── Current Position Marker ── */}
          {startNodeId && (() => {
            const startNode = getNodeById(startNodeId);
            if (!startNode) return null;
            return (
              <g>
                <circle cx={startNode.x} cy={startNode.y} r="14" className="current-pos-outer" />
                <circle cx={startNode.x} cy={startNode.y} r="6" className="current-pos-inner" />
              </g>
            );
          })()}

          {/* ── Destination Marker ── */}
          {state.destinationNodeId && navStatus !== NAV_STATUS.IDLE && (() => {
            const destNode = getNodeById(state.destinationNodeId);
            if (!destNode) return null;
            return (
              <g>
                <circle cx={destNode.x} cy={destNode.y} r="18" className="dest-marker-glow" />
                <circle cx={destNode.x} cy={destNode.y} r="8" className="dest-marker-bg" />
                <text x={destNode.x} y={destNode.y} className="dest-marker-icon">📍</text>
              </g>
            );
          })()}

          {/* ── Junction dots (removed for clean look) ── */}
        </svg>
      </div>

      {/* Zoom Controls */}
      <div className="zoom-controls" id="zoom-controls">
        <button className="zoom-btn" onClick={zoomIn} aria-label="Zoom in" id="btn-zoom-in">
          <Plus size={18} />
        </button>
        <button className="zoom-btn" onClick={zoomOut} aria-label="Zoom out" id="btn-zoom-out">
          <Minus size={18} />
        </button>
        <button className="zoom-btn" onClick={resetView} aria-label="Reset view" id="btn-reset-view">
          <Locate size={18} />
        </button>
      </div>
    </div>
  );
}
