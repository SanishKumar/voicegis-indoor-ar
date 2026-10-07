import { useEffect, useId, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Camera, LocateFixed, Maximize, Minus, Plus, SlidersHorizontal } from 'lucide-react';
import { useNavigation, VIEW_TYPE } from '../context/NavigationContext.jsx';
import {
  createVenueScene,
  type SceneZone,
  type SceneZoneMemory,
  type VenueScene,
} from '../map/venueScene';
import type { MapGraphicsSetting, MapGraphicsSnapshot } from '../map/visitorRenderQuality';
import { mapCheckpointKey } from '../map/visitorMapMemory';
import { logField } from '../fieldTest/fieldLog';
import { resolveVisitorLocation } from '../navigation/visitorLocation';
import type { LocationBasis } from '../navigation/visitorJourney';
import type { CheckInRecord } from '../capture/anchorCheckIn';
import type { GraphNode, RouteStep } from '../engine/routingCore';
import type { RouteDisplayClearance } from '../engine/routeClearance';
import { positionShownOn, trackForRoute, walkedFloors } from '../navigation/routeProgress';
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
/** How long the name of a map just entered stays up. */
const AREA_CARD_MS = 2600;

/** The name of the map the visitor has just come in to, and how they came. */
interface AreaCard {
  key: number;
  kicker: string;
  name: string;
}

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

/*
 * The panes over the map float a little way in from its edges rather than
 * touching them, so "at the top" means within this many pixels of the top.
 * The strip between a pane and the edge is too thin to be useful map, and the
 * inset runs from the edge to the pane's far side.
 */
const EDGE_REACH = 32;

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
          if (wide && rect.top <= bounds.top + EDGE_REACH) {
            next.top = Math.max(next.top, rect.bottom - bounds.top);
          } else if (wide && rect.bottom >= bounds.bottom - EDGE_REACH) {
            next.bottom = Math.max(next.bottom, bounds.bottom - rect.top);
          }
          if (tall && rect.left <= bounds.left + EDGE_REACH) {
            next.left = Math.max(next.left, rect.right - bounds.left);
          } else if (tall && rect.right >= bounds.right - EDGE_REACH) {
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
        '.compiled-map-presentation, .compiled-map-floors, .compiled-map-zoom, .compiled-map-location',
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
        '[data-map-inset], .compiled-map-presentation, .compiled-map-floors, .compiled-map-zoom, .compiled-map-location',
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
  graphics?: MapGraphicsSnapshot;
  zone?: SceneZoneMemory;
  /** A new scan or chosen start takes precedence over an old browsing view. */
  checkpointKey?: string;
}

interface NavigationValue {
  state: {
    startNodeId: string;
    locationFloorId: string;
    locationBasis: LocationBasis;
    activeFloorId: string;
    selectedPOI?: { poi?: { spaceId?: string } } | null;
    route?:
      | {
          found: true;
          path: GraphNode[];
          steps: RouteStep[];
          displayClearance?: RouteDisplayClearance;
        }
      | { found: false; path?: undefined; displayClearance?: RouteDisplayClearance }
      | null;
    progressMeters: number;
  };
  checkIn: (CheckInRecord & { scannedAt?: number }) | null;
  actions: {
    setFloor(floorId: string): void;
    selectPOI(node: unknown): void;
    setView(view: string): void;
  };
  venue: {
    buildingPackage: Parameters<typeof createVenueScene>[2];
    getNodeById(id: string): unknown;
    whereAt(position: readonly [number, number], floorId: string): string;
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
  const [graphics, setGraphics] = useState<MapGraphicsSnapshot | null>(null);
  const [graphicsOpen, setGraphicsOpen] = useState(false);
  /*
   * A venue with grounds is several maps that connect: the grounds, and each
   * building. Which one is open is the scene's to say - it follows the marker
   * through doors - and what is shown round the map follows from it: the
   * floors offered are that building's, and coming in to a map names it.
   */
  const [zone, setZone] = useState<SceneZone | null>(null);
  const zoneRef = useRef<SceneZone | null>(null);
  const [areaCard, setAreaCard] = useState<AreaCard | null>(null);
  const areaCardCount = useRef(0);
  const graphicsButtonRef = useRef<HTMLButtonElement>(null);
  const graphicsPanelRef = useRef<HTMLDivElement>(null);
  const graphicsId = useId();

  useEffect(() => {
    if (!graphicsOpen) return undefined;
    const dismissOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (
        graphicsButtonRef.current?.contains(event.target) ||
        graphicsPanelRef.current?.contains(event.target)
      )
        return;
      // Do not steal focus from the control the visitor is actually using.
      setGraphicsOpen(false);
    };
    document.addEventListener('pointerdown', dismissOutside);
    return () => document.removeEventListener('pointerdown', dismissOutside);
  }, [graphicsOpen]);

