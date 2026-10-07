import { describe, expect, it } from 'vitest';
import { mapCheckpointKey } from './visitorMapMemory';

describe('map browsing checkpoint identity', () => {
  const state = {
    startNodeId: 'space:e-entrance',
    locationBasis: 'qr' as const,
    locationFloorId: 'g',
  };
  const checkIn = {
    anchorId: 'anchor-emergency',
    floorId: 'g',
    nodeId: state.startNodeId,
    distanceMeters: 1,
    scannedAt: 1000,
  };

  it('retains the same check-in through a presentation-only round trip', () => {
    expect(mapCheckpointKey({ ...state }, { ...checkIn })).toBe(mapCheckpointKey(state, checkIn));
  });

  it('invalidates an old browsing view when the same sign is scanned again', () => {
    expect(mapCheckpointKey(state, { ...checkIn, scannedAt: 2000 })).not.toBe(
      mapCheckpointKey(state, checkIn),
    );
  });

  it('invalidates a changed floor, selected start or location basis', () => {
    for (const changed of [
      { ...state, locationFloorId: 'l1' },
      { ...state, startNodeId: 'space:other-start' },
      { ...state, locationBasis: 'selected' as const },
    ]) {
      expect(mapCheckpointKey(changed, checkIn)).not.toBe(mapCheckpointKey(state, checkIn));
    }
  });
});
