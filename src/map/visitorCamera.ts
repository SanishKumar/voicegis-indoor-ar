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

/** Screen space, in CSS pixels, that something else is drawn over. */
export interface MapInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_INSETS: Readonly<MapInsets> = Object.freeze({
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
});

const MIN_SCALE = 0.22;
const MAX_SCALE = 2.4;
/** Time constants for eased moves, in milliseconds. */
const MOVE_TAU = 190;
const TURN_TAU = 260;

export function defaultMapView(): VisitorMapView {
  return { mode: '2d', azimuth: 0, tilt3d: 0.86, scale: 1, target: [0, 0], overview: false };
}

interface Goal {
  target?: [number, number];
  scale?: number;
  azimuth?: number;
}

const clampScale = (scale: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

/** Shortest signed turn from one bearing to another. */
function turnBetween(from: number, to: number) {
  const full = Math.PI * 2;
  let delta = (to - from) % full;
  if (delta > Math.PI) delta -= full;
  if (delta <= -Math.PI) delta += full;
  return delta;
}

/**
 * Where a ground offset lands in view space for a given bearing and tilt.
 * `x` is screen-right and `y` screen-up, both in world units. Derived from
 * the rig's own `lookAt`, so it agrees with what is drawn.
 */
function viewOffset(dx: number, height: number, dz: number, azimuth: number, tilt: number) {
  const sin = Math.sin(azimuth);
  const cos = Math.cos(azimuth);
  return [
    dx * cos - dz * sin,
    -Math.cos(tilt) * (dx * sin + dz * cos) + height * Math.sin(tilt),
  ] as const;
}

/** The ground offset that appears at a given view-space offset: the inverse of `viewOffset`. */
function groundOffset(x: number, y: number, azimuth: number, tilt: number) {
  const along = y / Math.max(0.12, Math.cos(tilt));
  const sin = Math.sin(azimuth);
  const cos = Math.cos(azimuth);
  return [x * cos - along * sin, -x * sin - along * cos] as const;
}

/** The bearing that puts a plan direction at the top of the screen. */
export function azimuthForHeading([dx, dy]: readonly [number, number]) {
  return Math.atan2(-dx, -dy);
}

/**
 * Both views use an orthographic projection: a true plan and an orbitable
 * axonometric model. Switching between them changes only the tilt; centre,
 * bearing and scale are kept.
 *
 * The camera also knows how much of its canvas is covered. Whatever the
 * interface lays over the map - an instruction banner, a trip sheet, a side
 * panel - the point the camera looks at is drawn in the middle of what is left
 * visible, and fitting a route fits it into that space. Without this the route
 * was framed to the full canvas and landed behind the directions sheet.
 */
export function createVisitorCamera(span: number, saved = defaultMapView()) {
  const view: VisitorMapView = { ...saved, target: [...saved.target] };
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, span * 20);
  let tilt = view.mode === '2d' ? 0 : view.tilt3d;
  let insets: MapInsets = { ...NO_INSETS };
  let goal: Goal | null = null;
  let userMoved = false;
  const wantedTilt = () => (view.mode === '2d' ? 0 : view.tilt3d);

  /** The uncovered part of the canvas. Never smaller than a sliver. */
  const visible = (width: number, height: number) => {
    const w = Math.max(40, width - insets.left - insets.right);
    const h = Math.max(40, height - insets.top - insets.bottom);
    return { w, h };
  };

  /** World units per CSS pixel at a given scale. */
  const unitsPerPixel = (width: number, height: number, scale = view.scale) => {
    const { w, h } = visible(width, height);
    const half = (span * 0.57 * scale) / Math.min(w / h, 1);
    return (half * 2) / h;
  };

  const userAction = () => {
    goal = null;
    userMoved = true;
  };

  return {
    camera,
    view,
    snapshot: (): VisitorMapView => ({ ...view, target: [...view.target] }),

    setInsets(next: MapInsets) {
      const clean = (value: number) => (Number.isFinite(value) && value > 0 ? value : 0);
      insets = {
        top: clean(next.top),
        right: clean(next.right),
        bottom: clean(next.bottom),
        left: clean(next.left),
      };
    },
    getInsets: (): MapInsets => ({ ...insets }),
    /** World units covered by one CSS pixel at the current scale. */
    worldUnitsPerPixel: (width: number, height: number) => unitsPerPixel(width, height),
    /** Height of the uncovered area, in CSS pixels. */
    visibleHeight: (width: number, height: number) => visible(width, height).h,

    /** True once the visitor has moved the camera themselves since the last fit or recenter. */
    wasMovedByUser: () => userMoved,
    /** Restore that fact for a camera rebuilt around a view the visitor chose. */
    markMovedByUser() {
      goal = null;
      userMoved = true;
    },
    isAnimating: () => goal !== null,

    zoomBy(factor: number) {
      if (!Number.isFinite(factor) || factor <= 0) return;
      userAction();
      view.scale = clampScale(view.scale * factor);
    },

    pan(dx: number, dy: number, width: number, height: number) {
      if (width <= 0 || height <= 0) return;
      userAction();
      const units = unitsPerPixel(width, height);
      const [gx, gz] = groundOffset(-dx * units, dy * units, view.azimuth, tilt);
      view.target[0] += gx;
      view.target[1] += gz;
    },

    orbit(deltaAzimuth: number, deltaTilt: number) {
      userAction();
      view.azimuth -= deltaAzimuth;
      view.tilt3d = Math.min(1.3, Math.max(0.2, view.tilt3d - deltaTilt));
    },

    reset() {
      goal = null;
      userMoved = false;
      Object.assign(view, defaultMapView(), { mode: view.mode });
    },

    /**
     * Ease the camera so every point is inside the uncovered area.
     * Points are world coordinates: plan x, height, plan z.
     */
    fit(
      points: ReadonlyArray<readonly [number, number, number]>,
      width: number,
      height: number,
      options: { padding?: number; azimuth?: number; maxScale?: number } = {},
    ) {
      if (points.length === 0 || width <= 0 || height <= 0) return;
      const azimuth = options.azimuth ?? goal?.azimuth ?? view.azimuth;
      const destinationTilt = wantedTilt();
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const [x, h, z] of points) {
        const [vx, vy] = viewOffset(x, h, z, azimuth, destinationTilt);
        minX = Math.min(minX, vx);
        maxX = Math.max(maxX, vx);
        minY = Math.min(minY, vy);
        maxY = Math.max(maxY, vy);
      }
      const [tx, tz] = groundOffset((minX + maxX) / 2, (minY + maxY) / 2, azimuth, destinationTilt);
      const padding = options.padding ?? 1.18;
      const { w, h } = visible(width, height);
      const halfX = Math.max(2, ((maxX - minX) / 2) * padding);
      const halfY = Math.max(2, ((maxY - minY) / 2) * padding);
      // The world units per pixel that just fits, turned back into a scale.
      const needed = Math.max((halfX * 2) / w, (halfY * 2) / h);
      const perPixelAtUnitScale = unitsPerPixel(width, height, 1);
      const scale = clampScale(
        Math.min(options.maxScale ?? MAX_SCALE, needed / perPixelAtUnitScale),
      );
      goal = { target: [tx, tz], scale, azimuth };
      userMoved = false;
    },

    /** Keep a point centred at a bearing and scale - called every frame while following. */
    follow(target: readonly [number, number], options: { azimuth?: number; scale?: number } = {}) {
      goal = {
        target: [target[0], target[1]],
        scale: options.scale === undefined ? undefined : clampScale(options.scale),
        azimuth: options.azimuth,
      };
      userMoved = false;
    },

    /** Forget any eased move in progress without counting it as the visitor's doing. */
    stop() {
      goal = null;
    },

    update(width: number, height: number, elapsedMs: number, reducedMotion: boolean) {
      const dt = Math.min(100, Math.max(0, elapsedMs));
      const destination = wantedTilt();
      tilt = reducedMotion ? destination : tilt + (destination - tilt) * (1 - Math.exp(-dt / 85));
      if (Math.abs(destination - tilt) < 0.0001) tilt = destination;

      if (goal !== null) {
        const move = reducedMotion ? 1 : 1 - Math.exp(-dt / MOVE_TAU);
        const turn = reducedMotion ? 1 : 1 - Math.exp(-dt / TURN_TAU);
        let done = true;
        // Step first, then decide whether that step arrived, so a reduced-motion
        // jump is settled on the frame it happens.
        if (goal.target) {
          const next: [number, number] = [
            view.target[0] + (goal.target[0] - view.target[0]) * move,
            view.target[1] + (goal.target[1] - view.target[1]) * move,
          ];
          const arrived = Math.hypot(goal.target[0] - next[0], goal.target[1] - next[1]) < 0.01;
          view.target = arrived ? [...goal.target] : next;
          done &&= arrived;
        }
        if (goal.scale !== undefined) {
          const next = view.scale + (goal.scale - view.scale) * move;
          const arrived = Math.abs(goal.scale - next) < 0.0005;
          view.scale = arrived ? goal.scale : next;
          done &&= arrived;
        }
        if (goal.azimuth !== undefined) {
          const next = view.azimuth + turnBetween(view.azimuth, goal.azimuth) * turn;
          const arrived = Math.abs(turnBetween(next, goal.azimuth)) < 0.0005;
          view.azimuth = arrived ? goal.azimuth : next;
          done &&= arrived;
        }
        if (done) goal = null;
      }

      const units = unitsPerPixel(width, height);
      // Offset of the uncovered area's centre from the canvas centre, in pixels.
      const offsetX = insets.left - insets.right;
      const offsetY = insets.top - insets.bottom;
      camera.left = -(width / 2 + offsetX / 2) * units;
      camera.right = (width / 2 - offsetX / 2) * units;
      camera.top = (height / 2 + offsetY / 2) * units;
      camera.bottom = -(height / 2 - offsetY / 2) * units;
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
      return { tilt, settled: tilt === destination && goal === null };
    },
  };
}

export type VisitorCameraRig = ReturnType<typeof createVisitorCamera>;

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
