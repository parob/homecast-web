import { useLayoutEffect, useState } from 'react';

function readViewport() {
  const visible = window.visualViewport;
  const style = getComputedStyle(document.documentElement);
  return {
    width: window.innerWidth,
    height: visible?.height ?? window.innerHeight,
    top: visible?.offsetTop ?? 0,
    safeTop: parseFloat(style.getPropertyValue('--safe-area-top')) || 0,
    safeBottom: parseFloat(style.getPropertyValue('--safe-area-bottom')) || 0,
  };
}

/** The usable viewport can shrink without a window resize (browser chrome or
 * keyboard). Subscribe only while open; do not reflow a user's pinch zoom. */
export function useOverlayViewport(active: boolean) {
  const [viewport, setViewport] = useState(() => ({
    width: typeof window === 'undefined' ? Infinity : window.innerWidth,
    height: typeof window === 'undefined' ? 0 : window.innerHeight,
    top: 0, safeTop: 0, safeBottom: 0,
  }));
  useLayoutEffect(() => {
    if (!active) return;
    const update = () => {
      if (window.visualViewport && window.visualViewport.scale !== 1) return;
      const next = readViewport();
      setViewport(previous => Object.keys(next).every(key => previous[key as keyof typeof next] === next[key as keyof typeof next]) ? previous : next);
    };
    update();
    window.addEventListener('resize', update);
    const visible = window.visualViewport;
    visible?.addEventListener('resize', update);
    visible?.addEventListener('scroll', update);
    return () => {
      window.removeEventListener('resize', update);
      visible?.removeEventListener('resize', update);
      visible?.removeEventListener('scroll', update);
    };
  }, [active]);
  return viewport;
}
