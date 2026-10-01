/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SearchPanel from './SearchPanel.jsx';

const nodes = [
  {
    id: 'pharmacy',
    floor: 'g',
    floorName: 'Ground Floor',
    poi: { name: 'Outpatient Pharmacy', category: 'pharmacy', accessible: true, icon: 'Rx' },
  },
  {
    id: 'coffee',
    floor: 'l2',
    floorName: 'Second Floor',
    poi: { name: 'Coffee Counter', category: 'service', accessible: true, icon: 'S' },
  },
  ...Array.from({ length: 22 }, (_, index) => ({
    id: `room-${index}`,
    floor: 'g',
    floorName: 'Ground Floor',
    poi: {
      name: `Room ${String(index + 1).padStart(2, '0')}`,
      category: 'medical',
      accessible: index !== 0,
      icon: 'M',
    },
  })),
];
const state = {
  navStatus: 'idle',
  route: null as object | null,
  selectedPOI: null as object | null,
  startNodeId: 'anchor',
  destinationNodeId: 'saved-destination',
};
const actions = { selectPOI: vi.fn(), navigateTo: vi.fn(), setStart: vi.fn(), clearRoute: vi.fn() };
const previewRoute = vi.fn(() => ({ found: true, totalDistance: 10 }));
const binding = {
  state,
  actions,
  previewRoute,
  accessibleRouting: true,
  venue: {
    config: { name: 'Test Venue' },
    getPOIs: () => nodes,
    getCategory: (id: string) => ({
      label: { pharmacy: 'Pharmacy', service: 'Services', medical: 'Medical' }[id] ?? id,
      icon: id,
    }),
    getFloorById: (id: string) => ({ name: id }),
  },
};
vi.mock('../context/NavigationContext.jsx', () => ({
  NAV_STATUS: { IDLE: 'idle' },
  useNavigation: () => binding,
}));

function open() {
  fireEvent.click(screen.getByRole('button', { name: 'Search rooms and departments' }));
  return screen.getByRole('textbox', { name: 'Search rooms and departments' });
}

