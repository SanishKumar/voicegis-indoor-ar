import { nextVerticalRun, positionAt, type RouteTrack } from '../navigation/routeProgress';

/**
 * The route ahead, drawn on the floor of a camera image.
 *
 * A pinhole camera at a known height above the floor, facing a known plan
 * bearing and tilted by a known pitch and roll, sees each point of the floor
 * at one place on the screen. The route is a line on the floor, so it can be
 * drawn where the floor is - which is what makes a camera view useful when
 * the phone knows which way it faces but nothing anchors it to the building.
 * The same camera places a label floating above a door or a corner.
 *
 * Everything here is geometry on stated inputs. It does not know whether the
 * facing is right; the caller says where the facing came from.
 */

/** The camera image as it is shown, and how high the phone is held. */
export interface CameraModel {
  width: number;
  height: number;
  /** Vertical field of view of the shown image, in degrees. */
  verticalFovDegrees: number;
  /** Height of the camera above the floor, in metres. */
  eyeHeightMeters: number;
}

export interface ViewerPose {
  /** Plan position of the camera. */
  x: number;
  y: number;
  /** Plan bearing the camera looks along, degrees clockwise from plan-up. */
  facingDegrees: number;
  /** Optical axis above the horizon, in degrees; negative looks down. */
  pitchDegrees: number;
  /** Rotation about the optical axis, in degrees; positive swings the floor to the right. */
  rollDegrees: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
  depthMeters: number;
  alongMeters: number;
}

export interface Chevron {
  x: number;
  y: number;
  /** Direction of travel on screen, in radians, as `Math.atan2` gives it. */
  angleRadians: number;
  pixelsPerMeter: number;
  alongMeters: number;
}

export interface FloorProjection {
  /** The route ahead as screen polylines, split where it passes behind the camera. */
  ribbon: ScreenPoint[][];
  chevrons: Chevron[];
  /** The destination when it is within range and in front of the camera. */
  destination: ScreenPoint | null;
  /** Where the horizon crosses the screen's centre line, or null when it is off screen. */
  horizonY: number | null;
  /** Metres of route drawn; shorter than asked for when a storey change or the end comes first. */
  drawnMeters: number;
  /** True when the drawn route ends at a lift or stair. */
  endsAtVerticalRun: boolean;
}

export interface ProjectionOptions {
  aheadMeters?: number;
  /** The route nearer than this to the visitor is left undrawn; it is under them. */
  startOffsetMeters?: number;
  spacingMeters?: number;
  chevronEveryMeters?: number;
  /** Depth in front of the lens below which a point is behind the camera. */
  nearMeters?: number;
}

/** A phone camera in portrait, held at chest height, with the image filling the screen. */
export const DEFAULT_CAMERA_MODEL = Object.freeze({
  verticalFovDegrees: 55,
  eyeHeightMeters: 1.35,
});

const DEFAULTS: Required<ProjectionOptions> = {
  aheadMeters: 25,
  startOffsetMeters: 1.2,
  spacingMeters: 0.5,
  chevronEveryMeters: 2.5,
  nearMeters: 0.15,
};

const DEG = Math.PI / 180;

export interface CameraSpace {
  x: number;
  y: number;
  z: number;
}

export interface Projected {
  x: number;
  y: number;
  depthMeters: number;
}

/** One camera, for placing anything in the plan on the screen. */
export interface Projector {
  /** Pixels per metre at a depth of one metre. */
  focal: number;
  nearMeters: number;
  toCamera(planX: number, planY: number, heightMeters?: number): CameraSpace;
  toScreen(point: CameraSpace): { x: number; y: number };
  /** A plan point at a height above the floor, or null when it is behind the camera. */
  project(planX: number, planY: number, heightMeters?: number): Projected | null;
}

export function createProjector(
  pose: ViewerPose,
  camera: CameraModel,
  nearMeters = DEFAULTS.nearMeters,
): Projector {
  const focal = camera.height / 2 / Math.tan((camera.verticalFovDegrees / 2) * DEG);
  const centreX = camera.width / 2;
  const centreY = camera.height / 2;
  const bearing = pose.facingDegrees * DEG;
  const forward = [Math.sin(bearing), -Math.cos(bearing)];
  const right = [Math.cos(bearing), Math.sin(bearing)];
  const pitch = pose.pitchDegrees * DEG;
  const roll = pose.rollDegrees * DEG;
  const sinPitch = Math.sin(pitch);
  const cosPitch = Math.cos(pitch);
  const sinRoll = Math.sin(roll);
  const cosRoll = Math.cos(roll);

  const toCamera = (planX: number, planY: number, heightMeters = 0): CameraSpace => {
    const dx = planX - pose.x;
    const dy = planY - pose.y;
    const across = dx * right[0] + dy * right[1];
    const ahead = dx * forward[0] + dy * forward[1];
    const above = heightMeters - camera.eyeHeightMeters;
    // The camera tilts up by the pitch; in its own frame the world tilts the other way.
    const depth = above * sinPitch + ahead * cosPitch;
    const up = above * cosPitch - ahead * sinPitch;
    return {
      x: across * cosRoll - up * sinRoll,
      y: across * sinRoll + up * cosRoll,
      z: depth,
    };
  };
  const toScreen = (point: CameraSpace) => ({
    x: centreX + (focal * point.x) / point.z,
    y: centreY - (focal * point.y) / point.z,
  });
  return {
    focal,
    nearMeters,
    toCamera,
    toScreen,
    project(planX, planY, heightMeters = 0) {
      const point = toCamera(planX, planY, heightMeters);
      if (point.z < nearMeters) return null;
      return { ...toScreen(point), depthMeters: point.z };
    },
  };
}

