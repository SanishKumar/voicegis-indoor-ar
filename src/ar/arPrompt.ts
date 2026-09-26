import type { TrackerSnapshot } from '../navigation/liveTracker';
import type { ArFrameReport } from './arSession';

/**
 * What the AR view asks of the visitor while a session runs, and the one
 * action that answers it.
 *
 * A session can stop showing the route for several different reasons - the
 * platform has not found the room yet, it lost it, a lift is being ridden,
 * the position is too uncertain - and each is fixed by something different.
 * One line naming a mixture of them left the visitor to guess which applied,
 * and the buttons beside it could fix none of the ones that needed a floor
 * confirmed or a destination reached.
 */

export type ArPromptKind =
  /** The visitor has confirmed arrival. */
  | 'arrived'
  /** At the end of the route; arrival waits to be confirmed. */
  | 'arriving'
  /** At a lift or stair; the route returns once the storey change is confirmed. */
  | 'floor-change'
  /** The platform lost the room after the route was placed. */
  | 'pose-lost'
  /** The tracker is on another storey than the one the route was placed on. */
  | 'new-floor'
  /** Placing: no pose from the platform yet. */
  | 'tracking'
  /** Placing: the phone is not being held still. */
  | 'steady'
  /** Placing: the floor has not been found yet. */
  | 'floor'
  | 'floor-confirm'
  | 'floor-unavailable'
  | 'heading'
  /** The position is frozen for a reason only a check-in scan fixes. */
  | 'rescan'
  | 'wrong-way'
  /** Placed, but the camera looks well away from where the route goes. */
  | 'turn'
  /** Placed, and the route is behind the camera. */
  | 'turn-around'
  /** The route is shown and nothing needs doing. */
  | 'guiding';

export type ArActionKind = 'realign' | 'confirm-floor' | 'confirm-arrival' | 'confirm-surface';

export interface ArPrompt {
  kind: ArPromptKind;
  /** One line over the camera; null while the route simply leads on. */
  note: string | null;
  /** The control beside Leave AR; null where the only useful thing is to leave. */
  action: { kind: ArActionKind; label: string } | null;
  /** Which control is the thing to do next, if either. */
  leads: 'action' | 'leave' | null;
}

export interface ArPromptInput {
  report: ArFrameReport | null;
  /** The live tracker's snapshot; null while position is not live. */
  snapshot: TrackerSnapshot | null;
  /** Arrival has been confirmed. */
  arrived: boolean;
  floorName: (floorId: string) => string | undefined;
  /**
   * From where the camera looks to where the route goes a few metres on,
   * signed, positive to the right; null when either is unknown.
   */
  turnDegrees?: number | null;
}

const REALIGN = { kind: 'realign', label: 'Re-align' } as const;

export function arPrompt({
  report,
  snapshot,
  arrived,
  floorName,
  turnDegrees = null,
}: ArPromptInput): ArPrompt {
  if (arrived) return { kind: 'arrived', note: null, action: null, leads: 'leave' };

  // Before any recovery: the confirmation here also re-places the route.
  if (snapshot?.reason === 'floor-change' && snapshot.pendingFloor) {
    const floor = floorName(snapshot.pendingFloor.toFloorId) ?? 'the next floor';
    return {
      kind: 'floor-change',
      note: `The route carries on from ${floor}. Once you step out there, tap “I’m on ${floor}”, then confirm the floor surface.`,
      action: { kind: 'confirm-floor', label: `I’m on ${floor}` },
      leads: 'action',
    };
  }

  // Arrival can be confirmed whether or not the phone still knows the room.
  // Shared guidance may still show a preview while the physical pose is being
  // placed. Only the physical tracker (or explicit confirmation above) arrives.
  if (snapshot?.reason === 'arrived') {
    return {
      kind: 'arriving',
      note: 'Your destination is here.',
      action: { kind: 'confirm-arrival', label: 'I’m at my destination' },
      leads: 'action',
    };
  }

  if (report?.recovery === 'pose-lost') {
    return {
      kind: 'pose-lost',
      note: 'The phone lost track of the room. Tap Re-align, then find and confirm the floor again. Direction must also be available before the route returns; walking is not counted until then.',
      action: REALIGN,
      leads: 'action',
    };
  }
  if (report?.recovery === 'floor-change') {
    return {
      kind: 'new-floor',
      note: 'You are on another floor now. Tap Re-align, then find and confirm this floor. Floor confirmation does not set the building’s direction.',
      action: REALIGN,
      leads: 'action',
    };
  }

  if (!report?.aligned) {
    const placement = report?.placement ?? 'tracking';
    if (placement === 'heading') {
      return {
        kind: placement,
        note: 'Floor confirmed, but the app does not know which way you are facing. Raise the phone slightly. If this stays, leave AR and scan a check-in sign while facing it squarely, or set the direction by hand in the camera view.',
        action: null,
        leads: 'leave',
      };
    }
    if (placement === 'floor-unavailable') {
      return {
        kind: placement,
        note: 'Surface detection is unavailable in this session. The route cannot be placed on the floor. Leave AR to use the map.',
        action: null,
        leads: 'leave',
      };
    }
    if (placement === 'floor-confirm') {
      return {
        kind: placement,
        note: 'Check that the green ring sits on the floor, not furniture. Confirm only if it does.',
        action: { kind: 'confirm-surface', label: 'This is the floor' },
        leads: 'action',
      };
    }
    return {
      kind: placement,
      note:
        placement === 'floor'
          ? 'Point the phone at the floor nearby. Hold the ring still until it turns green; the route stays hidden until you confirm the floor.'
          : placement === 'steady'
            ? 'Hold the phone still. This stabilizes placement, not the building’s direction.'
            : 'Finding the room. Move the phone gently to look around.',
      action: null,
      leads: null,
    };
  }

  if (snapshot?.tier === 'frozen') {
    return {
      kind: 'rescan',
      note:
        snapshot.reason === 'off-route'
          ? 'You seem to have left the route. Leave AR and scan a check-in code to carry on.'
          : 'Your position is too uncertain to show the route. Leave AR and scan a check-in code.',
      action: null,
      leads: 'leave',
    };
  }

  if (snapshot?.reason === 'wrong-way') {
    return {
      kind: 'wrong-way',
      note: 'You are heading away from the route. Turn around.',
      action: REALIGN,
      leads: null,
    };
  }

  // Placed wherever the phone pointed; the route may well be beside or behind it.
  if (turnDegrees !== null && Math.abs(turnDegrees) > 120) {
    return {
      kind: 'turn-around',
      note: 'The route is behind you. Turn around.',
      action: REALIGN,
      leads: null,
    };
  }
  if (turnDegrees !== null && Math.abs(turnDegrees) > 45) {
    return {
      kind: 'turn',
      note: `Turn ${turnDegrees > 0 ? 'right' : 'left'} to see the route.`,
      action: REALIGN,
      leads: null,
    };
  }

  return { kind: 'guiding', note: null, action: REALIGN, leads: null };
}
