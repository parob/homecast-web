import React, { useState, useRef, useEffect, memo, ReactNode } from 'react';

interface LazyWidgetProps {
  children: ReactNode;
  /** Height estimate for placeholder when not visible (default: 120px for compact, 180px for normal) */
  estimatedHeight?: number;
  /** Margin around viewport to start loading (default: 200px) */
  rootMargin?: string;
  /** Whether this is in compact mode */
  compact?: boolean;
  /** Optional className for the wrapper */
  className?: string;
}

/**
 * LazyWidget - Defers rendering of children until they're near the viewport
 * Uses Intersection Observer for native, performant lazy loading without third-party libraries
 */
const LazyWidgetInner: React.FC<LazyWidgetProps> = ({
  children,
  estimatedHeight,
  rootMargin = '300px',
  compact = false,
  className = '',
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [hasBeenVisible, setHasBeenVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Calculate estimated height based on compact mode
  const placeholderHeight = estimatedHeight ?? (compact ? 52 : 140);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    // Check if Intersection Observer is supported
    if (!('IntersectionObserver' in window)) {
      // Fallback: just render everything
      setIsVisible(true);
      setHasBeenVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsVisible(true);
            setHasBeenVisible(true);
          } else if (hasBeenVisible) {
            // Once rendered, keep in DOM but can optionally hide
            // For now, keep visible to preserve state (like slider positions)
            // setIsVisible(false); // Uncomment to truly virtualize
          }
        });
      },
      {
        rootMargin,
        threshold: 0,
      }
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [rootMargin, hasBeenVisible]);

  // Show placeholder while not visible
  if (!isVisible && !hasBeenVisible) {
    return (
      <div
        ref={containerRef}
        className={className}
        style={{
          minHeight: placeholderHeight,
          width: '100%',
        }}
      />
    );
  }

  // Render actual content
  return (
    <div ref={containerRef} className={className}>
      {children}
    </div>
  );
};

export const LazyWidget = memo(LazyWidgetInner);
