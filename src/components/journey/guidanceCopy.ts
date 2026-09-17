import type { RouteStep } from '../../engine/routingCore';
import type { Guidance, RouteTrack } from '../../navigation/routeProgress';

/**
 * What the instruction banner says at a point on the route.
 *
 * One manoeuvre at a time, with the distance to it first, the way every
 * navigation product people already know does it. The full list is one tap
 * away; the banner is for the next thing to do.
 */
export interface BannerCopy {
  /** Short lead-in: "In 20 m", "Now", "Start", "Arriving". */
  lead: string;
  /** The instruction itself. */
  text: string;
  /** The manoeuvre straight after, when it follows closely enough to matter. */
  then: string | null;
  /** The step whose type picks the icon. */
  step: RouteStep;
  /** The same guidance phrased to be read aloud. */
  speech: string;
}

/** Manoeuvres closer than this to the one before are announced together. */
const THEN_WITHIN_METERS = 15;
/** Close enough that "In 2 m" is noise and "Now" is the instruction. */
const NOW_WITHIN_METERS = 3;
const VERTICAL_STEPS = new Set<RouteStep['type']>(['elevator', 'stairs', 'ramp', 'escalator']);
/**
 * A manoeuvre stays the instruction for this far past its point. Arriving at a
 * turn - by walking up to it or by stepping to it - is exactly when "turn
 * left" has to be on screen; treating arrival as having turned skipped the
 * first turn of a route entirely.
 */
const JUST_REACHED_METERS = 2.5;

export function formatMeters(meters: number) {
  if (!Number.isFinite(meters) || meters < 0) return '0 m';
  if (meters < 1000) return `${Math.max(1, Math.round(meters))} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

/** Walking time as people say it: whole minutes, never "1m 8s". */
export function formatMinutes(meters: number, walkSpeedMps = 1.2) {
  if (!Number.isFinite(meters) || meters <= 0 || !(walkSpeedMps > 0)) return 'Under 1 min';
  const minutes = Math.round(meters / walkSpeedMps / 60);
  return minutes < 1 ? 'Under 1 min' : `${minutes} min`;
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

export function bannerCopy(
  steps: readonly RouteStep[],
  track: RouteTrack,
  guidance: Guidance,
  progressMeters: number,
  floorName: (floorId: string) => string | undefined,
  riding = false,
): BannerCopy | null {
  const last = steps[steps.length - 1];
  if (last === undefined) return null;

  if (guidance.atEnd) {
    const floor = last.floorId === undefined ? undefined : floorName(String(last.floorId));
    return {
      lead: 'Arriving',
      text: last.instruction,
      then: floor ?? null,
      step: last,
      speech: last.instruction,
    };
  }

  // In the lift, the ride is the instruction until the doors open.
  const current = steps[guidance.stepIndex];
  if (riding && current !== undefined && VERTICAL_STEPS.has(current.type)) {
    return {
      lead: 'Now',
      text: current.instruction,
      then: `Then ${lowerFirst(steps[guidance.nextIndex].instruction)}`,
      step: current,
      speech: current.instruction,
    };
  }

  const thenAfter = (index: number) => {
    const following = steps[index + 1];
    if (following === undefined) return null;
    const gap = track.stepAt[index + 1] - track.stepAt[index];
    return gap < THEN_WITHIN_METERS ? `Then ${lowerFirst(following.instruction)}` : null;
  };

  const reached = steps[guidance.stepIndex];
  const sinceReached = progressMeters - (track.stepAt[guidance.stepIndex] ?? 0);
  if (guidance.stepIndex > 0 && reached !== undefined && sinceReached < JUST_REACHED_METERS) {
    return {
      lead: 'Now',
      text: reached.instruction,
      then: thenAfter(guidance.stepIndex),
      step: reached,
      speech: reached.instruction,
    };
  }

  const next = steps[guidance.nextIndex];

  // Before setting off, the thing to do is the start instruction itself.
  if (guidance.stepIndex === 0 && progressMeters < 0.5 && steps.length > 1) {
    const first = steps[0];
    const distance = formatMeters(guidance.metersToNext);
    return {
      lead: 'Start',
      text: first.instruction,
      then: `In ${distance}, ${lowerFirst(next.instruction)}`,
      step: first,
      speech: `${first.instruction}. In ${distance}, ${lowerFirst(next.instruction)}.`,
    };
  }

  const now = guidance.metersToNext < NOW_WITHIN_METERS;
  const lead = now ? 'Now' : `In ${formatMeters(guidance.metersToNext)}`;
  return {
    lead,
    text: next.instruction,
    then: thenAfter(guidance.nextIndex),
    step: next,
    speech: now ? next.instruction : `${lead}, ${lowerFirst(next.instruction)}`,
  };
}

/** A single sentence for the step list and for screen readers. */
export function stepSummary(step: RouteStep, floorName: (floorId: string) => string | undefined) {
  const floor = step.floorId === undefined ? undefined : floorName(String(step.floorId));
  const distance = step.distance > 0 ? `then ${formatMeters(step.distance)}` : null;
  return [floor, distance].filter(Boolean).join(' · ');
}
