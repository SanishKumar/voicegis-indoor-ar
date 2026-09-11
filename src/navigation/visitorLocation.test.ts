import { describe, expect, it } from 'vitest';
import { ASTERION_PACKAGE } from '../test/venueFixtures';
import { checkInFromScan } from '../capture/anchorCheckIn';
import { resolveVisitorLocation } from './visitorLocation';

function checkpoint() {
  const anchor = ASTERION_PACKAGE.localizationAnchors.find((entry) => entry.kind === 'qr')!;
  const scan = checkInFromScan(
    anchor.payload,
    ASTERION_PACKAGE.localizationAnchors,
    ASTERION_PACKAGE.routing.nodes,
  );
  if (!scan.ok) throw new Error('Fixture check-in must resolve');
  return {
    anchor,
    state: {
      startNodeId: scan.nodeId,
      locationFloorId: anchor.floorId,
      locationBasis: 'qr' as const,
    },
    record: {
      anchorId: anchor.id,
      floorId: anchor.floorId,
      nodeId: scan.nodeId,
      distanceMeters: scan.distanceMeters,
    },
  };
}

describe('visitor location marker', () => {
  it('uses the exact QR anchor, not the nearest routing node or preview step', () => {
    const { state, record, anchor } = checkpoint();
    expect(resolveVisitorLocation(state, record, ASTERION_PACKAGE)).toMatchObject({
      position: anchor.position,
      floorId: anchor.floorId,
      basis: 'qr',
    });
  });
  it('never invents a marker for the venue default', () => {
    const { state, record } = checkpoint();
    expect(
      resolveVisitorLocation({ ...state, locationBasis: 'default' }, record, ASTERION_PACKAGE),
    ).toBeNull();
  });
  it('distinguishes a selected planning start from a measured checkpoint', () => {
    const { state } = checkpoint();
    const node = ASTERION_PACKAGE.routing.nodes.find((entry) => entry.id === state.startNodeId)!;
    expect(
      resolveVisitorLocation({ ...state, locationBasis: 'selected' }, null, ASTERION_PACKAGE),
    ).toMatchObject({ position: node.position, basis: 'selected' });
  });
  it('rejects a stale checkpoint from another start or floor', () => {
    const { state, record } = checkpoint();
    expect(
      resolveVisitorLocation({ ...state, startNodeId: 'different' }, record, ASTERION_PACKAGE),
    ).toBeNull();
    expect(
      resolveVisitorLocation({ ...state, locationFloorId: 'different' }, record, ASTERION_PACKAGE),
    ).toBeNull();
    expect(resolveVisitorLocation(state, null, ASTERION_PACKAGE)).toBeNull();
  });
});
