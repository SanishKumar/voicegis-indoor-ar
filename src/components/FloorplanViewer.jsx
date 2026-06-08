/**
 * FloorplanViewer.jsx
 * 
 * High-performance Canvas rendering engine using react-konva.
 * Capable of rendering thousands of SVG paths at 60 FPS while supporting zooming and panning.
 */

import React, { useRef, useState, useEffect, useMemo } from 'react';
import { Stage, Layer, Path, Text, Circle, Line, Rect, Group } from 'react-konva';
import { useNavigation, VIEW_TYPE } from '../context/NavigationContext.jsx';
import { BUILDING_OUTLINE, ROOMS, ARCHITECTURAL_DETAILS, CORRIDOR_LABELS, ENTRANCE } from '../data/buildingGeometry.js';
import { CATEGORIES } from '../data/buildingGraph.js';

// Theme Colors for Canvas
const MAP_COLORS = {
  light: {
    bg: '#eef2f7',
    corridor: '#dce4ee',
    wall: '#64748b',
    room: '#ffffff',
    roomHover: '#f0f4ff',
    text: '#334155',
    grid: 'rgba(0,0,0,0.04)',
    accent: '#3b82f6',
    routePath: 'rgba(59, 130, 246, 0.4)',
  },
  dark: {
    bg: '#0b0f19',
    corridor: '#0f172a',
    wall: '#334155',
    room: '#1e293b',
    roomHover: '#1e293b',
    text: '#94a3b8',
    grid: 'rgba(255,255,255,0.02)',
    accent: '#3b82f6',
    routePath: 'rgba(59, 130, 246, 0.4)',
  }
};

