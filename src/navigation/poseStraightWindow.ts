import { planBearing, signedHeadingDifference } from './coordinateFrames';

export interface WalkPoint {
  x: number;
  y: number;
}

/** Software noise guards, not handset accuracy or permission to cross free space. */
export const STRAIGHT_WINDOW_POLICY = Object.freeze({
  maximumResidualMeters: 0.35,
  maximumRmsMeters: 0.18,
  minimumForwardFraction: 0.9,
  maximumBendDegrees: 8,
});

/** Orthogonal line fit: unlike endpoint heading, phone sway is averaged over all positions. */
function fit(points: readonly WalkPoint[]) {
  if (points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const x = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const y = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  let xx = 0,
    xy = 0,
    yy = 0;
  for (const point of points) {
    xx += (point.x - x) ** 2;
    xy += (point.x - x) * (point.y - y);
    yy += (point.y - y) ** 2;
  }
  if (xx + yy < 1e-12) return null;
  const angle = Math.atan2(2 * xy, xx - yy) / 2;
  const sign =
    (last.x - first.x) * Math.cos(angle) + (last.y - first.y) * Math.sin(angle) < 0 ? -1 : 1;
  const dx = sign * Math.cos(angle),
    dy = sign * Math.sin(angle);
  let maximumResidual = 0,
    squaredResiduals = 0,
    alongPath = 0;
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    const residual = Math.abs((point.x - x) * dy - (point.y - y) * dx);
    maximumResidual = Math.max(maximumResidual, residual);
    squaredResiduals += residual ** 2;
    if (i > 0)
      alongPath += Math.abs((point.x - points[i - 1].x) * dx + (point.y - points[i - 1].y) * dy);
  }
  const span = (last.x - first.x) * dx + (last.y - first.y) * dy;
  const bearing = planBearing([0, 0], [dx, dy]);
  return bearing === null
    ? null
    : {
        bearing,
        dx,
        dy,
        span,
        alongPath,
        maximumResidual,
        rms: Math.sqrt(squaredResiduals / points.length),
      };
}

/**
 * Classifies a window for heading learning only. NEVER smooths the actual pose
 * used by route/venue matching. Net travel sets the baseline; lateral phone
 * oscillation cannot make a short window look like three metres of walking.
 */
export function straightCourse(points: readonly WalkPoint[], minimumSpanMeters: number) {
  if (!Number.isFinite(minimumSpanMeters) || minimumSpanMeters <= 0) return null;
  if (points.some(({ x, y }) => !Number.isFinite(x) || !Number.isFinite(y))) return null;
  const whole = fit(points);
  if (
    !whole ||
    whole.span < minimumSpanMeters - 1e-6 ||
    whole.maximumResidual > STRAIGHT_WINDOW_POLICY.maximumResidualMeters ||
    whole.rms > STRAIGHT_WINDOW_POLICY.maximumRmsMeters ||
    whole.span / whole.alongPath < STRAIGHT_WINDOW_POLICY.minimumForwardFraction
  )
    return null;
  const first = points[0];
  const mid = points.findIndex(
    (point) => (point.x - first.x) * whole.dx + (point.y - first.y) * whole.dy >= whole.span / 2,
  );
  if (mid < 1 || mid >= points.length - 1) return null;
  const before = fit(points.slice(0, mid + 1));
  const after = fit(points.slice(mid));
  if (
    !before ||
    !after ||
    Math.abs(signedHeadingDifference(before.bearing, after.bearing)) >
      STRAIGHT_WINDOW_POLICY.maximumBendDegrees
  )
    return null;
  return { bearing: whole.bearing, spanMeters: whole.span };
}
