import type { CheckInRecord } from '../capture/anchorCheckIn';
import type { VisitorJourneyState } from '../navigation/visitorJourney';

/** Browsing can survive a camera visit, but not a newer check-in or chosen start. */
export function mapCheckpointKey(
  state: Pick<VisitorJourneyState, 'startNodeId' | 'locationBasis' | 'locationFloorId'>,
  checkIn: (CheckInRecord & { scannedAt?: number }) | null,
) {
  return JSON.stringify([
    state.startNodeId,
    state.locationBasis,
    state.locationFloorId,
    checkIn?.anchorId ?? null,
    checkIn?.scannedAt ?? null,
  ]);
}
