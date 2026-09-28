import { useEffect, useState } from 'react';

/** Follow the mounted heading and whichever container scrolls it. */
export function useHeadingVisibility() {
  const [heading, headingRef] = useState<HTMLHeadingElement | null>(null);
  const [headingHidden, setHeadingHidden] = useState(false);

  useEffect(() => {
    if (!heading) {
      setHeadingHidden(false);
      return;
    }
    let raf = 0;
    const check = () => {
      raf = 0;
      const centre = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--top-row-center')) || 96;
      setHeadingHidden(heading.getBoundingClientRect().bottom < centre + 28);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(check);
    };
    check();
    // Android scrolls an inner dashboard container; browsers scroll the
    // document. Scroll does not bubble, so capture it to cover both. Measure
    // the current heading rather than relying on an intersection notification
    // after the dashboard replaces its content during loading.
    document.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.addEventListener('resize', schedule);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(heading);
    observer?.observe(document.documentElement);
    return () => {
      document.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      observer?.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [heading]);

  return { headingRef, headingHidden };
}
