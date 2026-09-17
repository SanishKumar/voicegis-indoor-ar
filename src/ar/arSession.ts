import {
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  RingGeometry,
  Scene,
  Shape,
  ShapeGeometry,
  WebGLRenderer,
} from 'three';
import type { RouteTracker } from '../navigation/liveTracker';
import {
  bearingAt,
  nextVerticalRun,
  positionAt,
  type RouteTrack,
} from '../navigation/routeProgress';
import {
  alignPlanToWorld,
  planBearingToWorld,
  planToWorld,
  viewerFromMatrix,
  worldBearingToPlan,
  worldDisplacementToPlan,
  type PlanWorldAlignment,
  type ViewerReading,
} from './planWorld';

/**
 * Route guidance inside an immersive WebXR session.
 *
 * Where the browser offers `immersive-ar` - Android Chrome on ARCore hardware
 * in 2026, and nothing on iOS - the phone tracks its own movement through the
 * room with its camera and inertial sensors. That gives two things the
 * ordinary camera view cannot have: chevrons that stay put on the floor as the
 * phone moves, and metric displacement that moves the visitor's marker
 * without counting strides.
 *
 * What it still cannot have is knowledge of the building. The session's world
 * is aligned to the plan once, from an assumption - the visitor is at their
 * progress along the route, looking the way it goes - and everything after is
 * relative to that. The chevrons are anchored to the world, not to the walls;
 * a wrong assumption shows up as chevrons pointing into a wall, and the
 * tracker notices the walk disagreeing with the corridor exactly as it does
 * for strides. Re-aligning is one tap.
 */

const ROUTE_COLOR = 0x0a65db;
const INK = 0x000609;
const CREAM = 0xfff9f0;
const DEG = Math.PI / 180;
const CHEVRON_EVERY_METERS = 1.5;
const AHEAD_METERS = 30;
/** Pose movement is handed to the tracker in pieces about this long. */
const FLUSH_METERS = 0.25;
const FLUSH_MS = 250;
const REPORT_MS = 200;
/** A floor hit further than this from the running estimate is a table, not the floor. */
const FLOOR_HIT_TOLERANCE_METERS = 0.8;

export type ArEndReason = 'ended' | 'unsupported' | 'refused' | 'failed';

export class ArStartError extends Error {
  constructor(
    readonly reason: ArEndReason,
    readonly cause?: unknown,
  ) {
    super(`Immersive session ${reason}`);
    this.name = 'ArStartError';
  }
}

export interface ArFrameReport {
  aligned: boolean;
  /** Height of the floor in the session's frame, refined by hit testing. */
  floorY: number;
  /** Floor hits accepted so far; zero means the floor is where the platform guessed it. */
  floorHits: number;
  facingDegrees: number | null;
  progressMeters: number;
}

export interface ArGuidanceOptions {
  track: RouteTrack;
  /** An anchored tracker; its progress is where the alignment assumes the visitor stands. */
  tracker: RouteTracker;
  /** The element shown over the camera for the length of the session. */
  overlay: HTMLElement;
  /** Plan bearing the visitor faces at alignment, or null to assume the route's own bearing there. */
  facingDegrees: () => number | null;
  onFrame?: (report: ArFrameReport) => void;
  onEnd?: (reason: ArEndReason) => void;
}

export interface ArGuidanceHandle {
  end(): Promise<void>;
  /** Assume again that the visitor stands at their progress, looking along the route. */
  realign(): void;
}

export async function immersiveArSupported(): Promise<boolean> {
  const xr = navigator.xr;
  if (!xr || typeof xr.isSessionSupported !== 'function') return false;
  try {
    return await xr.isSessionSupported('immersive-ar');
  } catch {
    return false;
  }
}

function startFailure(error: unknown): ArEndReason {
  // A platform exception may come from another realm; its name still says what happened.
  const name =
    typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'refused';
  if (name === 'NotSupportedError') return 'unsupported';
  return 'failed';
}

/** A chevron half a metre across, drawn in x/y with y as the way forward. */
function chevronGeometry() {
  const shape = new Shape();
  shape.moveTo(-0.28, -0.2);
  shape.lineTo(0, 0.2);
  shape.lineTo(0.28, -0.2);
  shape.lineTo(0.28, -0.38);
  shape.lineTo(0, -0.02);
  shape.lineTo(-0.28, -0.38);
  shape.closePath();
  return new ShapeGeometry(shape);
}

