import { useEffect, useMemo, useRef, useState } from 'react';
import { Circle, Group, Layer, Line, Rect, Stage, Text } from 'react-konva';
import type Konva from 'konva';
import { Accessibility, Database, Layers, LockKeyhole } from 'lucide-react';
import { useNavigation } from '../context/NavigationContext.jsx';
import {
  BUILDING_PACKAGE,
  CATEGORIES,
  getFloorById,
  getNodeById,
  getPOIs,
  type VisitorPoiNode,
} from '../data/compiledBuilding';
import { floorTransitions, polygonCentroid, routeSegmentsForFloor } from '../engine/floorplanModel';
import type { RouteResult } from '../engine/routingCore';

const WORLD_SCALE = 44;
const MAP_PADDING = 50;

interface NavigatorContextValue {
  state: {
    activeFloorId: string;
    route: RouteResult | null;
    startNodeId: string | null;
    destinationNodeId: string | null;
    selectedPOI: VisitorPoiNode | null;
  };
  actions: {
    setFloor: (floorId: string) => void;
    selectPOI: (node: VisitorPoiNode) => void;
  };
  theme: 'light' | 'dark';
}

const SPACE_COLORS = {
  entrance: '#0e7490',
  room: '#334155',
  corridor: '#115e59',
  lobby: '#1d4ed8',
  service: '#6d28d9',
  restricted: '#9f1239',
  'vertical-circulation': '#b45309',
} as const;

const LIGHT_SPACE_COLORS = {
  entrance: '#cffafe',
  room: '#e2e8f0',
  corridor: '#ccfbf1',
  lobby: '#dbeafe',
  service: '#ede9fe',
  restricted: '#ffe4e6',
  'vertical-circulation': '#fef3c7',
} as const;

