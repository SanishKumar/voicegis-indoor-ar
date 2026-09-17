import { useEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Camera, LocateFixed, Maximize, Minus, Plus } from 'lucide-react';
import { useNavigation, VIEW_TYPE } from '../context/NavigationContext.jsx';
import { createVenueScene, type VenueScene } from '../map/venueScene';
import { resolveVisitorLocation } from '../navigation/visitorLocation';
import type { LocationBasis } from '../navigation/visitorJourney';
import type { CheckInRecord } from '../capture/anchorCheckIn';
import type { GraphNode, RouteStep } from '../engine/routingCore';
import { positionAt, trackForRoute, walkedFloors } from '../navigation/routeProgress';
import {
  NO_INSETS,
  defaultMapView,
  type MapInsets,
  type MapMode,
  type VisitorMapView,
} from '../map/visitorCamera';
import './visitorJourney.css';

/** How close the camera sits while following a walk-through. */
const FOLLOW_SCALE = 0.36;

/**
 * How much of the map the interface covers, measured from the elements that
 * say they cover it. Which edge each one covers is read from where it is, so
 * the same markup works as a top banner and bottom sheet on a phone and as a
 * side panel on a desktop.
 */
type Rect = { x: number; y: number; width: number; height: number };
const sameRects = (a: Rect[], b: Rect[]) =>
  a.length === b.length &&
  a.every(
    (rect, index) =>
      rect.x === b[index].x &&
      rect.y === b[index].y &&
      rect.width === b[index].width &&
      rect.height === b[index].height,
  );

