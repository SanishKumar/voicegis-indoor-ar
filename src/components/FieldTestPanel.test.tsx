/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { logField, resetFieldTest } from '../fieldTest/fieldLog';
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

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy report' })));
    expect(writeText).toHaveBeenCalledWith(text.value);
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
  });

  it('keeps recording while open, and can start again', async () => {
    resetFieldTest(true);
    render(<FieldTestPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Test log' }));
    const text = (await screen.findByDisplayValue(/VoiceGIS field test/)) as HTMLTextAreaElement;
    act(() => logField('ar', { event: 'running' }));
    expect(text.value).toContain('ar event=running');
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(text.value).toContain('0 events');
  });
});