export function projectRouteAhead(
  track: RouteTrack,
  progressMeters: number,
  pose: ViewerPose,
  camera: CameraModel,
  options: ProjectionOptions = {},
): FloorProjection {
  const settings = { ...DEFAULTS, ...options };
  const empty: FloorProjection = {
    ribbon: [],
    chevrons: [],
    destination: null,
    horizonY: null,
    drawnMeters: 0,
    endsAtVerticalRun: false,
  };
  if (!(track.length > 0) || !(camera.width > 0) || !(camera.height > 0)) return empty;

  const here = Math.min(Math.max(0, progressMeters), track.length);
  const progress = Math.min(here + settings.startOffsetMeters, track.length);
  const run = nextVerticalRun(track, here);
  const limit = Math.min(
    here + settings.aheadMeters,
    track.length,
    run === null ? Number.POSITIVE_INFINITY : run.boardingMeters,
  );
  const endsAtVerticalRun = run !== null && limit === run.boardingMeters;
  const reachesEnd = limit >= track.length;
  if (limit <= progress && !reachesEnd) return { ...empty, endsAtVerticalRun };

  const projector = createProjector(pose, camera, settings.nearMeters);
  const { focal, toCamera } = projector;
  const toScreen = (point: CameraSpace, along: number): ScreenPoint => ({
    ...projector.toScreen(point),
    depthMeters: point.z,
    alongMeters: along,
  });
  const inFront = (point: CameraSpace) => point.z >= settings.nearMeters;
  const cut = (a: CameraSpace, b: CameraSpace, alongA: number, alongB: number): ScreenPoint => {
    const t = (settings.nearMeters - a.z) / (b.z - a.z);
    return toScreen(
      { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: settings.nearMeters },
      alongA + (alongB - alongA) * t,
    );
  };

  // Samples every few decimetres plus every corner, so a turn is a corner and not a curve.
  const alongs = new Set<number>();
  for (let along = progress; along < limit; along += settings.spacingMeters) alongs.add(along);
  for (const at of track.at) if (at > progress && at < limit) alongs.add(at);
  alongs.add(limit);
  const samples = [...alongs]
    .sort((a, b) => a - b)
    .map((along) => {
      const position = positionAt(track, along);
      return { along, camera: toCamera(position.x, position.y) };
    });

  const ribbon: ScreenPoint[][] = [];
  let current: ScreenPoint[] = [];
  const close = () => {
    if (current.length >= 2) ribbon.push(current);
    current = [];
  };
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const previous = index > 0 ? samples[index - 1] : null;
    if (inFront(sample.camera)) {
      if (previous !== null && !inFront(previous.camera)) {
        current.push(cut(previous.camera, sample.camera, previous.along, sample.along));
      }
      current.push(toScreen(sample.camera, sample.along));
    } else {
      if (previous !== null && inFront(previous.camera)) {
        current.push(cut(previous.camera, sample.camera, previous.along, sample.along));
      }
      close();
    }
  }
  close();

  const chevrons: Chevron[] = [];
  const every = settings.chevronEveryMeters;
  for (let along = Math.ceil(progress / every) * every; along < limit; along += every) {
    const here = positionAt(track, along);
    const step = along + 0.3 <= limit ? 0.3 : -0.3;
    const there = positionAt(track, along + step);
    const a = toCamera(here.x, here.y);
    const b = toCamera(there.x, there.y);
    if (!inFront(a) || !inFront(b)) continue;
    const from = toScreen(a, along);
    const to = toScreen(b, along + step);
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    chevrons.push({
      x: from.x,
      y: from.y,
      angleRadians: step > 0 ? angle : angle + Math.PI,
      pixelsPerMeter: focal / a.z,
      alongMeters: along,
    });
  }

  let destination: ScreenPoint | null = null;
  if (reachesEnd) {
    const end = positionAt(track, track.length);
    const point = toCamera(end.x, end.y);
    if (inFront(point)) destination = toScreen(point, track.length);
  }

  // The horizon is where a level line of sight lands: above centre when looking down.
  const sinPitch = Math.sin(pose.pitchDegrees * DEG);
  const cosPitch = Math.cos(pose.pitchDegrees * DEG);
  const horizon =
    Math.abs(cosPitch) < 1e-6 ? null : camera.height / 2 + (focal * sinPitch) / cosPitch;
  const horizonY = horizon !== null && horizon >= 0 && horizon <= camera.height ? horizon : null;

  return {
    ribbon,
    chevrons,
    destination,
    horizonY,
    drawnMeters: Math.max(0, limit - here),
    endsAtVerticalRun,
  };
}