export default function FloorplanViewer() {
  const { state, actions, theme } = useNavigation() as unknown as NavigatorContextValue;
  const { activeFloorId } = state;
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [dimensions, setDimensions] = useState({ width: 900, height: 620 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      setDimensions({
        width: Math.max(1, entry.contentRect.width),
        height: Math.max(1, entry.contentRect.height),
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const activeFloor = getFloorById(activeFloorId) ?? BUILDING_PACKAGE.floors[0];
  const floorSpaces = BUILDING_PACKAGE.spaces.filter((space) => space.floorId === activeFloor.id);
  const floorPois = getPOIs().filter((node) => String(node.floor) === activeFloor.id);
  const poisBySpace = useMemo(() => {
    const result = new Map<string, typeof floorPois>();
    for (const poi of floorPois) {
      const values = result.get(poi.poi.spaceId) ?? [];
      values.push(poi);
      result.set(poi.poi.spaceId, values);
    }
    return result;
  }, [floorPois]);

  const xValues = activeFloor.outline.map(([x]) => x);
  const yValues = activeFloor.outline.map(([, y]) => y);
  const minX = Math.min(...xValues);
  const maxX = Math.max(...xValues);
  const minY = Math.min(...yValues);
  const maxY = Math.max(...yValues);
  const worldWidth = (maxX - minX) * WORLD_SCALE + MAP_PADDING * 2;
  const worldHeight = (maxY - minY) * WORLD_SCALE + MAP_PADDING * 2;
  const fitScale = Math.max(
    0.1,
    Math.min(dimensions.width / worldWidth, dimensions.height / worldHeight) * 0.94,
  );
  const stageScale = fitScale * zoom;
  const basePosition = {
    x: (dimensions.width - worldWidth * stageScale) / 2,
    y: (dimensions.height - worldHeight * stageScale) / 2,
  };
  const stagePosition = { x: basePosition.x + pan.x, y: basePosition.y + pan.y };

  const toCanvas = ([x, y]: [number, number]): [number, number] => [
    (x - minX) * WORLD_SCALE + MAP_PADDING,
    (y - minY) * WORLD_SCALE + MAP_PADDING,
  ];
  const flatPoints = (points: [number, number][]) => points.flatMap(toCanvas);

  const routePath = state.route?.found ? state.route.path : [];
  const floorRouteSegments = routeSegmentsForFloor(routePath, activeFloor.id);
  const transitions = floorTransitions(routePath, activeFloor.id);
  const startNode = getNodeById(state.startNodeId);
  const destinationNode = getNodeById(state.destinationNodeId);
  const destinationSpaceId = (destinationNode as VisitorPoiNode | null)?.poi?.spaceId;

  const colors =
    theme === 'dark'
      ? {
          background: '#0b1120',
          floor: '#111827',
          wall: '#64748b',
          text: '#e2e8f0',
          muted: '#94a3b8',
          spaces: SPACE_COLORS,
        }
      : {
          background: '#e8edf3',
          floor: '#ffffff',
          wall: '#64748b',
          text: '#0f172a',
          muted: '#64748b',
          spaces: LIGHT_SPACE_COLORS,
        };

  const resetView = (floorId: string) => {
    actions.setFloor(floorId);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  return (
    <div className="compiled-map" ref={containerRef} style={{ background: colors.background }}>
      <Stage
        ref={stageRef}
        width={dimensions.width}
        height={dimensions.height}
        x={stagePosition.x}
        y={stagePosition.y}
        scaleX={stageScale}
        scaleY={stageScale}
        draggable
        onDragEnd={(event) => {
          setPan({
            x: event.target.x() - basePosition.x,
            y: event.target.y() - basePosition.y,
          });
        }}
        onWheel={(event) => {
          event.evt.preventDefault();
          const stage = stageRef.current;
          const pointer = stage?.getPointerPosition();
          if (!stage || !pointer) return;
          const nextZoom = Math.max(0.65, Math.min(4, zoom * (event.evt.deltaY > 0 ? 0.9 : 1.1)));
          const point = {
            x: (pointer.x - stage.x()) / stageScale,
            y: (pointer.y - stage.y()) / stageScale,
          };
          const nextScale = fitScale * nextZoom;
          const nextBase = {
            x: (dimensions.width - worldWidth * nextScale) / 2,
            y: (dimensions.height - worldHeight * nextScale) / 2,
          };
          setZoom(nextZoom);
          setPan({
            x: pointer.x - point.x * nextScale - nextBase.x,
            y: pointer.y - point.y * nextScale - nextBase.y,
          });
        }}
      >
        <Layer>
          <Rect
            x={MAP_PADDING}
            y={MAP_PADDING}
            width={(maxX - minX) * WORLD_SCALE}
            height={(maxY - minY) * WORLD_SCALE}
            fill={colors.floor}
            stroke={colors.wall}
            strokeWidth={5}
            shadowColor="rgba(15, 23, 42, 0.24)"
            shadowBlur={18}
            shadowOffsetY={8}
          />

          {floorSpaces.map((space) => {
            const centre = toCanvas(polygonCentroid(space.polygon));
            const spacePois = poisBySpace.get(space.id) ?? [];
            const selected = state.selectedPOI?.poi?.spaceId === space.id;
            const destination = destinationSpaceId === space.id;
            const clickable = spacePois.length > 0;
            return (
              <Group
                key={space.id}
                onClick={() => clickable && actions.selectPOI(spacePois[0])}
                onTap={() => clickable && actions.selectPOI(spacePois[0])}
                onMouseEnter={(event) => {
                  if (clickable) event.target.getStage()!.container().style.cursor = 'pointer';
                }}
                onMouseLeave={(event) => {
                  event.target.getStage()!.container().style.cursor = 'default';
                }}
              >
                <Line
                  points={flatPoints(space.polygon)}
                  closed
                  fill={colors.spaces[space.type]}
                  opacity={space.public ? 0.9 : 0.68}
                  stroke={
                    selected
                      ? '#06b6d4'
                      : destination
                        ? '#22c55e'
                        : space.accessible
                          ? colors.wall
                          : '#f59e0b'
                  }
                  strokeWidth={selected || destination ? 5 : 2}
                  lineJoin="round"
                />
                <Text
                  x={centre[0] - 90}
                  y={centre[1] - 9}
                  width={180}
                  text={space.name}
                  align="center"
                  fontSize={space.type === 'corridor' ? 13 : 15}
                  fontStyle="600"
                  fill={colors.text}
                  listening={false}
                />
                {!space.public && (
                  <Text
                    x={centre[0] - 70}
                    y={centre[1] + 12}
                    width={140}
                    text="RESTRICTED"
                    align="center"
                    fontSize={9}
                    fontStyle="bold"
                    letterSpacing={1.5}
                    fill="#e11d48"
                    listening={false}
                  />
                )}
              </Group>
            );
          })}
        </Layer>

        <Layer>
          {floorRouteSegments.map(([from, to]) => {
            const fromPoint = toCanvas([from.x, from.y]);
            const toPoint = toCanvas([to.x, to.y]);
            return (
              <Line
                key={`${from.id}-${to.id}`}
                points={[...fromPoint, ...toPoint]}
                stroke="#0284c7"
                strokeWidth={7}
                lineCap="round"
                lineJoin="round"
                shadowColor="rgba(2, 132, 199, 0.28)"
                shadowBlur={9}
              />
            );
          })}

          {transitions.map(({ node, targetFloorId }) => {
            const point = toCanvas([node.x, node.y]);
            const targetFloor = getFloorById(targetFloorId);
            return (
              <Group key={`${node.id}-${targetFloorId}`} x={point[0]} y={point[1]}>
                <Circle radius={13} fill="#7c3aed" stroke="#ffffff" strokeWidth={3} />
                <Text
                  x={16}
                  y={-9}
                  text={`To ${targetFloor?.name ?? targetFloorId}`}
                  fontSize={13}
                  fontStyle="bold"
                  fill={colors.text}
                />
              </Group>
            );
          })}

          {floorPois.map((node) => {
            const point = toCanvas([node.x, node.y]);
            const category = CATEGORIES[node.poi.category as keyof typeof CATEGORIES];
            return (
              <Group
                key={node.id}
                x={point[0]}
                y={point[1]}
                onClick={() => actions.selectPOI(node)}
                onTap={() => actions.selectPOI(node)}
              >
                <Circle
                  radius={11}
                  fill={category?.color ?? '#475569'}
                  stroke="#ffffff"
                  strokeWidth={2}
                />
                <Text
                  x={-13}
                  y={-5}
                  width={26}
                  text={category?.icon ?? 'P'}
                  align="center"
                  fontSize={8}
                  fontStyle="bold"
                  fill="#ffffff"
                />
              </Group>
            );
          })}

          {startNode &&
            String(startNode.floor) === activeFloor.id &&
            (() => {
              const point = toCanvas([startNode.x, startNode.y]);
              return (
                <Group x={point[0]} y={point[1]}>
                  <Circle radius={18} fill="rgba(37, 99, 235, 0.2)" />
                  <Circle radius={8} fill="#2563eb" stroke="#ffffff" strokeWidth={3} />
                </Group>
              );
            })()}
        </Layer>
      </Stage>

      <div className="compiled-map-topbar">
        <div className="compiled-floor-switcher" aria-label="Select floor">
          <Layers size={15} />
          {BUILDING_PACKAGE.floors.map((floor) => (
            <button
              key={floor.id}
              type="button"
              className={floor.id === activeFloor.id ? 'active' : ''}
              aria-pressed={floor.id === activeFloor.id}
              onClick={() => resetView(floor.id)}
            >
              {floor.level === 0 ? 'G' : `L${floor.level}`}
              <small>{floor.name}</small>
            </button>
          ))}
        </div>
        <div className="compiled-map-proof" title={BUILDING_PACKAGE.manifest.contentHash}>
          <Database size={14} />
          <span>Package {BUILDING_PACKAGE.manifest.contentHash.slice(0, 8)}</span>
        </div>
      </div>

      <div className="compiled-map-floor-meta">
        <strong>{activeFloor.name}</strong>
        <span>{floorSpaces.length} semantic spaces</span>
        <span>{floorPois.length} public destinations</span>
      </div>

      <div className="compiled-map-legend">
        <span>
          <i className="map-legend-route" /> Route
        </span>
        <span>
          <Accessibility size={12} /> Accessible
        </span>
        <span>
          <LockKeyhole size={12} /> Restricted areas shown
        </span>
        <strong>Synthetic reference data</strong>
      </div>

      <div className="compiled-map-zoom">
        <button
          type="button"
          onClick={() => setZoom((value) => Math.min(4, value * 1.25))}
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => setZoom((value) => Math.max(0.65, value / 1.25))}
          aria-label="Zoom out"
        >
          −
        </button>
        <button
          type="button"
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
        >
          Fit
        </button>
      </div>
    </div>
  );
}
