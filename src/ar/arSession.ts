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
import { signedHeadingDifference } from '../navigation/coordinateFrames';
import type { RouteTracker } from '../navigation/liveTracker';
import { FloorPlacement } from './floorPlacement';
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
 * Where runtime capability detection offers `immersive-ar`, the phone tracks
 * its own movement through the
 * room with its camera and inertial sensors. That gives two things the
 * ordinary camera view cannot have: chevrons that stay put on the floor as the
 * phone moves, and metric displacement that moves the visitor's marker
 * without counting strides.
 *
 * What it still cannot have is knowledge of the building. The session's world
 * is aligned to the plan from the visitor's explicit camera alignment and
 * assumed position at their progress along the route. Everything after is
 * relative to that. The chevrons are anchored to the world, not to the walls;
 * a wrong assumption shows up as chevrons pointing into a wall, and the
 * tracker notices the walk disagreeing with the corridor exactly as it does
 * for strides. Recovery asks for re-alignment and fresh floor confirmation;
 * neither action establishes the building's direction independently.
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
/**
 * A viewer that moves further than this between two frames, faster than
 * anyone walks or after a long silence, has been re-placed by the platform
 * rather than carried. The route is hidden until the visitor re-aligns; the
 * jump is never counted as walking.
 */
const POSE_JUMP_METERS = 0.5;
const MAX_POSE_SPEED_MPS = 4;
const MAX_POSE_GAP_MS = 1_000;
/**
 * The route is placed only once the phone has been held this still for this
 * long. Platforms report their first poses while still working out the room,
 * and the pose at the moment of placing fixes where the whole route lies.
 */
const SETTLE_MS = 500;
const SETTLE_METERS = 0.15;
const SETTLE_DEGREES = 12;
/** A pre-placement frame gap invalidates even a just-confirmed surface. */
const PLACEMENT_MAX_POSE_GAP_MS = 250;

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
  recovery: 'pose-lost' | 'floor-change' | null;
  /**
   * Why the route is not placed yet, outside a recovery: no pose from the
   * platform yet, the phone not held still, or the floor not found yet.
   */
  placement:
    'tracking' | 'steady' | 'floor' | 'floor-confirm' | 'floor-unavailable' | 'heading' | null;
  /** Confirmed floor height in the session's frame; never a platform guess. */
  floorY: number | null;
  /** Consecutive qualified candidate hits, not a semantic floor classification. */
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
  /** Explicitly aligned plan bearing; null withholds the route until alignment is available. */
  facingDegrees: () => number | null;
  onFrame?: (report: ArFrameReport) => void;
  onEnd?: (reason: ArEndReason) => void;
}

