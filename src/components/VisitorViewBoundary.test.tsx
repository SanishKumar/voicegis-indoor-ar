/** @vitest-environment jsdom */
import { lazy } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import VisitorViewBoundary from './VisitorViewBoundary';

const expectedErrors: ((event: ErrorEvent) => void)[] = [];
function expectRenderFailure(message: string) {
  const listener = (event: ErrorEvent) => {
    if (event.error?.message === message) event.preventDefault();
  };
  expectedErrors.push(listener);
  window.addEventListener('error', listener);
  vi.spyOn(console, 'error').mockImplementation(() => {});
}

afterEach(() => {
  cleanup();
  expectedErrors.splice(0).forEach((listener) => window.removeEventListener('error', listener));
  vi.restoreAllMocks();
});

describe('deferred visitor views', () => {
  it('keeps an accessible exit while camera code loads, then replaces the placeholder', async () => {
    let finish!: (value: { default: () => React.JSX.Element }) => void;
    const View = lazy(
      () =>
        new Promise<{ default: () => React.JSX.Element }>((resolve) => {
          finish = resolve;
        }),
    );
    const onExit = vi.fn();
    render(
      <VisitorViewBoundary view="camera" onExit={onExit}>
        <View />
      </VisitorViewBoundary>,
    );
    expect(screen.getByRole('status')).toBe(document.activeElement);
    fireEvent.click(screen.getByRole('button', { name: 'Exit to plan' }));
    expect(onExit).toHaveBeenCalledOnce();
    await act(async () => finish({ default: () => <div>Camera ready</div> }));
    expect(screen.getByText('Camera ready')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('contains a failed camera import and explains that reload restarts the journey', async () => {
    expectRenderFailure('camera module unavailable');
    const View = lazy(() => Promise.reject(new Error('camera module unavailable')));
    const onExit = vi.fn();
    render(
      <VisitorViewBoundary view="camera" onExit={onExit}>
        <View />
      </VisitorViewBoundary>,
    );
    const alert = await screen.findByRole('alert');
    // The async lazy rejection commits the alert before its passive focus
    // effect runs. Wait for the behavior, not just the DOM node's presence.
    await waitFor(() => expect(alert).toBe(document.activeElement));
    expect(alert.textContent).toContain('Reloading the app restarts your journey');
    fireEvent.click(screen.getByRole('button', { name: 'Exit to plan' }));
    expect(onExit).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Reload app' })).toBeTruthy();
  });

  it('moves map recovery into the journey slot without remounting other guidance', async () => {
    expectRenderFailure('map module unavailable');
    const View = lazy(() => Promise.reject(new Error('map module unavailable')));
    const { container, rerender } = render(
      <VisitorViewBoundary view="map">
        <View />
      </VisitorViewBoundary>,
    );
    const alert = await screen.findByRole('alert');
    expect(container.contains(alert)).toBe(true);
    const slot = document.createElement('div');
    container.appendChild(slot);
    rerender(
      <VisitorViewBoundary view="map" recoveryTarget={slot}>
        <View />
      </VisitorViewBoundary>,
    );
    expect(slot.contains(screen.getByRole('alert'))).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('written directions still work');
    expect(screen.queryByRole('button', { name: 'Exit to plan' })).toBeNull();
  });
});
