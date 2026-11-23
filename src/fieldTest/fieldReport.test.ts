/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { probeHandset } from './fieldReport';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'xr');
  Reflect.deleteProperty(navigator, 'mediaDevices');
});

function mockXr(isSessionSupported: (mode: string) => Promise<boolean>) {
  const requestSession = vi.fn();
  Object.defineProperty(navigator, 'xr', {
    value: { isSessionSupported, requestSession },
    configurable: true,
  });
  return requestSession;
}

describe('permission-free handset report', () => {
  it.each([true, false])(
    'reports advertised AR support %s without starting any sensors',
    async (supported) => {
      vi.useFakeTimers();
      const support = vi.fn().mockResolvedValue(supported);
      const requestSession = mockXr(support);
      const requestPermission = vi.fn();
      const getUserMedia = vi.fn();
      vi.stubGlobal('DeviceMotionEvent', { requestPermission });
      vi.stubGlobal('DeviceOrientationEvent', { requestPermission });
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia },
        configurable: true,
      });
      const facts = await probeHandset();
      expect(facts.immersiveAr).toBe(supported ? 'yes' : 'no');
      expect(facts.motionAsks).toBe(true);
      expect(facts.orientationAsks).toBe(true);
      expect(facts.camera).toBe(true);
      expect(support).toHaveBeenCalledWith('immersive-ar');
      expect(requestSession).not.toHaveBeenCalled();
      expect(requestPermission).not.toHaveBeenCalled();
      expect(getUserMedia).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('distinguishes a missing WebXR API from a failed support check', async () => {
    expect((await probeHandset()).immersiveAr).toBe('no-webxr');
    mockXr(vi.fn().mockRejectedValue(new Error('Device unavailable')));
    expect((await probeHandset()).immersiveAr).toBe('unknown');
  });

  it('returns the other phone facts when the platform check hangs, ignoring a late answer', async () => {
    vi.useFakeTimers();
    let finish!: (supported: boolean) => void;
    mockXr(() => new Promise<boolean>((resolve) => (finish = resolve)));
    const report = probeHandset();
    await vi.advanceTimersByTimeAsync(2_000);
    const facts = await report;
    expect(facts.immersiveAr).toBe('unknown');
    expect(facts.userAgent).toBe(navigator.userAgent);
    expect(facts.screen).toContain('×');
    finish(true);
    await Promise.resolve();
    expect(facts.immersiveAr).toBe('unknown');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('contains a synchronous platform exception too', async () => {
    mockXr(() => {
      throw new Error('Policy blocked the query');
    });
    expect((await probeHandset()).immersiveAr).toBe('unknown');
  });
});
