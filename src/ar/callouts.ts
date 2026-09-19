import type { RouteStep } from '../engine/routingCore';
import type { Landmark } from '../engine/routeLandmarks';
import { formatMeters, formatMinutes } from '../components/journey/guidanceCopy';
import {
  guidanceAt,
  nextVerticalRun,
  positionAt,
  type RouteTrack,
} from '../navigation/routeProgress';

/**
 * What to label in the world ahead of the visitor: the destination once it
 * is on this floor and in range, the stair or lift the route takes next, the
 * next corners with the corridor they turn onto, and the named places nearby
 * with how far away they are. Each callout is a plan point; the camera view
 * puts it on the screen where that point is.
 */

export type CalloutKind = 'destination' | 'connector' | 'turn' | 'place';

export interface Callout {
  id: string;
  kind: CalloutKind;
  /** Plan position the label floats above. */
  x: number;
  y: number;
  /** Small line above the title, such as "Destination" or "Stairs". */
  kicker: string | null;
  title: string;
  /** Distance and, for the destination, time. */
  detail: string | null;
  /** The manoeuvre, for turns and storey changes. */
  stepType: RouteStep['type'] | null;
  /** Distance along the route to the point, or null for a place beside it. */
  alongMeters: number | null;
}

export interface CalloutInput {
  track: RouteTrack;
  steps: readonly RouteStep[];
  progressMeters: number;
  /** The floor being looked at; nothing on another storey is labelled. */
  floorId: string;
  destinationName: string;
  landmarks: readonly Landmark[];
  /** How far along the route ahead is labelled. */
  aheadMeters?: number;
  /** How far a place may be from the visitor and still be pointed out. */
  placeRadiusMeters?: number;
  maxPlaces?: number;
  maxTurns?: number;
  walkSpeedMps?: number;
}

const TURNS: ReadonlySet<RouteStep['type']> = new Set([
  'turn_left',
  'turn_right',
  'slight_left',
  'slight_right',
  'u_turn',
]);
const VERTICAL: ReadonlySet<RouteStep['type']> = new Set([
  'elevator',
  'stairs',
  'ramp',
  'escalator',
]);

const TURN_LABEL: Partial<Record<RouteStep['type'], string>> = {
  turn_left: 'Turn left',
  turn_right: 'Turn right',
  slight_left: 'Bear left',
  slight_right: 'Bear right',
  u_turn: 'Turn around',
};

const CONNECTOR_KICKER: Partial<Record<RouteStep['type'], string>> = {
  elevator: 'Lift',
  stairs: 'Stairs',
  ramp: 'Ramp',
  escalator: 'Escalator',
};

/** The corridor a turn leads onto, else the place it is at, else the manoeuvre itself. */
function turnTitle(step: RouteStep) {
  const onto = / onto (.+)$/.exec(step.instruction);
  if (onto) return onto[1];
  const at = / at (.+)$/.exec(step.instruction);
  if (at) return at[1];
  return TURN_LABEL[step.type] ?? step.instruction;
}

/** "Take South Public Stair to Ground · Wing" as a name and where it goes. */
function connectorTitle(step: RouteStep): { title: string; goesTo: string | null } {
  const take = /^Take (.+?) to (.+)$/.exec(step.instruction);
  if (take) return { title: take[1], goesTo: take[2].split(' · ')[0] };
  return { title: step.instruction, goesTo: null };
}

/**
 * The place a step is about, for a card read at walking pace.
 *
 * A camera held up at arm's length is not where a sentence belongs. The
 * manoeuvre is already drawn as an arrow and counted down in metres beside
 * it, so what is left to say is where: the corridor being turned onto, the
 * stair being taken, the door being arrived at. The whole instruction is
 * still spoken and still written out under it; this is only the part that
 * has to survive a glance.
 */
