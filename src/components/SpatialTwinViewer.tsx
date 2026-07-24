import { useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import {
  ContactShadows,
  Edges,
  GizmoHelper,
  GizmoViewport,
  Html,
  Line,
  OrbitControls,
} from '@react-three/drei';
import { Shape } from 'three';
import {
  Accessibility,
  Building2,
  Database,
  DoorOpen,
  Layers,
  LockKeyhole,
  Route,
  ScanLine,
} from 'lucide-react';
import type {
  FloorSource,
  PortalSource,
  SpaceSource,
  VerticalConnectorSource,
} from '@voicegis/spatial-schema';
import { BUILDING_PACKAGE as buildingPackage } from '../data/compiledBuilding';
import {
  buildSpaceWallSegments,
  getNearestBoundaryAngle,
  getPolygonBounds,
} from '../engine/spatialTwinArchitecture';
import {
  computeBuildingBounds,
  getGraphSummary,
  getVisibleSpaces,
  isSpaceRestricted,
  mapCoordinateToWorld,
  visualFloorElevation,
  type BuildingBounds,
  type FloorSelection,
} from '../engine/spatialTwinModel';

const SPACE_COLORS: Record<SpaceSource['type'], string> = {
  entrance: '#dbeafe',
  room: '#e2e8f0',
  corridor: '#ccfbf1',
  lobby: '#bfdbfe',
  service: '#ede9fe',
  restricted: '#fecdd3',
  'vertical-circulation': '#fef3c7',
};

const WALL_COLOR = '#dbe4ee';
const RESTRICTED_WALL_COLOR = '#8f3348';
const GLASS_COLOR = '#7dd3fc';
const WALL_THICKNESS_METERS = 0.12;

interface FloorGeometryProps {
  floor: FloorSource;
  bounds: BuildingBounds;
  exploded: boolean;
}

interface SpaceGeometryProps extends FloorGeometryProps {
  space: SpaceSource;
  portals: PortalSource[];
  selected: boolean;
  showArchitecture: boolean;
  onSelect: (spaceId: string) => void;
}

function polygonShape(points: [number, number][], bounds: BuildingBounds) {
  const shape = new Shape();
  points.forEach((coordinate, index) => {
    const [worldX, , worldZ] = mapCoordinateToWorld(coordinate, 0, bounds);
    if (index === 0) shape.moveTo(worldX, -worldZ);
    else shape.lineTo(worldX, -worldZ);
  });
  shape.closePath();
  return shape;
}

function FloorGeometry({ floor, bounds, exploded }: FloorGeometryProps) {
  const shape = useMemo(() => polygonShape(floor.outline, bounds), [bounds, floor.outline]);
  const elevation = visualFloorElevation(floor, exploded);
  const outline = [...floor.outline, floor.outline[0]].map((coordinate) =>
    mapCoordinateToWorld(coordinate, elevation + 0.025, bounds),
  );

  return (
    <group>
      <mesh position={[0, elevation - 0.16, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <extrudeGeometry args={[shape, { depth: 0.16, bevelEnabled: false }]} />
        <meshStandardMaterial color="#1e293b" metalness={0.12} roughness={0.78} />
      </mesh>
      <Line points={outline} color="#dbeafe" lineWidth={1.3} transparent opacity={0.55} />
    </group>
  );
}

interface WallRunProps {
  segment: ReturnType<typeof buildSpaceWallSegments>[number];
  elevation: number;
  height: number;
  bounds: BuildingBounds;
  color: string;
  glass: boolean;
}

function WallRun({ segment, elevation, height, bounds, color, glass }: WallRunProps) {
  const start = mapCoordinateToWorld(segment.start, elevation, bounds);
  const end = mapCoordinateToWorld(segment.end, elevation, bounds);
  const center: [number, number, number] = [
    (start[0] + end[0]) / 2,
    elevation + height / 2,
    (start[2] + end[2]) / 2,
  ];

  return (
    <mesh position={center} rotation={[0, -segment.angleRadians, 0]} castShadow receiveShadow>
      <boxGeometry args={[segment.length, height, WALL_THICKNESS_METERS]} />
      <meshPhysicalMaterial
        color={color}
        roughness={glass ? 0.08 : 0.72}
        metalness={glass ? 0.08 : 0.02}
        transmission={glass ? 0.58 : 0}
        transparent={glass}
        opacity={glass ? 0.68 : 1}
      />
    </mesh>
  );
}

function Bench({
  position,
  rotation = 0,
}: {
  position: [number, number, number];
  rotation?: number;
}) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 0.34, 0]} castShadow>
        <boxGeometry args={[1.5, 0.14, 0.48]} />
        <meshStandardMaterial color="#1d4ed8" roughness={0.58} />
      </mesh>
      <mesh position={[0, 0.72, 0.2]} castShadow>
        <boxGeometry args={[1.5, 0.62, 0.12]} />
        <meshStandardMaterial color="#2563eb" roughness={0.58} />
      </mesh>
      {[-0.55, 0.55].map((x) => (
        <mesh key={x} position={[x, 0.15, 0]}>
          <boxGeometry args={[0.08, 0.3, 0.36]} />
          <meshStandardMaterial color="#475569" metalness={0.45} roughness={0.35} />
        </mesh>
      ))}
    </group>
  );
}

