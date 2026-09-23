import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import { wallpaperRegion, type WallpaperRgb } from '@/lib/wallpaper-region';

/** Update only the wrapper's ink when a tile moves over a photograph. */
export function useWallpaperRegion(
  ref: RefObject<HTMLElement>,
  image: HTMLImageElement | null | undefined,
  brightness = 50,
): WallpaperRgb | null {
  const [colour, setColour] = useState<WallpaperRgb | null>(null);
  const measure = () => {
    const next = image && ref.current ? wallpaperRegion(image, ref.current.getBoundingClientRect(), brightness) : null;
    setColour(previous => previous?.join(',') === next?.join(',') ? previous : next);
  };
  // Layout/reorder renders can move a tile without changing its own size.
  useLayoutEffect(measure);
  useEffect(() => {
    if (!image) return;
    let frame = 0;
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; measure(); });
    };
    window.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.addEventListener('resize', schedule);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    if (ref.current) observer?.observe(ref.current);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
    };
  }, [image, brightness]); // eslint-disable-line react-hooks/exhaustive-deps
  return image ? colour : null;
}
