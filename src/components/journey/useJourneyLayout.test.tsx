/** @vitest-environment jsdom */
import { useRef } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useJourneyLayout } from './useJourneyLayout';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Surface({ status = 'navigating', instruction = 'Instruction' }) {
  const region = useRef<HTMLElement | null>(null);
  useJourneyLayout(region, status, null, instruction);
  return (
    <div className="jr">
      <section className="jr-banner">{instruction}</section>
      <section className="jr-sheet" ref={region} tabIndex={-1}>
        Directions
      </section>
    </div>
  );
}

it('publishes changed instruction height and cleans up without changing focus', () => {
  let notify = () => {};
  let height = 88;
  const disconnect = vi.fn();
  const observe = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        notify = callback;
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({ height }) as DOMRect,
  );
  const result = render(<Surface />);
  const root = result.container.querySelector<HTMLElement>('.jr')!;
  const sheet = result.container.querySelector<HTMLElement>('.jr-sheet')!;
  sheet.focus();
  expect(root.style.getPropertyValue('--journey-banner-height')).toBe('88px');
  expect(observe).toHaveBeenCalledWith(root.querySelector('.jr-banner'));
  const banner = root.querySelector<HTMLElement>('.jr-banner')!;
  banner.scrollTop = 37;
  height = 171.4;
  notify();
  expect(root.style.getPropertyValue('--journey-banner-height')).toBe('172px');
  expect(document.activeElement).toBe(sheet);
  expect(banner.scrollTop).toBe(37);
  result.rerender(<Surface instruction="Turn left" />);
  expect(banner.scrollTop).toBe(0);
  result.unmount();
  expect(disconnect).toHaveBeenCalledOnce();
  expect(root.style.getPropertyValue('--journey-banner-height')).toBe('');
});

it('keeps CSS fallback when layout has not been measured and handles window resize', () => {
  vi.stubGlobal('ResizeObserver', undefined);
  let height = 0;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({ height }) as DOMRect,
  );
  const result = render(<Surface />);
  const root = result.container.querySelector<HTMLElement>('.jr')!;
  expect(root.style.getPropertyValue('--journey-banner-height')).toBe('');
  height = 120;
  window.dispatchEvent(new Event('resize'));
  expect(root.style.getPropertyValue('--journey-banner-height')).toBe('120px');
});
