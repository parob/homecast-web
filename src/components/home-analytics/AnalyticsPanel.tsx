/**
 * THE frame every analytics chart lives in — the Grafana panel discipline
 * without Grafana: a title (what), a source line (from which sensors, at
 * what resolution), the visual, and a caption. One consistent shape is
 * what answers "what am I viewing and where does it come from" everywhere.
 */
export default function AnalyticsPanel({
  title,
  source,
  caption,
  actions,
  children,
}: {
  /** What this panel shows ("Temperature"). */
  title: string;
  /** Where the data comes from ("2 sensors · raw readings"). */
  source?: string;
  /** Summary under the visual ("min 21.8° · avg 22.6° · max 23.1°"). */
  caption?: React.ReactNode;
  /** Small controls at the panel's top right. */
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="border rounded-lg p-3 space-y-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <span className="text-xs font-medium">{title}</span>
        <span className="flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1">
          {/* Provenance is the first thing to go on a narrow screen: the
              toggles beside it are controls, and "8 rooms · averaged from 25
              sensors" was pushing them off the right edge. */}
          {source && <span className="hidden text-[0.625rem] text-muted-foreground sm:inline">{source}</span>}
          {actions}
        </span>
      </div>
      {children}
      {caption && <div className="text-[0.6875rem] text-muted-foreground">{caption}</div>}
    </div>
  );
}
