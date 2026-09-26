/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import QRCode from 'qrcode';
import { createQrDecoder } from './qrDecoder';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const square = [
  { x: 100, y: 60 },
  { x: 200, y: 60 },
  { x: 200, y: 160 },
  { x: 100, y: 160 },
];
function video(width = 1280, height = 721) {
  const element = document.createElement('video');
  Object.defineProperties(element, {
    videoWidth: { value: width, configurable: true },
    videoHeight: { value: height, configurable: true },
    currentTime: { value: 4, configurable: true },
  });
  return element;
}
function canvas(image?: ImageData) {
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage,
    getImageData: () => image,
  } as unknown as CanvasRenderingContext2D);
  return drawImage;
}
function native(detect: (source: CanvasImageSource) => Promise<unknown[]>) {
  vi.stubGlobal(
    'BarcodeDetector',
    class {
      detect = detect;
    },
  );
}

describe('QR frame observations', () => {
  it('pairs native geometry with immutable copied pixels, not decode completion or a live video', async () => {
    let finish!: (codes: unknown[]) => void;
    const detect = vi.fn<(source: CanvasImageSource) => Promise<unknown[]>>(
      () =>
        new Promise<unknown[]>((resolve) => {
          finish = resolve;
        }),
    );
    native(detect);
    canvas();
    const clock = vi.spyOn(performance, 'now').mockReturnValue(100);
    const source = video();
    const pending = createQrDecoder().decodeFrame(source);
    const copied = detect.mock.calls[0]?.[0] as unknown as HTMLCanvasElement;
    expect(copied).toBeInstanceOf(HTMLCanvasElement);
    expect(copied.width).toBe(640);
    expect(copied.height).toBe(361);
    clock.mockReturnValue(900);
    Object.defineProperty(source, 'videoWidth', { value: 640 });
    finish([{ rawValue: ' code ', cornerPoints: square }]);
    const result = await pending;
    expect(result?.frame).toEqual({
      width: 1280,
      height: 721,
      decodeWidth: 640,
      decodeHeight: 361,
      copiedAtMs: 100,
      mediaTimeSeconds: 4,
    });
    expect(result?.payload).toBe('code');
    expect(result?.cornerOrder).toBe('image-clockwise');
    expect(result?.corners?.[0]).toEqual({ x: 200, y: (60 * 721) / 361 });
    expect(result?.corners?.[0]).not.toBe(square[0]);
  });

  it.each([
    undefined,
    [],
    square.slice(1),
    [square[0], square[2], square[1], square[3]],
    [{ x: NaN, y: 10 }, ...square.slice(1)],
    [{ x: -1, y: 10 }, ...square.slice(1)],
    [{ x: 1000, y: 10 }, ...square.slice(1)],
    [square[0], square[0], square[2], square[3]],
  ])('keeps payload-only check-ins usable when corners are unusable (%j)', async (corners) => {
    native(async () => [{ rawValue: 'code', cornerPoints: corners }]);
    canvas();
    const decoder = createQrDecoder();
    expect(await decoder.decodeFrame(video())).toMatchObject({ payload: 'code', corners: null });
    expect(await decoder.decode(video())).toBe('code');
  });

  it('does not send an unready video to a decoder', async () => {
    const detect = vi.fn(async () => []);
    native(detect);
    canvas();
    expect(await createQrDecoder().decodeFrame(video(0, 0))).toBeNull();
    expect(detect).not.toHaveBeenCalled();
  });

  it('preserves semantic jsQR corners using an actual decoded raster', async () => {
    vi.stubGlobal('BarcodeDetector', undefined);
    const code = QRCode.create('voicegis://test/g/sign', { errorCorrectionLevel: 'M' });
    const scale = 5;
    const size = (code.modules.size + 8) * scale;
    const data = new Uint8ClampedArray(size * size * 4).fill(255);
    for (let y = 0; y < size; y += 1)
      for (let x = 0; x < size; x += 1) {
        const mx = Math.floor(x / scale) - 4;
        const my = Math.floor(y / scale) - 4;
        if (
          mx >= 0 &&
          my >= 0 &&
          mx < code.modules.size &&
          my < code.modules.size &&
          code.modules.get(my, mx)
        ) {
          const at = (y * size + x) * 4;
          data[at] = data[at + 1] = data[at + 2] = 0;
        }
      }
    canvas({ data, width: size, height: size } as ImageData);
    const result = await createQrDecoder().decodeFrame(video(size, size));
    expect(result).toMatchObject({
      payload: 'voicegis://test/g/sign',
      engine: 'jsqr',
      cornerOrder: 'qr-clockwise',
    });
    expect(result?.corners).toHaveLength(4);
    expect(result?.corners?.[0].x).toBeCloseTo(20, 0);
    expect(result?.corners?.[0].y).toBeCloseTo(20, 0);
    expect(result?.corners?.[2].x).toBeCloseTo(size - 20, 0);
    expect(result?.corners?.[2].y).toBeCloseTo(size - 20, 0);
  });
});
