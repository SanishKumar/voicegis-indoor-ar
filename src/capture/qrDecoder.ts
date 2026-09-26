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
  /** Geometry from the same frozen image as the payload; not a measured pose. */
  decodeFrame(video: HTMLVideoElement): Promise<QrFrameObservation | null>;
}

export interface QrImagePoint {
  x: number;
  y: number;
}

export interface QrFrameObservation {
  payload: string;
  engine: QrDecoder['engine'];
  /** Pixels in the original video frame, never CSS/display coordinates. */
  corners: readonly [QrImagePoint, QrImagePoint, QrImagePoint, QrImagePoint] | null;
  /** Native top-left is image-relative; only jsQR identifies the code's printed orientation. */
  cornerOrder: 'image-clockwise' | 'qr-clockwise';
  frame: {
    width: number;
    height: number;
    decodeWidth: number;
    decodeHeight: number;
    /** Monotonic time when pixels were copied, NOT exposure time or pose time. */
    copiedAtMs: number;
    mediaTimeSeconds: number;
  };
}

interface DetectedBarcode {
  rawValue: string;
  cornerPoints?: QrImagePoint[];
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
 * The longest edge the decoders work over. Both see the exact copied image
 * described in the observation, with coordinates mapped back to video pixels.
 *
 * jsQR cost scales with pixel count, and a full-resolution phone frame is
 * several megapixels — enough to stall the main thread between frames. A code
 * that fills a reasonable part of the viewfinder is still comfortably legible
 * at this size.
 */
const MAX_DECODE_EDGE = 640;

function copyFrame(video: HTMLVideoElement) {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0)
    return null;

  const scale = Math.min(1, MAX_DECODE_EDGE / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) return null;
  const copiedAtMs = performance.now();
  const mediaTimeSeconds = video.currentTime;
  context.drawImage(video, 0, 0, targetWidth, targetHeight);
  return {
    canvas,
    context,
    frame: {
      width,
      height,
      decodeWidth: targetWidth,
      decodeHeight: targetHeight,
      copiedAtMs,
      mediaTimeSeconds,
    },
  };
}

/** Reject malformed geometry without rejecting a perfectly usable location code. */
function frameCorners(
  points: readonly QrImagePoint[] | undefined,
  frame: QrFrameObservation['frame'],
): QrFrameObservation['corners'] {
  if (!points || points.length !== 4) return null;
  if (
    points.some(
      ({ x, y }) =>
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        x < 0 ||
        y < 0 ||
        x > frame.decodeWidth ||
        y > frame.decodeHeight,
    )
  )
    return null;
  // A convex clockwise quadrilateral in image coordinates (+Y down).
  for (let i = 0; i < 4; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % 4];
    const c = points[(i + 2) % 4];
    if ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) <= 0) return null;
  }
  return points.map(({ x, y }) => ({
    // Rounding the decode dimensions can make these two scales different.
    x: (x * frame.width) / frame.decodeWidth,
    y: (y * frame.height) / frame.decodeHeight,
  })) as unknown as QrFrameObservation['corners'];
}

export function createQrDecoder(): QrDecoder {
  const Native = nativeDetector();
  const detector = Native === undefined ? null : new Native({ formats: ['qr_code'] });
  const engine = detector === null ? 'jsqr' : 'barcode-detector';
  const decodeFrame = async (video: HTMLVideoElement): Promise<QrFrameObservation | null> => {
    // Own the exact pixel image and dimensions through asynchronous decoding.
    // copiedAtMs is deliberately not labelled as the camera's exposure time.
    const copied = copyFrame(video);
    if (!copied) return null;
    const { canvas, context, frame } = copied;
    if (detector !== null) {
      const code = (await detector.detect(canvas))[0];
      const payload = code?.rawValue?.trim();
      return payload
        ? {
            payload,
            engine,
            frame,
            corners: frameCorners(code.cornerPoints, frame),
            cornerOrder: 'image-clockwise',
          }
        : null;
    }
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const found = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });
    const payload = found?.data.trim();
    if (!found || !payload) return null;
    const { topLeftCorner, topRightCorner, bottomRightCorner, bottomLeftCorner } = found.location;
    return {
      payload,
      engine,
      frame,
      cornerOrder: 'qr-clockwise',
      corners: frameCorners(
        [topLeftCorner, topRightCorner, bottomRightCorner, bottomLeftCorner],
        frame,
      ),
    };
  };
  return {
    engine,
    decodeFrame,
    decode: async (video) => (await decodeFrame(video))?.payload ?? null,
  };
}