export async function startArGuidance(options: ArGuidanceOptions): Promise<ArGuidanceHandle> {
  const { track, tracker } = options;
  const xr = navigator.xr;
  if (!xr) throw new ArStartError('unsupported');

  let session: XRSession;
  try {
    session = await xr.requestSession('immersive-ar', {
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['hit-test', 'dom-overlay'],
      domOverlay: { root: options.overlay },
    });
  } catch (error) {
    throw new ArStartError(startFailure(error), error);
  }

  const renderer = new WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local-floor');
  try {
    await renderer.xr.setSession(session);
  } catch (error) {
    renderer.dispose();
    await session.end().catch(() => undefined);
    throw new ArStartError('failed', error);
  }

  const scene = new Scene();
  const camera = new PerspectiveCamera();
  const route = new Group();
  scene.add(route);
  const chevron = chevronGeometry();
  const ring = new RingGeometry(0.3, 0.45, 40);
  const chevronMaterial = new MeshBasicMaterial({
    color: ROUTE_COLOR,
    side: DoubleSide,
    transparent: true,
    opacity: 0.92,
    depthTest: false,
  });
  const outlineMaterial = new MeshBasicMaterial({
    color: INK,
    side: DoubleSide,
    transparent: true,
    opacity: 0.55,
    depthTest: false,
  });
  const endMaterial = new MeshBasicMaterial({
    color: CREAM,
    side: DoubleSide,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
  });

  let chevrons: { holder: Group; along: number }[] = [];
  let builtTo = 0;
  let alignment: PlanWorldAlignment | null = null;
  let alignedFloor: string | null = null;
  let floorY = 0;
  let floorHits = 0;
  let last: { x: number; z: number } | null = null;
  let pendingX = 0;
  let pendingZ = 0;
  let pendingSince = 0;
  let lastReport = 0;
  let hitSource: XRHitTestSource | null = null;
  let ended = false;

  const clearRoute = () => {
    route.clear();
    chevrons = [];
  };

  const buildRoute = (progress: number) => {
    clearRoute();
    if (alignment === null) return;
    const run = nextVerticalRun(track, progress);
    const limit = Math.min(
      track.length,
      progress + AHEAD_METERS,
      run === null ? Number.POSITIVE_INFINITY : run.boardingMeters,
    );
    const first = Math.ceil((progress + 0.75) / CHEVRON_EVERY_METERS) * CHEVRON_EVERY_METERS;
    for (let along = first; along <= limit; along += CHEVRON_EVERY_METERS) {
      const here = positionAt(track, along);
      const [x, , z] = planToWorld(alignment, here.x, here.y);
      const holder = new Group();
      holder.position.set(x, 0.01, z);
      // The world turns the other way from a bearing: bearings are clockwise from above.
      holder.rotation.y = -planBearingToWorld(alignment, bearingAt(track, along)) * DEG;
      const outline = new Mesh(chevron, outlineMaterial);
      outline.rotation.x = -Math.PI / 2;
      outline.scale.setScalar(1.25);
      outline.position.y = -0.002;
      const face = new Mesh(chevron, chevronMaterial);
      face.rotation.x = -Math.PI / 2;
      holder.add(outline, face);
      route.add(holder);
      chevrons.push({ holder, along });
    }
    if (limit >= track.length) {
      const end = positionAt(track, track.length);
      const [x, , z] = planToWorld(alignment, end.x, end.y);
      const marker = new Mesh(ring, endMaterial);
      marker.rotation.x = -Math.PI / 2;
      marker.position.set(x, 0.015, z);
      route.add(marker);
    }
    builtTo = limit;
    route.position.y = floorY;
  };

  const align = (viewer: ViewerReading, nowMs: number) => {
    const snapshot = tracker.read(nowMs);
    const here = positionAt(track, snapshot.progressMeters);
    const facing = options.facingDegrees() ?? bearingAt(track, snapshot.progressMeters);
    alignment = alignPlanToWorld(
      { x: here.x, y: here.y, bearingDegrees: facing },
      { x: viewer.x, z: viewer.z, bearingDegrees: viewer.bearingDegrees },
      floorY,
    );
    alignedFloor = snapshot.floorId;
    last = { x: viewer.x, z: viewer.z };
    pendingX = 0;
    pendingZ = 0;
    pendingSince = nowMs;
    buildRoute(snapshot.progressMeters);
  };

  try {
    const viewerSpace = await session.requestReferenceSpace('viewer');
    if (typeof session.requestHitTestSource === 'function' && typeof XRRay !== 'undefined') {
      // A ray from the phone, down and forward: where the floor is a pace ahead.
      hitSource =
        (await session.requestHitTestSource({
          space: viewerSpace,
          offsetRay: new XRRay({ x: 0, y: 0, z: 0, w: 1 }, { x: 0, y: -0.6, z: -0.8, w: 0 }),
        })) ?? null;
    }
  } catch {
    hitSource = null;
  }

  tracker.attachDisplacement(performance.now());

  const cleanup = () => {
    if (ended) return;
    ended = true;
    renderer.setAnimationLoop(null);
    try {
      hitSource?.cancel();
    } catch {
      // Already gone with the session.
    }
    clearRoute();
    chevron.dispose();
    ring.dispose();
    chevronMaterial.dispose();
    outlineMaterial.dispose();
    endMaterial.dispose();
    renderer.dispose();
    tracker.detachDisplacement(performance.now());
    options.onEnd?.('ended');
  };
  session.addEventListener('end', cleanup);

  renderer.setAnimationLoop((_time, frame) => {
    if (ended || !frame) return;
    const space = renderer.xr.getReferenceSpace();
    if (!space) return;
    const pose = frame.getViewerPose(space);
    if (!pose) return;
    const nowMs = performance.now();
    const viewer = viewerFromMatrix(pose.transform.matrix);

    if (hitSource !== null) {
      const hit = frame.getHitTestResults(hitSource)[0]?.getPose(space);
      if (hit && Math.abs(hit.transform.position.y - floorY) < FLOOR_HIT_TOLERANCE_METERS) {
        const y = hit.transform.position.y;
        floorY = floorHits === 0 ? y : floorY + (y - floorY) * 0.1;
        floorHits += 1;
        route.position.y = floorY;
        if (alignment !== null) alignment.floorY = floorY;
      }
    }

    if (alignment === null) {
      align(viewer, nowMs);
    } else if (last !== null) {
      pendingX += viewer.x - last.x;
      pendingZ += viewer.z - last.z;
      last = { x: viewer.x, z: viewer.z };
      const moved = Math.hypot(pendingX, pendingZ);
      if (moved >= FLUSH_METERS || (nowMs - pendingSince >= FLUSH_MS && moved >= 0.05)) {
        const [dx, dy] = worldDisplacementToPlan(alignment, pendingX, pendingZ);
        tracker.displace({ dxMeters: dx, dyMeters: dy, timeMs: nowMs });
        pendingX = 0;
        pendingZ = 0;
        pendingSince = nowMs;
      }
      tracker.facing(worldBearingToPlan(alignment, viewer.bearingDegrees), nowMs);
    }

    const snapshot = tracker.read(nowMs);
    if (alignment !== null) {
      // A storey change moves the floor under the session's feet: start again there.
      if (snapshot.floorId !== alignedFloor) {
        alignment = null;
        floorY = 0;
        floorHits = 0;
      } else if (snapshot.progressMeters + AHEAD_METERS > builtTo + 5 && builtTo < track.length) {
        buildRoute(snapshot.progressMeters);
      }
    }
    for (const entry of chevrons)
      entry.holder.visible = entry.along > snapshot.progressMeters + 0.5;

    if (nowMs - lastReport >= REPORT_MS) {
      lastReport = nowMs;
      options.onFrame?.({
        aligned: alignment !== null,
        floorY,
        floorHits,
        facingDegrees: snapshot.headingDegrees,
        progressMeters: snapshot.progressMeters,
      });
    }
    renderer.render(scene, camera);
  });

  return {
    async end() {
      if (!ended) await session.end().catch(() => undefined);
      cleanup();
    },
    realign() {
      alignment = null;
    },
  };
}
