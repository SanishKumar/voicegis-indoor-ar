import { describe, expect, it } from 'vitest';
import { alignedCameraHeading } from './alignedCameraHeading';
import type { FacingAnchor } from './facingFrom';

const anchor: FacingAnchor = {
  source: 'visitor',
  yawDegrees: 0,
  planBearing: 90,
  epoch: 1,
  axis: 'camera-forward',
};
const reading = { yawDegrees: 180, pitchDegrees: -30, epoch: 1, timeMs: 100 };
describe('explicit manual camera heading bridge', () => {
  it('carries a turn around instead of forcing the route to point ahead', () => {
    expect(alignedCameraHeading(reading, anchor, 100)).toBe(270);
  });
  it('refuses route assumptions and a missing calibration', () => {
    expect(alignedCameraHeading(reading, null, 100)).toBeNull();
    expect(alignedCameraHeading(reading, { ...anchor, source: 'route' }, 100)).toBeNull();
    expect(alignedCameraHeading(reading, { ...anchor, axis: 'device-top' }, 100)).toBeNull();
    expect(alignedCameraHeading(reading, { ...anchor, axis: undefined }, 100)).toBeNull();
  });
  it.each([99, 201, Infinity, NaN])('refuses stale or invalid times (%s)', (now) => {
    expect(alignedCameraHeading(reading, anchor, now)).toBeNull();
  });
  it('refuses sensor restarts, invalid angles and near-vertical axis substitutions', () => {
    expect(alignedCameraHeading({ ...reading, epoch: 2 }, anchor, 100)).toBeNull();
    expect(alignedCameraHeading({ ...reading, yawDegrees: NaN }, anchor, 100)).toBeNull();
    expect(alignedCameraHeading({ ...reading, pitchDegrees: -90 }, anchor, 100)).toBeNull();
    expect(alignedCameraHeading(null, anchor, 100)).toBeNull();
  });
});
