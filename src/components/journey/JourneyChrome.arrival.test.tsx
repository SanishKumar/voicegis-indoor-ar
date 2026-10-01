/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ASTERION_RUNTIME } from '../../test/venueFixtures';
import { createVenueScopedState } from '../../data/venueSession';
import { calculateCompiledRoute } from '../../engine/compiledRoutePolicy';
import { trackForRoute } from '../../navigation/routeProgress';
import { RouteTracker } from '../../navigation/liveTracker';
import JourneyChrome from './JourneyChrome';

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

const destinationNodeId = 'poi:poi-cardiology';
const destination = ASTERION_RUNTIME.getPOIs().find((node) => node.id === destinationNodeId)!;
const route = (() => {
  const result = calculateCompiledRoute(
    ASTERION_RUNTIME,
    ASTERION_RUNTIME.getDefaultStartNodeId(),
    destinationNodeId,
  );
  if (!result.found) throw new Error('Arrival fixture needs a reachable destination');
  return result;
})();
const track = trackForRoute(route);
const walkthrough = { pause: vi.fn(), toggle: vi.fn(), playing: false };
const trackingActions = { start: vi.fn(), stop: vi.fn(), confirmFloor: vi.fn() };
const initialSnapshot = new RouteTracker(track).read(0);

function navigation(progressMeters = 0, navStatus = 'navigating') {
  return {
    state: {
      ...createVenueScopedState(ASTERION_RUNTIME).navigation,
      navStatus,
      destinationNodeId,
      route,
      progressMeters,
      previewStepIndex: progressMeters === track.length ? route.steps.length - 1 : 0,
    },
    actions: {
      clearRoute: vi.fn(),
      confirmArrival: vi.fn(),
      previewStep: vi.fn(),
      prevStep: vi.fn(),
      nextStep: vi.fn(),
    },
    venue: ASTERION_RUNTIME,
    checkIn: null,
    accessibleRouting: false,
    toggleAccessibleRouting: vi.fn(),
    setShowLocationPicker: vi.fn(),
  };
}

const scrollDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
beforeAll(() => {
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});
afterAll(() => {
  if (scrollDescriptor)
    Object.defineProperty(Element.prototype, 'scrollIntoView', scrollDescriptor);
  else Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
});
beforeEach(() => {
  vi.clearAllMocks();
  binding.mockReturnValue(navigation());
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('visitor destination and explicit arrival', () => {
  it('keeps authored destination context available without repeating a derived description', () => {
    const { container } = render(<JourneyChrome walkthrough={walkthrough} />);
    const details = container.querySelector<HTMLDetailsElement>('.jr-destination-context')!;
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')?.textContent).toBe('Destination details');
    expect(details.textContent).toContain(destination.poi!.floorName);
    expect(details.textContent).toContain(destination.poi!.spaceName);
    expect(details.querySelectorAll('p')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'I’m at my destination' })).toBeNull();
  });

  it('does not turn a preview at the route end into a location or arrival claim', () => {
    const value = navigation(track.length);
    binding.mockReturnValue(value);
    const { container } = render(<JourneyChrome walkthrough={walkthrough} />);
    const banner = screen.getByRole('region', { name: 'Next step' });
    expect(banner.textContent).toContain('End of route');
    expect(banner.textContent).toContain('your arrival is not confirmed');
    expect(banner.textContent).not.toContain('You’re here');
    expect(banner.textContent).not.toContain('Near destination');
    expect(container.querySelector<HTMLDetailsElement>('.jr-destination-context')?.open).toBe(true);
    expect(screen.getByRole('button', { name: 'I’m at my destination' })).toBeTruthy();
    expect(value.actions.confirmArrival).not.toHaveBeenCalled();
    expect(container.querySelector('.jr')?.getAttribute('data-journey')).toBe('guiding');
  });

  it('labels the live arrival radius as proximity and still requires confirmation', () => {
    const value = navigation(track.length - 1);
    binding.mockReturnValue(value);
    render(
      <JourneyChrome
        walkthrough={walkthrough}
        tracking={{
          ...trackingActions,
          status: 'on',
          plausible: true,
          snapshot: { ...initialSnapshot, tier: 'tracking', reason: 'arrived' },
        }}
      />,
    );
    const banner = screen.getByRole('region', { name: 'Next step' });
    expect(banner.textContent).toContain('Near destination');
    expect(banner.textContent).toContain('Check the destination sign');
    expect(screen.getByRole('status').textContent).toContain('near the mapped destination');
    expect(screen.getByRole('status').textContent).not.toContain('You’re at your destination');
    expect(value.actions.confirmArrival).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'I’m at my destination' }));
    expect(value.actions.confirmArrival).toHaveBeenCalledOnce();
  });

  it('keeps confirmed arrival explicit when the visitor opens the steps', () => {
    binding.mockReturnValue(navigation(track.length, 'arrived'));
    const { container } = render(<JourneyChrome walkthrough={walkthrough} />);
    expect(screen.getByRole('region', { name: 'Next step' }).textContent).toContain(
      `Arrival confirmed by you at ${destination.poi!.name}`,
    );
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
    expect(container.querySelector<HTMLDetailsElement>('.jr-destination-context')?.open).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /^Show all \d+ steps$/ }));
    expect(container.querySelector('.jr-steps')?.textContent).toContain(
      'These steps are a route preview, not your tracked location',
    );
    expect(container.querySelector('.jr-steps')?.textContent).not.toContain(
      'Your position isn’t tracked yet',
    );
  });

  it('calls a step inspection a preview and releases the live owner without confirming arrival', () => {
    const value = navigation();
    binding.mockReturnValue(value);
    render(
      <JourneyChrome
        walkthrough={walkthrough}
        tracking={{
          ...trackingActions,
          status: 'on',
          plausible: true,
          snapshot: { ...initialSnapshot, tier: 'tracking', reason: 'following' },
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Show all \d+ steps$/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Preview step 2:/ }));
    expect(walkthrough.pause).toHaveBeenCalledOnce();
    expect(trackingActions.stop).toHaveBeenCalledOnce();
    expect(value.actions.previewStep).toHaveBeenCalledWith(1);
    expect(value.actions.confirmArrival).not.toHaveBeenCalled();
  });

  it('shows additional authored description, but does not invent a door or a staff contact', () => {
    const value = navigation(track.length);
    value.venue = {
      ...ASTERION_RUNTIME,
      getNodeById: (id: string) =>
        id === destinationNodeId
          ? {
              ...destination,
              poi: { ...destination.poi!, description: 'The desk beside the garden windows.' },
            }
          : ASTERION_RUNTIME.getNodeById(id),
    };
    binding.mockReturnValue(value);
    const { container } = render(<JourneyChrome walkthrough={walkthrough} />);
    const details = container.querySelector('.jr-destination-context') as HTMLElement;
    expect(within(details).getByText('The desk beside the garden windows.')).toBeTruthy();
    expect(details.textContent).not.toMatch(/entrance|phone|opening hours|door number/i);
  });

  it('does not invent destination context when metadata is absent', () => {
    const value = navigation(track.length);
    value.venue = {
      ...ASTERION_RUNTIME,
      getNodeById: (id: string) =>
        id === destinationNodeId ? null : ASTERION_RUNTIME.getNodeById(id),
    };
    binding.mockReturnValue(value);
    const { container } = render(<JourneyChrome walkthrough={walkthrough} />);
    expect(container.querySelector('.jr-destination-context')).toBeNull();
    expect(screen.getByRole('button', { name: 'End route' })).toBeTruthy();
  });

  it('ends a confirmed trip deliberately and restores the search trigger focus', () => {
    vi.useFakeTimers();
    const value = navigation(track.length, 'arrived');
    binding.mockReturnValue(value);
    render(
      <>
        <button id="btn-search-open">Find another destination</button>
        <JourneyChrome
          walkthrough={walkthrough}
          tracking={{ ...trackingActions, status: 'off', plausible: true, snapshot: null }}
        />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(value.actions.clearRoute).toHaveBeenCalledOnce();
    expect(walkthrough.pause).toHaveBeenCalledOnce();
    expect(trackingActions.stop).toHaveBeenCalledOnce();
    vi.runAllTimers();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Find another destination' }),
    );
  });
});