beforeEach(() => {
  state.navStatus = 'idle';
  state.route = null;
  state.selectedPOI = null;
  state.startNodeId = 'anchor';
  state.destinationNodeId = 'saved-destination';
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Visitor destination search', () => {
  it('reports the full count and reveals every destination rather than silently stopping at ten', () => {
    render(<SearchPanel />);
    const input = open();
    expect(document.activeElement).toBe(input);
    const summary = screen.getByRole('status', { name: 'Search results' });
    expect(summary.textContent).toContain('24 destinations. Showing 10');
    const list = screen.getByRole('list', { name: 'Destination results' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(10);
    fireEvent.click(screen.getByRole('button', { name: 'Show 10 more destinations' }));
    expect(within(list).getAllByRole('listitem')).toHaveLength(20);
    expect(document.activeElement).toBe(
      within(list).getAllByRole('button', { name: /View details/ })[10],
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show 4 more destinations' }));
    expect(within(list).getAllByRole('listitem')).toHaveLength(24);
    expect(summary.textContent).toBe('24 destinations.');
    expect(screen.queryByRole('button', { name: /more destinations/ })).toBeNull();
    expect(actions.navigateTo).not.toHaveBeenCalled();
  });

  it('recovers from an incompatible category without throwing away the search query', () => {
    render(<SearchPanel />);
    const input = open();
    fireEvent.click(screen.getByRole('button', { name: 'pharmacy Pharmacy' }));
    fireEvent.change(input, { target: { value: 'Coffee Counter' } });
    expect(screen.getByRole('heading', { name: 'No destinations found' })).toBeTruthy();
    expect(screen.getByText('Your search has 1 match outside Pharmacy.')).toBeTruthy();
    expect(screen.getByRole('status', { name: 'Search results' }).textContent).toContain(
      '0 destinations matching “Coffee Counter” in Pharmacy',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Search all categories' }));
    expect((input as HTMLInputElement).value).toBe('Coffee Counter');
    expect(document.activeElement).toBe(input);
    expect(screen.getByRole('button', { name: 'View details for Coffee Counter' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'pharmacy Pharmacy' }).getAttribute('aria-pressed'),
    ).toBe('false');
    expect(actions.navigateTo).not.toHaveBeenCalled();
  });

  it('offers spelling recovery and a full browse reset with useful focus', () => {
    render(<SearchPanel />);
    const input = open();
    fireEvent.change(input, { target: { value: 'zzzzzzzzzzzzz' } });
    expect(screen.getByText(/Try a room name, department, service/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try another search' }));
    expect((input as HTMLInputElement).value).toBe('');
    expect(document.activeElement).toBe(input);
    fireEvent.click(screen.getByRole('button', { name: 'pharmacy Pharmacy' }));
    fireEvent.change(input, { target: { value: 'zzzzzzzzzzzzz' } });
    fireEvent.click(screen.getByRole('button', { name: 'Browse all destinations' }));
    expect((input as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('status', { name: 'Search results' }).textContent).toContain(
      '24 destinations',
    );
    expect(
      screen.getByRole('button', { name: 'pharmacy Pharmacy' }).getAttribute('aria-pressed'),
    ).toBe('false');
    expect(document.activeElement).toBe(input);
  });

  it('resets pagination on a filter and keeps the active category when only the query is cleared', () => {
    render(<SearchPanel />);
    const input = open();
    fireEvent.click(screen.getByRole('button', { name: 'Show 10 more destinations' }));
    fireEvent.click(screen.getByRole('button', { name: 'medical Medical' }));
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(10);
    expect(screen.getByRole('status', { name: 'Search results' }).textContent).toContain(
      '22 destinations in Medical',
    );
    fireEvent.change(input, { target: { value: 'Room 01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(
      screen.getByRole('button', { name: 'medical Medical' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(document.activeElement).toBe(input);
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('status', { name: 'Search results' }).textContent).toContain(
      '24 destinations',
    );
  });

  it('dismisses without changing the saved start, destination or mobility preference', () => {
    render(<SearchPanel />);
    const input = open();
    fireEvent.change(input, { target: { value: 'Coffee Counter' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(actions.navigateTo).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Escape' });
    const trigger = screen.getByRole('button', { name: 'Search rooms and departments' });
    expect(document.activeElement).toBe(trigger);
    expect(state.startNodeId).toBe('anchor');
    expect(state.destinationNodeId).toBe('saved-destination');
    expect(binding.accessibleRouting).toBe(true);
    expect(actions.setStart).not.toHaveBeenCalled();
    expect(actions.clearRoute).not.toHaveBeenCalled();
    expect(document.getElementById('search-panel')?.hasAttribute('inert')).toBe(true);
  });

  it('distinguishes details from the explicit route action and exposes floor metadata', () => {
    render(<SearchPanel />);
    const input = open();
    fireEvent.change(input, { target: { value: 'Coffee Counter' } });
    const details = screen.getByRole('button', { name: 'View details for Coffee Counter' });
    const description = document.getElementById(details.getAttribute('aria-describedby')!);
    expect(description?.textContent).toBe('Second Floor · Accessible');
    fireEvent.click(details);
    expect(actions.selectPOI).toHaveBeenCalledWith(nodes[1]);
    expect(actions.navigateTo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Navigate to Coffee Counter' }));
    expect(actions.navigateTo).toHaveBeenCalledWith('coffee');
    expect(
      screen.queryByRole('button', { name: 'Close destination search' })?.closest('[inert]'),
    ).toBeTruthy();
  });

  it('retires its open session when external guidance starts so it cannot return over the map', async () => {
    vi.useFakeTimers();
    const { rerender } = render(<SearchPanel />);
    open();
    state.navStatus = 'active';
    state.route = { found: true };
    rerender(<SearchPanel />);
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(() => vi.runAllTimersAsync());
    state.navStatus = 'idle';
    state.route = null;
    rerender(<SearchPanel />);
    expect(screen.getByRole('button', { name: 'Search rooms and departments' })).toBeTruthy();
    expect(document.getElementById('search-panel')?.hasAttribute('inert')).toBe(true);
  });
});
