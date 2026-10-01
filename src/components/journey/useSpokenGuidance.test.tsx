/** @vitest-environment jsdom */
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BannerCopy } from './guidanceCopy';
import { withArrivalState } from './guidanceCopy';
import { useSpokenGuidance } from './useSpokenGuidance';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function fixture() {
  const speak = vi.fn();
  const cancel = vi.fn();
  vi.stubGlobal('speechSynthesis', { speak, cancel });
  vi.stubGlobal(
    'SpeechSynthesisUtterance',
    class {
      rate = 1;
      constructor(public text: string) {}
    },
  );
  const copy: BannerCopy = {
    lead: 'In 12 m',
    text: 'Turn right',
    then: null,
    speech: 'In 12 m, turn right',
    step: {
      type: 'turn_right',
      nodeId: 'turn',
      instruction: 'Turn right',
      distance: 0,
      bearing: 90,
    },
  };
  return { speak, cancel, copy };
}

describe('spoken journey milestones', () => {
  it('announces preview end, proximity and confirmation once each despite a repeated destination', () => {
    const { copy, speak } = fixture();
    const forState = (confirmed: boolean, nearDestination: boolean) =>
      withArrivalState(copy, 'The Desk', { confirmed, nearDestination, atEnd: true })!;
    const { rerender } = renderHook(({ guidance }) => useSpokenGuidance(guidance, true), {
      initialProps: { guidance: forState(false, false) },
    });
    rerender({ guidance: forState(false, false) });
    rerender({ guidance: forState(false, true) });
    rerender({ guidance: forState(false, true) });
    rerender({ guidance: forState(true, true) });
    rerender({ guidance: forState(true, true) });
    expect(speak).toHaveBeenCalledTimes(3);
    const sentences = speak.mock.calls.map(([utterance]) => utterance.text);
    expect(sentences[0]).toContain('your arrival is not confirmed');
    expect(sentences[1]).toContain('Check the destination sign');
    expect(sentences[2]).toContain('Arrival confirmed by you');
  });

  it('still suppresses each metre of countdown but repeats the Now turn', () => {
    const { copy, speak } = fixture();
    const { rerender } = renderHook(({ guidance }) => useSpokenGuidance(guidance, true), {
      initialProps: { guidance: copy },
    });
    rerender({ guidance: { ...copy, lead: 'In 10 m', speech: 'In 10 m, turn right' } });
    expect(speak).toHaveBeenCalledOnce();
    rerender({ guidance: { ...copy, lead: 'Now', speech: 'Turn right' } });
    expect(speak).toHaveBeenCalledTimes(2);
  });

  it('does not speak milestones when voice is disabled and cancels on mute', () => {
    const { copy, speak, cancel } = fixture();
    const milestone = withArrivalState(copy, 'The Desk', {
      confirmed: true,
      nearDestination: false,
      atEnd: true,
    })!;
    const { rerender } = renderHook(({ enabled }) => useSpokenGuidance(milestone, enabled), {
      initialProps: { enabled: false },
    });
    expect(speak).not.toHaveBeenCalled();
    rerender({ enabled: true });
    expect(speak).toHaveBeenCalledOnce();
    const before = cancel.mock.calls.length;
    rerender({ enabled: false });
    expect(cancel.mock.calls.length).toBe(before + 1);
  });
});
