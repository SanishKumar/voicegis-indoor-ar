/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import InspectorLabelLayout from './InspectorLabelLayout';

const hooks = vi.hoisted(() => ({
  get: () => ({}) as unknown,
  onFrame: null as (() => void) | null,
}));
vi.mock('@react-three/fiber', () => ({
  useThree: (select: (state: { get: typeof hooks.get }) => unknown) => select({ get: hooks.get }),
  useFrame: (callback: () => void) => {
    hooks.onFrame = callback;
  },
}));

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Inspector HTML label layout lifecycle', () => {
  it('reconsiders labels after a camera frame and cancels its pending work on unmount', () => {
    const container = document.createElement('div');
    container.className = 'twin-canvas';
    const canvas = document.createElement('canvas');
    container.append(canvas);
    document.body.append(container);
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 300));
    const makeLabel = (id: string, priority: number) => {
      const label = document.createElement('div');
      label.dataset.inspectorLabelId = id;
      label.dataset.inspectorLabelPriority = String(priority);
      container.append(label);
      return label;
    };
    const entrance = makeLabel('entrance', 60);
    const room = makeLabel('room', 30);
    vi.spyOn(entrance, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 100, 100, 24));
    const roomBounds = vi
      .spyOn(room, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(30, 100, 100, 24));
    const frames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++frameId, callback);
      return frameId;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect = disconnect;
      },
    );
    const invalidate = vi.fn();
    hooks.get = () => ({ gl: { domElement: canvas }, invalidate });
    const view = render(<InspectorLabelLayout />);
    const flush = () => {
      for (const [id, callback] of [...frames]) {
        frames.delete(id);
        callback(0);
      }
    };
    flush();
    expect(entrance.style.visibility).toBe('visible');
    expect(room.style.visibility).toBe('hidden');
    expect(room.getAttribute('aria-hidden')).toBe('true');

    roomBounds.mockReturnValue(new DOMRect(200, 100, 100, 24));
    hooks.onFrame!();
    flush();
    expect(room.style.visibility).toBe('visible');
    expect(room.getAttribute('aria-hidden')).toBe('false');
    // Laying out DOM text must not keep the demand-rendered canvas running.
    expect(invalidate).toHaveBeenCalledOnce();

    hooks.onFrame!();
    expect(frames.size).toBe(1);
    view.unmount();
    expect(frames.size).toBe(0);
    expect(disconnect).toHaveBeenCalledOnce();
    expect(room.style.visibility).toBe('');
    expect(room.hasAttribute('data-inspector-label-visible')).toBe(false);
  });
});
