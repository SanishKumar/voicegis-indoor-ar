import { useEffect, useMemo, useRef, useState } from 'react';
import { Arc, Circle, Group, Layer, Line, Rect, Stage, Text } from 'react-konva';
import type Konva from 'konva';
import type { ConnectorKind } from '@voicegis/spatial-schema';
import {
  Accessibility,
  ArrowUpDown,
  Box,
  Compass,
  Footprints,
  Layers,
  Map as MapIcon,
  Route,
} from 'lucide-react';
import {
  CARTOGRAPHIC_THEME,
  spaceSurfaceFills,
  wallSurface,
} from '../engine/cartographicTheme';
import { useNavigation } from '../context/NavigationContext.jsx';
import type { CompiledBuildingRuntime, VisitorPoiNode } from '../data/compiledBuilding';
import {
  createCartographicProjection,
  deriveCartographicExtrusionFaces,
  deriveFloorplanCartography,
  getCartographicBounds,
  placeCartographicLabels,
  projectCartographicPoint,
  projectCartographicPortalFrame,
  type CartographicBounds,
  type CartographicProjectionMode,
} from '../engine/floorplanCartography';
import {
  polygonCentroid,
  routeConnectorRuns,
  routeFloorIds,
  routeSegmentsForFloor,
} from '../engine/floorplanModel';
import type { RouteResult } from '../engine/routingCore';

const WORLD_SCALE = 44;
const MAP_PADDING = 96;
const PERSPECTIVE_SLAB_DEPTH = 18;
const RAISED_SPACE_TYPES = new Set(['room', 'service', 'restricted', 'vertical-circulation']);
const SPACE_RENDER_ORDER = {
  corridor: 0,
  lobby: 1,
  entrance: 2,
  room: 3,
  service: 4,
  'vertical-circulation': 5,
  restricted: 6,
} as const;
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
  venue: CompiledBuildingRuntime;
}

const SPACE_COLORS = spaceSurfaceFills();

function safeCategoryGlyph(icon: string | undefined) {
  return icon && /^[\x20-\x7e]{1,3}$/.test(icon) ? icon : '•';
}

function fixedScreenBounds(
  center: [number, number],
  width: number,
  height: number,
): CartographicBounds {
  return {
    minX: center[0] - width / 2,
    minY: center[1] - height / 2,
    maxX: center[0] + width / 2,
    maxY: center[1] + height / 2,
    width,
    height,
    center,
  };
}

interface CartographicConnectorSymbolProps {
  x: number;
  y: number;
  kind: ConnectorKind;
  accessible: boolean;
  restricted: boolean;
  inverseScale: number;
}