export interface ArGuidanceHandle {
  end(): Promise<void>;
  /** Confirm the fresh, stable surface under the visible target as the floor. */
  confirmSurface(): boolean;
  /** Place again at tracked progress using the heading provider, never the route bearing. */
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
      // Confirmation and recovery must remain operable inside the session.
      requiredFeatures: ['local-floor', 'dom-overlay'],
      optionalFeatures: ['hit-test'],
      domOverlay: { root: options.overlay },
    });
  } catch (error) {
    throw new ArStartError(startFailure(error), error);
  }

  const renderer = new WebGLRenderer({ alpha: true, antialias: true });
  let ended = false;
  let attached = false;
  // Own the session before the first asynchronous setup step. The browser can
  // end AR while its renderer, reference space or hit-test source is pending.
  let releaseResources = () => renderer.dispose();
  const cleanup = () => {
    if (ended) return;
    ended = true;
    session.removeEventListener('end', cleanup);
    releaseResources();
    if (attached) tracker.detachDisplacement(performance.now());
    options.onEnd?.('ended');
  };
  session.addEventListener('end', cleanup);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local-floor');
  try {
    await renderer.xr.setSession(session);
  } catch (error) {
    await session.end().catch(() => undefined);
    cleanup();
    throw new ArStartError('failed', error);
  }
  if (ended) throw new ArStartError('ended');

  const scene = new Scene();
  const camera = new PerspectiveCamera();
  const route = new Group();
  // Nothing is shown until the route has been placed.
  route.visible = false;
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
  const targetGeometry = new RingGeometry(0.12, 0.17, 40);
  const targetMaterial = new MeshBasicMaterial({ color: 0xffc857, side: DoubleSide });
  const target = new Mesh(targetGeometry, targetMaterial);
  target.rotation.x = -Math.PI / 2;
  target.visible = false;
  scene.add(target);

  let chevrons: { holder: Group; along: number }[] = [];
  let builtTo = 0;
  let alignment: PlanWorldAlignment | null = null;
  let recovery: ArFrameReport['recovery'] = null;
  let placement: ArFrameReport['placement'] = null;
  let settle: { x: number; z: number; bearing: number; atMs: number } | null = null;
  let lastViewerAtMs: number | null = null;
  let alignedFloor: string | null = null;
  // A confirmed surface belongs to this storey and reference-space continuity only.
  let floorFor = tracker.read(performance.now()).floorId;
  const floor = new FloorPlacement();
  let last: { x: number; z: number } | null = null;
  let lastAtMs = 0;
  let pendingX = 0;
  let pendingZ = 0;
  let pendingSince = 0;
  let lastReport = 0;
  let hitSource: XRHitTestSource | null = null;

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
    route.position.y = alignment.floorY;
  };

  const align = (viewer: ViewerReading, nowMs: number) => {
    const snapshot = tracker.read(nowMs);
    const here = positionAt(track, snapshot.progressMeters);
    const facing = options.facingDegrees();
    // A world pose has an arbitrary origin. It is not a venue alignment.
    const floorY = floor.confirmedY;
    if (floorY === null) return;
    if (facing === null || !Number.isFinite(facing)) {
      waitFor('heading', nowMs);
      return;
    }
    alignment = alignPlanToWorld(
      { x: here.x, y: here.y, bearingDegrees: facing },
      { x: viewer.x, z: viewer.z, bearingDegrees: viewer.bearingDegrees },
      floorY,
    );
    alignedFloor = snapshot.floorId;
    last = { x: viewer.x, z: viewer.z };
    lastAtMs = nowMs;
    tracker.poseRestored(nowMs);
    pendingX = 0;
    pendingZ = 0;
    pendingSince = nowMs;
    tracker.facing(worldBearingToPlan(alignment, viewer.bearingDegrees), nowMs);
    target.visible = false;
    buildRoute(snapshot.progressMeters);
  };

  releaseResources = () => {
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
    targetGeometry.dispose();
    targetMaterial.dispose();
    renderer.dispose();
  };

  try {
    const viewerSpace = await session.requestReferenceSpace('viewer');
    if (
      !ended &&
      typeof session.requestHitTestSource === 'function' &&
      typeof XRRay !== 'undefined'
    ) {
      // Through the camera centre so the visitor can aim at and identify the
      // actual surface. Pointing at the ground does not establish venue yaw.
      hitSource =
        (await session.requestHitTestSource({
          space: viewerSpace,
          entityTypes: ['plane'],
          offsetRay: new XRRay(),
        })) ?? null;
      // A source resolving after the end event was not available to cleanup.
      if (ended) {
        try {
          hitSource?.cancel();
        } catch {
          // The platform may already have released it with the session.
        }
        hitSource = null;
      }
    }
  } catch {
    hitSource = null;
  }
  if (ended) throw new ArStartError('ended');

  tracker.attachDisplacement(performance.now());
  attached = true;

  const emit = (nowMs: number, immediately: boolean) => {
    if (!immediately && nowMs - lastReport < REPORT_MS) return;
    lastReport = nowMs;
    const snapshot = tracker.read(nowMs);
    options.onFrame?.({
      aligned: alignment !== null,
      recovery,
      placement: alignment === null && recovery === null ? placement : null,
      floorY: floor.confirmedY,
      floorHits: floor.hits,
      facingDegrees: alignment !== null ? snapshot.headingDegrees : null,
      progressMeters: snapshot.progressMeters,
    });
  };

  const hold = (reason: NonNullable<ArFrameReport['recovery']>, nowMs: number) => {
    const changed = recovery !== reason;
    recovery = reason;
    alignment = null;
    last = null;
    pendingX = 0;
    pendingZ = 0;
    route.visible = false;
    target.visible = false;
    floor.reset();
    tracker.facing(null, nowMs);
    if (changed) emit(nowMs, true);
  };

  const waitFor = (reason: NonNullable<ArFrameReport['placement']>, nowMs: number) => {
    const changed = placement !== reason;
    placement = reason;
    emit(nowMs, changed);
  };

  /*
   * Nothing has been placed yet, so nothing is lost: a missing pose here is
   * the platform still finding the room, which is how every session starts.
   * Only once the route is placed does a missing pose mean it may be wrong.
   */
  const lose = (nowMs: number) => {
    if (alignment === null && recovery === null) {
      settle = null;
      floor.reset();
      target.visible = false;
      waitFor('tracking', nowMs);
    } else {
      hold('pose-lost', nowMs);
    }
  };

  /**
   * Neither elapsed time nor local-floor's estimated zero proves a floor.
   * A stable observed surface must be explicitly identified by the visitor.
   */
  const readyToPlace = (viewer: ViewerReading, nowMs: number) => {
    if (
      settle === null ||
      Math.hypot(viewer.x - settle.x, viewer.z - settle.z) > SETTLE_METERS ||
      Math.abs(signedHeadingDifference(viewer.bearingDegrees, settle.bearing)) > SETTLE_DEGREES
    ) {
      settle = { x: viewer.x, z: viewer.z, bearing: viewer.bearingDegrees, atMs: nowMs };
    }
    if (nowMs - settle.atMs < SETTLE_MS) {
      waitFor('steady', nowMs);
      return false;
    }
    if (hitSource === null) {
      waitFor('floor-unavailable', nowMs);
      return false;
    }
    if (floor.confirmedY === null) {
      waitFor(floor.candidate(nowMs)?.ready ? 'floor-confirm' : 'floor', nowMs);
      return false;
    }
    return true;
  };

  const referenceSpace = renderer.xr.getReferenceSpace();
  const reset = () => lose(performance.now());
  referenceSpace?.addEventListener?.('reset', reset);
  session.addEventListener('end', () => referenceSpace?.removeEventListener?.('reset', reset), {
    once: true,
  });

  renderer.setAnimationLoop((_time, frame) => {
    if (ended || !frame) return;
    const space = renderer.xr.getReferenceSpace();
    const nowMs = performance.now();
    const pose = space ? frame.getViewerPose(space) : null;
    if (!space || !pose || pose.emulatedPosition) {
      lose(nowMs);
      renderer.render(scene, camera);
      return;
    }
    if (recovery !== null) {
      renderer.render(scene, camera);
      return;
    }
    const viewer = viewerFromMatrix(pose.transform.matrix);

    if (alignment === null) {
      const floorId = tracker.read(nowMs).floorId;
      if (
        floorId !== floorFor ||
        (lastViewerAtMs !== null && nowMs - lastViewerAtMs > PLACEMENT_MAX_POSE_GAP_MS)
      ) {
        floorFor = floorId;
        floor.reset();
        settle = null;
      }
    }
    lastViewerAtMs = nowMs;

    if (alignment === null && floor.confirmedY === null) {
      let matrix: Float32Array | null = null;
      try {
        matrix =
          hitSource === null
            ? null
            : (frame.getHitTestResults(hitSource)[0]?.getPose(space)?.transform.matrix ?? null);
      } catch {
        // No usable observation this frame. Do not reuse a stale target.
      }
      floor.observe(matrix, viewer, nowMs);
      const candidate = floor.candidate(nowMs);
      target.visible = candidate !== null;
      if (candidate !== null) {
        target.position.set(candidate.x, candidate.y + 0.005, candidate.z);
        targetMaterial.color.setHex(candidate.ready ? 0x37d6a1 : 0xffc857);
      }
    }

    let placed = false;
    if (alignment === null) {
      if (!readyToPlace(viewer, nowMs)) {
        renderer.render(scene, camera);
        return;
      }
      align(viewer, nowMs);
      placed = alignment !== null;
    } else if (last !== null) {
      const step = Math.hypot(viewer.x - last.x, viewer.z - last.z);
      const elapsedMs = nowMs - lastAtMs;
      if (
        step > POSE_JUMP_METERS &&
        (elapsedMs > MAX_POSE_GAP_MS ||
          step / Math.max(0.001, elapsedMs / 1000) > MAX_POSE_SPEED_MPS)
      ) {
        hold('pose-lost', nowMs);
        renderer.render(scene, camera);
        return;
      }
      pendingX += viewer.x - last.x;
      pendingZ += viewer.z - last.z;
      last = { x: viewer.x, z: viewer.z };
      lastAtMs = nowMs;
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

    // A valid stationary pose is still a position observation. Keep it fresh
    // without counting any movement; missing/emulated/recovering poses exit above.
    if (alignment !== null) tracker.displace({ dxMeters: 0, dyMeters: 0, timeMs: nowMs });
    const snapshot = tracker.read(nowMs);
    if (snapshot.reason === 'pose-jump') {
      // The tracker also checks movement independently. Its rejection must
      // use the same explicit recovery path as a lost/jumping viewer pose.
      hold('pose-lost', nowMs);
      renderer.render(scene, camera);
      return;
    }
    if (alignment !== null) {
      // A storey change moves the floor under the session's feet: start again there.
      if (snapshot.floorId !== alignedFloor) {
        hold('floor-change', nowMs);
      } else if (snapshot.progressMeters + AHEAD_METERS > builtTo + 5 && builtTo < track.length) {
        buildRoute(snapshot.progressMeters);
      }
    }
    for (const entry of chevrons)
      entry.holder.visible = entry.along > snapshot.progressMeters + 0.5;

    route.visible = alignment !== null && recovery === null && snapshot.tier !== 'frozen';

    emit(nowMs, placed);
    renderer.render(scene, camera);
  });

  return {
    confirmSurface() {
      if (
        ended ||
        alignment !== null ||
        recovery !== null ||
        placement !== 'floor-confirm' ||
        floor.confirmedY !== null
      )
        return false;
      const nowMs = performance.now();
      if (floor.confirm(nowMs)) return true;
      // A stalled frame loop must not leave a green, tappable but stale target.
      floor.reset();
      target.visible = false;
      waitFor('floor', nowMs);
      return false;
    },
    async end() {
      if (!ended) await session.end().catch(() => undefined);
      cleanup();
    },
    realign() {
      // Reacquire the room, not an invented venue heading. Floor confirmation
      // cannot supply the missing yaw when the provider is unavailable.
      recovery = null;
      alignment = null;
      // Placed again from a pose held still, as at the start.
      placement = null;
      settle = null;
      floor.reset();
      target.visible = false;
      lastViewerAtMs = null;
      last = null;
      pendingX = 0;
      pendingZ = 0;
      route.visible = false;
    },
  };
}
