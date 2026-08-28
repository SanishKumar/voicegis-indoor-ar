import { describe, expect, it } from 'vitest';
import { readCachedVenuePointer } from './packageCacheRuntime';

function storage(value: string | null) {
  return { getItem: () => value };
}

describe('offline venue pointer', () => {
  it('accepts only a complete pointer with a full SHA-256 digest', () => {
    const pointer = {
      buildingId: 'asterion-medical-center',
      contentHash: 'a'.repeat(64),
      source: '/venues/asterion-medical-center.package.json',
    };

    expect(readCachedVenuePointer(false, storage(JSON.stringify(pointer)))).toEqual(pointer);
    expect(
      readCachedVenuePointer(false, storage(JSON.stringify({ ...pointer, contentHash: 'short' }))),
    ).toBeNull();
    expect(readCachedVenuePointer(false, storage('{not json'))).toBeNull();
  });
});
