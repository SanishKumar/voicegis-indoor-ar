import { useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Edges, Line, OrbitControls } from '@react-three/drei';
import { Shape } from 'three';
import { Accessibility, Database, Layers, LockKeyhole, Route, ScanLine } from 'lucide-react';
import type { CompiledBuildingPackage } from '@voicegis/map-compiler';
import type { FloorSource, SpaceSource } from '@voicegis/spatial-schema';
import referencePackageJson from '../../buildings/reference-medical-centre/compiled/building.package.json';
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

const buildingPackage = referencePackageJson as unknown as CompiledBuildingPackage;

const SPACE_COLORS: Record<SpaceSource['type'], string> = {
  entrance: '#38bdf8',
  room: '#64748b',
  corridor: '#0f766e',
  lobby: '#2563eb',
  service: '#7c3aed',
  restricted: '#be123c',
  'vertical-circulation': '#d97706',
};

interface FloorGeometryProps {
  floor: FloorSource;
  bounds: BuildingBounds;
  exploded: boolean;
}

interface SpaceGeometryProps extends FloorGeometryProps {
  space: SpaceSource;
  selected: boolean;
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
      <mesh position={[0, elevation - 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <extrudeGeometry args={[shape, { depth: 0.06, bevelEnabled: false }]} />
        <meshStandardMaterial color="#0f172a" transparent opacity={0.72} roughness={0.9} />
      </mesh>
      <Line points={outline} color="#94a3b8" lineWidth={1.1} transparent opacity={0.65} />
    </group>
  );
}

function SpaceGeometry({ space, floor, bounds, exploded, selected, onSelect }: SpaceGeometryProps) {
  const shape = useMemo(() => polygonShape(space.polygon, bounds), [bounds, space.polygon]);
  const elevation = visualFloorElevation(floor, exploded);
  const restricted = isSpaceRestricted(space);
  const edgeColor = selected
    ? '#f8fafc'
    : restricted
      ? '#fb7185'
      : space.accessible
        ? '#94a3b8'
        : '#fbbf24';

  return (
    <mesh
      position={[0, elevation, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      castShadow
      receiveShadow
      onClick={(event) => {
        event.stopPropagation();
        onSelect(space.id);
      }}
    >
      <extrudeGeometry args={[shape, { depth: selected ? 0.28 : 0.2, bevelEnabled: false }]} />
      <meshStandardMaterial
        color={SPACE_COLORS[space.type]}
        emissive={selected ? '#0e7490' : '#000000'}
        emissiveIntensity={selected ? 0.7 : 0}
        metalness={0.05}
        roughness={0.72}
        transparent
        opacity={restricted ? 0.74 : 0.88}
      />
      <Edges color={edgeColor} threshold={20} />
    </mesh>
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

  return (
    <>
      <color attach="background" args={['#070b16']} />
      <fog attach="fog" args={['#070b16', 34, 62]} />
      <ambientLight intensity={0.65} />
      <hemisphereLight args={['#bfdbfe', '#111827', 1.25]} />
      <directionalLight position={[12, 24, 8]} intensity={1.4} castShadow />

      <gridHelper args={[52, 52, '#334155', '#172033']} position={[0, -0.1, 0]} />
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.115, 0]}
        onClick={onClearSelection}
        receiveShadow
      >
        <planeGeometry args={[52, 52]} />
        <meshStandardMaterial color="#080d1a" />
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
            selected={space.id === selectedSpaceId}
            onSelect={onSelectSpace}
          />
        );
      })}
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
        enableDamping={false}
        target={[0, 1.8, 0]}
        minDistance={12}
        maxDistance={56}
        maxPolarAngle={Math.PI / 2.05}
      />
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
  const [showRouting, setShowRouting] = useState(false);
  const [showAnchors, setShowAnchors] = useState(true);
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
            <span className="twin-fixture-badge">Synthetic fixture</span>
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
          <Canvas
            camera={{ position: [24, 23, 29], fov: 42, near: 0.1, far: 120 }}
            dpr={[1, 1.5]}
            frameloop="demand"
            shadows
          >
            <TwinScene
              floorSelection={floorSelection}
              exploded={exploded}
              showRestricted={showRestricted}
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
        <strong>Reference data only — not surveyed or deployment-safe</strong>
      </div>
    </section>
  );
}
