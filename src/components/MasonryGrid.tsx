import React, { ReactNode, useMemo, useState, useRef, useLayoutEffect } from 'react';

interface MasonryGridProps {
  children: ReactNode;
  enabled?: boolean;
  className?: string;
  compact?: boolean;
  style?: React.CSSProperties;
  minColumnWidth?: number;
}

export const MasonryGrid: React.FC<MasonryGridProps> = ({
  children,
  enabled = true,
  className = '',
  compact = false,
  style,
  minColumnWidth = 290,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [columnCount, setColumnCount] = useState(2);
  const childArray = useMemo(() => React.Children.toArray(children), [children]);

  // Calculate column count based on container width and min column width
  useLayoutEffect(() => {
    if (!enabled) return;

    const updateColumnCount = () => {
      if (!containerRef.current) return;
      const containerWidth = containerRef.current.offsetWidth;
      const gap = compact ? 8 : 12;
      // Calculate how many columns fit with the minimum width
      // Formula: n * minWidth + (n-1) * gap <= containerWidth
      // n * minWidth + n * gap - gap <= containerWidth
      // n * (minWidth + gap) <= containerWidth + gap
      // n <= (containerWidth + gap) / (minWidth + gap)
      const effectiveMinWidth = compact ? 100 : minColumnWidth;
      const maxCols = Math.floor((containerWidth + gap) / (effectiveMinWidth + gap));
      setColumnCount(Math.max(1, maxCols));
    };

    updateColumnCount();

    const resizeObserver = new ResizeObserver(updateColumnCount);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => resizeObserver.disconnect();
  }, [enabled, compact, minColumnWidth]);

  // Assign items to columns using round-robin for even distribution
  const columns = useMemo(() => {
    if (!enabled) return [];

    const cols: React.ReactNode[][] = Array.from({ length: columnCount }, () => []);

    // Simple round-robin: item 0 → col 0, item 1 → col 1, etc.
    // This ensures no gaps - items always fill left to right
    let validIndex = 0;
    childArray.forEach((child) => {
      if (!React.isValidElement(child)) return;
      const colIndex = validIndex % columnCount;
      cols[colIndex].push(child);
      validIndex++;
    });

    return cols;
  }, [childArray, columnCount, enabled]);

  // Non-masonry grid mode
  if (!enabled) {
    return (
      <div
        className={className}
        style={{
          ...style,
          // Ensure grid respects min-width
          ...(style?.gridTemplateColumns ? {} : {})
        }}
      >
        {children}
      </div>
    );
  }

  const gap = compact ? 8 : 12;

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        display: 'flex',
        gap: `${gap}px`,
        width: '100%',
        maxWidth: '100%',
        boxSizing: 'border-box',
      }}
    >
      {columns.map((columnItems, colIndex) => (
        <div
          key={colIndex}
          style={{
            flex: 1,
            flexBasis: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: `${gap}px`,
            minWidth: 0,
            maxWidth: '100%',
          }}
        >
          {columnItems.map((item, itemIndex) => (
            <div
              key={itemIndex}
              style={{
                width: '100%',
                minWidth: 0,
                maxWidth: '100%',
              }}
            >
              {item}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};
