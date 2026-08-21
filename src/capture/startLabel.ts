import { describeCheckIn, type CheckInRecord } from './anchorCheckIn';

/**
 * What to call the visitor's starting point.
 *
 * A check-in resolves to the nearest *routable* node, which is usually a
 * corridor waypoint rather than a room, and waypoints carry no POI. Labelling
 * from the POI alone therefore printed "Choose a starting point" immediately
 * after a successful scan — the app had just resolved a check-in and was
 * reporting that it had none.
 *
 * The check-in is only allowed to name the start while it still *is* the start.
 * Once someone picks a landmark by hand the node changes, and a check-in left
 * labelling it would describe a place they walked away from.
 */
export function startPointLabel(
  start: { id?: string; poi?: { name?: string } | null } | null | undefined,
  checkIn: (CheckInRecord & { scannedAt?: number }) | null | undefined,
  names: { space(id: string): string | null; floor(id: string): string | null },
  fallback: string,
): string {
  const poiName = start?.poi?.name;
  if (poiName) return poiName;
  if (checkIn && start?.id === checkIn.nodeId) return describeCheckIn(checkIn, names).place;
  return fallback;
}
