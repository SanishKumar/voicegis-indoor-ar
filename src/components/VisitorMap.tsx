import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { createPortal } from 'react-dom';
import { LocateFixed, Maximize, Minus, Plus } from 'lucide-react';
import { useNavigation } from '../context/NavigationContext.jsx';
import { createVenueScene, type VenueScene } from '../map/venueScene';
import { resolveVisitorLocation } from '../navigation/visitorLocation';
import type { LocationBasis } from '../navigation/visitorJourney';
import type { CheckInRecord } from '../capture/anchorCheckIn';
import { defaultMapView, type MapMode, type VisitorMapView } from '../map/visitorCamera';
import './visitorJourney.css';

interface NavigationValue {
  state: {
    startNodeId: string;
    locationFloorId: string;
    locationBasis: LocationBasis;
    activeFloorId: string;
    selectedPOI?: { poi?: { spaceId?: string } } | null;
    route?: { found?: boolean; path?: Array<{ x: number; y: number; floor: string }> } | null;
  };
  checkIn: CheckInRecord | null;
  actions: {
    setFloor(floorId: string): void;
    selectPOI(node: unknown): void;
  };
  venue: {
    buildingPackage: Parameters<typeof createVenueScene>[2];
    getNodeById(id: string): unknown;
  };
}

/**
 * The visitor map.
 *
 * The scene is built once per venue and then addressed imperatively - React
 * owns which floor is active and what is selected, the scene owns geometry and
 * the render loop. Rebuilding a WebGL scene on every state change is the one
 * thing this arrangement exists to avoid.
 */
