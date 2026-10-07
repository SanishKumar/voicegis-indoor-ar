// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MobilePanelHandle from './MobilePanelHandle';
import { useMobilePanel } from './useMobilePanel';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Fixture({ session = 'first' }) {
  const panel = useMobilePanel(session);
  return <MobilePanelHandle panel={panel} label="route details" controls="details" />;
}

describe('mobile panel presentation', () => {
  it('folds on a vertical drag without toggling twice, and ignores cancelled gestures', () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    render(<Fixture />);
    const handle = screen.getByRole('button');
    const pointer = (type: string, x: number, y: number) => {
      const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
      Object.defineProperty(event, 'isPrimary', { value: true });
      fireEvent(handle, event);
    };
    pointer('pointerdown', 100, 100);
    pointer('pointerup', 105, 160);
    fireEvent.click(handle);
    expect(handle.getAttribute('aria-expanded')).toBe('false');
    pointer('pointerdown', 100, 160);
    pointer('pointerup', 100, 100);
    fireEvent.click(handle);
    expect(handle.getAttribute('aria-expanded')).toBe('true');
    pointer('pointerdown', 100, 100);
    pointer('pointercancel', 100, 110);
    pointer('pointerup', 100, 180);
    expect(handle.getAttribute('aria-expanded')).toBe('true');
    pointer('pointerdown', 100, 100);
    pointer('pointerup', 180, 110);
    expect(handle.getAttribute('aria-expanded')).toBe('true');
  });

  it('preserves the choice across renders, resets on a new task, and expands on desktop', () => {
    let mobile = true;
    let notify = () => {};
    vi.stubGlobal('matchMedia', () => ({
      matches: mobile,
      addEventListener: (_: string, callback: () => void) => {
        notify = callback;
      },
      removeEventListener: vi.fn(),
    }));
    const view = render(<Fixture />);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse route details' }));
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(screen.getByRole('button'));
    view.rerender(<Fixture />);
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false');
    act(() => {
      mobile = false;
      notify();
    });
    expect(screen.queryByRole('button')).toBeNull();
    act(() => {
      mobile = true;
      notify();
    });
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false');
    view.rerender(<Fixture session="second" />);
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true');
    view.rerender(<Fixture />);
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true');
  });
});
