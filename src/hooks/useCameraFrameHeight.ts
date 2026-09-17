import { useLayoutEffect, useRef, useState } from 'react';

/** Give the image what is left after the real title, controls and action row,
 * including wrapped text and larger fonts — not a guessed viewport deduction. */
export function useCameraFrameHeight(expanded: boolean) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [maxHeight, setMaxHeight] = useState<number>();
  // The card's padding and the width its header needs are both rem, so a
  // reader with text turned up needs a wider card for the same layout.
  const [rem, setRem] = useState(16);
  useLayoutEffect(() => {
    const frame = frameRef.current;
    const scroller = frame?.closest<HTMLElement>('[data-expanded-overlay-scroll]');
    if (!expanded || !frame || !scroller) return;
    const measure = () => {
      const root = parseFloat(getComputedStyle(document.documentElement).fontSize);
      if (Number.isFinite(root) && root > 0) setRem(root);
      const budget = parseFloat(getComputedStyle(scroller).maxHeight);
      if (!Number.isFinite(budget)) return;
      const chrome = scroller.scrollHeight - frame.offsetHeight;
      // scrollHeight/offsetHeight round to whole pixels. Leave two for rounding.
      setMaxHeight(Math.max(0, Math.floor(budget - chrome - 2)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    if (scroller.firstElementChild) observer.observe(scroller.firstElementChild);
    observer.observe(frame.parentElement!);
    // Raising max-height leaves the current card the same size, so no resize
    // fires. Watch the constraint too, so the image can grow as well as shrink.
    const constraints = new MutationObserver(measure);
    constraints.observe(scroller, { attributes: true, attributeFilter: ['style'] });
    return () => { observer.disconnect(); constraints.disconnect(); };
  }, [expanded]);
  return { frameRef, maxHeight, rem };
}