export default function VisitorMap({
  viewMemory,
  recoveryTarget = null,
}: {
  viewMemory: MutableRefObject<{ venueHash: string; view: VisitorMapView } | null>;
  recoveryTarget?: HTMLElement | null;
}) {
  const { state, actions, venue, checkIn } = useNavigation() as unknown as NavigationValue;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<VenueScene | null>(null);
  const [ready, setReady] = useState(false);
  const [renderStatus, setRenderStatus] = useState<'loading' | 'ready' | 'lost' | 'unavailable'>(
    'loading',
  );
  const [attempt, setAttempt] = useState(0);

  const buildingPackage = venue.buildingPackage;
  const venueHash = buildingPackage.manifest.contentHash;
  const [presentation, setPresentation] = useState(() =>
    viewMemory.current?.venueHash === venueHash ? viewMemory.current.view : defaultMapView(),
  );
  const floors = buildingPackage.floors;
  const location = resolveVisitorLocation(state, checkIn, buildingPackage);
  const locationX = location?.position[0];
  const locationY = location?.position[1];
  const locationFloor = location?.floorId;
  const locationBasis = location?.basis;

  // Overview is explicitly requested; a cross-floor route alone never opens it.
  const routeFloorCount = new Set(
    (state.route?.found === true ? (state.route.path ?? []) : []).map((point) =>
      String(point.floor),
    ),
  ).size;

  useEffect(() => {
    const canvas = canvasRef.current;
    const labelLayer = labelRef.current;
    if (canvas === null || labelLayer === null) return undefined;

    let scene: VenueScene | null = null;
    let frame = 0;
    let contextLost = false;
    const onLost = (event: Event) => {
      event.preventDefault();
      contextLost = true;
      setRenderStatus('lost');
    };
    const onRestored = () => {
      contextLost = false;
      if (!scene) {
        setAttempt((value) => value + 1);
        return;
      }
      setRenderStatus('ready');
    };
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    const tick = () => {
      if (!scene) {
        try {
          const saved =
            viewMemory.current?.venueHash === venueHash ? viewMemory.current.view : undefined;
          scene = createVenueScene(canvas, labelLayer, buildingPackage, saved);
        } catch {
          setRenderStatus('unavailable');
          setReady(false);
          return;
        }
        sceneRef.current = scene;
        setReady(true);
        setRenderStatus('ready');
        setPresentation(scene.getView());
        // Let the journey effects apply the active floor/route/checkpoint before
        // the first draw; never flash the package's default floor on recovery.
        frame = window.requestAnimationFrame(tick);
        return;
      }
      if (!contextLost) scene.frame();
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(frame);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      if (scene) viewMemory.current = { venueHash, view: scene.getView() };
      sceneRef.current = null;
      setReady(false);
      scene?.dispose();
    };
  }, [buildingPackage, venueHash, viewMemory, attempt]);

  useEffect(() => {
    if (!ready) return;
    sceneRef.current?.setActiveFloor(String(state.activeFloorId));
    // The route is redrawn with the floor, because only the part of it on this
    // floor belongs on this floor.
    sceneRef.current?.setRoute(state.route?.found ? (state.route.path ?? []) : []);
  }, [ready, state.activeFloorId, state.route, attempt, buildingPackage]);

  useEffect(() => {
    if (!ready) return;
    sceneRef.current?.setSelectedSpace(state.selectedPOI?.poi?.spaceId ?? null);
  }, [ready, state.selectedPOI, state.activeFloorId, attempt, buildingPackage]);

  useEffect(() => {
    if (!ready) return;
    sceneRef.current?.setLocation(
      locationX !== undefined && locationY !== undefined && locationFloor && locationBasis
        ? { position: [locationX, locationY], floorId: locationFloor, basis: locationBasis }
        : null,
    );
  }, [ready, locationX, locationY, locationFloor, locationBasis, attempt, buildingPackage]);

  const handleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    // Letting go after dragging the map is not a tap on whatever happens to be
    // under the cursor.
    if (sceneRef.current?.wasDragged() === true) return;
    const poiId = sceneRef.current?.pickPoi(event.clientX, event.clientY) ?? null;
    if (poiId === null) return;
    const node = venue.getNodeById(`poi:${poiId}`);
    if (node) actions.selectPOI(node);
  };
  const changeMode = (mode: MapMode) => {
    sceneRef.current?.setMode(mode);
    if (sceneRef.current) setPresentation(sceneRef.current.getView());
  };

  const recovery = (renderStatus === 'lost' || renderStatus === 'unavailable') && (
    <div className="compiled-map-fallback" role="status">
      <strong>{renderStatus === 'lost' ? 'Map display paused' : 'Map display unavailable'}</strong>
      <span>Your route is unchanged. Search and written directions still work.</span>
      <button
        type="button"
        onClick={() => {
          setReady(false);
          setRenderStatus('loading');
          setAttempt((value) => value + 1);
        }}
      >
        Retry map display
      </button>
    </div>
  );

  return (
    <div
      className="compiled-map"
      data-route-floors={routeFloorCount}
      data-location-floor={locationFloor}
      data-location-basis={locationBasis}
      data-render-status={renderStatus}
    >
      <canvas
        ref={canvasRef}
        className="compiled-map-canvas"
        onClick={handleClick}
        tabIndex={0}
        title={
          presentation.mode === '2d'
            ? 'Drag or use arrow keys to pan. Pinch or use the zoom buttons to zoom.'
            : 'Drag to orbit. Shift-drag, two fingers or arrow keys to pan.'
        }
        aria-label={`${presentation.mode === '2d' ? '2D plan' : '3D model'} of ${floors.find((floor) => floor.id === state.activeFloorId)?.name ?? 'the venue'}`}
      />
      <div ref={labelRef} className="compiled-map-labels" aria-hidden="true" />
      <div className="compiled-map-presentation" role="group" aria-label="Map presentation">
        <div className="compiled-map-modes">
          <button
            type="button"
            aria-label="2D plan"
            aria-pressed={presentation.mode === '2d'}
            disabled={renderStatus !== 'ready'}
            onClick={() => changeMode('2d')}
          >
            2D
          </button>
          <button
            type="button"
            aria-label="3D model"
            aria-pressed={presentation.mode === '3d'}
            disabled={renderStatus !== 'ready'}
            onClick={() => changeMode('3d')}
          >
            3D
          </button>
        </div>
        {presentation.mode === '3d' && routeFloorCount > 1 && (
          <button
            className="compiled-map-overview"
            type="button"
            aria-pressed={presentation.overview}
            disabled={renderStatus !== 'ready'}
            onClick={() => {
              sceneRef.current?.setOverview(!presentation.overview);
              if (sceneRef.current) setPresentation(sceneRef.current.getView());
            }}
          >
            Route overview
          </button>
        )}
      </div>
      {/* Recovery belongs inside visible directions, never underneath their panel.
          Expanding the map moves this same action back onto the unobstructed map. */}
      {recoveryTarget ? createPortal(recovery, recoveryTarget) : recovery}
      {location && (
        <div className="compiled-map-location" aria-label="Planning location">
          <strong>
            {location.basis === 'qr' ? `Last check-in · ${location.label}` : location.label}
          </strong>
          <span>
            {floors.find((floor) => floor.id === location.floorId)?.name} ·{' '}
            {location.basis === 'qr' ? 'Not tracked between check-ins' : 'Not a measured position'}
          </span>
        </div>
      )}

      {/* Wheel and pinch are not available to a keyboard, so the same moves
          have buttons. */}
      <div className="compiled-map-zoom" role="group" aria-label="Map view">
        {location && (
          <button
            type="button"
            aria-label={
              location.basis === 'qr' ? 'Recenter on last check-in' : 'Recenter on selected start'
            }
            onClick={() => {
              actions.setFloor(location.floorId);
              sceneRef.current?.focusLocation();
            }}
          >
            <LocateFixed size={18} strokeWidth={2} aria-hidden="true" />
          </button>
        )}
        <button type="button" aria-label="Zoom in" onClick={() => sceneRef.current?.zoomBy(0.75)}>
          <Plus size={18} strokeWidth={2} aria-hidden="true" />
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => sceneRef.current?.zoomBy(1.35)}>
          <Minus size={18} strokeWidth={2} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Reset the map view"
          onClick={() => {
            sceneRef.current?.resetView();
            if (sceneRef.current) setPresentation(sceneRef.current.getView());
          }}
        >
          <Maximize size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      <div className="compiled-map-floors" role="group" aria-label="Floors">
        {[...floors]
          .sort((left, right) => right.level - left.level)
          .map((floor) => {
            const active = String(floor.id) === String(state.activeFloorId);
            return (
              <button
                key={floor.id}
                type="button"
                className={`compiled-map-floor${active ? ' active' : ''}`}
                aria-pressed={active}
                aria-label={`Show ${floor.name}`}
                onClick={() => actions.setFloor(floor.id)}
              >
                <b>{floor.level === 0 ? 'G' : `L${floor.level}`}</b>
              </button>
            );
          })}
      </div>
    </div>
  );
}
