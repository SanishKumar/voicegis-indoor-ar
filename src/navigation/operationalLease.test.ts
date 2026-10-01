import { describe, expect, it } from 'vitest';
import fixture from '../../buildings/asterion-medical-center/operations/all-public-lifts-closed.overlay.json';
import { ASTERION_PACKAGE } from '../test/venueFixtures';
import { copyOperationalOverlay, createOperationalLease } from './operationalLease';

const wall = Date.parse('2026-07-22T12:00:00Z');
const overlay = { ...fixture, validUntil: new Date(wall + 10_000).toISOString() };
const lease = (value: unknown = overlay) =>
  createOperationalLease(value, ASTERION_PACKAGE, wall, 1000);

describe('operational policy local expiry lease', () => {
  it('expires exactly at validUntil without extending a timer after expiry', () => {
    const policy = lease();
    expect(policy.read(wall, 1000).status).toBe('current');
    expect(policy.read(wall + 9999, 10999).status).toBe('current');
    expect(policy.delay(wall + 9999, 10999)).toBe(1);
    expect(policy.read(wall + 10000, 11000)).toMatchObject({
      status: 'unavailable',
      reason: 'overlay-expired',
    });
    expect(policy.delay(wall + 10000, 11000)).toBe(1000);
  });
  it('cannot outlive its monotonic deadline under small wall-clock corrections', () => {
    const policy = lease();
    policy.read(wall + 9900, 10900);
    expect(policy.read(wall + 9500, 11000).reason).toBe('overlay-expired');
  });
  it.each(['wall', 'monotonic'] as const)(
    'latches a broken %s clock rather than reviving guidance',
    (clock) => {
      const policy = lease();
      policy.read(wall, 1000);
      expect(
        policy.read(clock === 'wall' ? wall - 2000 : wall, clock === 'wall' ? 1001 : 999).reason,
      ).toBe('clock-unreliable');
      expect(policy.read(wall + 2000, 3000).status).toBe('unavailable');
    },
  );
  it.each([NaN, Infinity, 1e20])('rejects an invalid wall clock %s without throwing', (now) => {
    expect(lease().read(now, 1000)).toMatchObject({
      status: 'unavailable',
      reason: 'clock-unreliable',
    });
  });
  it('keeps package/shape/target rejection even when the interval is current', () => {
    expect(lease({ ...overlay, packageHash: 'wrong' }).read(wall, 1000).status).toBe('unavailable');
    expect(
      lease({
        ...overlay,
        closures: [{ ...overlay.closures[0], target: { type: 'source', id: 'absent' } }],
      }).read(wall, 1000).reason,
    ).toBe('unknown-target');
    expect(lease({ id: 'partial' }).read(wall, 1000).reason).toBe('invalid-shape');
  });
  it('can recognize a future policy becoming active without reviving an expired lease', () => {
    const policy = lease({ ...overlay, validFrom: new Date(wall + 5000).toISOString() });
    expect(policy.read(wall, 1000).reason).toBe('overlay-not-active');
    expect(policy.read(wall + 5000, 6000).status).toBe('current');
    expect(policy.read(wall + 10000, 11000).reason).toBe('overlay-expired');
  });
  it('owns nested closure targets so caller mutation cannot change pending requests', () => {
    const input = structuredClone(overlay);
    const copy = copyOperationalOverlay(input);
    input.closures[0].target.id = 'changed';
    expect(copy).toEqual(overlay);
    expect(copy).not.toBe(input);
    expect(Object.isFrozen(copy)).toBe(true);
  });
});
