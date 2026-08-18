import jsQR from 'jsqr';

/**
 * Reading a QR code out of a video frame, on whatever the phone happens to be.
 *
 * Two decoders, because one is not enough in practice. `BarcodeDetector` is the
 * platform's own and is much the faster of the two, but it is a Chromium
 * feature: Safari does not implement it at all, so on an iPhone — the device
 * most likely to be pointed at a sign — it simply is not there. Relying on it
 * alone meant the scanner reported "this browser cannot decode QR codes" on
 * exactly the demo everyone reaches for first.
 *
 * jsQR is the fallback. It is slower because it runs in JavaScript over pixel
 * data, which is why it is not simply used everywhere.
 */

export interface QrDecoder {
  /** The implementation in use, for diagnostics and for saying so on screen. */
  readonly engine: 'barcode-detector' | 'jsqr';
  decode(video: HTMLVideoElement): Promise<string | null>;
}

interface DetectedBarcode {
  rawValue: string;
}

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}

interface BarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
}

function nativeDetector(): BarcodeDetectorConstructor | undefined {
  return (globalThis as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
}

/**
 * The longest edge the fallback decoder works over.
 *
 * jsQR cost scales with pixel count, and a full-resolution phone frame is
 * several megapixels — enough to stall the main thread between frames. A code
 * that fills a reasonable part of the viewfinder is still comfortably legible
 * at this size.
 */
const MAX_DECODE_EDGE = 640;

function frameToImageData(video: HTMLVideoElement): ImageData | null {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (width === 0 || height === 0) return null;

  const scale = Math.min(1, MAX_DECODE_EDGE / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) return null;
  context.drawImage(video, 0, 0, targetWidth, targetHeight);
  return context.getImageData(0, 0, targetWidth, targetHeight);
}

export function createQrDecoder(): QrDecoder {
  const Native = nativeDetector();

  if (Native !== undefined) {
    const detector = new Native({ formats: ['qr_code'] });
    return {
      engine: 'barcode-detector',
      async decode(video) {
        const codes = await detector.detect(video);
        return codes[0]?.rawValue?.trim() || null;
      },
    };
  }

  return {
    engine: 'jsqr',
    async decode(video) {
      const image = frameToImageData(video);
      if (image === null) return null;
      // `dontInvert` keeps it to dark-on-light, which is what a printed sign
      // is, and roughly halves the work per frame.
      const found = jsQR(image.data, image.width, image.height, {
        inversionAttempts: 'dontInvert',
      });
      return found?.data.trim() || null;
    },
  };
}
