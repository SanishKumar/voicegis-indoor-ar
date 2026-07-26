import { useEffect, useMemo, useRef, useState } from 'react';
import { Arc, Circle, Group, Layer, Line, Rect, Stage, Text } from 'react-konva';
import type Konva from 'konva';
import {
  Accessibility,
  ArrowUpDown,
  Compass,
  Database,
  DoorOpen,
  Footprints,
  Layers,
  LockKeyhole,
  Route,
} from 'lucide-react';
import { useNavigation } from '../context/NavigationContext.jsx';
import type { CompiledBuildingRuntime, VisitorPoiNode } from '../data/compiledBuilding';
import {
  polygonCentroid,
  routeConnectorRuns,
  routeFloorIds,
  routeSegmentsForFloor,
} from '../engine/floorplanModel';
import type { RouteResult } from '../engine/routingCore';
import { getNearestBoundaryAngle, getPolygonBounds } from '../engine/spatialTwinArchitecture';

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
  venue: CompiledBuildingRuntime;
}

const SPACE_COLORS = {
  entrance: '#e7f1ee',
  room: '#f7f5ef',
  corridor: '#ebe9e2',
  lobby: '#eeecf8',
  service: '#f2eee6',
  restricted: '#f3e6e7',
  'vertical-circulation': '#e9e5db',
} as const;

const SPACE_ACCENTS = {
  entrance: '#207564',
  room: '#7c7d82',
  corridor: '#8d8a82',
  lobby: '#6257c7',
  service: '#9a6a34',
  restricted: '#a44149',
  'vertical-circulation': '#5f625e',
} as const;

function roomCode(id: string) {
  return id
    .split('-')
    .slice(1)
    .map((part) => part.slice(0, 2))
    .join('')
    .toUpperCase()
    .slice(0, 6);
}