function CartographicConnectorSymbol({
  x,
  y,
  kind,
  accessible,
  restricted,
  inverseScale,
}: CartographicConnectorSymbolProps) {
  const accent = restricted ? '#a54b55' : accessible ? '#176b5b' : '#b9782d';
  const label =
    kind === 'elevator' ? 'LIFT' : kind === 'stairs' ? 'STAIR' : kind === 'ramp' ? 'RAMP' : 'ESC';

  return (
    <Group x={x} y={y} scaleX={inverseScale} scaleY={inverseScale} listening={false}>
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
          <Line points={[-10, 3, 9, -9]} stroke="#53605a" strokeWidth={2} lineCap="round" />
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
  const { state, actions, venue } = useNavigation() as unknown as NavigatorContextValue;
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
  const suppressClickRef = useRef(false);
  const [dimensions, setDimensions] = useState({ width: 900, height: 620 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [projectionMode, setProjectionMode] = useState<CartographicProjectionMode>('perspective');

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

  const projection = useMemo(
    () =>
      createCartographicProjection(activeFloor.outline, projectionMode, WORLD_SCALE, MAP_PADDING),
    [activeFloor.outline, projectionMode],
  );
  const worldWidth = projection.width;
  const worldHeight =
    projection.height + (projectionMode === 'perspective' ? PERSPECTIVE_SLAB_DEPTH : 0);
  const fitScale = Math.max(
    0.1,
    Math.min(dimensions.width / worldWidth, dimensions.height / worldHeight) * 0.88,
  );
  const stageScale = fitScale * zoom;
  const basePosition = {
    x: (dimensions.width - worldWidth * stageScale) / 2,
    y: (dimensions.height - worldHeight * stageScale) / 2,
  };
  const stagePosition = { x: basePosition.x + pan.x, y: basePosition.y + pan.y };

  const toCanvas = (point: [number, number]): [number, number] =>
    projectCartographicPoint(projection, point);
  const projectedOutline = activeFloor.outline.map(toCanvas);
  const slabFaces =
    projectionMode === 'perspective'
      ? deriveCartographicExtrusionFaces(projectedOutline, PERSPECTIVE_SLAB_DEPTH)
      : [];

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
  const inverseStageScale = 1 / stageScale;
  const spaceDisplays = floorSpaces.map((space) => {
    const projectedPoints = space.polygon.map(toCanvas);
    const projectedBounds = getCartographicBounds(projectedPoints);
    const centre = toCanvas(polygonCentroid(space.polygon));
    const spacePois = poisBySpace.get(space.id) ?? [];
    const primaryPoi = spacePois[0];
    const category = primaryPoi ? venue.getCategory(primaryPoi.poi.category) : null;
    const selected = state.selectedPOI?.poi?.spaceId === space.id;
    const destination = destinationSpaceId === space.id;
    const screenWidth = projectedBounds.width * stageScale;
    const screenHeight = projectedBounds.height * stageScale;
    const compact = screenWidth < 138 || screenHeight < 82;
    const labelWidth = Math.max(72, Math.min(156, screenWidth - 18));
    const labelFontSize = space.type === 'corridor' ? 9.5 : compact ? 10.5 : 11.5;
    const showLabelCandidate =
      space.type === 'corridor'
        ? screenWidth > 185 && screenHeight > 46
        : screenWidth > 88 && screenHeight > 54;
    const labelPriority = selected
      ? 1000
      : destination
        ? 950
        : space.type === 'entrance'
          ? 800
          : primaryPoi?.poi.public
            ? 650
            : primaryPoi
              ? 360
              : space.type === 'corridor'
                ? 140
                : 260;

    return {
      space,
      projectedPoints,
      projectedBounds,
      centre,
      spacePois,
      primaryPoi,
      category,
      selected,
      destination,
      clickable: spacePois.length > 0,
      compact,
      labelWidth,
      labelFontSize,
      label: primaryPoi?.poi.name ?? space.name,
      showLabelCandidate,
      labelPriority,
    };
  });
  const reservedLabelBounds = [
    ...cartography.connectorStops.map((stop) => {
      const point = toCanvas(stop.position);
      return fixedScreenBounds([point[0] * stageScale, point[1] * stageScale], 54, 48);
    }),
    ...standalonePois.map((node) => {
      const point = toCanvas([node.x, node.y]);
      return fixedScreenBounds([point[0] * stageScale, point[1] * stageScale], 34, 34);
    }),
  ];
  const visibleLabelSpaceIds = new Set(
    placeCartographicLabels(
      spaceDisplays
        .filter((display) => display.showLabelCandidate)
        .map((display) => ({
          id: display.space.id,
          center: [
            display.centre[0] * stageScale,
            display.centre[1] * stageScale + (display.primaryPoi ? 10 : 0),
          ] as [number, number],
          width: display.labelWidth,
          height: display.primaryPoi ? 58 : display.space.type === 'corridor' ? 20 : 34,
          priority: display.labelPriority,
          required: display.selected || display.destination,
        })),
      reservedLabelBounds,
      6,
    ).map((label) => label.id),
  );
  const renderSpaceDisplays = [...spaceDisplays].sort(
    (left, right) =>
      SPACE_RENDER_ORDER[left.space.type] - SPACE_RENDER_ORDER[right.space.type] ||
      left.space.id.localeCompare(right.space.id),
  );

  const colors = {
    background: CARTOGRAPHIC_THEME.plan.background,
    paper: CARTOGRAPHIC_THEME.plan.paper,
    floor: CARTOGRAPHIC_THEME.plan.floor,
    wall: wallSurface('exterior').color,
    partition: wallSurface('interior').color,
    text: '#17211f',
    muted: '#6f7874',
    spaces: SPACE_COLORS,
  };

  const resetView = (floorId: string) => {
    actions.setFloor(floorId);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const changeProjection = (mode: CartographicProjectionMode) => {
    setProjectionMode(mode);
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
        key={`${dimensions.width}:${dimensions.height}:${projectionMode}`}
        ref={stageRef}
        width={dimensions.width}
        height={dimensions.height}
        x={stagePosition.x}
        y={stagePosition.y}
        scaleX={stageScale}
        scaleY={stageScale}
        draggable
        onDragStart={() => {
          suppressClickRef.current = true;
        }}
        onDragEnd={(event) => {
          setPan({
            x: event.target.x() - basePosition.x,
            y: event.target.y() - basePosition.y,
          });
          requestAnimationFrame(() => {
            suppressClickRef.current = false;
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
            y={projectionMode === 'perspective' ? PERSPECTIVE_SLAB_DEPTH + 5 : 10}
            points={projectedOutline.flat()}
            closed
            fill="#aeb8b2"
            stroke="#9da9a2"
            strokeWidth={2}
            strokeScaleEnabled={false}
            opacity={0.48}
            shadowColor="rgba(23, 33, 31, 0.24)"
            shadowBlur={34}
            shadowOffsetY={18}
            listening={false}
          />
          {slabFaces.map((face) => (
            <Line
              key={face.id}
              points={face.points.flat()}
              closed
              fill={face.shade === 'front' ? '#aeb9b3' : '#c4ccc7'}
              stroke="#929e98"
              strokeWidth={1.2}
              strokeScaleEnabled={false}
              lineJoin="round"
              listening={false}
            />
          ))}
          <Line
            points={projectedOutline.flat()}
            closed
            fill={colors.paper}
            stroke="#c9d1cd"
            strokeWidth={1.4}
            strokeScaleEnabled={false}
            lineJoin="round"
            listening={false}
          />

          {renderSpaceDisplays.map((display) => {
            const {
              space,
              projectedPoints,
              centre,
              spacePois,
              primaryPoi,
              category,
              selected,
              destination,
              clickable,
              labelWidth,
              label,
              labelFontSize,
            } = display;
            const showLabel = visibleLabelSpaceIds.has(space.id);
            const roomFill = destination
              ? '#f9d7ce'
              : selected
                ? '#dceee8'
                : colors.spaces[space.type];
            return (
              <Group
                key={space.id}
                onClick={() =>
                  clickable && !suppressClickRef.current && actions.selectPOI(spacePois[0])
                }
                onTap={() =>
                  clickable && !suppressClickRef.current && actions.selectPOI(spacePois[0])
                }
                onMouseEnter={(event) => {
                  if (clickable) event.target.getStage()!.container().style.cursor = 'pointer';
                }}
                onMouseLeave={(event) => {
                  event.target.getStage()!.container().style.cursor = 'default';
                }}
              >
                <Line
                  points={projectedPoints.flat()}
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
                  strokeScaleEnabled={false}
                  lineJoin="round"
                  shadowColor={
                    projectionMode === 'perspective' && RAISED_SPACE_TYPES.has(space.type)
                      ? 'rgba(54, 67, 61, 0.28)'
                      : undefined
                  }
                  shadowBlur={
                    projectionMode === 'perspective' && RAISED_SPACE_TYPES.has(space.type) ? 7 : 0
                  }
                  shadowOffsetY={
                    projectionMode === 'perspective' && RAISED_SPACE_TYPES.has(space.type) ? 5 : 0
                  }
                  shadowOpacity={0.52}
                />
                {(space.type === 'restricted' || !space.public) && (
                  <Line
                    points={projectedPoints.flat()}
                    closed
                    stroke="#a54b55"
                    strokeWidth={1.6}
                    strokeScaleEnabled={false}
                    dash={[9, 6]}
                    opacity={0.52}
                    lineJoin="round"
                    listening={false}
                  />
                )}
                {primaryPoi && space.type !== 'corridor' && (
                  <Group
                    x={centre[0]}
                    y={centre[1]}
                    scaleX={inverseStageScale}
                    scaleY={inverseStageScale}
                    listening={false}
                  >
                    <Circle
                      y={showLabel ? -11 : 0}
                      radius={9}
                      fill={category?.color ?? '#176b5b'}
                      stroke="#ffffff"
                      strokeWidth={2.5}
                      shadowColor="rgba(23, 33, 31, 0.2)"
                      shadowBlur={6}
                      shadowOffsetY={2}
                    />
                    <Text
                      x={-10}
                      y={showLabel ? -14.5 : -3.5}
                      width={20}
                      text={safeCategoryGlyph(category?.icon)}
                      align="center"
                      fontFamily="Inter, Segoe UI, sans-serif"
                      fontSize={7}
                      fontStyle="bold"
                      fill="#ffffff"
                    />
                    {showLabel && (
                      <Text
                        x={-labelWidth / 2}
                        y={7}
                        width={labelWidth}
                        text={label}
                        align="center"
                        fontFamily="Inter, Segoe UI, sans-serif"
                        fontSize={labelFontSize}
                        fontStyle="600"
                        lineHeight={1.12}
                        fill={colors.text}
                      />
                    )}
                  </Group>
                )}
                {showLabel && (!primaryPoi || space.type === 'corridor') && (
                  <Group
                    x={centre[0]}
                    y={centre[1]}
                    scaleX={inverseStageScale}
                    scaleY={inverseStageScale}
                    listening={false}
                  >
                    <Text
                      x={-labelWidth / 2}
                      y={-labelFontSize / 2}
                      width={labelWidth}
                      text={space.type === 'corridor' ? space.name.toUpperCase() : label}
                      align="center"
                      fontFamily="Inter, Segoe UI, sans-serif"
                      fontSize={labelFontSize}
                      fontStyle={space.type === 'corridor' ? 'bold' : '600'}
                      letterSpacing={space.type === 'corridor' ? 1.7 : 0}
                      fill={space.type === 'corridor' ? colors.muted : colors.text}
                      opacity={space.type === 'corridor' ? 0.68 : 1}
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
                    strokeScaleEnabled={false}
                    lineCap="square"
                    lineJoin="miter"
                  />
                  <Line
                    points={[...start, ...end]}
                    stroke={colors.paper}
                    strokeWidth={1.25}
                    strokeScaleEnabled={false}
                    lineCap="square"
                  />
                  {wall.kind === 'restricted' && (
                    <Line
                      points={[...start, ...end]}
                      stroke="#a54b55"
                      strokeWidth={1.25}
                      strokeScaleEnabled={false}
                      dash={[7, 6]}
                      opacity={0.82}
                    />
                  )}
                </Group>
              );
            })}

          <Line
            points={projectedOutline.flat()}
            closed
            stroke={colors.wall}
            strokeWidth={7}
            strokeScaleEnabled={false}
            lineJoin="round"
            listening={false}
          />
          <Line
            points={projectedOutline.flat()}
            closed
            stroke="#cbd3cf"
            strokeWidth={1.7}
            strokeScaleEnabled={false}
            lineJoin="round"
            listening={false}
          />

          {cartography.portals.map((portal) => {
            const frame = projectCartographicPortalFrame(projection, portal);
            const angle = (frame.angleRadians * 180) / Math.PI;
            const width = frame.width;
            const portalAccent = portal.restricted
              ? '#a54b55'
              : portal.accessible
                ? '#729c91'
                : '#b9782d';
            return (
              <Group
                key={portal.id}
                x={frame.center[0]}
                y={frame.center[1]}
                rotation={angle}
                listening={false}
              >
                <Line
                  points={[-width / 2, 0, width / 2, 0]}
                  stroke={colors.paper}
                  strokeWidth={10}
                  strokeScaleEnabled={false}
                />
                <Line
                  points={[-width / 2, -5, -width / 2, 5]}
                  stroke={colors.wall}
                  strokeWidth={2.2}
                  strokeScaleEnabled={false}
                />
                <Line
                  points={[width / 2, -5, width / 2, 5]}
                  stroke={colors.wall}
                  strokeWidth={2.2}
                  strokeScaleEnabled={false}
                />
                <Line
                  points={[-width / 2, 0, width / 2, 0]}
                  stroke={portalAccent}
                  strokeWidth={1}
                  strokeScaleEnabled={false}
                  opacity={0.62}
                />
                {portal.kind === 'door' && (
                  <>
                    <Line
                      points={[-width / 2, 0, -width / 2, -width * 0.78]}
                      stroke={colors.wall}
                      strokeWidth={2}
                      strokeScaleEnabled={false}
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
                      strokeScaleEnabled={false}
                    />
                  </>
                )}
                {portal.kind === 'opening' && (
                  <Line
                    points={[-width / 2, 0, width / 2, 0]}
                    stroke="#a8b1ad"
                    strokeWidth={1}
                    strokeScaleEnabled={false}
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
                      strokeScaleEnabled={false}
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
                  strokeScaleEnabled={false}
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
                  strokeScaleEnabled={false}
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
                inverseScale={inverseStageScale}
              />
            );
          })}

          {connectorMarkers.map(({ run, node, connector, movement }) => {
            const point = toCanvas([node.x, node.y]);
            return (
              <Group
                key={`${run.connectorId}-${activeFloor.id}`}
                x={point[0]}
                y={point[1]}
                scaleX={inverseStageScale}
                scaleY={inverseStageScale}
              >
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
                scaleX={inverseStageScale}
                scaleY={inverseStageScale}
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
                <Group
                  x={point[0]}
                  y={point[1]}
                  scaleX={inverseStageScale}
                  scaleY={inverseStageScale}
                  listening={false}
                >
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
                <Group
                  x={point[0]}
                  y={point[1]}
                  scaleX={inverseStageScale}
                  scaleY={inverseStageScale}
                  listening={false}
                >
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

      <div className="compiled-map-view-mode" role="group" aria-label="Map view">
        <button
          type="button"
          className={projectionMode === 'perspective' ? 'active' : ''}
          aria-pressed={projectionMode === 'perspective'}
          onClick={() => changeProjection('perspective')}
        >
          <Box size={14} />
          <span>Tilted</span>
        </button>
        <button
          type="button"
          className={projectionMode === 'plan' ? 'active' : ''}
          aria-pressed={projectionMode === 'plan'}
          onClick={() => changeProjection('plan')}
        >
          <MapIcon size={14} />
          <span>Plan</span>
        </button>
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
