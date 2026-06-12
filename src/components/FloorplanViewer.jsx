/**
 * FloorplanViewer.jsx
 * 
 * Ultra-Premium Canvas rendering engine using react-konva.
 * Features:
 *   - 2.5D room depth (inner shadow + gradient fills)
 *   - Pulsing "You Are Here" position marker
 *   - Full Light/Dark theme support
 *   - Professional dashed wayfinding route
 */

import React, { useRef, useState, useEffect, useMemo } from 'react';
import { Stage, Layer, Path, Text, Circle, Line, Rect, Group } from 'react-konva';
import { useNavigation } from '../context/NavigationContext.jsx';
import { BUILDING_OUTLINE, ROOMS, CORRIDOR_LABELS, ENTRANCE } from '../data/buildingGeometry.js';
import { getNodeById } from '../data/buildingGraph.js';

// ── DUAL THEME PALETTES ──
const PALETTES = {
  light: {
    bg: '#EBE9E1',
    floorBase: '#FFFFFF',
    wall: '#64748B',
    wallStrokeWidth: 4,
    roomMedical: '#DBEAFE',
    roomService: '#F1F5F9',
    roomAdmin: '#EDE9FE',
    roomEmergency: '#FEE2E2',
    roomDiagnostic: '#FEF3C7',
    roomEntrance: '#CCFBF1',
    roomRestroom: '#F1F5F9',
    roomPharmacy: '#D1FAE5',
    roomHover: '#BFDBFE',
    roomInnerShadow: 'rgba(0,0,0,0.06)',
    text: '#1E293B',
    textHalo: '#FFFFFF',
    corridorLabel: '#9CA3AF',
    routePath: '#2563EB',
    routeShadow: 'rgba(37, 99, 235, 0.15)',
    positionDot: '#2563EB',
    positionGlow: 'rgba(37, 99, 235, 0.2)',
  },
  dark: {
    bg: '#0F172A',
    floorBase: '#1E293B',
    wall: '#475569',
    wallStrokeWidth: 4,
    roomMedical: '#1E3A5F',
    roomService: '#1E293B',
    roomAdmin: '#2E1065',
    roomEmergency: '#450A0A',
    roomDiagnostic: '#422006',
    roomEntrance: '#042F2E',
    roomRestroom: '#1E293B',
    roomPharmacy: '#052E16',
    roomHover: '#334155',
    roomInnerShadow: 'rgba(0,0,0,0.25)',
    text: '#E2E8F0',
    textHalo: '#0F172A',
    corridorLabel: '#64748B',
    routePath: '#60A5FA',
    routeShadow: 'rgba(96, 165, 250, 0.2)',
    positionDot: '#60A5FA',
    positionGlow: 'rgba(96, 165, 250, 0.25)',
  }
};

