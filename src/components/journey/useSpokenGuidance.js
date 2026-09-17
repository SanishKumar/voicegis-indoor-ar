import { useEffect, useRef } from 'react';

export function speechAvailable() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/**
 * Reads each new instruction aloud.
 *
 * Only a change of instruction is spoken - not every metre of the countdown -
 * and the "Now" moment is spoken again, because that is when a turn is due.
 * Where the platform has no voice this does nothing; the banner is the same.
 */
export function useSpokenGuidance(copy, enabled) {
  const spokenRef = useRef('');

  useEffect(() => {
    if (!enabled || !speechAvailable() || copy === null) {
      spokenRef.current = '';
      return;
    }
    const key = `${copy.text}|${copy.lead === 'Now' ? 'now' : ''}`;
    if (key === spokenRef.current) return;
    spokenRef.current = key;
    const utterance = new SpeechSynthesisUtterance(copy.speech);
    utterance.rate = 1;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }, [copy, enabled]);

  useEffect(() => {
    if (enabled || !speechAvailable()) return;
    window.speechSynthesis.cancel();
  }, [enabled]);
}
