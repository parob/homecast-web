import { useRef, useState, useEffect, type ReactNode } from 'react';
import { WidgetSkeleton } from '@/components/LoadingSkeletons';

interface LazyWidgetProps {
  children: ReactNode;
  /** Estimated height for placeholder when not yet visible */
  height?: number;
  /** Whether lazy rendering is enabled (disabled for small lists) */
  enabled?: boolean;
  /** Tile sits over a dark wallpaper — use white overlays in the placeholder */
  tone?: 'light' | 'dark';
}

/**
 * Defers rendering of widget content until it enters the viewport.
 * Once visible, content stays mounted to avoid layout shifts during drag-and-drop.
 */
export function LazyWidget({ children, height = 120, enabled = true, tone = 'light' }: LazyWidgetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [hasBeenVisible, setHasBeenVisible] = useState(!enabled);

  useEffect(() => {
    if (!enabled || hasBeenVisible) return;
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setHasBeenVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '300px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled, hasBeenVisible]);

  if (hasBeenVisible) {
    return <>{children}</>;
  }

  // A tile-shaped placeholder rather than a blank sized div: off-screen widgets
  // scrolled into view used to appear out of empty space, which reads as a
  // rendering fault on a long list.
  return (
    <div ref={ref} style={{ minHeight: height }}>
      <WidgetSkeleton tone={tone} compact={height <= 100} />
    </div>
  );
}