export default function FloorplanViewer() {
  const { state, actions, theme } = useNavigation();
  const [scale, setScale] = useState(0.55);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [positionPulse, setPositionPulse] = useState(0);
  const containerRef = useRef(null);
  const stageRef = useRef(null);
  const staticLayerRef = useRef(null);

  const colors = PALETTES[theme] || PALETTES.light;

  // ── Animate the position pulse ──
  useEffect(() => {
    let frame;
    const animate = () => {
      setPositionPulse(prev => (prev + 0.03) % (Math.PI * 2));
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (containerRef.current) {
      const { width, height } = containerRef.current.getBoundingClientRect();
      setPosition({ x: width / 2 - 1000 * scale, y: height / 2 - 700 * scale });
      
      const resizeObserver = new ResizeObserver((entries) => {
        for (let entry of entries) {
          setDimensions({
            width: entry.contentRect.width,
            height: entry.contentRect.height
          });
        }
      });
      resizeObserver.observe(containerRef.current);
      return () => resizeObserver.disconnect();
    }
  }, []);

  useEffect(() => {
    if (staticLayerRef.current) {
      setTimeout(() => {
        if (staticLayerRef.current) {
          staticLayerRef.current.clearCache();
          staticLayerRef.current.cache();
        }
      }, 50);
    }
  }, [scale, theme]);

  const handleWheel = (e) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();
    const mousePointTo = { x: (pointer.x - stage.x()) / oldScale, y: (pointer.y - stage.y()) / oldScale };
    let direction = e.evt.deltaY > 0 ? -1 : 1;
    if (e.evt.ctrlKey) direction = -direction;
    const newScale = direction > 0 ? oldScale * 1.1 : oldScale / 1.1;
    const clampedScale = Math.max(0.15, Math.min(newScale, 4));
    setScale(clampedScale);
    setPosition({ x: pointer.x - mousePointTo.x * clampedScale, y: pointer.y - mousePointTo.y * clampedScale });
  };

  const handleZoom = (direction) => {
    const newScale = direction === 1 ? scale * 1.3 : scale / 1.3;
    const clampedScale = Math.max(0.15, Math.min(newScale, 4));
    if (containerRef.current) {
      const { width, height } = containerRef.current.getBoundingClientRect();
      const center = { x: width / 2, y: height / 2 };
      const mousePointTo = { x: (center.x - position.x) / scale, y: (center.y - position.y) / scale };
      setScale(clampedScale);
      setPosition({ x: center.x - mousePointTo.x * clampedScale, y: center.y - mousePointTo.y * clampedScale });
    }
  };

  const routePoints = useMemo(() => {
    if (!state.route || !state.route.path) return [];
    return state.route.path.flatMap(node => [node.x, node.y]);
  }, [state.route]);

  // Find user's current position node
  const startNode = useMemo(() => getNodeById(state.startNodeId), [state.startNodeId]);

  // Color lookup
  const getRoomColor = (category) => {
    switch (category) {
      case 'medical': return colors.roomMedical;
      case 'emergency': return colors.roomEmergency;
      case 'diagnostic': return colors.roomDiagnostic;
      case 'admin': return colors.roomAdmin;
      case 'service': return colors.roomService;
      case 'entrance': return colors.roomEntrance;
      case 'restroom': return colors.roomRestroom;
      case 'pharmacy': return colors.roomPharmacy;
      default: return colors.roomService;
    }
  };

  const pulseRadius = 18 + Math.sin(positionPulse) * 8;
  const pulseOpacity = 0.3 - Math.sin(positionPulse) * 0.15;

  return (
    <div className="map-container" ref={containerRef} style={{ width: '100%', height: '100%', background: colors.bg }}>
      <Stage
        width={dimensions.width} height={dimensions.height}
        scaleX={scale} scaleY={scale}
        x={position.x} y={position.y}
        draggable
        onWheel={handleWheel}
        onDragEnd={(e) => setPosition({ x: e.target.x(), y: e.target.y() })}
        ref={stageRef}
      >
        {/* ── LAYER 1: STATIC BASE (CACHED) ── */}
        <Layer ref={staticLayerRef}>
          {/* Building footprint with 2.5D drop shadow */}
          <Path
            data={BUILDING_OUTLINE.path}
            fill={colors.floorBase} stroke={colors.wall} strokeWidth={6}
            lineJoin="round"
            shadowColor="rgba(0,0,0,0.2)" shadowBlur={30} shadowOffsetX={8} shadowOffsetY={12}
          />

          {/* Corridor Labels */}
          {CORRIDOR_LABELS.map((lbl, idx) => (
            <Text
              key={`cl-${idx}`} x={lbl.x} y={lbl.y} text={lbl.text} rotation={lbl.rotate}
              fontSize={22} fill={colors.corridorLabel} opacity={0.5} fontWeight="700" letterSpacing={6}
              fontFamily="-apple-system, 'Segoe UI', sans-serif" align="center"
            />
          ))}
        </Layer>

        {/* ── LAYER 2: 2.5D INTERACTIVE ROOMS ── */}
        <Layer>
          {ROOMS.map(room => {
            const dest = state.destinationNodeId === room.id;
            const start = state.startNodeId === room.id;
            const sel = state.selectedPOI?.id === room.id;
            const baseColor = getRoomColor(room.category);
            const b = room.bounds;

            let fill = baseColor;
            let stroke = colors.wall;
            let strokeWidth = colors.wallStrokeWidth;

            if (sel) { fill = colors.roomHover; stroke = colors.routePath; strokeWidth = 6; }
            else if (dest) { stroke = '#22C55E'; strokeWidth = 6; }
            else if (start) { stroke = colors.routePath; strokeWidth = 5; }

            return (
              <Group
                key={`room-${room.id}`}
                onClick={() => actions.selectPOI({ id: room.id, poi: { ...room, name: room.label } })}
                onTap={() => actions.selectPOI({ id: room.id, poi: { ...room, name: room.label } })}
              >
                {/* ── 2.5D DEPTH EFFECT ── */}
                {/* Bottom shadow edge (simulates wall thickness / 3D extrusion) */}
                {b && (
                  <Rect
                    x={b.x + 3} y={b.y + 3}
                    width={b.w} height={b.h}
                    fill={colors.roomInnerShadow}
                    cornerRadius={2}
                  />
                )}

                {/* Main room surface */}
                <Path
                  data={room.path}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={strokeWidth}
                  shadowColor={sel || dest ? stroke : "transparent"}
                  shadowBlur={sel || dest ? 12 : 0}
                  onMouseEnter={(e) => { e.target.getStage().container().style.cursor = 'pointer'; }}
                  onMouseLeave={(e) => { e.target.getStage().container().style.cursor = 'default'; }}
                />

                {/* Inner top-left highlight (simulates light source for 2.5D) */}
                {b && (
                  <Line
                    points={[b.x + 6, b.y + 6, b.x + b.w - 6, b.y + 6]}
                    stroke={theme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.6)'}
                    strokeWidth={2} lineCap="round"
                  />
                )}

                {/* Center Icon */}
                {room.icon && (
                  <Text x={room.center.x - 16} y={room.center.y - 25} text={room.icon} fontSize={32} />
                )}

                {/* Center Text with halo */}
                {room.label && (
                  <Text
                    x={room.center.x - (room.label.length * 4)} y={room.center.y + 12}
                    text={room.label} fontSize={14} fill={colors.text} fontWeight="600"
                    fontFamily="-apple-system, 'Segoe UI', sans-serif"
                    stroke={colors.textHalo} strokeWidth={3} fillAfterStrokeEnabled={true}
                  />
                )}
              </Group>
            );
          })}
        </Layer>

        {/* ── LAYER 3: DYNAMIC ROUTES ── */}
        <Layer>
          {routePoints.length > 0 && (
            <>
              <Line points={routePoints} stroke={colors.routeShadow} strokeWidth={24} lineCap="round" lineJoin="round" />
              <Line
                points={routePoints} stroke={colors.routePath} strokeWidth={5}
                lineCap="round" lineJoin="round"
                dash={[15, 10]}
              />
              {/* Start pin */}
              <Circle x={routePoints[0]} y={routePoints[1]} radius={10} fill={colors.routePath} stroke="white" strokeWidth={3} />
              {/* End pin */}
              <Circle x={routePoints[routePoints.length - 2]} y={routePoints[routePoints.length - 1]} radius={14} fill="#22C55E" stroke="white" strokeWidth={3} shadowColor="rgba(0,0,0,0.3)" shadowOffsetY={2} shadowBlur={4} />
            </>
          )}

          {/* ── "YOU ARE HERE" PULSING POSITION MARKER ── */}
          {startNode && (
            <>
              {/* Pulsing glow ring */}
              <Circle
                x={startNode.x} y={startNode.y} radius={pulseRadius}
                fill={colors.positionGlow} opacity={pulseOpacity}
              />
              {/* Solid dot */}
              <Circle
                x={startNode.x} y={startNode.y} radius={10}
                fill={colors.positionDot} stroke="white" strokeWidth={3}
                shadowColor="rgba(0,0,0,0.3)" shadowBlur={6} shadowOffsetY={2}
              />
            </>
          )}
        </Layer>
      </Stage>

      {/* Floating Zoom Controls */}
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
