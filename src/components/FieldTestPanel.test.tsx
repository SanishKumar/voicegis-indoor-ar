/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fieldEvents, fieldTestEnabled, logField, resetFieldTest } from '../fieldTest/fieldLog';
import FieldTestPanel from './FieldTestPanel';

vi.mock('../context/NavigationContext.jsx', () => ({
  useNavigation: () => ({
    venue: {
      buildingPackage: {
        building: { id: 'asterion-medical-center' },
        manifest: { contentHash: '9a9c9d37907c78ec1b72bed95658ec248c43d96a' },
      },
    },
  }),
}));

afterEach(() => {
  cleanup();
  resetFieldTest(null);
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

describe('getting a field test record off the phone', () => {
  it('shows nothing to an ordinary visitor', () => {
    resetFieldTest(false);
    const { container } = render(<FieldTestPanel />);
    expect(container.innerHTML).toBe('');
  });

  it('shows the record as text, and copies it whole', async () => {
    resetFieldTest(true);
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<FieldTestPanel />);
    logField('ar', { event: 'start' });
    logField('ar-state', { state: 'floor', seconds: 0.6 });

    fireEvent.click(screen.getByRole('button', { name: 'Test log' }));
    const text = (await screen.findByDisplayValue(/VoiceGIS field test/)) as HTMLTextAreaElement;
    expect(text.value).toContain('venue asterion-medical-center 9a9c9d37907c');
    expect(text.value).toContain('immersive-ar no-webxr');
    expect(text.value).toMatch(/ar event=start\n.*ar-state state=floor seconds=0\.60$/);

    const copy = screen.getByRole('button', { name: 'Copy report' }) as HTMLButtonElement;
    expect(copy.disabled).toBe(true);
    expect(writeText).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: /reviewed this report/ }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy report' })));
    expect(writeText).toHaveBeenCalledWith(text.value);
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
  });

  it('keeps recording without changing the reviewed snapshot; refresh requires consent again', async () => {
    resetFieldTest(true);
    render(<FieldTestPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Test log' }));
    const text = (await screen.findByDisplayValue(/VoiceGIS field test/)) as HTMLTextAreaElement;
    fireEvent.click(screen.getByRole('checkbox', { name: /reviewed this report/ }));
    act(() => logField('ar', { event: 'running' }));
    expect(text.value).not.toContain('ar event=running');
    expect(fieldEvents()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh report' }));
    expect(text.value).toContain('ar event=running');
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    expect(
      (screen.getByRole('button', { name: 'Copy report' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(text.value).toContain('0 events');
    expect(fieldEvents()).toEqual([]);
  });

  it('does not relabel a refreshed report when an older clipboard request finishes', async () => {
    resetFieldTest(true);
    let finish!: () => void;
    const writeText = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<FieldTestPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Test log' }));
    const text = (await screen.findByDisplayValue(/VoiceGIS field test/)) as HTMLTextAreaElement;
    const reviewed = text.value;
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Copy report' }));
    act(() => logField('ar', { event: 'running' }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh report' }));
    await act(async () => finish());
    expect(writeText).toHaveBeenCalledWith(reviewed);
    expect(text.value).not.toBe(reviewed);
    expect(screen.queryByRole('button', { name: 'Copied' })).toBeNull();
  });

  it('leaves a selectable snapshot when clipboard access is refused', async () => {
    resetFieldTest(true);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) },
      configurable: true,
    });
    render(<FieldTestPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Test log' }));
    const text = (await screen.findByDisplayValue(/VoiceGIS field test/)) as HTMLTextAreaElement;
    fireEvent.click(screen.getByRole('checkbox'));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy report' })));
    expect(screen.getByRole('status').textContent).toContain('Clipboard unavailable');
    expect(text.readOnly).toBe(true);
    expect(text.disabled).toBe(false);
  });

  it('stops and clears the log without reloading or changing navigation', async () => {
    window.history.replaceState(null, '', '/?fieldtest=1&venue=campus#/visitor');
    resetFieldTest(null);
    render(<FieldTestPanel />);
    act(() => logField('position', { progress: 3 }));
    fireEvent.click(screen.getByRole('button', { name: 'Test log' }));
    await screen.findByDisplayValue(/VoiceGIS field test/);
    fireEvent.click(screen.getByRole('button', { name: 'Stop logging and clear' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Test log' })).toBeNull();
    expect(fieldTestEnabled()).toBe(false);
    logField('position', { progress: 4 });
    expect(fieldEvents()).toEqual([]);
    expect(window.location.hash).toBe('#/visitor');
    expect(new URLSearchParams(window.location.search).get('venue')).toBe('campus');
    expect(new URLSearchParams(window.location.search).get('fieldtest')).toBe('0');
  });
});
