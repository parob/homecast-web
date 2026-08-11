/**
 * Tiny pure-SVG sparkline for Analytics tiles — no recharts on the
 * overview. Pattern-copied from the cloud admin's analytics sparkline
 * (src/cloud/pages/admin/analytics/shared.tsx); the OSS bundle must not
 * import from src/cloud, so this is a copy by design.
 */
export default function Sparkline({
  values,
  height = 24,
  className = 'text-primary',
}: {
  values: number[];
  height?: number;
  className?: string;
}) {
  if (values.length < 2) return <div style={{ height }} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((v, i) => `${(i / (values.length - 1)) * 100},${height - 2 - ((v - min) / span) * (height - 4)}`)
    .join(' ');

  return (
    <svg
      className={`w-full ${className}`}
      height={height}
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <polygon
        points={`0,${height} ${points} 100,${height}`}
        fill="currentColor"
        fillOpacity={0.18}
      />
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.2}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