function Planter({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.28, 0]} castShadow>
        <cylinderGeometry args={[0.34, 0.27, 0.56, 16]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.72} />
      </mesh>
      <mesh position={[0, 0.85, 0]} castShadow>
        <sphereGeometry args={[0.52, 14, 10]} />
        <meshStandardMaterial color="#15803d" roughness={0.88} />
      </mesh>
    </group>
  );
}

function ClinicalBed({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.56, 0]} castShadow>
        <boxGeometry args={[1.9, 0.22, 0.72]} />
        <meshStandardMaterial color="#e0f2fe" roughness={0.5} />
      </mesh>
      <mesh position={[-0.72, 0.78, 0]} rotation={[0, 0, -0.18]} castShadow>
        <boxGeometry args={[0.62, 0.16, 0.7]} />
        <meshStandardMaterial color="#bae6fd" roughness={0.48} />
      </mesh>
      {[-0.72, 0.72].map((x) =>
        [-0.26, 0.26].map((z) => (
          <mesh key={`${x}-${z}`} position={[x, 0.25, z]}>
            <cylinderGeometry args={[0.05, 0.05, 0.5, 8]} />
            <meshStandardMaterial color="#64748b" metalness={0.55} roughness={0.28} />
          </mesh>
        )),
      )}
    </group>
  );
}

function SemanticProps({
  space,
  bounds,
  elevation,
}: {
  space: SpaceSource;
  bounds: BuildingBounds;
  elevation: number;
}) {
  if (space.type === 'corridor' || space.type === 'vertical-circulation') return null;

  const footprint = getPolygonBounds(space.polygon);
  const [centerX, , centerZ] = mapCoordinateToWorld(footprint.center, elevation, bounds);
  const basePosition: [number, number, number] = [centerX, elevation, centerZ];
  const normalizedName = space.name.toLowerCase();

  if (space.type === 'entrance' || space.type === 'lobby') {
    return (
      <group>
        <Bench position={[centerX - 0.9, elevation, centerZ]} />
        <Planter position={[centerX + 1.25, elevation, centerZ + 0.4]} />
      </group>
    );
  }

  if (normalizedName.includes('reception') || normalizedName.includes('administration')) {
    return (
      <group position={basePosition}>
        <mesh position={[0, 0.56, 0]} castShadow>
          <boxGeometry args={[Math.min(3.4, footprint.width * 0.55), 1.12, 0.72]} />
          <meshStandardMaterial color="#f8fafc" roughness={0.52} />
        </mesh>
        <mesh position={[0, 1.13, 0.26]} castShadow>
          <boxGeometry args={[Math.min(3.5, footprint.width * 0.58), 0.08, 0.82]} />
          <meshStandardMaterial color="#0f766e" roughness={0.46} />
        </mesh>
        <mesh position={[0, 1.58, -0.28]}>
          <boxGeometry args={[0.66, 0.44, 0.05]} />
          <meshStandardMaterial color="#0f172a" emissive="#0891b2" emissiveIntensity={0.22} />
        </mesh>
      </group>
    );
  }

  if (normalizedName.includes('imaging')) {
    return (
      <group position={basePosition}>
        <mesh position={[0.65, 1.05, 0]} rotation={[0, Math.PI / 2, 0]} castShadow>
          <torusGeometry args={[0.78, 0.3, 18, 36]} />
          <meshStandardMaterial color="#f8fafc" metalness={0.18} roughness={0.3} />
        </mesh>
        <mesh position={[-0.35, 0.58, 0]} castShadow>
          <boxGeometry args={[1.7, 0.18, 0.58]} />
          <meshStandardMaterial color="#bae6fd" roughness={0.45} />
        </mesh>
      </group>
    );
  }

  if (normalizedName.includes('pharmacy') || normalizedName.includes('store')) {
    return (
      <group position={basePosition}>
        {[-1.15, 0, 1.15].map((x) => (
          <group key={x} position={[x, 0, 0]}>
            <mesh position={[0, 0.9, 0]} castShadow>
              <boxGeometry args={[0.76, 1.8, 0.34]} />
              <meshStandardMaterial color={space.public ? '#f8fafc' : '#475569'} roughness={0.62} />
            </mesh>
            {[0.38, 0.82, 1.26].map((y) => (
              <mesh key={y} position={[0, y, 0.2]}>
                <boxGeometry args={[0.68, 0.06, 0.18]} />
                <meshStandardMaterial color="#0ea5e9" />
              </mesh>
            ))}
          </group>
        ))}
      </group>
    );
  }

  if (normalizedName.includes('laboratory')) {
    return (
      <group position={basePosition}>
        {[-0.9, 0.9].map((z) => (
          <group key={z} position={[0, 0, z]}>
            <mesh position={[0, 0.66, 0]} castShadow>
              <boxGeometry args={[3.2, 0.14, 0.74]} />
              <meshStandardMaterial color="#e2e8f0" roughness={0.46} />
            </mesh>
            <mesh position={[0, 0.39, 0]}>
              <boxGeometry args={[2.7, 0.5, 0.52]} />
              <meshStandardMaterial color="#334155" roughness={0.64} />
            </mesh>
          </group>
        ))}
      </group>
    );
  }

  if (
    normalizedName.includes('cardiology') ||
    normalizedName.includes('consultation') ||
    normalizedName.includes('training')
  ) {
    return <ClinicalBed position={basePosition} />;
  }

  return null;
}