function useMapInsets(mapRef: RefObject<HTMLDivElement | null>, enabled: boolean) {
  const [insets, setInsets] = useState<MapInsets>(NO_INSETS);
  const [controls, setControls] = useState<Rect[]>([]);
  useEffect(() => {
    const map = mapRef.current;
    const stage = map?.parentElement;
    if (!map || !stage) return undefined;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const bounds = map.getBoundingClientRect();
      const next = { top: 0, right: 0, bottom: 0, left: 0 };
      if (enabled && bounds.width > 0 && bounds.height > 0) {
        for (const element of stage.querySelectorAll('[data-map-inset]')) {
          const rect = element.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          const wide = rect.width >= bounds.width * 0.6;
          const tall = rect.height >= bounds.height * 0.6;
          if (wide && rect.top <= bounds.top + 4) {
            next.top = Math.max(next.top, rect.bottom - bounds.top);
          } else if (wide && rect.bottom >= bounds.bottom - 4) {
            next.bottom = Math.max(next.bottom, bounds.bottom - rect.top);
          }
          if (tall && rect.left <= bounds.left + 4) {
            next.left = Math.max(next.left, rect.right - bounds.left);
          } else if (tall && rect.right >= bounds.right - 4) {
            next.right = Math.max(next.right, bounds.right - rect.left);
          }
        }
      }
      const rounded: MapInsets = {
        top: Math.round(next.top),
        right: Math.round(next.right),
        bottom: Math.round(next.bottom),
        left: Math.round(next.left),
      };
      // The controls are placed from these offsets, so they are applied before
      // the controls are measured. Measuring first read where the buttons were
      // about to stop being, and a button that moves without resizing never
      // triggers another measurement.
      map.style.setProperty('--map-inset-top', `${rounded.top}px`);
      map.style.setProperty('--map-inset-right', `${rounded.right}px`);
      map.style.setProperty('--map-inset-bottom', `${rounded.bottom}px`);
      map.style.setProperty('--map-inset-left', `${rounded.left}px`);

      // The map's own button groups, so labels are not drawn underneath them.
      const groups: Rect[] = [];
      for (const group of map.querySelectorAll(
        '.compiled-map-presentation, .compiled-map-floors, .compiled-map-zoom',
      )) {
        const rect = group.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        groups.push({
          x: Math.round(rect.left - bounds.left),
          y: Math.round(rect.top - bounds.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      }
      setControls((current) => (sameRects(current, groups) ? current : groups));
      setInsets((current) =>
        current.top === rounded.top &&
        current.right === rounded.right &&
        current.bottom === rounded.bottom &&
        current.left === rounded.left
          ? current
          : rounded,
      );
    };
    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(measure);
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(map);
    const watchCovers = () => {
      for (const element of stage.querySelectorAll(
        '[data-map-inset], .compiled-map-presentation, .compiled-map-floors, .compiled-map-zoom',
      ))
        resize.observe(element);
      schedule();
    };
    const mutations = new MutationObserver(watchCovers);
    mutations.observe(stage, { childList: true, subtree: true });
    watchCovers();
    return () => {
      window.cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
    };
  }, [mapRef, enabled]);
  return { insets, controls };
}

/**
 * What the map keeps while it is off screen - during a camera-view visit, the
 * map is unmounted. Without the route it had framed and whether the visitor had
 * taken the camera, coming back reframed the route over the view they chose.
 */
export interface MapMemory {
  venueHash: string;
  view: VisitorMapView;
  framedRoute: unknown;
  userMoved: boolean;
}

interface NavigationValue {
  state: {
    startNodeId: string;
    locationFloorId: string;
    locationBasis: LocationBasis;
    activeFloorId: string;
    selectedPOI?: { poi?: { spaceId?: string } } | null;
    route?:
      | { found: true; path: GraphNode[]; steps: RouteStep[] }
      | { found: false; path?: undefined }
      | null;
    progressMeters: number;
  };
  checkIn: CheckInRecord | null;
  actions: {
    setFloor(floorId: string): void;
    selectPOI(node: unknown): void;
    setView(view: string): void;
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
  journey = false,
  following = false,
  sigmaMeters = null,
}: {
  viewMemory: MutableRefObject<MapMemory | null>;
  recoveryTarget?: HTMLElement | null;
  /** A route is being planned or shown; the map gives way to its chrome. */
  journey?: boolean;
  /** Keep the guidance marker centred and the way ahead up. */
  following?: boolean;
  /** Live position uncertainty to draw around the marker; null for a walk-through. */
  sigmaMeters?: number | null;
}) {
  const { state, actions, venue, checkIn } = useNavigation() as unknown as NavigationValue;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const userMovedRef = useRef(false);
  const framedRouteRef = useRef<unknown>(null);
  const [userMoved, setUserMoved] = useState(false);
  const { insets, controls } = useMapInsets(mapRef, journey);
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
  const route = state.route?.found === true ? state.route : null;
  const track = route ? trackForRoute(route) : null;
  const guidancePosition = track ? positionAt(track, state.progressMeters) : null;
  const routeFloorIds = track ? walkedFloors(track) : [];
  const atEnd = track !== null && state.progressMeters >= track.length - 0.05;
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
        const remembered = viewMemory.current?.venueHash === venueHash ? viewMemory.current : null;
        if (remembered) {
          framedRouteRef.current = remembered.framedRoute;
          if (remembered.userMoved) {
            scene.restoreUserMove();
            userMovedRef.current = true;
            setUserMoved(true);
          }
        }
        scene.onUserMove((moved) => {
          userMovedRef.current = moved;
          setUserMoved(moved);
        });
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
      if (scene) {
        viewMemory.current = {
          venueHash,
          view: scene.getView(),
          framedRoute: framedRouteRef.current,
          userMoved: scene.wasMovedByUser(),
        };
      }
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
    sceneRef.current?.setRoute(
      state.route?.found
        ? state.route.path.map((point) => ({ x: point.x, y: point.y, floor: String(point.floor) }))
        : [],
    );
  }, [ready, state.activeFloorId, state.route, attempt, buildingPackage]);

  useEffect(() => {
    if (!ready) return;
    sceneRef.current?.setSelectedSpace(state.selectedPOI?.poi?.spaceId ?? null);
  }, [ready, state.selectedPOI, state.activeFloorId, attempt, buildingPackage]);

  // Covered space goes to the camera; the controls already have it as CSS offsets.
  useEffect(() => {
    if (!ready) return;
    sceneRef.current?.setInsets(insets);
  }, [ready, insets, attempt]);

  useEffect(() => {
    if (!ready) return;
    sceneRef.current?.setLabelObstacles(controls);
  }, [ready, controls, attempt]);

  useEffect(() => {
    if (!ready) return;
    sceneRef.current?.setProgress(route ? state.progressMeters : null);
  }, [ready, route, state.progressMeters, state.activeFloorId, attempt]);

  const puckX = guidancePosition?.x;
  const puckY = guidancePosition?.y;
  const puckFloor = guidancePosition?.floor;
  const headingX = guidancePosition?.heading[0];
  const headingY = guidancePosition?.heading[1];
  useEffect(() => {
    if (!ready) return;
    sceneRef.current?.setPuck(
      puckX !== undefined &&
        puckY !== undefined &&
        puckFloor &&
        headingX !== undefined &&
        headingY !== undefined
        ? { x: puckX, y: puckY, floorId: puckFloor, heading: [headingX, headingY], sigmaMeters }
        : null,
    );
  }, [
    ready,
    puckX,
    puckY,
    puckFloor,
    headingX,
    headingY,
    sigmaMeters,
    state.activeFloorId,
    attempt,
  ]);

  useEffect(() => {
    if (!ready) return;
    // At the destination there is nothing ahead to make room for.
    sceneRef.current?.setFollow(
      following ? { headingUp: true, scale: FOLLOW_SCALE, lookahead: atEnd ? 0 : 0.22 } : null,
    );
  }, [ready, following, atEnd, attempt]);

  // A new route is always shown whole. After that the camera only reframes
  // for the visitor's benefit - a panel resizing, a change of floor - and
  // never over a view they chose themselves.
  const wasFollowingRef = useRef(false);
  useEffect(() => {
    const leftFollowing = wasFollowingRef.current && !following;
    wasFollowingRef.current = following;
    if (!ready || !route || following) return;
    const newRoute = framedRouteRef.current !== route;
    if (!newRoute && !leftFollowing && userMovedRef.current) return;
    framedRouteRef.current = route;
    // Following turned the map to the direction of travel; the overview it
    // returns to is the plan the right way up.
    sceneRef.current?.frameRoute({ northUp: leftFollowing });
  }, [ready, route, following, insets, state.activeFloorId, attempt]);

  useEffect(() => {
    if (!ready) return;
    // Inside a journey the guidance marker stands in for the start.
    if (journey && route) {
      sceneRef.current?.setLocation(null);
      return;
    }
    sceneRef.current?.setLocation(
      locationX !== undefined && locationY !== undefined && locationFloor && locationBasis
        ? { position: [locationX, locationY], floorId: locationFloor, basis: locationBasis }
        : null,
    );
  }, [
    ready,
    journey,
    route,
    locationX,
    locationY,
    locationFloor,
    locationBasis,
    attempt,
    buildingPackage,
  ]);

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
      ref={mapRef}
      className="compiled-map"
      data-route-floors={routeFloorCount}
      data-camera-owner={userMoved ? 'visitor' : 'guidance'}
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
          {journey && route && (
            <button
              type="button"
              className="compiled-map-camera"
              aria-label="Camera view"
              title="Check which way to go with the camera"
              onClick={() => actions.setView(VIEW_TYPE.CAMERA_PREVIEW)}
            >
              <Camera size={16} strokeWidth={2} aria-hidden="true" />
            </button>
          )}
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
      {location && !journey && (
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
        {journey && route && guidancePosition && (
          <button
            type="button"
            className={userMoved ? 'is-emphasised' : undefined}
            aria-label={following ? 'Recenter on guidance' : 'Show whole route'}
            onClick={() => {
              actions.setFloor(guidancePosition.floor);
              sceneRef.current?.recenter();
            }}
          >
            <LocateFixed size={18} strokeWidth={2} aria-hidden="true" />
          </button>
        )}
        {location && !journey && (
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
        {!journey && (
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
        )}
      </div>

      <div className="compiled-map-floors" role="group" aria-label="Floors">
        {[...floors]
          .filter(
            (floor) =>
              !journey ||
              !route ||
              String(floor.id) === String(state.activeFloorId) ||
              routeFloorIds.includes(String(floor.id)),
          )
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
