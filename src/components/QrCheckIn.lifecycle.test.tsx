/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import QrCheckIn from './QrCheckIn';

/**
 * Regression for camera ownership across effect runs.
 *
 * The scanner opens the camera asynchronously, and every step of that -
 * getUserMedia, play, decode - resolves on a later tick. A generation token
 * stopped a stale run *proceeding*, but the run still released the camera
 * through refs shared with every other run, so a continuation belonging to a
 * closed scanner could stop the camera a freshly reopened one had just opened.
 *
 * These drive the component rather than the pure gate, because that is where
 * the defect lived: the acceptance logic was already correct and tested.
 */

interface FakeTrack {
  stop: ReturnType<typeof vi.fn>;
}

function fakeStream() {
  const track: FakeTrack = { stop: vi.fn() };
  return {
    track,
    stream: { getTracks: () => [track] } as unknown as MediaStream,
  };
}

/** A getUserMedia whose resolution the test controls, one call at a time. */
function deferredCamera() {
  const pending: Array<() => void> = [];
  const streams: ReturnType<typeof fakeStream>[] = [];

  const getUserMedia = vi.fn(
    () =>
      new Promise<MediaStream>((resolve) => {
        const made = fakeStream();
        streams.push(made);
        pending.push(() => resolve(made.stream));
      }),
  );

  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });

  return {
    streams,
    getUserMedia,
    /** Resolves the nth outstanding camera request. */
    async settle(index: number) {
      await act(async () => {
        pending[index]();
        await Promise.resolve();
        await Promise.resolve();
      });
    },
  };
}

const noop = () => true;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('camera ownership across scanner lifecycles', () => {
  it('releases a camera that arrives after the scanner was closed', async () => {
    const camera = deferredCamera();
    const view = render(<QrCheckIn onPayload={noop} onClose={() => {}} />);

    view.unmount();
    await camera.settle(0);

    // The request was already in flight when the scanner closed, so nothing
    // else can release it.
    expect(camera.streams[0].track.stop).toHaveBeenCalledTimes(1);
  });

  it('never lets a closed scanner stop the camera a reopened one owns', async () => {
    // The reported defect. Open, close, reopen, then let the first run's
    // camera arrive: it must release its own stream and leave the second
    // run's alone.
    const camera = deferredCamera();

    const first = render(<QrCheckIn onPayload={noop} onClose={() => {}} />);
    first.unmount();

    const second = render(<QrCheckIn onPayload={noop} onClose={() => {}} />);
    await camera.settle(1);
    await camera.settle(0);

    expect(camera.getUserMedia).toHaveBeenCalledTimes(2);
    expect(camera.streams[0].track.stop).toHaveBeenCalledTimes(1);
    expect(camera.streams[1].track.stop).not.toHaveBeenCalled();

    second.unmount();
    expect(camera.streams[1].track.stop).toHaveBeenCalledTimes(1);
  });

  it('stops the camera it opened when the scanner is closed normally', async () => {
    const camera = deferredCamera();
    const view = render(<QrCheckIn onPayload={noop} onClose={() => {}} />);

    await camera.settle(0);
    expect(camera.streams[0].track.stop).not.toHaveBeenCalled();

    view.unmount();
    expect(camera.streams[0].track.stop).toHaveBeenCalledTimes(1);
  });

  it('reports a refused camera without leaving the dialog blank', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(() =>
          Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' })),
        ),
      },
    });

    const view = render(<QrCheckIn onPayload={noop} onClose={() => {}} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(view.getByRole('status').textContent).toMatch(/refused/i);
  });
});
