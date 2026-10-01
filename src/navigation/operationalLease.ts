import type { CompiledBuildingPackage } from '@voicegis/map-compiler';
import { isOperationalOverlay, resolveOperationalOverlay } from '../engine/operationalOverlay';

export interface OperationalFreshness {
  status: 'none' | 'current' | 'unavailable';
  overlayId: string | null;
  reason: string | null;
}

export const NO_OPERATIONAL_POLICY: OperationalFreshness = {
  status: 'none',
  overlayId: null,
  reason: null,
};

/** Own a copy: mutating an imported object cannot change an in-flight policy. */
export function copyOperationalOverlay(value: unknown) {
  if (!isOperationalOverlay(value)) return value;
  return Object.freeze({
    ...value,
    closures: Object.freeze(
      value.closures.map((closure) =>
        Object.freeze({
          ...closure,
          target: Object.freeze({ ...closure.target }),
        }),
      ),
    ),
  });
}

/** A local expiry lease, not authentication, network freshness or a trusted clock. */
export function createOperationalLease(
  overlay: unknown,
  pkg: CompiledBuildingPackage,
  wallMs: number,
  monotonicMs: number,
) {
  const until = isOperationalOverlay(overlay) ? Date.parse(overlay.validUntil) : NaN;
  const from = isOperationalOverlay(overlay) ? Date.parse(overlay.validFrom) : NaN;
  const deadline = monotonicMs + (until - wallMs);
  let lastWall = wallMs;
  let lastMonotonic = monotonicMs;
  let clockLost = false;
  let expired = false;
  let resolution: ReturnType<typeof resolveOperationalOverlay> | null = null;
  return {
    read(nowWall: number, nowMonotonic: number): OperationalFreshness {
      // Wall time may move back slightly under ordinary clock synchronization.
      // A material rollback, or a broken monotonic clock, cannot extend a lease.
      if (
        !Number.isFinite(nowWall) ||
        !Number.isFinite(nowMonotonic) ||
        nowWall < lastWall - 1000 ||
        nowMonotonic < lastMonotonic ||
        !Number.isFinite(wallMs) ||
        !Number.isFinite(monotonicMs)
      )
        clockLost = true;
      lastWall = Math.max(lastWall, nowWall);
      lastMonotonic = Math.max(lastMonotonic, nowMonotonic);
      if (Number.isFinite(until) && (nowWall >= until || nowMonotonic >= deadline)) expired = true;
      const date = new Date(nowWall);
      if (!Number.isFinite(date.getTime())) clockLost = true;
      // Overlay contents are owned and immutable for this lease. Resolve the
      // graph once, except when a future-dated policy becomes active. Frame
      // guards must not rebuild the venue graph at camera frame rate.
      if (!resolution || (resolution.issues[0]?.code === 'overlay-not-active' && nowWall >= from)) {
        resolution = resolveOperationalOverlay(
          overlay,
          pkg,
          Number.isFinite(date.getTime()) ? date.toISOString() : '',
        );
      }
      const result = resolution;
      return {
        status: !clockLost && !expired && result.valid ? 'current' : 'unavailable',
        overlayId: result.overlayId,
        reason: clockLost
          ? 'clock-unreliable'
          : expired
            ? 'overlay-expired'
            : (result.issues[0]?.code ?? null),
      };
    },
    /** Timers are only a wakeup: every decision still reads both clocks. */
    delay(nowWall: number, nowMonotonic: number) {
      const remaining = Math.min(until - nowWall, deadline - nowMonotonic);
      return !expired && !clockLost && remaining > 0 && Number.isFinite(remaining)
        ? Math.max(1, Math.min(1000, remaining))
        : 1000;
    },
  };
}

export function operationalProblem(reason: string | null, offline = false) {
  switch (reason) {
    case 'overlay-expired':
      return offline
        ? 'Closure information has expired. You are offline, so updated closure information is unavailable. A cached map does not confirm that paths are open.'
        : 'Closure information has expired. Updated closure information is needed before this route can be used.';
    case 'overlay-removed':
      return 'Closure information was removed. That does not confirm that the previously closed paths are open. Updated closure information is needed.';
    case 'overlay-changed':
      return 'Closure information changed. Confirm where you are now before planning the route again.';
    case 'location-required':
      return 'The previous route is no longer current. Confirm where you are now before planning another route.';
    case 'clock-unreliable':
      return 'The device clock changed unexpectedly. Recheck the clock and load updated closure information before using the route.';
    default:
      return 'Closure information cannot be applied to this venue right now. Updated, valid closure information is needed before using the route.';
  }
}
