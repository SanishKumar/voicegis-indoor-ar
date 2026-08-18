import { describe, expect, it } from 'vitest';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { readFileSync } from 'node:fs';
import { scannableAnchors, type AnchorLike } from './anchorCheckIn';

/**
 * The generated signs and the fallback decoder have to agree.
 *
 * `BarcodeDetector` is Chromium-only — Safari has none — so on an iPhone every
 * scan goes through jsQR. That makes the pairing of "what the generator prints"
 * with "what jsQR reads" a real contract, and one that no amount of testing the
 * two halves separately would check.
 *
 * Rasterised here rather than photographed, so this proves the encoding is
 * sound. It cannot speak for focus, glare or angle, which only a real sign can.
 */

/** Paints a QR matrix as RGBA pixels, the way a camera frame would arrive. */
async function rasterize(payload: string, modulePixels: number, quietModules: number) {
  const qr = QRCode.create(payload, { errorCorrectionLevel: 'M' });
  const size = qr.modules.size;
  const data = qr.modules.data;
  const edge = (size + quietModules * 2) * modulePixels;
  const pixels = new Uint8ClampedArray(edge * edge * 4).fill(255);

  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      if (data[row * size + column] === 0) continue;
      const originX = (column + quietModules) * modulePixels;
      const originY = (row + quietModules) * modulePixels;
      for (let y = 0; y < modulePixels; y += 1) {
        for (let x = 0; x < modulePixels; x += 1) {
          const offset = ((originY + y) * edge + originX + x) * 4;
          pixels[offset] = 0;
          pixels[offset + 1] = 0;
          pixels[offset + 2] = 0;
        }
      }
    }
  }
  return { pixels, edge };
}

function venueAnchors(venue: string): AnchorLike[] {
  const pkg = JSON.parse(
    readFileSync(`buildings/${venue}/compiled/building.package.json`, 'utf8'),
  ) as { localizationAnchors: AnchorLike[] };
  return scannableAnchors(pkg.localizationAnchors);
}

describe('a printed check-in code survives the decoder an iPhone will use', () => {
  it('round-trips every scannable payload the venues actually ship', async () => {
    const anchors = [
      ...venueAnchors('asterion-medical-center'),
      ...venueAnchors('reference-medical-centre'),
      ...venueAnchors('harbor-exchange'),
    ];
    expect(anchors.length).toBeGreaterThan(0);

    for (const anchor of anchors) {
      const { pixels, edge } = await rasterize(anchor.payload, 6, 2);
      const decoded = jsQR(pixels, edge, edge, { inversionAttempts: 'dontInvert' });
      expect(decoded?.data, anchor.id).toBe(anchor.payload);
    }
  });

  it('still reads at the small module size a crowded print sheet produces', async () => {
    const { pixels, edge } = await rasterize('voicegis://asterion/g/west', 3, 2);
    const decoded = jsQR(pixels, edge, edge, { inversionAttempts: 'dontInvert' });

    expect(decoded?.data).toBe('voicegis://asterion/g/west');
  });

  it('fails rather than inventing a payload when the quiet zone is gone', async () => {
    // A sign printed flush to a dark border is the classic unreadable code, and
    // the failure has to be a clean null: a decoder that guessed would check a
    // visitor in at the wrong end of the building.
    const { pixels, edge } = await rasterize('voicegis://asterion/g/west', 3, 0);
    const framed = new Uint8ClampedArray(pixels);
    for (let index = 0; index < edge * 4; index += 1) framed[index] = 0;

    const decoded = jsQR(framed, edge, edge, { inversionAttempts: 'dontInvert' });
    expect(decoded === null || decoded.data === 'voicegis://asterion/g/west').toBe(true);
  });
});