function SpaceGeometry({
  space,
  floor,
  bounds,
  exploded,
  portals,
  selected,
  showArchitecture,
  onSelect,
}: SpaceGeometryProps) {
  const shape = useMemo(() => polygonShape(space.polygon, bounds), [bounds, space.polygon]);
  const elevation = visualFloorElevation(floor, exploded);
  const restricted = isSpaceRestricted(space);
  const wallSegments = useMemo(() => buildSpaceWallSegments(space, portals), [portals, space]);
  const wallHeight = Math.min(floor.clearHeight * 0.72, 2.45);
  const glass = space.type === 'entrance';

  return (
    <group>
      <mesh
        position={[0, elevation + 0.012, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        onClick={(event) => {
          event.stopPropagation();
          onSelect(space.id);
        }}
      >
        <extrudeGeometry args={[shape, { depth: selected ? 0.09 : 0.045, bevelEnabled: false }]} />
        <meshStandardMaterial
          color={SPACE_COLORS[space.type]}
          emissive={selected ? '#0ea5e9' : '#000000'}
          emissiveIntensity={selected ? 0.42 : 0}
          metalness={0.01}
          roughness={0.7}
          transparent
          opacity={restricted ? 0.86 : 0.96}
        />
        <Edges color={selected ? '#0ea5e9' : restricted ? '#fb7185' : '#94a3b8'} threshold={20} />
      </mesh>
      {showArchitecture &&
        wallSegments.map((segment, index) => (
          <WallRun
            key={`${space.id}-wall-${index}`}
            segment={segment}
            elevation={elevation + 0.08}
            height={wallHeight}
            bounds={bounds}
            color={restricted ? RESTRICTED_WALL_COLOR : glass ? GLASS_COLOR : WALL_COLOR}
            glass={glass}
          />
        ))}
      {showArchitecture && (
        <SemanticProps space={space} bounds={bounds} elevation={elevation + 0.08} />
      )}
    </group>
  );
}

function PortalAssembly({
  portal,
  floor,
  bounds,
  exploded,
}: {
  portal: PortalSource;
  floor: FloorSource;
  bounds: BuildingBounds;
  exploded: boolean;
}) {
  const connectedSpace = buildingPackage.spaces.find((space) => space.id === portal.connects[0]);
  if (!connectedSpace) return null;

  const elevation = visualFloorElevation(floor, exploded) + 0.08;
  const position = mapCoordinateToWorld(portal.position, elevation, bounds);
  const angle = getNearestBoundaryAngle(connectedSpace.polygon, portal.position);
  const frameColor = portal.restricted ? '#fb7185' : portal.accessible ? '#0f766e' : '#f59e0b';
  const clearHeight = portal.kind === 'gate' ? 2.1 : 2.25;

  return (
    <group position={position} rotation={[0, -angle, 0]}>
      {[-portal.width / 2, portal.width / 2].map((x) => (
        <mesh key={x} position={[x, clearHeight / 2, 0]} castShadow>
          <boxGeometry args={[0.1, clearHeight, 0.18]} />
          <meshStandardMaterial color={frameColor} metalness={0.35} roughness={0.32} />
        </mesh>
      ))}
      <mesh position={[0, clearHeight, 0]} castShadow>
        <boxGeometry args={[portal.width + 0.1, 0.12, 0.18]} />
        <meshStandardMaterial color={frameColor} metalness={0.35} roughness={0.32} />
      </mesh>
      {portal.kind !== 'opening' && (
        <mesh position={[0, clearHeight / 2, 0.035]} castShadow>
          <boxGeometry args={[portal.width * 0.92, clearHeight * 0.93, 0.055]} />
          <meshPhysicalMaterial
            color={portal.restricted ? '#7f1d1d' : '#bae6fd'}
            transparent
            opacity={portal.restricted ? 0.72 : 0.42}
            transmission={portal.restricted ? 0.05 : 0.4}
            roughness={0.18}
          />
        </mesh>
      )}
    </group>
  );
}

function VerticalConnectorAssembly({
  connector,
  floor,
  bounds,
  exploded,
}: {
  connector: VerticalConnectorSource;
  floor: FloorSource;
  bounds: BuildingBounds;
  exploded: boolean;
}) {
  const stop = connector.stops.find((candidate) => candidate.floorId === floor.id);
  if (!stop) return null;

  const elevation = visualFloorElevation(floor, exploded) + 0.08;
  const position = mapCoordinateToWorld(stop.position, elevation, bounds);
  const height = Math.min(floor.clearHeight * 0.76, 2.5);

  if (connector.kind === 'elevator') {
    return (
      <group position={position}>
        <mesh position={[0, height / 2, 0]} castShadow>
          <boxGeometry args={[2.3, height, 2.05]} />
          <meshPhysicalMaterial
            color="#67e8f9"
            transparent
            opacity={0.25}
            transmission={0.55}
            roughness={0.12}
            metalness={0.12}
          />
        </mesh>
        {[-0.54, 0.54].map((x) => (
          <mesh key={x} position={[x, 1.05, 1.045]} castShadow>
            <boxGeometry args={[1.02, 2.1, 0.07]} />
            <meshStandardMaterial color="#64748b" metalness={0.72} roughness={0.2} />
          </mesh>
        ))}
        <mesh position={[1.28, 1.2, 1.07]}>
          <boxGeometry args={[0.14, 0.36, 0.06]} />
          <meshStandardMaterial color="#0f172a" emissive="#22d3ee" emissiveIntensity={0.65} />
        </mesh>
      </group>
    );
  }

  if (connector.kind === 'stairs' || connector.kind === 'escalator') {
    const stepCount = 10;
    return (
      <group position={position} rotation={[0, Math.PI / 2, 0]}>
        {Array.from({ length: stepCount }, (_, index) => {
          const stepHeight = 0.13 + index * 0.14;
          return (
            <mesh
              key={index}
              position={[0, stepHeight / 2, -1.35 + index * 0.28]}
              castShadow
              receiveShadow
            >
              <boxGeometry args={[1.9, stepHeight, 0.3]} />
              <meshStandardMaterial color="#cbd5e1" roughness={0.68} />
            </mesh>
          );
        })}
        {[-1.05, 1.05].map((x) => (
          <mesh key={x} position={[x, 1.1, 0]} rotation={[0.61, 0, 0]}>
            <cylinderGeometry args={[0.035, 0.035, 3.45, 8]} />
            <meshStandardMaterial color="#0284c7" metalness={0.5} roughness={0.28} />
          </mesh>
        ))}
      </group>
    );
  }

  return null;
}

function PoiLabels({
  floorSelection,
  bounds,
  exploded,
}: {
  floorSelection: FloorSelection;
  bounds: BuildingBounds;
  exploded: boolean;
}) {
  const floorsById = useMemo(
    () => new Map(buildingPackage.floors.map((floor) => [floor.id, floor])),
    [],
  );

  return (
    <>
      {buildingPackage.pois.map((poi) => {
        if (!poi.public || (floorSelection !== 'all' && poi.floorId !== floorSelection))
          return null;
        if (
          floorSelection === 'all' &&
          !['entrance', 'service', 'pharmacy', 'medical'].includes(poi.category)
        ) {
          return null;
        }
        const floor = floorsById.get(poi.floorId);
        if (!floor) return null;
        const position = mapCoordinateToWorld(
          poi.position,
          visualFloorElevation(floor, exploded) + 2.82,
          bounds,
        );
        return (
          <Html key={poi.id} position={position} center distanceFactor={18}>
            <div className="twin-poi-label">{poi.name}</div>
          </Html>
        );
      })}
    </>
  );
}

interface OverlayProps {
  bounds: BuildingBounds;
  exploded: boolean;
  floorSelection: FloorSelection;
  visibleSpaceIds: Set<string>;
}

function RoutingOverlay({ bounds, exploded, floorSelection, visibleSpaceIds }: OverlayProps) {
  const floorsById = useMemo(
    () => new Map(buildingPackage.floors.map((floor) => [floor.id, floor])),
    [],
  );
  const nodesById = useMemo(
    () => new Map(buildingPackage.routing.nodes.map((node) => [node.id, node])),
    [],
  );

  const visibleNodes = buildingPackage.routing.nodes.filter((node) => {
    if (floorSelection !== 'all' && node.floorId !== floorSelection) return false;
    return node.kind !== 'space' || visibleSpaceIds.has(node.sourceId);
  });
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));

  const pointForNode = (nodeId: string) => {
    const node = nodesById.get(nodeId);
    if (!node) return null;
    const floor = floorsById.get(node.floorId);
    if (!floor) return null;
    return mapCoordinateToWorld(
      node.position,
      visualFloorElevation(floor, exploded) + 0.42,
      bounds,
    );
  };

  return (
    <group>
      {buildingPackage.routing.edges.map((edge) => {
        if (!visibleNodeIds.has(edge.from) || !visibleNodeIds.has(edge.to)) return null;
        const from = pointForNode(edge.from);
        const to = pointForNode(edge.to);
        if (!from || !to) return null;
        const color = edge.restricted
          ? '#fb7185'
          : !edge.accessible
            ? '#fbbf24'
            : edge.kind === 'vertical-connector'
              ? '#c084fc'
              : '#22d3ee';
        return (
          <Line
            key={edge.id}
            points={[from, to]}
            color={color}
            lineWidth={edge.kind === 'vertical-connector' ? 2.6 : 1.35}
            transparent
            opacity={0.92}
          />
        );
      })}
      {visibleNodes.map((node) => {
        const point = pointForNode(node.id);
        if (!point) return null;
        return (
          <mesh key={node.id} position={point}>
            <sphereGeometry args={[node.kind === 'poi' ? 0.11 : 0.07, 10, 10]} />
            <meshBasicMaterial color={node.kind === 'poi' ? '#f8fafc' : '#22d3ee'} />
          </mesh>
        );
      })}
    </group>
  );
}

