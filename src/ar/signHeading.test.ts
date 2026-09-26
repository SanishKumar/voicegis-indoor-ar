import { describe, expect, it } from 'vitest';
import { signHeadingFrom } from './signHeading';
import type { OrientationReading } from './sharedOrientation';

const reading = (overrides: Partial<OrientationReading> = {}): OrientationReading => ({
  yawDegrees: 37,
  pitchDegrees: 4,
  rollDegrees: 0,
  epoch: 3,
  timeMs: 1_000,
  absolute: false,
  ...overrides,
});
const sign = { id: 'anchor-g-east', headingDegrees: 270 };

describe('an approximate direction from a scanned sign', () => {
  it('looks the opposite way to the sign, at the yaw the phone had for that frame', () => {
    expect(
      signHeadingFrom({ anchor: sign, venueKey: 'v', frameTimeMs: 1_040, reading: reading() }),
    ).toEqual({
      heading: {
        source: 'sign',
        anchorId: 'anchor-g-east',
        venueKey: 'v',
        // The sign faces west into the concourse; reading it, the camera looks east.
        planBearing: 90,
        yawDegrees: 37,
        epoch: 3,
        timeMs: 1_000,
      },
      refusal: null,
    });
  });

  it('sets no direction from a link, a sign without a facing, or no orientation for that frame', () => {
    const at = { anchor: sign, venueKey: 'v', reading: reading() };
    expect(signHeadingFrom({ ...at, frameTimeMs: null }).refusal).toBe('no-frame');
    expect(signHeadingFrom({ ...at, anchor: { id: 'x' }, frameTimeMs: 1_000 }).refusal).toBe(
      'no-sign-heading',
    );
    expect(signHeadingFrom({ ...at, frameTimeMs: 1_000, reading: null }).refusal).toBe(
      'no-orientation',
    );
    // A reading from well before or after the decoded frame did not describe it.
    expect(signHeadingFrom({ ...at, frameTimeMs: 1_200 }).refusal).toBe('no-orientation');
  });

  it('refuses a scan with the camera steeply tilted, where yaw no longer says which way someone faces', () => {
    expect(
      signHeadingFrom({
        anchor: sign,
        venueKey: 'v',
        frameTimeMs: 1_000,
        reading: reading({ pitchDegrees: -55 }),
      }).refusal,
    ).toBe('not-level');
  });
});
