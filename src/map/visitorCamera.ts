import { OrthographicCamera } from 'three';

export type MapMode = '2d' | '3d';
export interface VisitorMapView {
  mode: MapMode;
  /** Map bearing, not a measured device heading. */
  azimuth: number;
  tilt3d: number;
  scale: number;
  target: [number, number];
  overview: boolean;
}

export function defaultMapView(): VisitorMapView {
  return { mode: '2d', azimuth: 0, tilt3d: 0.86, scale: 1, target: [0, 0], overview: false };
}

/** Both views use an orthographic projection: a true plan and an orbitable
 * axonometric model. Only tilt changes; map centre, bearing and scale do not.
 * There is no device heading, location or journey progress in this state. */
export function createVisitorCamera(span: number, saved = defaultMapView()) {
  const view: VisitorMapView = { ...saved, target: [...saved.target] };
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, span * 20);
  let tilt = view.mode === '2d' ? 0 : view.tilt3d;
  const wantedTilt = () => (view.mode === '2d' ? 0 : view.tilt3d);
  const halfHeight = (aspect: number) => (span * 0.57 * view.scale) / Math.min(aspect, 1);

  return {
    camera,
    view,
    snapshot: (): VisitorMapView => ({ ...view, target: [...view.target] }),
    zoomBy(factor: number) {
      if (Number.isFinite(factor) && factor > 0)
        view.scale = Math.min(2.4, Math.max(0.22, view.scale * factor));
    },
    pan(dx: number, dy: number, width: number, height: number) {
      if (width <= 0 || height <= 0) return;
      const units = (halfHeight(width / height) * 2) / height;
      const along = dy / Math.max(0.12, Math.cos(tilt));
      view.target[0] -= (dx * Math.cos(view.azimuth) + along * Math.sin(view.azimuth)) * units;
      view.target[1] += (dx * Math.sin(view.azimuth) - along * Math.cos(view.azimuth)) * units;
    },
    reset() {
      Object.assign(view, defaultMapView(), { mode: view.mode });
    },
    update(width: number, height: number, elapsedMs: number, reducedMotion: boolean) {
      const destination = wantedTilt();
      tilt = reducedMotion
        ? destination
        : tilt + (destination - tilt) * (1 - Math.exp(-Math.min(100, Math.max(0, elapsedMs)) / 85));
      if (Math.abs(destination - tilt) < 0.0001) tilt = destination;
      const aspect = width / Math.max(1, height);
      const half = halfHeight(aspect);
      camera.left = -half * aspect;
      camera.right = half * aspect;
      camera.top = half;
      camera.bottom = -half;
      camera.updateProjectionMatrix();
      const radius = span * 5;
      camera.position.set(
        view.target[0] + radius * Math.sin(tilt) * Math.sin(view.azimuth),
        radius * Math.cos(tilt),
        view.target[1] + radius * Math.sin(tilt) * Math.cos(view.azimuth),
      );
      // A defined up vector at exactly zero tilt avoids lookAt's pole singularity.
      camera.up.set(-Math.sin(view.azimuth), 0, -Math.cos(view.azimuth));
      camera.lookAt(view.target[0], 0, view.target[1]);
      camera.updateMatrixWorld();
      return { tilt, settled: tilt === destination };
    },
  };
}

/** Plan +X is right, +Y is down; world +Y is elevation. */
export function planToWorld(
  x: number,
  y: number,
  centre: readonly [number, number],
): [number, number] {
  return [x - centre[0], y - centre[1]];
}

export interface RoutePoint {
  x: number;
  y: number;
  floor: string;
}
/** Never join non-adjacent points, even when a route leaves and revisits a floor. */
export function routeSegments(
  points: readonly RoutePoint[],
): Array<readonly [RoutePoint, RoutePoint]> {
  return points.slice(1).map((point, index) => [points[index], point] as const);
}
