import type { CheckInFailure } from './anchorCheckIn';

/**
 * What a visitor is told when a scan does not check them in.
 *
 * One phrasing, in one place. The onboarding flow and the location picker both
 * show these, and two copies of a user-facing sentence drift the moment either
 * is edited.
 *
 * Each says what happened rather than what went wrong internally: someone
 * holding a phone at a wall cannot act on the word "payload", but they can act
 * on being told the sticker they scanned is not one of this building's codes.
 */
export function scanProblemText(reason: CheckInFailure): string {
  switch (reason) {
    case 'unknown-code':
      return 'That code is not one of this venue\u2019s check-in points.';
    case 'not-a-checkin-code':
      return 'That marker is not a check-in code.';
    case 'no-node-on-floor':
      return 'That code has no routable path on its floor.';
  }
}
