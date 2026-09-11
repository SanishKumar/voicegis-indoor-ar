import type { CompiledBuildingPackage } from '@voicegis/map-compiler';
import type { CheckInRecord } from '../capture/anchorCheckIn';
import type { VisitorJourneyState } from './visitorJourney';

export interface VisitorLocation {
  position: [number, number];
  floorId: string;
  basis: 'qr' | 'selected';
  label: string;
}

/** A checkpoint marker, never a live handset pose or a preview-step position. */
export function resolveVisitorLocation(
  state: Pick<VisitorJourneyState, 'startNodeId' | 'locationBasis' | 'locationFloorId'>,
  checkIn: CheckInRecord | null,
  pkg: CompiledBuildingPackage,
): VisitorLocation | null {
  if (state.locationBasis === 'default') return null;
  if (state.locationBasis === 'qr') {
    if (!checkIn || checkIn.nodeId !== state.startNodeId) return null;
    const anchor = pkg.localizationAnchors.find((entry) => entry.id === checkIn.anchorId);
    if (!anchor || anchor.floorId !== state.locationFloorId || anchor.floorId !== checkIn.floorId)
      return null;
    return {
      position: anchor.position,
      floorId: anchor.floorId,
      basis: 'qr',
      label: pkg.spaces.find((space) => space.id === anchor.spaceId)?.name ?? anchor.id,
    };
  }
  const node = pkg.routing.nodes.find((entry) => entry.id === state.startNodeId);
  if (!node || node.floorId !== state.locationFloorId) return null;
  return {
    position: node.position,
    floorId: node.floorId,
    basis: 'selected',
    label: 'Selected start',
  };
}
