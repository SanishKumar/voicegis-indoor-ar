import { useCallback, useEffect, useRef, useState } from 'react';

/** How much faster than walking pace the walk-through plays. */
export const WALKTHROUGH_RATE = 3;
/** Guidance updates at most this often; the map eases the marker in between. */
const DISPATCH_MS = 60;
/** With reduced motion the walk-through moves manoeuvre by manoeuvre instead. */
const REDUCED_MOTION_STEP_MS = 2400;

/**
 * Plays the route from the current point to the end at a multiple of walking
 * pace, by supplying the same distance a matched position will supply later.
 *
 * It is a preview and says so: nothing here moves the planning location, and
 * reaching the end is not arriving.
 */
export function useWalkthrough({ track, progressMeters, setProgress, walkSpeedMps = 1.2 }) {
  // Playing belongs to the route it was started on, so a new route is simply
  // not playing - there is no flag to reset.
  const [playingTrack, setPlayingTrack] = useState(null);
  const playing = track !== null && track !== undefined && playingTrack === track;
  const progressRef = useRef(progressMeters);
  const dispatchedRef = useRef(progressMeters);
  const length = track?.length ?? 0;
  const stepMarks = track?.stepAt;

  useEffect(() => {
    progressRef.current = progressMeters;
  }, [progressMeters]);

  useEffect(() => {
    if (!playing || length <= 0) return undefined;
    // Playing from the end starts again from the beginning.
    let meters = progressRef.current >= length - 0.05 ? 0 : progressRef.current;
    dispatchedRef.current = meters;
    setProgress(meters);

    const adoptExternalMove = () => {
      // Someone stepped the route by hand while it played: carry on from there.
      if (Math.abs(progressRef.current - dispatchedRef.current) > 0.01) {
        meters = progressRef.current;
        dispatchedRef.current = meters;
      }
    };

    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      const timer = window.setInterval(() => {
        adoptExternalMove();
        meters = stepMarks?.find((mark) => mark > meters + 0.05) ?? length;
        dispatchedRef.current = meters;
        setProgress(meters);
        if (meters >= length) setPlayingTrack(null);
      }, REDUCED_MOTION_STEP_MS);
      return () => window.clearInterval(timer);
    }

    let frame = 0;
    let last = performance.now();
    let sinceDispatch = 0;
    const tick = (now) => {
      adoptExternalMove();
      const elapsed = Math.min(100, Math.max(0, now - last));
      last = now;
      meters = Math.min(length, meters + (elapsed / 1000) * walkSpeedMps * WALKTHROUGH_RATE);
      sinceDispatch += elapsed;
      if (sinceDispatch >= DISPATCH_MS || meters >= length) {
        sinceDispatch = 0;
        dispatchedRef.current = meters;
        setProgress(meters);
      }
      if (meters >= length) {
        setPlayingTrack(null);
        return;
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [playing, length, stepMarks, setProgress, walkSpeedMps]);

  const play = useCallback(() => setPlayingTrack(track ?? null), [track]);
  const pause = useCallback(() => setPlayingTrack(null), []);
  const toggle = useCallback(
    () =>
      setPlayingTrack((current) =>
        current !== null && current === track ? null : (track ?? null),
      ),
    [track],
  );

  return { playing, play, pause, toggle };
}
