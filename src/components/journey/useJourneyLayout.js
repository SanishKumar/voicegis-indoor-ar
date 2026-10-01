import { useEffect } from 'react';

/** Keep the scrollable trip sheet below the instruction, including text zoom.
 * The map already measures both panels as insets; this only bounds the sheet,
 * and never changes route or tracking state. */
export function useJourneyLayout(regionRef, navStatus, route, instruction) {
  useEffect(() => {
    const root = regionRef.current?.closest('.jr');
    const banner = root?.querySelector('.jr-banner');
    if (!root || !banner) return;
    const publish = () => {
      const height = banner.getBoundingClientRect().height;
      if (height > 0) root.style.setProperty('--journey-banner-height', `${Math.ceil(height)}px`);
    };
    publish();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publish);
    observer?.observe(banner);
    window.addEventListener('resize', publish);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', publish);
      root.style.removeProperty('--journey-banner-height');
    };
  }, [regionRef, navStatus, route]);

  // A new manoeuvre starts at its beginning, but a resize or another stride
  // must not interrupt someone reading the rest of the current instruction.
  useEffect(() => {
    const banner = regionRef.current?.closest('.jr')?.querySelector('.jr-banner');
    if (banner) banner.scrollTop = 0;
  }, [regionRef, instruction]);
}
