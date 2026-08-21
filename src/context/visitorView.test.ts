import { describe, expect, it } from 'vitest';
import { VISITOR_VIEW, visitorViewFor } from './visitorView';

/**
 * Regression for a blank visitor canvas.
 *
 * The inspector stored `spatial-twin` in shared navigation state. Returning to
 * the visitor surface then matched neither the map branch nor the camera
 * branch, so `<main>` rendered with zero children: no map, no camera, no error,
 * and both header toggles reporting `aria-pressed="false"`.
 */

describe('choosing what the visitor surface renders', () => {
  it('falls back to the map for a view the surface cannot render', () => {
    // The exact value that produced the empty canvas.
    expect(visitorViewFor('spatial-twin')).toBe(VISITOR_VIEW.MAP);
  });

  it('never returns nothing, whatever it is handed', () => {
    for (const value of [undefined, null, '', 'studio', 0, {}, [], 'MAP']) {
      expect([VISITOR_VIEW.MAP, VISITOR_VIEW.CAMERA_PREVIEW]).toContain(visitorViewFor(value));
    }
  });

  it('still honours the camera preview', () => {
    expect(visitorViewFor('camera-preview')).toBe(VISITOR_VIEW.CAMERA_PREVIEW);
    expect(visitorViewFor('map')).toBe(VISITOR_VIEW.MAP);
  });
});
