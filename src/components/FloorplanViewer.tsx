import { useEffect, useMemo, useRef, useState } from 'react';
import { Arc, Circle, Group, Layer, Line, Rect, Stage, Text } from 'react-konva';
import type Konva from 'konva';
import type { ConnectorKind } from '@voicegis/spatial-schema';
import { Accessibility, ArrowUpDown, Compass, Footprints, Layers, Route } from 'lucide-react';
import { useNavigation } from '../context/NavigationContext.jsx';
import type { CompiledBuildingRuntime, VisitorPoiNode } from '../data/compiledBuilding';
import { deriveFloorplanCartography } from '../engine/floorplanCartography';
import {
  polygonCentroid,
  routeConnectorRuns,
  routeFloorIds,
  routeSegmentsForFloor,
} from '../engine/floorplanModel';
import type { RouteResult } from '../engine/routingCore';
import { getPolygonBounds } from '../engine/spatialTwinArchitecture';

const WORLD_SCALE = 44;
const MAP_PADDING = 96;
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
  entrance: '#dceff0',
  room: '#f3efe7',
  corridor: '#ffffff',
  lobby: '#eef2ed',
  service: '#e6edf2',
  restricted: '#f2dfe2',
  'vertical-circulation': '#e1e8e5',
} as const;

function safeCategoryGlyph(icon: string | undefined) {
  return icon && /^[\x20-\x7e]{1,3}$/.test(icon) ? icon : '•';
}

interface CartographicConnectorSymbolProps {
  x: number;
  y: number;
  kind: ConnectorKind;
  accessible: boolean;
  restricted: boolean;
}