export default function FloorplanViewer() {
  const { state, actions, theme, venue } = useNavigation() as unknown as NavigatorContextValue;
  const { activeFloorId } = state;
  const buildingPackage = venue.buildingPackage;
  const connectorsById = useMemo(
    () =>
      new Map(
        buildingPackage.verticalConnectors.map((connector) => [connector.id, connector] as const),
      ),
    [buildingPackage],
  );
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

  const activeFloor = venue.getFloorById(activeFloorId) ?? buildingPackage.floors[0];
  const floorSpaces = buildingPackage.spaces.filter((space) => space.floorId === activeFloor.id);
  const floorPortals = buildingPackage.portals.filter(
    (portal) => portal.floorId === activeFloor.id,
  );
  const floorConnectorStops = buildingPackage.verticalConnectors.flatMap((connector) =>
    connector.stops
      .filter((stop) => stop.floorId === activeFloor.id)
      .map((stop) => ({ connector, stop })),
  );
  const floorPois = venue.getPOIs().filter((node) => String(node.floor) === activeFloor.id);
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
  const routeFloors = routeFloorIds(routePath);
  const connectorRuns = routeConnectorRuns(routePath);
  const multiFloorRoute = routeFloors.length > 1;
  const connectorMarkers = connectorRuns.flatMap((run) => {
    const floorIndex = run.floorIds.indexOf(activeFloor.id);
    if (floorIndex < 0) return [];
    const node = run.nodes.find((candidate) => String(candidate.floor) === activeFloor.id);
    if (!node) return [];
    const connector = connectorsById.get(run.connectorId);
    const movement =
      floorIndex === 0
        ? `to ${run.toFloorId.toUpperCase()}`
        : floorIndex === run.floorIds.length - 1
          ? `from ${run.fromFloorId.toUpperCase()}`
          : `continue to ${run.toFloorId.toUpperCase()}`;
    return [{ run, node, connector, movement }];
  });
  const startNode = venue.getNodeById(state.startNodeId);
  const destinationNode = venue.getNodeById(state.destinationNodeId);
  const destinationSpaceId = (destinationNode as VisitorPoiNode | null)?.poi?.spaceId;

  const colors = {
    background: theme === 'dark' ? '#242528' : '#e5e3dd',
    paper: '#fbfaf6',
    floor: '#f6f4ed',
    wall: '#4b4d50',
    partition: '#777871',
    grid: '#d8d5cd',
    text: '#25272b',
    muted: '#74746e',
    spaces: SPACE_COLORS,
  };

  const gridLines = (() => {
    const vertical = [];
    for (let x = Math.ceil(minX / 8) * 8; x <= maxX; x += 8) {
      vertical.push([toCanvas([x, minY]), toCanvas([x, maxY])] as const);
    }
    const horizontal = [];
    for (let y = Math.ceil(minY / 8) * 8; y <= maxY; y += 8) {
      horizontal.push([toCanvas([minX, y]), toCanvas([maxX, y])] as const);
    }
    return { vertical, horizontal };
  })();

  const resetView = (floorId: string) => {
    actions.setFloor(floorId);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  return (
    <div
      className={`compiled-map${multiFloorRoute ? ' route-multifloor' : ''}`}
      ref={containerRef}
      style={{ background: colors.background }}
    >
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
          <Line
            points={flatPoints(activeFloor.outline)}
            closed
            fill={colors.paper}
            stroke={colors.wall}
            strokeWidth={6}
            shadowColor="rgba(20, 22, 25, 0.22)"
            shadowBlur={26}
            shadowOffsetY={12}
          />

          {floorSpaces.map((space) => {
            const centre = toCanvas(polygonCentroid(space.polygon));
            const bounds = getPolygonBounds(space.polygon);
            const topLeft = toCanvas([bounds.minX, bounds.minY]);
            const spacePois = poisBySpace.get(space.id) ?? [];
            const selected = state.selectedPOI?.poi?.spaceId === space.id;
            const destination = destinationSpaceId === space.id;
            const clickable = spacePois.length > 0;
            const compact = bounds.width < 8;
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
                  stroke={
                    selected
                      ? '#5b4ee6'
                      : destination
                        ? '#16825d'
                        : space.accessible
                          ? colors.partition
                          : '#a9651a'
                  }
                  strokeWidth={selected || destination ? 5 : 2.2}
                  lineJoin="miter"
                />
                <Line
                  points={[
                    topLeft[0] + 7,
                    topLeft[1] + 7,
                    topLeft[0] + Math.max(20, bounds.width * WORLD_SCALE - 7),
                    topLeft[1] + 7,
                  ]}
                  stroke={SPACE_ACCENTS[space.type]}
                  strokeWidth={3}
                  opacity={0.9}
                  listening={false}
                />
                <Text
                  x={topLeft[0] + 9}
                  y={topLeft[1] + 13}
                  text={roomCode(space.id)}
                  fontFamily="Consolas, monospace"
                  fontSize={12}
                  fontStyle="bold"
                  letterSpacing={1.2}
                  fill={SPACE_ACCENTS[space.type]}
                  listening={false}
                />
                <Text
                  x={centre[0] - 90}
                  y={centre[1] - (space.public ? 8 : 15)}
                  width={180}
                  text={space.type === 'corridor' ? space.name.toUpperCase() : space.name}
                  align="center"
                  fontFamily="Inter, Segoe UI, sans-serif"
                  fontSize={space.type === 'corridor' ? 18 : compact ? 17 : 22}
                  fontStyle={space.type === 'corridor' ? 'bold' : '600'}
                  letterSpacing={space.type === 'corridor' ? 2.2 : 0}
                  fill={colors.text}
                  listening={false}
                />
                {space.type === 'vertical-circulation' &&
                  [0.25, 0.45, 0.65, 0.85].map((offset) => {
                    const x = topLeft[0] + bounds.width * WORLD_SCALE * offset;
                    return (
                      <Line
                        key={offset}
                        points={[
                          x - 18,
                          topLeft[1] + bounds.depth * WORLD_SCALE - 11,
                          x + 18,
                          topLeft[1] + bounds.depth * WORLD_SCALE - 47,
                        ]}
                        stroke="#8b8a83"
                        strokeWidth={1.3}
                        opacity={0.55}
                        listening={false}
                      />
                    );
                  })}
                {!space.public && (
                  <Text
                    x={centre[0] - 70}
                    y={centre[1] + 8}
                    width={140}
                    text="STAFF ACCESS"
                    align="center"
                    fontSize={12}
                    fontStyle="bold"
                    letterSpacing={1.5}
                    fill="#a44149"
                    listening={false}
                  />
                )}
              </Group>
            );
          })}

          {[...gridLines.vertical, ...gridLines.horizontal].map(([start, end], index) => (
            <Line
              key={`grid-${index}`}
              points={[...start, ...end]}
              stroke={colors.grid}
              strokeWidth={1}
              dash={[3, 9]}
              opacity={0.6}
              listening={false}
            />
          ))}

          {floorPortals.map((portal) => {
            const point = toCanvas(portal.position);
            const connectedSpace = floorSpaces.find((space) => portal.connects.includes(space.id));
            const angle = connectedSpace
              ? (getNearestBoundaryAngle(connectedSpace.polygon, portal.position) * 180) / Math.PI
              : 0;
            const width = portal.width * WORLD_SCALE;
            return (
              <Group key={portal.id} x={point[0]} y={point[1]} rotation={angle}>
                <Line
                  points={[-width / 2, 0, width / 2, 0]}
                  stroke={colors.paper}
                  strokeWidth={9}
                  listening={false}
                />
                {portal.kind === 'door' && (
                  <>
                    <Line
                      points={[-width / 2, 0, -width / 2, -width * 0.78]}
                      stroke={colors.wall}
                      strokeWidth={2}
                      listening={false}
                    />
                    <Arc
                      x={-width / 2}
                      y={0}
                      innerRadius={width * 0.77}
                      outerRadius={width * 0.77}
                      angle={90}
                      rotation={-90}
                      stroke={colors.partition}
                      strokeWidth={1}
                      listening={false}
                    />
                  </>
                )}
                {portal.kind === 'opening' && (
                  <Line
                    points={[-width / 2, 0, width / 2, 0]}
                    stroke="#9a9992"
                    strokeWidth={1}
                    dash={[4, 5]}
                    listening={false}
                  />
                )}
                {portal.kind === 'gate' && (
                  <Line
                    points={[-width / 2, 0, width / 2, 0]}
                    stroke="#a44149"
                    strokeWidth={3}
                    dash={[6, 4]}
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
              <Group key={`${from.id}-${to.id}`}>
                <Line
                  points={[...fromPoint, ...toPoint]}
                  stroke="#202226"
                  strokeWidth={14}
                  lineCap="round"
                  lineJoin="round"
                />
                <Line
                  points={[...fromPoint, ...toPoint]}
                  stroke="#ff5c39"
                  strokeWidth={7}
                  lineCap="round"
                  lineJoin="round"
                />
                <Circle
                  x={fromPoint[0]}
                  y={fromPoint[1]}
                  radius={4.5}
                  fill="#fffaf4"
                  stroke="#202226"
                  strokeWidth={2}
                />
              </Group>
            );
          })}

          {floorConnectorStops.map(({ connector, stop }) => {
            const point = toCanvas(stop.position);
            return (
              <Group key={connector.id} x={point[0]} y={point[1]} listening={false}>
                <Rect
                  x={-16}
                  y={-16}
                  width={32}
                  height={32}
                  fill="#fbfaf6"
                  stroke="#555750"
                  strokeWidth={2}
                />
                <Text
                  x={-16}
                  y={-6}
                  width={32}
                  text={connector.kind === 'elevator' ? 'LIFT' : 'ST'}
                  align="center"
                  fontFamily="Consolas, monospace"
                  fontSize={10}
                  fontStyle="bold"
                  fill="#3e403d"
                />
              </Group>
            );
          })}

          {connectorMarkers.map(({ run, node, connector, movement }) => {
            const point = toCanvas([node.x, node.y]);
            return (
              <Group key={`${run.connectorId}-${activeFloor.id}`} x={point[0]} y={point[1]}>
                <Circle
                  radius={23}
                  fill="rgba(91, 78, 230, 0.08)"
                  stroke="#5b4ee6"
                  strokeWidth={3}
                  dash={[5, 4]}
                />
                <Circle radius={4} fill="#5b4ee6" />
                <Text
                  x={29}
                  y={-17}
                  width={180}
                  text={`${connector?.name ?? 'Vertical connector'}\n${movement}`}
                  fontSize={11}
                  lineHeight={1.35}
                  fontStyle="bold"
                  fill={colors.text}
                />
              </Group>
            );
          })}

          {floorPois.map((node) => {
            const point = toCanvas([node.x, node.y]);
            const category = venue.getCategory(node.poi.category);
            return (
              <Group
                key={node.id}
                x={point[0]}
                y={point[1]}
                onClick={() => actions.selectPOI(node)}
                onTap={() => actions.selectPOI(node)}
              >
                <Circle
                  radius={13}
                  fill="#fbfaf6"
                  stroke={category?.color ?? '#5f625e'}
                  strokeWidth={3}
                />
                <Text
                  x={-15}
                  y={-5}
                  width={30}
                  text={category?.icon ?? 'P'}
                  align="center"
                  fontSize={9}
                  fontStyle="bold"
                  fill={category?.color ?? '#5f625e'}
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
                  <Circle radius={17} fill="#ffffff" stroke="#202226" strokeWidth={3} />
                  <Circle radius={8} fill="#5b4ee6" />
                </Group>
              );
            })()}
        </Layer>
      </Stage>

      <div className="compiled-map-topbar">
        <div className="compiled-floor-switcher" aria-label="Select floor">
          <Layers size={15} />
          {buildingPackage.floors.map((floor) => (
            <button
              key={floor.id}
              type="button"
              className={floor.id === activeFloor.id ? 'active' : ''}
              data-route-floor={routeFloors.includes(floor.id) || undefined}
              aria-pressed={floor.id === activeFloor.id}
              onClick={() => resetView(floor.id)}
            >
              {floor.level === 0 ? 'G' : `L${floor.level}`}
              <small>{floor.name}</small>
            </button>
          ))}
        </div>
        <div className="compiled-map-operations">
          <div className="compiled-map-proof" title={buildingPackage.manifest.contentHash}>
            <Database size={14} />
            <span>Package {buildingPackage.manifest.contentHash.slice(0, 8)}</span>
          </div>
        </div>
      </div>

      {multiFloorRoute && (
        <div className="compiled-route-journey" aria-label="Multi-floor route">
          <span className="compiled-route-journey-label">
            <Route size={13} />
            Multi-floor
          </span>
          <div className="compiled-route-floor-chain">
            {routeFloors.map((floorId, index) => {
              const floor = venue.getFloorById(floorId);
              return (
                <span key={floorId}>
                  {index > 0 && <i aria-hidden="true">→</i>}
                  <button
                    type="button"
                    className={floorId === activeFloor.id ? 'active' : ''}
                    onClick={() => resetView(floorId)}
                    title={floor?.name}
                  >
                    {floor?.level === 0 ? 'G' : `L${floor?.level ?? floorId}`}
                  </button>
                </span>
              );
            })}
          </div>
          {connectorRuns.map((run) => {
            const connector = connectorsById.get(run.connectorId);
            const ConnectorIcon = connector?.kind === 'elevator' ? ArrowUpDown : Footprints;
            return (
              <span className="compiled-route-connector" key={run.connectorId}>
                <ConnectorIcon size={13} />
                {connector?.name ?? run.connectorId}
                <small>
                  {run.fromFloorId.toUpperCase()} → {run.toFloorId.toUpperCase()}
                </small>
              </span>
            );
          })}
          <span className="compiled-route-viewing">
            Viewing {activeFloor.level === 0 ? 'G' : `L${activeFloor.level}`} segment
          </span>
        </div>
      )}

      <div className="compiled-map-floor-meta">
        <strong>{activeFloor.name}</strong>
        <span>{floorSpaces.length} semantic spaces</span>
        <span>{floorPortals.length} modeled portals</span>
        <span>{floorPois.length} public destinations</span>
      </div>

      <div className="compiled-map-orientation" aria-hidden="true">
        <Compass size={15} />
        <strong>N</strong>
        <span>{buildingPackage.building.coordinateSystem.northOffsetDegrees}°</span>
      </div>

      <div className="compiled-map-legend">
        <span>
          <i className="map-legend-route" /> Route
        </span>
        <span>
          <DoorOpen size={12} /> Doors + openings
        </span>
        <span>
          <Accessibility size={12} /> Accessible
        </span>
        <span>
          <LockKeyhole size={12} /> Restricted areas shown
        </span>
        <strong>Compiled venue geometry</strong>
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