function AnchorOverlay({ bounds, exploded, floorSelection, visibleSpaceIds }: OverlayProps) {
  const floorsById = useMemo(
    () => new Map(buildingPackage.floors.map((floor) => [floor.id, floor])),
    [],
  );

  return (
    <group>
      {buildingPackage.localizationAnchors.map((anchor) => {
        if (floorSelection !== 'all' && anchor.floorId !== floorSelection) return null;
        if (!visibleSpaceIds.has(anchor.spaceId)) return null;
        const floor = floorsById.get(anchor.floorId);
        if (!floor) return null;
        const base = mapCoordinateToWorld(
          anchor.position,
          visualFloorElevation(floor, exploded) + 0.24,
          bounds,
        );
        const top: [number, number, number] = [base[0], base[1] + 0.85, base[2]];
        return (
          <group key={anchor.id}>
            <Line points={[base, top]} color="#a78bfa" lineWidth={1.4} />
            <mesh position={top} rotation={[0, (anchor.headingDegrees * Math.PI) / 180, 0]}>
              <octahedronGeometry args={[0.18, 0]} />
              <meshStandardMaterial color="#c4b5fd" emissive="#7c3aed" emissiveIntensity={0.7} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

interface TwinSceneProps {
  floorSelection: FloorSelection;
  exploded: boolean;
  showRestricted: boolean;
  showArchitecture: boolean;
  showLabels: boolean;
  showRouting: boolean;
  showAnchors: boolean;
  selectedSpaceId: string | null;
  onSelectSpace: (spaceId: string) => void;
  onClearSelection: () => void;
}

function TwinScene({
  floorSelection,
  exploded,
  showRestricted,
  showArchitecture,
  showLabels,
  showRouting,
  showAnchors,
  selectedSpaceId,
  onSelectSpace,
  onClearSelection,
}: TwinSceneProps) {
  const bounds = useMemo(() => computeBuildingBounds(buildingPackage), []);
  const visibleSpaces = useMemo(
    () =>
      getVisibleSpaces(buildingPackage, {
        floorId: floorSelection,
        includeRestricted: showRestricted,
      }),
    [floorSelection, showRestricted],
  );
  const visibleSpaceIds = useMemo(
    () => new Set(visibleSpaces.map((space) => space.id)),
    [visibleSpaces],
  );
  const visibleFloors = buildingPackage.floors.filter(
    (floor) => floorSelection === 'all' || floor.id === floorSelection,
  );
  const floorsById = useMemo(
    () => new Map(buildingPackage.floors.map((floor) => [floor.id, floor])),
    [],
  );
  const orbitTargetY =
    visibleFloors.reduce((total, floor) => total + visualFloorElevation(floor, exploded) + 1.2, 0) /
    Math.max(1, visibleFloors.length);

  return (
    <>
      <color attach="background" args={['#07101d']} />
      <fog attach="fog" args={['#07101d', 90, 180]} />
      <ambientLight intensity={0.86} />
      <hemisphereLight args={['#e0f2fe', '#0f172a', 1.35]} />
      <directionalLight
        position={[18, 28, 13]}
        intensity={2.2}
        castShadow
        shadow-mapSize={[2048, 2048]}
      />
      <directionalLight position={[-12, 14, -16]} intensity={0.65} color="#67e8f9" />

      <gridHelper args={[104, 104, '#35506a', '#142438']} position={[0, -0.18, 0]} />
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.19, 0]}
        onClick={onClearSelection}
        receiveShadow
      >
        <planeGeometry args={[104, 104]} />
        <meshStandardMaterial color="#081321" roughness={0.86} />
      </mesh>

      {visibleFloors.map((floor) => (
        <FloorGeometry key={floor.id} floor={floor} bounds={bounds} exploded={exploded} />
      ))}
      {visibleSpaces.map((space) => {
        const floor = floorsById.get(space.floorId);
        if (!floor) return null;
        return (
          <SpaceGeometry
            key={space.id}
            space={space}
            floor={floor}
            bounds={bounds}
            exploded={exploded}
            portals={buildingPackage.portals.filter((portal) => portal.floorId === floor.id)}
            selected={space.id === selectedSpaceId}
            showArchitecture={showArchitecture}
            onSelect={onSelectSpace}
          />
        );
      })}
      {showArchitecture &&
        visibleFloors.flatMap((floor) =>
          buildingPackage.portals
            .filter((portal) => portal.floorId === floor.id)
            .filter((portal) => portal.connects.some((spaceId) => visibleSpaceIds.has(spaceId)))
            .map((portal) => (
              <PortalAssembly
                key={portal.id}
                portal={portal}
                floor={floor}
                bounds={bounds}
                exploded={exploded}
              />
            )),
        )}
      {showArchitecture &&
        visibleFloors.flatMap((floor) =>
          buildingPackage.verticalConnectors.map((connector) => (
            <VerticalConnectorAssembly
              key={`${connector.id}-${floor.id}`}
              connector={connector}
              floor={floor}
              bounds={bounds}
              exploded={exploded}
            />
          )),
        )}
      {showLabels && (
        <PoiLabels floorSelection={floorSelection} bounds={bounds} exploded={exploded} />
      )}
      {showRouting && (
        <RoutingOverlay
          bounds={bounds}
          exploded={exploded}
          floorSelection={floorSelection}
          visibleSpaceIds={visibleSpaceIds}
        />
      )}
      {showAnchors && (
        <AnchorOverlay
          bounds={bounds}
          exploded={exploded}
          floorSelection={floorSelection}
          visibleSpaceIds={visibleSpaceIds}
        />
      )}

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        target={[0, orbitTargetY, 0]}
        minDistance={9}
        maxDistance={128}
        maxPolarAngle={Math.PI / 2.05}
      />
      <ContactShadows
        position={[0, -0.17, 0]}
        opacity={0.45}
        scale={84}
        blur={2.6}
        far={24}
        frames={1}
      />
      <GizmoHelper alignment="bottom-right" margin={[76, 76]}>
        <GizmoViewport axisColors={['#fb7185', '#4ade80', '#38bdf8']} labelColor="#e2e8f0" />
      </GizmoHelper>
    </>
  );
}

interface ToggleButtonProps {
  active: boolean;
  label: string;
  onClick: () => void;
}

function ToggleButton({ active, label, onClick }: ToggleButtonProps) {
  return (
    <button
      className={`twin-toggle ${active ? 'active' : ''}`}
      type="button"
      aria-pressed={active}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export default function SpatialTwinViewer() {
  const [floorSelection, setFloorSelection] = useState<FloorSelection>('all');
  const [exploded, setExploded] = useState(true);
  const [showRestricted, setShowRestricted] = useState(true);
  const [showArchitecture, setShowArchitecture] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [showRouting, setShowRouting] = useState(false);
  const [showAnchors, setShowAnchors] = useState(false);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null);

  const visibleSpaces = useMemo(
    () =>
      getVisibleSpaces(buildingPackage, {
        floorId: floorSelection,
        includeRestricted: showRestricted,
      }),
    [floorSelection, showRestricted],
  );
  const selectedSpace = visibleSpaces.find((space) => space.id === selectedSpaceId);
  const graphSummary = useMemo(() => getGraphSummary(buildingPackage), []);
  const buildingBounds = useMemo(() => computeBuildingBounds(buildingPackage), []);
  const explodedHeight = Math.max(
    ...buildingPackage.floors.map((floor) => visualFloorElevation(floor, true) + floor.clearHeight),
  );
  const cameraPosition: [number, number, number] = [
    buildingBounds.width * 0.92,
    Math.max(40, explodedHeight + 20),
    buildingBounds.depth * 1.85,
  ];

  const selectedPortals = selectedSpace
    ? buildingPackage.portals.filter((portal) => portal.connects.includes(selectedSpace.id))
    : [];
  const selectedPois = selectedSpace
    ? buildingPackage.pois.filter((poi) => poi.spaceId === selectedSpace.id)
    : [];
  const selectedAnchors = selectedSpace
    ? buildingPackage.localizationAnchors.filter((anchor) => anchor.spaceId === selectedSpace.id)
    : [];

  return (
    <section className="spatial-twin" aria-label="Compiled indoor spatial twin inspector">
      <div className="twin-toolbar">
        <div className="twin-heading">
          <span className="twin-eyebrow">Compiled package inspector</span>
          <div className="twin-title-row">
            <h1>{buildingPackage.building.name}</h1>
            <span className="twin-fixture-badge">Fictional benchmark</span>
          </div>
          <p>Semantic geometry, policy metadata, graph topology, and localization anchors.</p>
        </div>

        <div className="twin-controls" aria-label="Spatial twin display controls">
          <div className="twin-control-group" aria-label="Floor isolation">
            <span>Floor</span>
            <ToggleButton
              active={floorSelection === 'all'}
              label="All"
              onClick={() => setFloorSelection('all')}
            />
            {buildingPackage.floors.map((floor) => (
              <ToggleButton
                key={floor.id}
                active={floorSelection === floor.id}
                label={floor.level === 0 ? 'G' : `L${floor.level}`}
                onClick={() => setFloorSelection(floor.id)}
              />
            ))}
          </div>
          <ToggleButton
            active={exploded}
            label="Exploded"
            onClick={() => setExploded((value) => !value)}
          />
          <ToggleButton
            active={showArchitecture}
            label="Architecture"
            onClick={() => setShowArchitecture((value) => !value)}
          />
          <ToggleButton
            active={showLabels}
            label="Labels"
            onClick={() => setShowLabels((value) => !value)}
          />
          <ToggleButton
            active={showRestricted}
            label="Restricted"
            onClick={() => setShowRestricted((value) => !value)}
          />
          <ToggleButton
            active={showRouting}
            label="Routing graph"
            onClick={() => setShowRouting((value) => !value)}
          />
          <ToggleButton
            active={showAnchors}
            label="Anchors"
            onClick={() => setShowAnchors((value) => !value)}
          />
        </div>
      </div>

      <div className="twin-stage">
        <div
          className="twin-canvas"
          role="application"
          aria-label="Interactive 3D model. Drag to orbit, scroll to zoom, and select a space."
        >
          <div className="twin-viewport-status" aria-hidden="true">
            <span>
              <Building2 size={13} />
              Architectural cutaway
            </span>
            <span>
              <DoorOpen size={13} />
              {buildingPackage.portals.length} modeled portals
            </span>
          </div>
          <Canvas
            camera={{ position: cameraPosition, fov: 42, near: 0.1, far: 220 }}
            dpr={[1, 1.5]}
            frameloop="demand"
            shadows
          >
            <TwinScene
              floorSelection={floorSelection}
              exploded={exploded}
              showRestricted={showRestricted}
              showArchitecture={showArchitecture}
              showLabels={showLabels}
              showRouting={showRouting}
              showAnchors={showAnchors}
              selectedSpaceId={selectedSpaceId}
              onSelectSpace={setSelectedSpaceId}
              onClearSelection={() => setSelectedSpaceId(null)}
            />
          </Canvas>
        </div>

        <aside className="twin-inspector" aria-live="polite">
          {selectedSpace ? (
            <>
              <div className="twin-inspector-header">
                <span className="twin-space-type">{selectedSpace.type.replace('-', ' ')}</span>
                <h2>{selectedSpace.name}</h2>
                <code>{selectedSpace.id}</code>
              </div>
              <dl className="twin-property-grid">
                <div>
                  <dt>Floor</dt>
                  <dd>
                    {
                      buildingPackage.floors.find((floor) => floor.id === selectedSpace.floorId)
                        ?.name
                    }
                  </dd>
                </div>
                <div>
                  <dt>Access</dt>
                  <dd>{selectedSpace.public ? 'Public' : 'Restricted'}</dd>
                </div>
                <div>
                  <dt>Mobility</dt>
                  <dd>{selectedSpace.accessible ? 'Accessible' : 'Not accessible'}</dd>
                </div>
                <div>
                  <dt>Boundary</dt>
                  <dd>{selectedSpace.polygon.length} vertices</dd>
                </div>
              </dl>
              <div className="twin-related-data">
                <h3>Compiled relationships</h3>
                <p>{selectedPortals.length} portals</p>
                <p>{selectedPois.length} points of interest</p>
                <p>{selectedAnchors.length} localization anchors</p>
              </div>
              {selectedPois.length > 0 && (
                <div className="twin-tag-list">
                  {selectedPois.map((poi) => (
                    <span key={poi.id}>{poi.name}</span>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="twin-empty-inspector">
              <ScanLine size={24} />
              <h2>Inspect a semantic space</h2>
              <p>
                Select any extruded area to trace its source metadata and compiled relationships.
              </p>
            </div>
          )}

          <div className="twin-package-facts">
            <div>
              <Layers size={15} />
              <span>{buildingPackage.spaces.length} spaces</span>
            </div>
            <div>
              <Route size={15} />
              <span>
                {graphSummary.nodeCount} nodes / {graphSummary.edgeCount} edges
              </span>
            </div>
            <div>
              <Accessibility size={15} />
              <span>{graphSummary.accessibleEdgeCount} accessible edges</span>
            </div>
            <div>
              <LockKeyhole size={15} />
              <span>{graphSummary.restrictedEdgeCount} restricted edges</span>
            </div>
            <div title={buildingPackage.manifest.contentHash}>
              <Database size={15} />
              <code>{buildingPackage.manifest.contentHash.slice(0, 12)}</code>
            </div>
          </div>
        </aside>
      </div>

      <div className="twin-legend" aria-label="Spatial twin legend">
        <span>
          <i className="legend-swatch public" /> Public space
        </span>
        <span>
          <i className="legend-swatch restricted" /> Restricted space
        </span>
        <span>
          <i className="legend-line accessible" /> Accessible edge
        </span>
        <span>
          <i className="legend-line inaccessible" /> Inaccessible edge
        </span>
        <span>
          <i className="legend-anchor" /> Localization anchor
        </span>
        <strong>Fictional benchmark — not surveyed or deployment-safe</strong>
      </div>
    </section>
  );
}
