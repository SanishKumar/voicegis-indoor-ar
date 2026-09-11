import { AlertTriangle, MapPin, X } from 'lucide-react';
import { useNavigation } from '../context/NavigationContext.jsx';
import { describeCheckIn, type CheckInRecord } from '../capture/anchorCheckIn';
import { scanProblemText } from '../capture/scanProblemText';
import type { CheckInFailure } from '../capture/anchorCheckIn';

/**
 * Confirms a check-in landed, and where.
 *
 * Without this a successful scan closed the scanner and silently moved on, so
 * the one moment the product is actually doing something — deciding where you
 * are from a photograph of a sticker — was invisible. A visitor could not tell
 * a good scan from a mis-scan, and neither could anyone watching.
 *
 * It names the anchor as well as the space because space names do not identify
 * a code; see `describeCheckIn`.
 *
 * It stays until dismissed. A timed toast was tried first and was wrong twice
 * over: it removed the one piece of evidence a demo is built around before
 * anyone could point at it, and a behaviour that only exists for seven seconds
 * cannot be checked by anything except watching for it.
 */

interface NavigationBinding {
  checkInToastVisible: boolean;
  checkIn: (CheckInRecord & { scannedAt: number }) | null;
  checkInProblem: { reason: CheckInFailure; venueName: string } | null;
  actions: { dismissCheckIn: () => void };
  venue: {
    getSpaceById(id: string): { name?: string } | null;
    getFloorById(id: string): { name?: string } | null;
  };
}

export default function CheckInToast() {
  const { checkIn, checkInToastVisible, checkInProblem, actions, venue } =
    useNavigation() as NavigationBinding;
  const dismiss = actions.dismissCheckIn;

  // A check-in link this venue could not honour. Shown rather than swallowed:
  // the codes of every venue look alike, so opening one building's link while
  // another is active is the obvious mistake, and it used to land silently at
  // the default start.
  if (checkInProblem !== null) {
    return (
      <div className="checkin-toast checkin-toast-problem" role="alert">
        <span className="checkin-toast-icon" aria-hidden="true">
          <AlertTriangle size={16} />
        </span>
        <span className="checkin-toast-body">
          <strong>That check-in link did not work here</strong>
          <span className="checkin-toast-detail">
            {scanProblemText(checkInProblem.reason)} Active venue: {checkInProblem.venueName}.
          </span>
        </span>
        <button
          type="button"
          className="checkin-toast-close"
          onClick={dismiss}
          aria-label="Dismiss"
        >
          <X size={15} />
        </button>
      </div>
    );
  }

  if (!checkIn || !checkInToastVisible) return null;

  const label = describeCheckIn(checkIn, {
    space: (id) => venue.getSpaceById(id)?.name ?? null,
    floor: (id) => venue.getFloorById(id)?.name ?? null,
  });

  return (
    <div className="checkin-toast" role="status">
      <span className="checkin-toast-icon" aria-hidden="true">
        <MapPin size={16} />
      </span>
      <span className="checkin-toast-body">
        <strong>Checked in at {label.place}</strong>
        <span className="checkin-toast-detail">{label.detail}</span>
      </span>
      <button type="button" className="checkin-toast-close" onClick={dismiss} aria-label="Dismiss">
        <X size={15} />
      </button>
    </div>
  );
}
