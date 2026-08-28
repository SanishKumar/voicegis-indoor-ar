import { useEffect, useRef, useState } from 'react';
import { Maximize, Minus, Plus } from 'lucide-react';
import { useNavigation } from '../context/NavigationContext.jsx';
import { createVenueScene, type VenueScene } from '../map/venueScene';

interface NavigationValue {
  state: {
    activeFloorId: string;
    selectedPOI?: { poi?: { spaceId?: string } } | null;
    route?: { found?: boolean; path?: Array<{ x: number; y: number; floor: string }> } | null;
  };
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
export default function VisitorMap() {
  const { state, actions, venue } = useNavigation() as unknown as NavigationValue;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<VenueScene | null>(null);
  const [ready, setReady] = useState(false);

  const buildingPackage = venue.buildingPackage;
  const floors = buildingPackage.floors;

  /*
   * How many storeys the active route touches. The scene opens the stack when
   * this is more than one, so publishing it makes that behaviour observable
   * from the outside instead of only visible in a screenshot.
   */
  const routeFloorCount = new Set(
    (state.route?.found === true ? (state.route.path ?? []) : []).map((point) =>
      String(point.floor),
    ),
  ).size;

  useEffect(() => {
    const canvas = canvasRef.current;
    const labelLayer = labelRef.current;
    if (canvas === null || labelLayer === null) return undefined;

    const scene = createVenueScene(canvas, labelLayer, buildingPackage);
    sceneRef.current = scene;
    setReady(true);

    let frame = 0;
    const tick = () => {
      scene.frame();
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(frame);
      sceneRef.current = null;
      setReady(false);
      scene.dispose();
    };
  }, [buildingPackage]);

  useEffect(() => {
    if (!ready) return;
    sceneRef.current?.setActiveFloor(String(state.activeFloorId));
    // The route is redrawn with the floor, because only the part of it on this
    // floor belongs on this floor.
    sceneRef.current?.setRoute(state.route?.found ? (state.route.path ?? []) : []);
  }, [ready, state.activeFloorId, state.route]);

  useEffect(() => {
    if (!ready) return;
    sceneRef.current?.setSelectedSpace(state.selectedPOI?.poi?.spaceId ?? null);
  }, [ready, state.selectedPOI, state.activeFloorId]);

  const handleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    // Letting go after dragging the map is not a tap on whatever happens to be
    // under the cursor.
    if (sceneRef.current?.wasDragged() === true) return;
    const poiId = sceneRef.current?.pickPoi(event.clientX, event.clientY) ?? null;
    if (poiId === null) return;
    const node = venue.getNodeById(`poi:${poiId}`);
    if (node) actions.selectPOI(node);
  };

  return (
    <div className="compiled-map" data-route-floors={routeFloorCount}>
      <canvas ref={canvasRef} className="compiled-map-canvas" onClick={handleClick} />
      <div ref={labelRef} className="compiled-map-labels" aria-hidden="true" />

      {/* Wheel and pinch are not available to a keyboard, so the same moves
          have buttons. */}
      <div className="compiled-map-zoom" role="group" aria-label="Map view">
        <button type="button" aria-label="Zoom in" onClick={() => sceneRef.current?.zoomBy(0.75)}>
          <Plus size={18} strokeWidth={2} aria-hidden="true" />
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => sceneRef.current?.zoomBy(1.35)}>
          <Minus size={18} strokeWidth={2} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Reset the map view"
          onClick={() => sceneRef.current?.resetView()}
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
