import { describe, expect, it } from 'vitest';
import { venueDrawingBufferNeedsResize } from './venueScene';

describe('venue scene drawing-buffer sizing', () => {
  it('does not resize every frame when a high-DPR buffer already matches its CSS size', () => {
    expect(venueDrawingBufferNeedsResize(780, 480, 390, 240, 2)).toBe(false);
    expect(venueDrawingBufferNeedsResize(585, 360, 390, 240, 1.5)).toBe(false);
  });

  it('requests a resize when either the layout or the pixel ratio changed', () => {
    expect(venueDrawingBufferNeedsResize(390, 240, 390, 240, 2)).toBe(true);
    expect(venueDrawingBufferNeedsResize(780, 480, 400, 240, 2)).toBe(true);
    expect(venueDrawingBufferNeedsResize(780, 480, 390, 250, 2)).toBe(true);
  });

  it('matches Three.js integer drawing-buffer rounding', () => {
    expect(venueDrawingBufferNeedsResize(499, 333, 333, 222, 1.5)).toBe(false);
  });
});
