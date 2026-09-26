import { describe, expect, it } from 'vitest';
import { bindVisualCheckIn } from './visualCheckIn';
import type { QrFrameObservation } from './qrDecoder';

const anchor = { id: 'sign', payload: 'venue/sign', headingDegrees: 180 };
const observation: QrFrameObservation = {
  payload: anchor.payload,
  engine: 'jsqr',
  cornerOrder: 'qr-clockwise',
  corners: [
    { x: 10, y: 10 },
    { x: 110, y: 10 },
    { x: 110, y: 110 },
    { x: 10, y: 110 },
  ],
  frame: {
    width: 640,
    height: 480,
    decodeWidth: 640,
    decodeHeight: 480,
    copiedAtMs: 100,
    mediaTimeSeconds: 2,
  },
};
describe('visual check-in is distinct from payload position', () => {
  it('binds geometry to the exact package revision and sign without granting heading', () => {
    const bound = bindVisualCheckIn(observation, anchor, 'venue:revision-a', 101)!;
    expect(bound).toMatchObject({
      venueKey: 'venue:revision-a',
      anchorId: 'sign',
      status: 'unqualified',
    });
    expect(bound).not.toHaveProperty('headingDegrees');
    expect(bound.observation).toEqual(observation);
    expect(bound.observation.frame).not.toBe(observation.frame);
    expect(bound.observation.corners?.[0]).not.toBe(observation.corners?.[0]);
  });
  it.each([99, 601, NaN, Infinity])('rejects invalid or stale copy time at %s', (now) => {
    expect(bindVisualCheckIn(observation, anchor, 'venue:a', now)).toBeNull();
  });
  it('accepts no geometry from links, another payload, or an unidentified venue', () => {
    expect(bindVisualCheckIn(null, anchor, 'venue:a', 101)).toBeNull();
    expect(
      bindVisualCheckIn(observation, { ...anchor, payload: 'other' }, 'venue:a', 101),
    ).toBeNull();
    expect(bindVisualCheckIn(observation, anchor, '', 101)).toBeNull();
  });
});