export function shortStepTitle(step: RouteStep): string {
  if (VERTICAL.has(step.type)) return connectorTitle(step).title;
  if (TURNS.has(step.type)) return turnTitle(step);
  if (step.type === 'arrive') {
    const at = /^Arrive at (.+?)(?:,|$)/.exec(step.instruction);
    return at ? at[1] : step.instruction;
  }
  // "…continue on Family Care Concourse, towards Women's Imaging" is a
  // corridor and then a reason; the corridor is the part being walked.
  const on = / on (.+?)(?:,| · |$)/.exec(step.instruction);
  if (on) return on[1];
  return step.instruction;
}

export function calloutsAhead(input: CalloutInput): Callout[] {
  const {
    track,
    steps,
    floorId,
    destinationName,
    landmarks,
    aheadMeters = 30,
    placeRadiusMeters = 18,
    maxPlaces = 3,
    maxTurns = 2,
    walkSpeedMps = 1.2,
  } = input;
  const callouts: Callout[] = [];
  if (track.length <= 0 || steps.length === 0) return callouts;
  const progress = Math.min(Math.max(0, input.progressMeters), track.length);
  const guidance = guidanceAt(track, progress);
  const here = positionAt(track, progress);

  const remaining = track.length - progress;
  const end = positionAt(track, track.length);
  if (end.floor === floorId && remaining <= aheadMeters) {
    callouts.push({
      id: 'destination',
      kind: 'destination',
      x: end.x,
      y: end.y,
      kicker: 'Destination',
      title: destinationName,
      detail: `${formatMeters(remaining)} (${formatMinutes(remaining, walkSpeedMps)})`,
      stepType: 'arrive',
      alongMeters: remaining,
    });
  }

  const run = nextVerticalRun(track, progress);
  if (run !== null && run.fromFloorId === floorId && run.boardingMeters - progress <= aheadMeters) {
    const index = steps.findIndex(
      (step, at) =>
        VERTICAL.has(step.type) && Math.abs(track.stepAt[at] - run.boardingMeters) < 0.6,
    );
    const step = index >= 0 ? steps[index] : null;
    const named = step ? connectorTitle(step) : { title: 'Change of floor', goesTo: null };
    const boarding = positionAt(track, run.boardingMeters);
    const distance = formatMeters(run.boardingMeters - progress);
    callouts.push({
      id: `connector:${run.boardingMeters.toFixed(2)}`,
      kind: 'connector',
      x: boarding.x,
      y: boarding.y,
      kicker: step ? (CONNECTOR_KICKER[step.type] ?? 'Change of floor') : 'Change of floor',
      title: named.title,
      detail: named.goesTo ? `${distance} · to ${named.goesTo}` : distance,
      stepType: step?.type ?? null,
      alongMeters: run.boardingMeters - progress,
    });
  }

  let turns = 0;
  for (let index = guidance.nextIndex; index < steps.length && turns < maxTurns; index += 1) {
    const step = steps[index];
    const along = track.stepAt[index] - progress;
    if (along > aheadMeters) break;
    if (VERTICAL.has(step.type)) break;
    if (!TURNS.has(step.type) || along < 0.5) continue;
    const corner = positionAt(track, track.stepAt[index]);
    if (corner.floor !== floorId) break;
    callouts.push({
      id: `turn:${index}`,
      kind: 'turn',
      x: corner.x,
      y: corner.y,
      kicker: null,
      title: turnTitle(step),
      detail: formatMeters(along),
      stepType: step.type,
      alongMeters: along,
    });
    turns += 1;
  }

  const places = landmarks
    .filter((landmark) => landmark.floorId === floorId && landmark.name !== destinationName)
    .map((landmark) => ({
      landmark,
      distance: Math.hypot(landmark.position[0] - here.x, landmark.position[1] - here.y),
    }))
    .filter((entry) => entry.distance >= 1.5 && entry.distance <= placeRadiusMeters)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, maxPlaces);
  for (const { landmark, distance } of places) {
    callouts.push({
      id: `place:${landmark.id}`,
      kind: 'place',
      x: landmark.position[0],
      y: landmark.position[1],
      kicker: null,
      title: landmark.name,
      detail: formatMeters(distance),
      stepType: null,
      alongMeters: null,
    });
  }

  return callouts;
}
