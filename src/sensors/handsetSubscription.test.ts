/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startHandsetSubscription, type HandsetAccessState } from './handsetSubscription';

beforeEach(() => {
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('DeviceMotionEvent', class {});
  vi.stubGlobal('DeviceOrientationEvent', class {});
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function callbacks() {
  return {
    onMotion: vi.fn(),
    onOrientation: vi.fn(),
    onState: vi.fn<(state: HandsetAccessState) => void>(),
  };
}
async function flush() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
function events() {
  window.dispatchEvent(new Event('deviceorientation'));
  window.dispatchEvent(new Event('devicemotion'));
}

describe('consent-owned handset subscription', () => {
  it('requests both permissions synchronously and attaches only after both resolve', async () => {
    let grant!: (value: string) => void;
    const motion = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          grant = resolve;
        }),
    );
    const orientation = vi.fn(async () => 'granted');
    vi.stubGlobal('DeviceMotionEvent', { requestPermission: motion });
    vi.stubGlobal('DeviceOrientationEvent', { requestPermission: orientation });
    const calls = callbacks();
    const dispose = startHandsetSubscription(calls);
    expect(motion).toHaveBeenCalledOnce();
    expect(orientation).toHaveBeenCalledOnce();
    events();
    expect(calls.onMotion).not.toHaveBeenCalled();
    grant('granted');
    await flush();
    events();
    expect(calls.onMotion).toHaveBeenCalledOnce();
    expect(calls.onOrientation).toHaveBeenCalledOnce();
    expect(calls.onState).toHaveBeenLastCalledWith('listening');
    dispose();
    events();
    expect(calls.onMotion).toHaveBeenCalledOnce();
  });

  it.each(['motion', 'orientation'] as const)(
    'a denied %s permission attaches neither channel',
    async (channel) => {
      vi.stubGlobal(channel === 'motion' ? 'DeviceMotionEvent' : 'DeviceOrientationEvent', {
        requestPermission: async () => 'denied',
      });
      const calls = callbacks();
      const dispose = startHandsetSubscription(calls);
      await flush();
      events();
      expect(calls.onState).toHaveBeenLastCalledWith('denied');
      expect(calls.onMotion).not.toHaveBeenCalled();
      expect(calls.onOrientation).not.toHaveBeenCalled();
      dispose();
    },
  );

  it.each(['dispose', 'hidden', 'pagehide'] as const)(
    'ignores a late grant after %s',
    async (action) => {
      let grant!: (value: string) => void;
      vi.stubGlobal('DeviceMotionEvent', {
        requestPermission: () =>
          new Promise<string>((resolve) => {
            grant = resolve;
          }),
      });
      const calls = callbacks();
      const dispose = startHandsetSubscription(calls);
      if (action === 'dispose') dispose();
      else if (action === 'pagehide') window.dispatchEvent(new Event('pagehide'));
      else {
        vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
        document.dispatchEvent(new Event('visibilitychange'));
      }
      vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
      document.dispatchEvent(new Event('visibilitychange'));
      grant('granted');
      await flush();
      events();
      expect(calls.onMotion).not.toHaveBeenCalled();
      expect(calls.onState.mock.calls.flat()).not.toContain('listening');
      dispose();
    },
  );

  it.each(['insecure', 'hidden', 'unsupported'] as const)(
    'refuses %s entry before any prompt',
    async (reason) => {
      const request = vi.fn(async () => 'granted');
      vi.stubGlobal('DeviceMotionEvent', { requestPermission: request });
      if (reason === 'insecure') vi.stubGlobal('isSecureContext', false);
      if (reason === 'hidden') vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
      if (reason === 'unsupported') vi.stubGlobal('DeviceOrientationEvent', undefined);
      const calls = callbacks();
      const dispose = startHandsetSubscription(calls);
      await flush();
      events();
      expect(request).not.toHaveBeenCalled();
      expect(calls.onMotion).not.toHaveBeenCalled();
      expect(calls.onState).toHaveBeenLastCalledWith(reason);
      dispose();
    },
  );

  it('detaches on a permission revocation when the browser exposes it', async () => {
    const status = Object.assign(new EventTarget(), { state: 'granted' });
    vi.stubGlobal('navigator', { permissions: { query: vi.fn(async () => status) } });
    const calls = callbacks();
    const dispose = startHandsetSubscription(calls);
    await flush();
    events();
    expect(calls.onMotion).toHaveBeenCalledOnce();
    status.state = 'denied';
    status.dispatchEvent(new Event('change'));
    events();
    expect(calls.onState).toHaveBeenLastCalledWith('denied');
    expect(calls.onMotion).toHaveBeenCalledOnce();
    dispose();
  });

  it('does not attach permission listeners after disposal while the query is pending', async () => {
    const status = Object.assign(new EventTarget(), { state: 'granted' });
    const attach = vi.spyOn(status, 'addEventListener');
    let resolve!: (value: typeof status) => void;
    const pending = new Promise<typeof status>((done) => {
      resolve = done;
    });
    vi.stubGlobal('navigator', { permissions: { query: () => pending } });
    const calls = callbacks();
    const dispose = startHandsetSubscription(calls);
    await flush();
    dispose();
    resolve(status);
    await flush();
    expect(attach).not.toHaveBeenCalled();
  });

  it('keeps unsupported permission queries distinct from denial and contains handler errors', async () => {
    vi.stubGlobal('navigator', {
      permissions: {
        query: async () => {
          throw new Error('Unsupported permission name');
        },
      },
    });
    const calls = callbacks();
    calls.onMotion.mockImplementation(() => {
      throw new Error('Bad input clock');
    });
    const dispose = startHandsetSubscription(calls);
    await flush();
    events();
    events();
    expect(calls.onState).toHaveBeenLastCalledWith('error');
    expect(calls.onMotion).toHaveBeenCalledOnce();
    dispose();
  });
});
