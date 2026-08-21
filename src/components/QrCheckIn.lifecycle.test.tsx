/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import QrCheckIn from './QrCheckIn';

/**
 * Regression for camera ownership across effect runs.
 *
 * The scanner opens the camera asynchronously and every step of that —
 * getUserMedia, play, decode — resolves on a later tick. A generation token
 * stopped a stale run *proceeding*, but the run released the camera through
 * refs shared with every other run of the same component, so a continuation
 * belonging to a closed scanner could stop a camera a restarted one had just
 * opened.
 *
 * The first version of this file was vacuous: it unmounted one component and
 * rendered another, and two component instances never share refs, so it passed
 * against the very implementation it was meant to catch. The effect has to be
 * restarted *on the same mounted component*, which is what changing
 * `onPayload` — the effect's only dependency — does here.
 */

let nextDecode: () => Promise<string | null> = () => Promise.resolve(null);

vi.mock('../capture/qrDecoder', () => ({
  createQrDecoder: () => ({ engine: 'jsqr' as const, decode: () => nextDecode() }),
}));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function fakeStream() {
  const track = { stop: vi.fn() };
  return { track, stream: { getTracks: () => [track] } as unknown as MediaStream };
}

/** Camera and playback whose resolution the test drives, one call at a time. */
function fakeMedia() {
  const cameras: Array<Deferred<MediaStream>> = [];
  const streams: Array<ReturnType<typeof fakeStream>> = [];
  const plays: Array<Deferred<void>> = [];

  const getUserMedia = vi.fn(() => {
    const made = fakeStream();
    const pending = deferred<MediaStream>();
    streams.push(made);
    cameras.push(pending);
    return pending.promise;
  });

  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });

  // jsdom leaves play() unimplemented, so without this the deferred-play
  // branch — the one the ownership bug lived in — is never reached at all.
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: () => {
      const pending = deferred<void>();
      plays.push(pending);
      return pending.promise;
    },
  });

  const flush = async () => {
    await act(async () => {
      for (let index = 0; index < 4; index += 1) await Promise.resolve();
    });
  };

  return {
    getUserMedia,
    streams,
    playCount: () => plays.length,
    flush,
    async openCamera(index: number) {
      cameras[index].resolve(streams[index].stream);
      await flush();
    },
    async startPlaying(index: number) {
      plays[index].resolve();
      await flush();
    },
  };
}

/** jsdom video elements report readyState 0, which the scan loop skips. */
function makeVideoReady(container: HTMLElement) {
  const video = container.querySelector('video');
  if (video) Object.defineProperty(video, 'readyState', { configurable: true, value: 4 });
}

beforeEach(() => {
  nextDecode = () => Promise.resolve(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('camera ownership across effect restarts on one component', () => {
  it('never lets a retired run stop the camera the current run owns', async () => {
    const media = fakeMedia();
    const view = render(<QrCheckIn onPayload={() => true} onClose={() => {}} />);

    // The first run must get *past* the camera check while it is still current,
    // so that it is sitting in the deferred play when it gets retired. That is
    // the only way to reach the branch the bug lived in.
    await media.openCamera(0);
    expect(media.playCount()).toBe(1);

    // Restart the effect in place. Same component, same refs, which is the
    // condition the shared-ref implementation failed under.
    view.rerender(<QrCheckIn onPayload={() => true} onClose={() => {}} />);
    expect(media.getUserMedia).toHaveBeenCalledTimes(2);

    // The new run takes ownership...
    await media.openCamera(1);
    expect(media.playCount()).toBe(2);
    await media.startPlaying(1);

    // ...and only now does the retired run's play resolve. It must release its
    // own camera and leave the current one alone.
    await media.startPlaying(0);

    expect(media.streams[0].track.stop).toHaveBeenCalledTimes(1);
    expect(media.streams[1].track.stop).not.toHaveBeenCalled();

    view.unmount();
    expect(media.streams[1].track.stop).toHaveBeenCalledTimes(1);
  });

  it('releases a camera that arrives after the scanner closed', async () => {
    const media = fakeMedia();
    const view = render(<QrCheckIn onPayload={() => true} onClose={() => {}} />);

    view.unmount();
    await media.openCamera(0);

    expect(media.streams[0].track.stop).toHaveBeenCalledTimes(1);
  });

  it('stops the camera it opened when closed normally', async () => {
    const media = fakeMedia();
    const view = render(<QrCheckIn onPayload={() => true} onClose={() => {}} />);

    await media.openCamera(0);
    await media.startPlaying(0);
    expect(media.streams[0].track.stop).not.toHaveBeenCalled();

    view.unmount();
    expect(media.streams[0].track.stop).toHaveBeenCalledTimes(1);
  });
});

describe('what the running scan loop does', () => {
  it('reports an accepted payload once and releases the camera', async () => {
    vi.useFakeTimers();
    const media = fakeMedia();
    const onPayload = vi.fn(() => true);
    const view = render(<QrCheckIn onPayload={onPayload} onClose={() => {}} />);

    await media.openCamera(0);
    await media.startPlaying(0);
    makeVideoReady(view.container);
    expect(media.playCount()).toBe(1);

    nextDecode = () => Promise.resolve('voicegis://asterion/g/west');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });

    expect(onPayload).toHaveBeenCalledTimes(1);
    expect(onPayload).toHaveBeenCalledWith('voicegis://asterion/g/west');
    expect(media.streams[0].track.stop).toHaveBeenCalledTimes(1);
  });

  it('keeps scanning after a refusal and does not refire the same code', async () => {
    vi.useFakeTimers();
    const media = fakeMedia();
    const onPayload = vi.fn(() => false);
    const view = render(<QrCheckIn onPayload={onPayload} onClose={() => {}} />);

    await media.openCamera(0);
    await media.startPlaying(0);
    makeVideoReady(view.container);

    nextDecode = () => Promise.resolve('voicegis://elsewhere/g/west');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    // Reported once despite many frames, and the camera is still running.
    expect(onPayload).toHaveBeenCalledTimes(1);
    expect(media.streams[0].track.stop).not.toHaveBeenCalled();

    // A different code is offered immediately: the visitor may have walked to
    // another sign.
    nextDecode = () => Promise.resolve('voicegis://asterion/g/east');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    expect(onPayload).toHaveBeenCalledTimes(2);
    expect(onPayload).toHaveBeenLastCalledWith('voicegis://asterion/g/east');
  });

  it('does not report a decode that lands after the scanner closed', async () => {
    vi.useFakeTimers();
    const media = fakeMedia();
    const onPayload = vi.fn(() => true);
    const view = render(<QrCheckIn onPayload={onPayload} onClose={() => {}} />);

    await media.openCamera(0);
    await media.startPlaying(0);
    makeVideoReady(view.container);

    // A decode still in flight when the scanner is dismissed must not check the
    // visitor in at a sign they walked away from.
    const held = deferred<string | null>();
    nextDecode = () => held.promise;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    view.unmount();
    await act(async () => {
      held.resolve('voicegis://asterion/g/west');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onPayload).not.toHaveBeenCalled();
  });
});

describe('when the camera cannot be opened', () => {
  it('says so rather than leaving the dialog blank', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(() =>
          Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' })),
        ),
      },
    });

    const view = render(<QrCheckIn onPayload={() => true} onClose={() => {}} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(view.getByRole('status').textContent).toMatch(/refused/i);
  });
});
