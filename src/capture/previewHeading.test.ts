import { describe, expect, it } from 'vitest';
import { readPreviewHeading, type PreviewOrientationEvent } from './previewHeading';

describe('browser heading reference boundary', () => {
  it.each([
    [{ alpha: 270, absolute: false }, 'Relative only'],
    [{ alpha: 270 }, 'Relative only'],
    [{ alpha: 270, absolute: true }, 'Uncalibrated'],
    [{ webkitCompassHeading: 90, webkitCompassAccuracy: 5 }, 'Uncalibrated'],
    [{ webkitCompassHeading: 0, webkitCompassAccuracy: 0 }, 'Uncalibrated'],
    [{ webkitCompassHeading: 360 }, 'Uncalibrated'],
    [{ webkitCompassHeading: -1, alpha: 270 }, 'Unavailable'],
    [{ webkitCompassHeading: null, alpha: 270 }, 'Unavailable'],
    [{ webkitCompassHeading: Infinity, alpha: 270 }, 'Unavailable'],
    [{ webkitCompassHeading: 90, webkitCompassAccuracy: -1 }, 'Unavailable'],
    [{ webkitCompassHeading: 90, webkitCompassAccuracy: NaN }, 'Unavailable'],
    [{ alpha: null }, 'Unavailable'],
    [{ alpha: NaN }, 'Unavailable'],
    [{ alpha: 360 }, 'Unavailable'],
  ] as Array<[Partial<PreviewOrientationEvent>, string]>)(
    'keeps unsupported input non-directional %#',
    (event, label) => {
      const result = readPreviewHeading({ timeStamp: 100, ...event }, 101, 'venue');
      expect(result.label).toBe(label);
      expect(result.planHeading.status).toBe('unknown');
    },
  );

  it.each([-1, NaN, Infinity, 10_000, 1_700_000_000_000])(
    'rejects incompatible occurrence timestamps %s',
    (timeStamp) => {
      expect(
        readPreviewHeading({ timeStamp, webkitCompassHeading: 90 }, 101, 'venue'),
      ).toMatchObject({
        label: 'Unavailable',
        planHeading: { status: 'unknown', reason: 'invalid-reading' },
      });
    },
  );

  it('ages the event occurrence, not the moment a delayed event arrived', () => {
    expect(
      readPreviewHeading({ timeStamp: 100, webkitCompassHeading: 90 }, 2_101, 'venue'),
    ).toMatchObject({
      label: 'Stale',
      planHeading: { status: 'unknown', reason: 'stale' },
    });
  });
});