  const buildingPackage = venue.buildingPackage;
  const venueHash = buildingPackage.manifest.contentHash;
  const [presentation, setPresentation] = useState(() =>
    viewMemory.current?.venueHash === venueHash ? viewMemory.current.view : defaultMapView(),
  );
  const floors = buildingPackage.floors;
  const location = resolveVisitorLocation(state, checkIn, buildingPackage);
  const route = state.route?.found === true ? state.route : null;
  const track = route ? trackForRoute(route) : null;
  // Inside a storey change the marker is shown on whichever end of the run is
  // the floor being read, so stepping to "take the stairs" does not lose it.
  const guidancePosition = track
    ? positionShownOn(track, state.progressMeters, String(state.activeFloorId))
    : null;
  const routeFloorIds = track ? walkedFloors(track) : [];
  const atEnd = track !== null && state.progressMeters >= track.length - 0.05;
  const locationX = location?.position[0];
  const locationY = location?.position[1];
  const locationFloor = location?.floorId;
  const locationBasis = location?.basis;
  const checkpointKey = mapCheckpointKey(state, checkIn);
  const checkpointKeyRef = useRef(checkpointKey);
  useEffect(() => {
    checkpointKeyRef.current = checkpointKey;
  }, [checkpointKey]);

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
    let unsubscribeGraphics: (() => void) | undefined;
    let unsubscribeZone: (() => void) | undefined;
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
          const memory = viewMemory.current?.venueHash === venueHash ? viewMemory.current : null;
          const saved =
            memory &&
            (memory.checkpointKey === undefined ||
              memory.checkpointKey === checkpointKeyRef.current)
              ? memory
              : null;
          scene = createVenueScene(
            canvas,
            labelLayer,
            buildingPackage,
            saved?.view,
            memory?.graphics,
            saved?.zone,
          );
        } catch {
          setRenderStatus('unavailable');
          setReady(false);
          return;
        }
        sceneRef.current = scene;
        const publishGraphics = (snapshot: MapGraphicsSnapshot) => {
          setGraphics(snapshot);
          logField('map-graphics', {
            setting: snapshot.setting,
            level: snapshot.level,
            reason: snapshot.reason,
          });
        };
        publishGraphics(scene.getGraphics());
        unsubscribeGraphics = scene.onGraphicsChange(publishGraphics);
        zoneRef.current = scene.getZone();
        setZone(zoneRef.current);
        unsubscribeZone = scene.onZoneChange((next, why) => {
          const left = zoneRef.current;
          zoneRef.current = next;
          setZone(next);
          areaCardCount.current += 1;
          setAreaCard({
            key: areaCardCount.current,
            // Walked through a door, or gone to look: said differently, because
            // only one of them says where the visitor is.
            kicker:
              next !== null
                ? why === 'walked'
                  ? 'Entering'
                  : 'Inside'
                : left !== null
                  ? `Leaving ${left.name}`
                  : 'Outside',
            name: next !== null ? next.name : 'The grounds',
          });
        });
        const memory = viewMemory.current?.venueHash === venueHash ? viewMemory.current : null;
        const remembered =
          memory &&
          (memory.checkpointKey === undefined || memory.checkpointKey === checkpointKeyRef.current)
            ? memory
            : null;
        // A new scan/start while the map was away releases the old browsing
        // camera as well as its zone. It does not change tracking or progress.
        if (!remembered) {
          framedRouteRef.current = null;
          userMovedRef.current = false;
          setUserMoved(false);
        }
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
          graphics: scene.getGraphics(),
          zone: scene.getZoneMemory(),
          checkpointKey: checkpointKeyRef.current,
        };
      }
      sceneRef.current = null;
      unsubscribeGraphics?.();
      unsubscribeZone?.();
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
      state.route?.found && state.route.displayClearance?.status !== 'withheld'
        ? state.route.path.map((point) => ({ x: point.x, y: point.y, floor: String(point.floor) }))
        : [],
    );
    // The route's end is the one label the visitor is hunting for.
    const last = state.route?.found ? state.route.path[state.route.path.length - 1] : undefined;
    sceneRef.current?.setDestination(last === undefined ? null : String(last.id));
  }, [ready, state.activeFloorId, state.route, attempt, buildingPackage]);

  // A change of floor inside a building is a change of map too, and is named
  // the same way. Only where there are several maps to be in.
  const hasSite = buildingPackage.site !== undefined;
  const shownFloorRef = useRef<string | null>(null);
  useEffect(() => {
    const floorId = String(state.activeFloorId);
    const before = shownFloorRef.current;
    shownFloorRef.current = floorId;
    if (!ready || !hasSite || before === null || before === floorId) return;
    const floor = buildingPackage.floors.find((entry) => entry.id === floorId);
    if (floor === undefined) return;
    areaCardCount.current += 1;
    setAreaCard({
      key: areaCardCount.current,
      kicker: zoneRef.current?.name ?? 'The grounds',
      // The floor every building stands on is named for the site: "Ground ·
      // Campus". Under a building's name it is that building's ground floor.
      name: floorId === buildingPackage.site?.floorId ? floor.name.split(' · ')[0] : floor.name,
    });
  }, [ready, hasSite, state.activeFloorId, buildingPackage]);

  useEffect(() => {
    if (areaCard === null) return undefined;
    const timer = window.setTimeout(() => setAreaCard(null), AREA_CARD_MS);
    return () => window.clearTimeout(timer);
  }, [areaCard]);

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

  // The route overview is of the whole trip: every floor it crosses, stacked.
  // While it is open the camera frames all of that and does not follow the
  // marker along one floor of it. Closing it gives the marker the camera back.
  const stackOpen = presentation.mode === '3d' && presentation.overview && routeFloorCount > 1;
  const tracking = following && !stackOpen;

  useEffect(() => {
    if (!ready) return;
    // At the destination there is nothing ahead to make room for.
    sceneRef.current?.setFollow(
      tracking ? { headingUp: true, scale: FOLLOW_SCALE, lookahead: atEnd ? 0 : 0.22 } : null,
    );
  }, [ready, tracking, atEnd, attempt]);

  // A new route is always shown whole. After that the camera only reframes
  // for the visitor's benefit - a panel resizing, a change of floor, the
  // overview opening or closing - and never over a view they chose themselves.
  const wasTrackingRef = useRef(false);
  const wasStackOpenRef = useRef(stackOpen);
  useEffect(() => {
    const leftTracking = wasTrackingRef.current && !tracking;
    wasTrackingRef.current = tracking;
    // What is drawn has just changed from one floor to several, or back: the
    // framing of the one is wrong for the other, whoever chose it.
    const stackChanged = wasStackOpenRef.current !== stackOpen;
    wasStackOpenRef.current = stackOpen;
    if (!ready || !route || tracking) return;
    const newRoute = framedRouteRef.current !== route;
    if (!newRoute && !leftTracking && !stackChanged && userMovedRef.current) return;
    framedRouteRef.current = route;
    // Following turned the map to the direction of travel; the overview it
    // returns to is the plan the right way up.
    sceneRef.current?.frameRoute({ northUp: leftTracking || stackChanged });
  }, [ready, route, tracking, stackOpen, insets, state.activeFloorId, attempt]);

  // A trip that is over leaves the map where the walk ended. It comes home:
  // to where the visitor is known to be, the right way up.
  const wasJourneyRef = useRef(journey);
  useEffect(() => {
    const was = wasJourneyRef.current;
    wasJourneyRef.current = journey;
    if (!ready || !was || journey) return;
    sceneRef.current?.goHome();
    if (sceneRef.current) setPresentation(sceneRef.current.getView());
  }, [ready, journey]);

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

  /*
   * The floors offered. On a route, the floors it crosses. Otherwise, in one
   * building, all of them; and where there are several buildings, the floors
   * of the one the map is in. Out on the grounds there is nothing to choose:
   * "Level 1" is not a floor of a garden, and of three buildings it would not
   * say which.
   */
  const floorChoices = [...floors]
    .filter((floor) => {
      const id = String(floor.id);
      if (journey && route) {
        return id === String(state.activeFloorId) || routeFloorIds.includes(id);
      }
      return !hasSite || (zone !== null && zone.floorIds.includes(id));
    })
    .sort((left, right) => right.level - left.level);
  // One floor is not a choice.
  if (hasSite && floorChoices.length < 2) floorChoices.length = 0;

  const handleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    // Letting go after dragging the map is not a tap on whatever happens to be
    // under the cursor.
    if (sceneRef.current?.wasDragged() === true) return;
    const poiId = sceneRef.current?.pickPoi(event.clientX, event.clientY) ?? null;
    // Not a place: from outside, a tap on a building goes in to it.
    if (poiId === null && sceneRef.current?.enterBuildingAt(event.clientX, event.clientY)) return;
    if (poiId === null) return;
    const node = venue.getNodeById(`poi:${poiId}`);
    if (node) actions.selectPOI(node);
  };
  const changeMode = (mode: MapMode) => {
    sceneRef.current?.setMode(mode);
    if (sceneRef.current) setPresentation(sceneRef.current.getView());
  };
  const closeGraphics = () => {
    setGraphicsOpen(false);
    graphicsButtonRef.current?.focus();
  };
  const changeGraphics = (setting: MapGraphicsSetting) => {
    sceneRef.current?.setGraphics(setting);
    closeGraphics();
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
      data-route-clearance={state.route?.displayClearance?.status ?? 'not-checked'}
      data-route-floors={routeFloorCount}
      data-zone={hasSite ? (zone?.id ?? 'grounds') : undefined}
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
      <div ref={labelRef} className="compiled-map-labels" />
      {areaCard && (
        <div key={areaCard.key} className="map-area-card" role="status">
          <span>{areaCard.kicker}</span>
          <strong>{areaCard.name}</strong>
        </div>
      )}
      <div
        className="compiled-map-presentation"
        role="group"
        aria-label="Map presentation"
        onKeyDown={(event) => {
          if (graphicsOpen && event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closeGraphics();
          }
        }}
      >
        {/*
         * Two different things, so two different shapes. Which view you are
         * looking at is a choice between two, and is one segmented pill. Opening
         * the camera and changing the graphics are actions, and are buttons
         * beside it. They used to share the pill, where the selected view's
         * white circle sat against the next icon and read as covering it.
         */}
        <div className="compiled-map-bar">
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
          {journey && route && (
            <button
              type="button"
              className="compiled-map-tool compiled-map-camera"
              aria-label="Camera view"
              title="Check which way to go with the camera"
              onClick={() => actions.setView(VIEW_TYPE.CAMERA_PREVIEW)}
            >
              <Camera size={18} strokeWidth={2} aria-hidden="true" />
              <span>Camera</span>
            </button>
          )}
          <button
            ref={graphicsButtonRef}
            type="button"
            className="compiled-map-tool"
            aria-label="Graphics detail"
            title="Map graphics detail"
            aria-expanded={graphicsOpen}
            aria-controls={graphicsId}
            disabled={renderStatus !== 'ready'}
            onClick={() => setGraphicsOpen((open) => !open)}
          >
            <SlidersHorizontal size={18} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        {graphicsOpen && graphics && (
          <div
            ref={graphicsPanelRef}
            id={graphicsId}
            className="compiled-map-graphics"
            role="group"
            aria-label="Map graphics detail"
          >
            {(
              [
                ['auto', 'Automatic'],
                ['full', 'Full detail'],
                ['low', 'Low detail'],
              ] as const
            ).map(([setting, label]) => (
              <button
                key={setting}
                type="button"
                aria-pressed={graphics.setting === setting}
                disabled={renderStatus !== 'ready'}
                onClick={() => changeGraphics(setting)}
              >
                {label}
              </button>
            ))}
            <p role="status">
              {graphics.setting === 'auto'
                ? graphics.level === 'low'
                  ? graphics.reason === 'slow-frames'
                    ? 'Using low detail after slow map frames.'
                    : 'Using low detail for this device.'
                  : 'Using full detail. Switches down if map frames stay slow.'
                : graphics.level === 'low'
                  ? 'Lower resolution, no shadows.'
                  : 'Higher resolution with shadows.'}{' '}
              Your route and location are unchanged.
            </p>
          </div>
        )}
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
            {venue.whereAt(location.position, location.floorId)} ·{' '}
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
            aria-label={tracking ? 'Recenter on guidance' : 'Show whole route'}
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
              // Campus means the grounds, even while browsing a storey above
              // them. This is only the viewed floor, not a position update.
              if (buildingPackage.site) {
                actions.setFloor(buildingPackage.site.floorId);
                sceneRef.current?.setActiveFloor(buildingPackage.site.floorId);
              }
              sceneRef.current?.resetView();
              if (sceneRef.current) setPresentation(sceneRef.current.getView());
            }}
          >
            <Maximize size={16} strokeWidth={2} aria-hidden="true" />
            {buildingPackage.site && <span className="map-campus-reset-label">Campus</span>}
          </button>
        )}
      </div>

      {floorChoices.length > 0 && (
        <div
          className="compiled-map-floors"
          role="group"
          aria-label={zone ? `Floors of ${zone.name}` : 'Floors'}
        >
          {floorChoices.map((floor) => {
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
      )}
    </div>
  );
}