function CartographicConnectorSymbol({
  x,
  y,
  kind,
  accessible,
  restricted,
}: CartographicConnectorSymbolProps) {
  const accent = restricted ? '#a54b55' : accessible ? '#176b5b' : '#b9782d';
  const label =
    kind === 'elevator' ? 'LIFT' : kind === 'stairs' ? 'STAIR' : kind === 'ramp' ? 'RAMP' : 'ESC';

  return (
    <Group x={x} y={y} listening={false}>
      <Rect
        x={-21}
        y={-18}
        width={42}
        height={36}
        cornerRadius={6}
        fill="#ffffff"
        stroke={accent}
        strokeWidth={1.6}
        shadowColor="rgba(23, 33, 31, 0.16)"
        shadowBlur={7}
        shadowOffsetY={2}
      />
      {kind === 'elevator' && (
        <>
          <Rect
            x={-11}
            y={-12}
            width={22}
            height={16}
            cornerRadius={2}
            stroke="#53605a"
            strokeWidth={1.3}
          />
          <Line points={[0, -12, 0, 4]} stroke="#87928d" strokeWidth={1} />
          <Line
            points={[-7, -1, -4, -5, -1, -1]}
            stroke={accent}
            strokeWidth={1.3}
            lineCap="round"
            lineJoin="round"
          />
          <Line
            points={[1, -7, 4, -3, 7, -7]}
            stroke={accent}
            strokeWidth={1.3}
            lineCap="round"
            lineJoin="round"
          />
        </>
      )}
      {kind === 'stairs' && (
        <Line
          points={[-12, 4, -7, 4, -7, 0, -2, 0, -2, -4, 3, -4, 3, -8, 11, -8]}
          stroke="#53605a"
          strokeWidth={1.8}
          lineCap="square"
          lineJoin="miter"
        />
      )}
      {kind === 'ramp' && (
        <>
          <Rect x={-12} y={-10} width={24} height={14} stroke="#87928d" strokeWidth={1} />
          <Line
            points={[-9, 2, 8, -7, 4, -8, 8, -7, 7, -3]}
            stroke={accent}
            strokeWidth={1.7}
            lineCap="round"
            lineJoin="round"
          />
        </>
      )}
      {kind === 'escalator' && (
        <>
          <Line
            points={[-10, 3, 9, -9]}
            stroke="#53605a"
            strokeWidth={2}
            lineCap="round"
          />
          <Circle x={-11} y={4} radius={2.5} stroke={accent} strokeWidth={1.2} />
          <Circle x={10} y={-10} radius={2.5} stroke={accent} strokeWidth={1.2} />
          {[-5, 0, 5].map((offset) => (
            <Line
              key={offset}
              points={[offset - 3, -offset * 0.62 + 1, offset + 1, -offset * 0.62 + 4]}
              stroke="#87928d"
              strokeWidth={1}
            />
          ))}
        </>
      )}
      <Text
        x={-18}
        y={8}
        width={36}
        text={label}
        align="center"
        fontFamily="Inter, Segoe UI, sans-serif"
        fontSize={6.8}
        fontStyle="bold"
        letterSpacing={0.7}
        fill="#44504b"
      />
    </Group>
  );
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
  const cartography = useMemo(
    () => deriveFloorplanCartography(buildingPackage, activeFloor.id),
    [activeFloor.id, buildingPackage],
  );
  const floorSpaces = buildingPackage.spaces.filter((space) => space.floorId === activeFloor.id);
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
    Math.min(dimensions.width / worldWidth, dimensions.height / worldHeight) * 0.9,
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
  const mappedSpaceIds = new Set(floorSpaces.map((space) => space.id));
  const standalonePois = floorPois.filter((node) => !mappedSpaceIds.has(node.poi.spaceId));

  const colors = {
    background:
      theme === 'dark'
        ? 'radial-gradient(circle at 48% 42%, #27312e 0%, #18201e 72%)'
        : 'radial-gradient(circle at 48% 42%, #f5f7f4 0%, #e5eae6 72%)',
    paper: '#fdfdf9',
    floor: '#f7f8f4',
    wall: '#59645f',
    partition: '#b9c2bd',
    text: '#17211f',
    muted: '#6f7874',
    spaces: SPACE_COLORS,
  };

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
            x={0}
            y={13}
            points={flatPoints(activeFloor.outline)}
            closed
            fill="#b9c2bd"
            stroke="#aab4af"
            strokeWidth={3}
            opacity={theme === 'dark' ? 0.46 : 0.7}
            shadowColor="rgba(23, 33, 31, 0.24)"
            shadowBlur={30}
            shadowOffsetY={16}
            listening={false}
          />
          <Line
            points={flatPoints(activeFloor.outline)}
            closed
            fill={colors.paper}
            stroke="#c9d1cd"
            strokeWidth={1.4}
            lineJoin="round"
            listening={false}
          />

          {floorSpaces.map((space) => {
            const centre = toCanvas(polygonCentroid(space.polygon));
            const bounds = getPolygonBounds(space.polygon);
            const topLeft = toCanvas([bounds.minX, bounds.minY]);
            const spacePois = poisBySpace.get(space.id) ?? [];
            const primaryPoi = spacePois[0];
            const category = primaryPoi ? venue.getCategory(primaryPoi.poi.category) : null;
            const selected = state.selectedPOI?.poi?.spaceId === space.id;
            const destination = destinationSpaceId === space.id;
            const clickable = spacePois.length > 0;
            const compact = bounds.width < 8 || bounds.depth < 5;
            const screenWidth = bounds.width * WORLD_SCALE * stageScale;
            const screenDepth = bounds.depth * WORLD_SCALE * stageScale;
            const showLabel =
              space.type === 'corridor'
                ? screenWidth > 150 && screenDepth > 42
                : screenWidth > 70 && screenDepth > 48;
            const labelWidth = Math.max(
              48,
              Math.min(230, bounds.width * WORLD_SCALE - (compact ? 10 : 24)),
            );
            const label = primaryPoi?.poi.name ?? space.name;
            const labelFontSize = space.type === 'corridor' ? 15 : compact ? 15 : 19;
            const roomFill = destination
              ? '#f9d7ce'
              : selected
                ? '#dceee8'
                : colors.spaces[space.type];
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
                  fill={roomFill}
                  stroke={
                    selected
                      ? '#176b5b'
                      : destination
                        ? '#df4f31'
                        : space.accessible
                          ? colors.partition
                          : '#b9782d'
                  }
                  strokeWidth={selected || destination ? 4 : 0.8}
                  lineJoin="round"
                />
                {(space.type === 'restricted' || !space.public) && (
                  <Line
                    points={flatPoints(space.polygon)}
                    closed
                    stroke="#a54b55"
                    strokeWidth={1.6}
                    dash={[9, 6]}
                    opacity={0.52}
                    lineJoin="round"
                    listening={false}
                  />
                )}
                {showLabel && primaryPoi && space.type !== 'corridor' && (
                  <Group x={centre[0]} y={centre[1] - (space.public ? 13 : 21)} listening={false}>
                    <Circle
                      radius={12}
                      fill={category?.color ?? '#176b5b'}
                      stroke="#ffffff"
                      strokeWidth={3}
                      shadowColor="rgba(23, 33, 31, 0.2)"
                      shadowBlur={8}
                      shadowOffsetY={2}
                    />
                    <Text
                      x={-13}
                      y={-4.5}
                      width={26}
                      text={safeCategoryGlyph(category?.icon)}
                      align="center"
                      fontFamily="Inter, Segoe UI, sans-serif"
                      fontSize={8.5}
                      fontStyle="bold"
                      fill="#ffffff"
                    />
                    <Text
                      x={-labelWidth / 2}
                      y={20}
                      width={labelWidth}
                      text={label}
                      align="center"
                      fontFamily="Inter, Segoe UI, sans-serif"
                      fontSize={labelFontSize}
                      fontStyle="600"
                      lineHeight={1.12}
                      fill={colors.text}
                    />
                  </Group>
                )}
                {showLabel && (!primaryPoi || space.type === 'corridor') && (
                  <Text
                    x={centre[0] - labelWidth / 2}
                    y={centre[1] - labelFontSize / 2}
                    width={labelWidth}
                    text={space.type === 'corridor' ? space.name.toUpperCase() : label}
                    align="center"
                    fontFamily="Inter, Segoe UI, sans-serif"
                    fontSize={labelFontSize}
                    fontStyle={space.type === 'corridor' ? 'bold' : '600'}
                    letterSpacing={space.type === 'corridor' ? 2.4 : 0}
                    fill={space.type === 'corridor' ? colors.muted : colors.text}
                    opacity={space.type === 'corridor' ? 0.7 : 1}
                    listening={false}
                  />
                )}
                {!space.public && (
                  <Group x={topLeft[0] + 10} y={topLeft[1] + 10} listening={false}>
                    <Rect
                      width={70}
                      height={18}
                      cornerRadius={6}
                      fill="rgba(165, 75, 85, 0.1)"
                    />
                    <Text
                      y={5}
                      width={70}
                      text="STAFF ONLY"
                      align="center"
                      fontSize={8}
                      fontStyle="bold"
                      letterSpacing={0.9}
                      fill="#a54b55"
                    />
                  </Group>
                )}
              </Group>
            );
          })}

          {cartography.walls
            .filter((wall) => wall.kind !== 'exterior')
            .map((wall) => {
              const start = toCanvas(wall.start);
              const end = toCanvas(wall.end);
              return (
                <Group key={wall.id} listening={false}>
                  <Line
                    points={[...start, ...end]}
                    stroke={colors.wall}
                    strokeWidth={4.4}
                    lineCap="square"
                    lineJoin="miter"
                  />
                  <Line
                    points={[...start, ...end]}
                    stroke={colors.paper}
                    strokeWidth={1.25}
                    lineCap="square"
                  />
                  {wall.kind === 'restricted' && (
                    <Line
                      points={[...start, ...end]}
                      stroke="#a54b55"
                      strokeWidth={1.25}
                      dash={[7, 6]}
                      opacity={0.82}
                    />
                  )}
                </Group>
              );
            })}

          <Line
            points={flatPoints(activeFloor.outline)}
            closed
            stroke={colors.wall}
            strokeWidth={7}
            lineJoin="round"
            listening={false}
          />
          <Line
            points={flatPoints(activeFloor.outline)}
            closed
            stroke="#cbd3cf"
            strokeWidth={1.7}
            lineJoin="round"
            listening={false}
          />

          {cartography.portals.map((portal) => {
            const point = toCanvas(portal.position);
            const angle = (portal.angleRadians * 180) / Math.PI;
            const width = portal.width * WORLD_SCALE;
            const portalAccent = portal.restricted
              ? '#a54b55'
              : portal.accessible
                ? '#729c91'
                : '#b9782d';
            return (
              <Group
                key={portal.id}
                x={point[0]}
                y={point[1]}
                rotation={angle}
                listening={false}
              >
                <Line
                  points={[-width / 2, 0, width / 2, 0]}
                  stroke={colors.paper}
                  strokeWidth={10}
                />
                <Line
                  points={[-width / 2, -5, -width / 2, 5]}
                  stroke={colors.wall}
                  strokeWidth={2.2}
                />
                <Line
                  points={[width / 2, -5, width / 2, 5]}
                  stroke={colors.wall}
                  strokeWidth={2.2}
                />
                <Line
                  points={[-width / 2, 0, width / 2, 0]}
                  stroke={portalAccent}
                  strokeWidth={1}
                  opacity={0.62}
                />
                {portal.kind === 'door' && (
                  <>
                    <Line
                      points={[-width / 2, 0, -width / 2, -width * 0.78]}
                      stroke={colors.wall}
                      strokeWidth={2}
                      lineCap="round"
                    />
                    <Arc
                      x={-width / 2}
                      y={0}
                      innerRadius={width * 0.77}
                      outerRadius={width * 0.77}
                      angle={90}
                      rotation={-90}
                      stroke={colors.partition}
                      strokeWidth={1.2}
                    />
                  </>
                )}
                {portal.kind === 'opening' && (
                  <Line
                    points={[-width / 2, 0, width / 2, 0]}
                    stroke="#a8b1ad"
                    strokeWidth={1}
                    dash={[4, 5]}
                  />
                )}
                {portal.kind === 'gate' && (
                  <>
                    <Rect
                      x={-width / 2 - 2.5}
                      y={-4.5}
                      width={5}
                      height={9}
                      fill={portalAccent}
                      cornerRadius={1}
                    />
                    <Rect
                      x={width / 2 - 2.5}
                      y={-4.5}
                      width={5}
                      height={9}
                      fill={portalAccent}
                      cornerRadius={1}
                    />
                    <Line
                      points={[-width / 2 + 3, 0, width / 2 - 3, 0]}
                      stroke={portalAccent}
                      strokeWidth={2.2}
                      dash={[6, 4]}
                    />
                  </>
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
                  stroke="#ffffff"
                  strokeWidth={13}
                  lineCap="round"
                  lineJoin="round"
                  shadowColor="rgba(23, 33, 31, 0.28)"
                  shadowBlur={8}
                  shadowOffsetY={3}
                />
                <Line
                  points={[...fromPoint, ...toPoint]}
                  stroke="#176b5b"
                  strokeWidth={7}
                  lineCap="round"
                  lineJoin="round"
                />
              </Group>
            );
          })}

          {cartography.connectorStops.map((stop) => {
            const point = toCanvas(stop.position);
            return (
              <CartographicConnectorSymbol
                key={stop.id}
                x={point[0]}
                y={point[1]}
                kind={stop.kind}
                accessible={stop.accessible}
                restricted={stop.restricted}
              />
            );
          })}

          {connectorMarkers.map(({ run, node, connector, movement }) => {
            const point = toCanvas([node.x, node.y]);
            return (
              <Group key={`${run.connectorId}-${activeFloor.id}`} x={point[0]} y={point[1]}>
                <Circle
                  radius={21}
                  fill="rgba(23, 107, 91, 0.1)"
                  stroke="#176b5b"
                  strokeWidth={2.5}
                  dash={[4, 4]}
                />
                <Circle radius={5} fill="#176b5b" stroke="#ffffff" strokeWidth={2} />
                <Text
                  x={29}
                  y={-17}
                  width={180}
                  text={`${connector?.name ?? 'Vertical connector'}\n${movement}`}
                  fontSize={11}
                  lineHeight={1.35}
                  fontStyle="bold"
                  fill={colors.text}
                  shadowColor="#ffffff"
                  shadowBlur={3}
                />
              </Group>
            );
          })}

          {standalonePois.map((node) => {
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
                  radius={12}
                  fill={category?.color ?? '#176b5b'}
                  stroke="#ffffff"
                  strokeWidth={3}
                  shadowColor="rgba(23, 33, 31, 0.2)"
                  shadowBlur={7}
                  shadowOffsetY={2}
                />
                <Text
                  x={-13}
                  y={-4.5}
                  width={26}
                  text={safeCategoryGlyph(category?.icon)}
                  align="center"
                  fontSize={8.5}
                  fontStyle="bold"
                  fill="#ffffff"
                />
                <Text
                  x={17}
                  y={-7}
                  width={150}
                  text={node.poi.name}
                  fontFamily="Inter, Segoe UI, sans-serif"
                  fontSize={12}
                  fontStyle="600"
                  fill={colors.text}
                  shadowColor="#ffffff"
                  shadowBlur={3}
                />
              </Group>
            );
          })}

          {startNode &&
            String(startNode.floor) === activeFloor.id &&
            (() => {
              const point = toCanvas([startNode.x, startNode.y]);
              return (
                <Group x={point[0]} y={point[1]} listening={false}>
                  <Circle radius={22} fill="rgba(23, 107, 91, 0.16)" />
                  <Circle
                    radius={13}
                    fill="#ffffff"
                    stroke="#176b5b"
                    strokeWidth={3}
                    shadowColor="rgba(23, 33, 31, 0.22)"
                    shadowBlur={8}
                    shadowOffsetY={2}
                  />
                  <Circle radius={6} fill="#176b5b" />
                </Group>
              );
            })()}

          {destinationNode &&
            String(destinationNode.floor) === activeFloor.id &&
            destinationNode.id !== startNode?.id &&
            (() => {
              const point = toCanvas([destinationNode.x, destinationNode.y]);
              return (
                <Group x={point[0]} y={point[1]} listening={false}>
                  <Circle radius={20} fill="rgba(237, 91, 58, 0.18)" />
                  <Circle
                    radius={13}
                    fill="#ed5b3a"
                    stroke="#ffffff"
                    strokeWidth={3}
                    shadowColor="rgba(23, 33, 31, 0.24)"
                    shadowBlur={8}
                    shadowOffsetY={2}
                  />
                  <Circle radius={4} fill="#ffffff" />
                </Group>
              );
            })()}
        </Layer>
      </Stage>

      <div className="compiled-map-topbar">
        <div className="compiled-floor-switcher" aria-label="Select floor">
          <span className="compiled-floor-switcher-label">
            <Layers size={14} />
            Floors
          </span>
          {buildingPackage.floors.map((floor) => (
            <button
              key={floor.id}
              type="button"
              className={floor.id === activeFloor.id ? 'active' : ''}
              data-route-floor={routeFloors.includes(floor.id) || undefined}
              aria-pressed={floor.id === activeFloor.id}
              aria-label={`Show ${floor.name}`}
              onClick={() => resetView(floor.id)}
            >
              <strong>{floor.level === 0 ? 'G' : `L${floor.level}`}</strong>
              <small>{floor.name}</small>
            </button>
          ))}
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
        <span className="compiled-map-floor-kicker">You’re viewing</span>
        <strong>{activeFloor.name}</strong>
        <span>{floorPois.length} destinations</span>
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
          <Accessibility size={12} /> Step-free access
        </span>
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
