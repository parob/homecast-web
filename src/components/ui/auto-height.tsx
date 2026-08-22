import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * A row that animates its own height when its contents rewrap.
 *
 * For the summary row, which changes shape when Edit Layout starts: the edit
 * variant reveals sections that are hidden the rest of the time, and each pill
 * carries a control the live one does not, so on a narrow phone it can wrap to
 * a second line where the live row fits on one. That is a 32px step, and it
 * lands while a tile is being dragged — Edit Layout is entered by a long press
 * that is already a drag — so the grid below jumps under the finger.
 *
 * The step cannot be designed away: the two rows hold different things, and how
 * they wrap depends on the label lengths, the counts and the viewport. So it is
 * animated instead, which is the one treatment that degrades gracefully whatever
 * the widths turn out to be.
 *
 * `height: auto` is not animatable, so the height is measured and set. A
 * ResizeObserver on the *content* rather than the wrapper is what makes this
 * self-driving — the wrapper's height is the thing being animated, so observing
 * it would feed the animation back into itself.
 */
export function AutoHeight({
  children,
  className,
  /** Skip the animation entirely — for the first paint, and for tests. */
  disabled = false,
}: {
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const content = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  // Nothing animates until a first height is known, or the row would slide down
  // from zero on the initial paint.
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const el = content.current;
    if (!el) return;
    const measure = () => setHeight(el.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (height !== null) setReady(true);
  }, [height]);

  // Somebody who has asked for less movement gets the step, not a slide. The
  // tab bar reads the same preference.
  const reduced = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const animate = ready && !disabled && !reduced;

  return (
    <div
      // `overflow-hidden` only while animating: the row holds real controls, and
      // clipping them the rest of the time would cut off a focus ring.
      className={cn(animate && 'overflow-hidden transition-[height] duration-base ease-standard', className)}
      style={height === null ? undefined : { height }}
    >
      <div ref={content}>{children}</div>
    </div>
  );
}