export default function FloorplanViewer() {
  const { state, actions, theme } = useNavigation();
  const [scale, setScale] = useState(0.3);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const containerRef = useRef(null);
  const stageRef = useRef(null);
  const staticLayerRef = useRef(null);

  const colors = MAP_COLORS[theme] || MAP_COLORS.light;

  // Center the map on mount
  useEffect(() => {
    if (containerRef.current) {
      const { width, height } = containerRef.current.getBoundingClientRect();
      setPosition({
        x: width / 2 - 1500 * scale, // Center of 3000x2000
        y: height / 2 - 1000 * scale
      });
    }
  }, []);

  // Cache the static layer to guarantee 60 FPS
  useEffect(() => {
    if (staticLayerRef.current) {
      // Re-cache when theme changes
      staticLayerRef.current.clearCache();
      staticLayerRef.current.cache();
    }
  }, [theme]);

  const handleWheel = (e) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;

    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();

    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };

    let direction = e.evt.deltaY > 0 ? -1 : 1;
    if (e.evt.ctrlKey) direction = -direction;

    const scaleBy = 1.1;
    const newScale = direction > 0 ? oldScale * scaleBy : oldScale / scaleBy;
    const clampedScale = Math.max(0.1, Math.min(newScale, 3));

    setScale(clampedScale);
    setPosition({
      x: pointer.x - mousePointTo.x * clampedScale,
      y: pointer.y - mousePointTo.y * clampedScale,
    });
  };

  const handleZoom = (direction) => {
    const scaleBy = 1.3;
    const newScale = direction === 1 ? scale * scaleBy : scale / scaleBy;
    const clampedScale = Math.max(0.1, Math.min(newScale, 3));
    
    // Zoom to center
    if (containerRef.current) {
      const { width, height } = containerRef.current.getBoundingClientRect();
      const center = { x: width / 2, y: height / 2 };
      
      const mousePointTo = {
        x: (center.x - position.x) / scale,
        y: (center.y - position.y) / scale,
      };

      setScale(clampedScale);
      setPosition({
        x: center.x - mousePointTo.x * clampedScale,
        y: center.y - mousePointTo.y * clampedScale,
      });
    }
  };

  const isSelected = (id) => state.selectedPOI?.id === id;
  const isStart = (id) => state.startNodeId === id;
  const isDestination = (id) => state.destinationNodeId === id;

  // Prepare route line if active
  const routePoints = useMemo(() => {
    if (!state.route || !state.route.path) return [];
    return state.route.path.flatMap(node => [node.x, node.y]);
  }, [state.route]);

  return (
    <div className="map-container" ref={containerRef} style={{ width: '100%', height: '100%', background: colors.bg }}>
      <Stage
        width={window.innerWidth}
        height={window.innerHeight}
        scaleX={scale}
        scaleY={scale}
        x={position.x}
        y={position.y}
        draggable
        onWheel={handleWheel}
        onDragEnd={(e) => {
          setPosition({ x: e.target.x(), y: e.target.y() });
        }}
        ref={stageRef}
      >
        {/* ── LAYER 1: STATIC ARCHITECTURE (CACHED) ── */}
        <Layer ref={staticLayerRef}>
          {/* Building Footprint (Corridor Floor) */}
          <Path
            data={BUILDING_OUTLINE.path}
            fill={colors.corridor}
            stroke={colors.wall}
            strokeWidth={4}
            lineJoin="round"
          />

          {/* Architectural Details */}
          {ARCHITECTURAL_DETAILS.map((detail, idx) => {
            if (detail.type === 'pillar') {
              return <Circle key={idx} x={detail.x} y={detail.y} radius={detail.r} fill={colors.wall} />;
            }
            if (detail.type === 'elevator') {
              return (
                <Group key={idx} x={detail.x} y={detail.y}>
                  <Rect width={detail.w} height={detail.h} stroke={colors.wall} strokeWidth={2} fill={colors.corridor} />
                  <Line points={[0, 0, detail.w, detail.h]} stroke={colors.wall} strokeWidth={2} />
                  <Line points={[0, detail.h, detail.w, 0]} stroke={colors.wall} strokeWidth={2} />
                </Group>
              );
            }
            if (detail.type === 'stairs') {
              return (
                <Group key={idx} x={detail.x} y={detail.y}>
                  <Rect width={detail.w} height={detail.h} stroke={colors.wall} strokeWidth={2} fill={colors.bg} />
                  {Array.from({ length: detail.steps }).map((_, sIdx) => {
                    const stepY = (detail.h / detail.steps) * sIdx;
                    return <Line key={sIdx} points={[0, stepY, detail.w, stepY]} stroke={colors.wall} strokeWidth={1} />;
                  })}
                </Group>
              );
            }
            return null;
          })}

          {/* Corridor Labels */}
          {CORRIDOR_LABELS.map((lbl, idx) => (
            <Text
              key={`cl-${idx}`}
              x={lbl.x} y={lbl.y}
              text={lbl.text}
              rotation={lbl.rotate}
              fontSize={lbl.size === 'large' ? 48 : 32}
              fill={colors.text}
              opacity={0.3}
              fontFamily="system-ui"
              fontWeight="bold"
              align="center"
              verticalAlign="middle"
              offsetX={100}
            />
          ))}
        </Layer>

        {/* ── LAYER 2: INTERACTIVE ROOMS ── */}
        <Layer>
          {ROOMS.map(room => {
            const dest = isDestination(room.id);
            const start = isStart(room.id);
            const sel = isSelected(room.id);
            
            let fill = colors.room;
            let stroke = colors.wall;
            let strokeWidth = 2;

            if (sel) {
              fill = colors.roomHover;
              stroke = colors.accent;
              strokeWidth = 6;
            }
            if (start) {
              stroke = '#3b82f6';
              strokeWidth = 6;
            }
            if (dest) {
              stroke = '#10b981';
              strokeWidth = 6;
            }

            const catColor = CATEGORIES[room.category]?.color || '#cbd5e1';

            return (
              <Group
                key={`room-${room.id}`}
                onClick={() => {
                  const poi = { ...room, name: room.label };
                  actions.selectPOI({ id: room.id, poi });
                }}
                onTap={() => {
                  const poi = { ...room, name: room.label };
                  actions.selectPOI({ id: room.id, poi });
                }}
              >
                {/* Room Geometry */}
                <Path
                  data={room.path}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={strokeWidth}
                  shadowColor="rgba(0,0,0,0.1)"
                  shadowBlur={10}
                  shadowOffsetY={4}
                  onMouseEnter={(e) => {
                    const container = e.target.getStage().container();
                    container.style.cursor = 'pointer';
                  }}
                  onMouseLeave={(e) => {
                    const container = e.target.getStage().container();
                    container.style.cursor = 'default';
                  }}
                />

                {/* Center Icon & Text */}
                <Text
                  x={room.center.x} y={room.center.y - 20}
                  text={room.icon}
                  fontSize={40}
                  align="center"
                  offsetX={20}
                />
                <Text
                  x={room.center.x} y={room.center.y + 25}
                  text={room.label}
                  fontSize={18}
                  fill={colors.text}
                  fontFamily="system-ui"
                  fontWeight="bold"
                  align="center"
                  offsetX={room.label.length * 4.5} // rough centering
                />
              </Group>
            );
          })}

          {/* Entrance Marker */}
          <Circle
            x={ENTRANCE.x} y={ENTRANCE.y}
            radius={20}
            fill="#06b6d4"
            stroke="white"
            strokeWidth={4}
            shadowColor="rgba(0,0,0,0.2)"
            shadowBlur={10}
          />
        </Layer>

        {/* ── LAYER 3: DYNAMIC ROUTES ── */}
        <Layer>
          {routePoints.length > 0 && (
            <>
              {/* Glow/Shadow underlying line */}
              <Line
                points={routePoints}
                stroke={colors.routePath}
                strokeWidth={16}
                lineCap="round"
                lineJoin="round"
              />
              {/* Main routing line */}
              <Line
                points={routePoints}
                stroke={colors.accent}
                strokeWidth={6}
                lineCap="round"
                lineJoin="round"
              />
              
              {/* Origin Dot */}
              <Circle
                x={routePoints[0]} y={routePoints[1]}
                radius={12} fill={colors.accent} stroke="white" strokeWidth={4}
              />
              
              {/* Destination Dot */}
              <Circle
                x={routePoints[routePoints.length - 2]} y={routePoints[routePoints.length - 1]}
                radius={16} fill="#10b981" stroke="white" strokeWidth={4}
              />
            </>
          )}
        </Layer>
      </Stage>

      {/* Floating Zoom Controls (DOM overlay) */}
      <div className="zoom-controls">
        <button className="zoom-btn" onClick={() => handleZoom(1)} aria-label="Zoom In">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        </button>
        <button className="zoom-btn" onClick={() => handleZoom(-1)} aria-label="Zoom Out">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        </button>
      </div>
    </div>
  );
}
