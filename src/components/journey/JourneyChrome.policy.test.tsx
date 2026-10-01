/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ASTERION_RUNTIME } from '../../test/venueFixtures';
import { createVenueScopedState } from '../../data/venueSession';
import JourneyChrome from './JourneyChrome';
import { calculateCompiledRoute } from '../../engine/compiledRoutePolicy';

const binding = vi.hoisted(() => vi.fn());
vi.mock('../../context/NavigationContext.jsx', () => ({
  useNavigation: binding,
  NAV_STATUS: {
    IDLE: 'idle',
    ROUTING: 'routing',
    NAVIGATING: 'navigating',
    ARRIVED: 'arrived',
    PAUSED: 'paused',
  },
}));
const walkthrough = { pause: vi.fn() };
const picker = vi.fn();
function value(status = 'unavailable') {
  return {
    state: {
      ...createVenueScopedState(ASTERION_RUNTIME).navigation,
      navStatus: 'paused',
      destinationNodeId: 'poi:poi-cardiology',
      policyPause: { reason: 'overlay-expired' },
    },
    actions: { clearRoute: vi.fn() },
    venue: ASTERION_RUNTIME,
    checkIn: null,
    accessibleRouting: true,
    setShowLocationPicker: picker,
    operationalFreshness: { status, reason: status === 'unavailable' ? 'overlay-expired' : null },
  };
}
beforeEach(() => {
  binding.mockReturnValue(value());
  picker.mockClear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('visitor paused closure recovery', () => {
  it('keeps written directions and deliberate end-route recovery when only graphics do not fit', () => {
    const route = calculateCompiledRoute(
      ASTERION_RUNTIME,
      ASTERION_RUNTIME.getDefaultStartNodeId(),
      'poi:poi-cardiology',
    );
    const bindingValue = value('current');
    bindingValue.state = {
      ...bindingValue.state,
      navStatus: 'navigating',
      route: {
        ...route,
        displayClearance: { ...route.displayClearance!, status: 'withheld' },
      },
    } as typeof bindingValue.state;
    binding.mockReturnValue(bindingValue);
    render(
      <JourneyChrome walkthrough={{ ...walkthrough, playing: false }} onRecoverySlot={undefined} />,
    );
    expect(screen.getByRole('status').textContent).toContain('Written directions remain available');
    expect(screen.getByRole('region', { name: 'Next step' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'End route' })).toBeTruthy();
  });
  it('keeps destination/profile visible, focuses the pause and does not offer a scan as a policy refresh', () => {
    render(<JourneyChrome walkthrough={walkthrough} onRecoverySlot={undefined} />);
    const panel = screen.getByRole('alert', { name: 'Directions paused' });
    expect(document.activeElement).toBe(panel);
    expect(panel.textContent).toContain('Heart & Vascular Clinic');
    expect(panel.textContent).toContain('Step-free route');
    expect(panel.textContent).toContain('Scanning a code confirms location only');
    expect(screen.queryByRole('button', { name: 'Scan a code' })).toBeNull();
    expect(screen.getByRole('button', { name: 'End route' })).toBeTruthy();
  });
  it('discloses that a cached map is not fresh closure information while offline', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    render(<JourneyChrome walkthrough={walkthrough} onRecoverySlot={undefined} />);
    expect(screen.getByRole('alert').textContent).toContain(
      'A cached map does not confirm that paths are open',
    );
  });
  it('offers deliberate location recovery once policy is current, without stealing focus or resuming', () => {
    const view = render(<JourneyChrome walkthrough={walkthrough} onRecoverySlot={undefined} />);
    const end = screen.getByRole('button', { name: 'End route' });
    end.focus();
    binding.mockReturnValue(value('current'));
    view.rerender(<JourneyChrome walkthrough={walkthrough} onRecoverySlot={undefined} />);
    expect(document.activeElement).toBe(end);
    expect(screen.getByRole('alert').textContent).toContain('Confirm where you are now');
    fireEvent.click(screen.getByRole('button', { name: 'Choose current location' }));
    expect(picker).toHaveBeenCalledWith(true);
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});
