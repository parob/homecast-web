/**
 * One loading language for the app.
 *
 * The Dashboard used to carry a dozen unrelated loading states — a black splash,
 * a blank Suspense frame, a white full-screen spinner, and six more spinners in
 * one ternary ladder — so a cold start showed the viewport change colour and
 * shape several times before any content appeared. Worse, the sidebar's home and
 * room lists were a strict `loading ? spinner : list.map()`, so an empty array
 * rendered a zero-height div and read as a rendering glitch.
 *
 * These are the replacements. The rule they share is the one already written
 * down in ChartSkeleton: a placeholder is shape- and size-matched to the thing
 * that is coming, so the page keeps its height and nothing jumps when data
 * lands. A spinner in empty space measures nothing and then shoves everything
 * down.
 *
 * `tone` exists because Dashboard tiles sit over a user wallpaper. `bg-muted` is
 * a solid theme token and disappears against a dark background, so surfaces that
 * know they are dark pass tone="dark" and get white overlays instead.
 */
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

type Tone = 'light' | 'dark';

/** Pulsing block. The one primitive everything here is built from. */
function Bar({ tone, className }: { tone: Tone; className?: string }) {
  return (
    <div
      className={cn(
        'animate-pulse rounded',
        tone === 'dark' ? 'bg-white/15' : 'bg-muted',
        className
      )}
    />
  );
}

/**
 * Sidebar home/room rows. Matches SortableHomeItem's shape: an icon square, a
 * name bar, and the trailing count — at the same `px-3 py-2` rhythm, so the
 * list does not resize when the real rows replace it.
 */
export function SidebarRowsSkeleton({
  rows = 3,
  tone = 'light',
  compact = false,
}: {
  rows?: number;
  tone?: Tone;
  compact?: boolean;
}) {
  return (
    <div className={compact ? 'space-y-0.5' : 'space-y-1'} aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className={cn(
            'flex w-full items-center gap-2 rounded-lg px-3',
            compact ? 'py-1.5' : 'py-2'
          )}
        >
          <Bar tone={tone} className={compact ? 'h-3 w-3 shrink-0' : 'h-4 w-4 shrink-0'} />
          {/* Varied widths so it reads as a list of names, not a progress bar. */}
          <Bar
            tone={tone}
            className={cn(compact ? 'h-2.5' : 'h-3', ['w-24', 'w-32', 'w-20', 'w-28'][i % 4])}
          />
          <div className="flex-1" />
          <Bar tone={tone} className={cn(compact ? 'h-2.5 w-3' : 'h-3 w-4')} />
        </div>
      ))}
    </div>
  );
}

/**
 * A single accessory tile placeholder, sized to the real widget height so the
 * masonry grid does not reflow when tiles resolve.
 */
export function WidgetSkeleton({
  tone = 'light',
  compact = false,
}: {
  tone?: Tone;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border p-3',
        tone === 'dark' ? 'border-white/10 bg-white/5' : 'border-border bg-card'
      )}
      style={{ minHeight: compact ? 80 : 140 }}
      aria-hidden="true"
    >
      <div className="flex items-start gap-2">
        <Bar tone={tone} className="h-8 w-8 shrink-0 rounded-full" />
        <div className="flex-1 space-y-2 pt-1">
          <Bar tone={tone} className="h-3 w-2/3" />
          <Bar tone={tone} className="h-2.5 w-1/3" />
        </div>
      </div>
      {!compact && <Bar tone={tone} className="mt-4 h-8 w-full rounded-lg" />}
    </div>
  );
}

/**
 * The accessory grid before it arrives — room headings with tiles underneath,
 * in the same column shape the real grid uses.
 *
 * `progress` is reported only where a real count exists (accessories are fetched
 * one request per home, so "3 of 5 homes" is a fact). A percentage invented from
 * a timer is the kind of progress bar nobody believes twice, so when there is no
 * count there is no bar.
 */
export function AccessoryGridSkeleton({
  rooms = [{ tiles: 4 }, { tiles: 3 }],
  tone = 'light',
  compact = false,
  progress,
  label,
}: {
  rooms?: { tiles: number }[];
  tone?: Tone;
  compact?: boolean;
  progress?: { done: number; total: number };
  label?: string;
}) {
  const pct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.done / progress.total) * 100))
      : null;

  return (
    <div className="space-y-6">
      {(pct !== null || label) && (
        <div className="flex items-center gap-2">
          {pct !== null && (
            <div
              className={cn(
                'h-1 flex-1 overflow-hidden rounded-full',
                tone === 'dark' ? 'bg-white/10' : 'bg-muted'
              )}
            >
              <div
                className="h-full rounded-full bg-primary/60 transition-[width] duration-300"
                style={{ width: `${Math.max(pct, 4)}%` }}
              />
            </div>
          )}
          <span
            className={cn(
              'shrink-0 text-[0.625rem] tabular-nums',
              pct === null && 'flex-1',
              tone === 'dark' ? 'text-white/60' : 'text-muted-foreground'
            )}
          >
            {progress ? `${progress.done} of ${progress.total} homes` : label}
          </span>
        </div>
      )}
      {rooms.map((room, i) => (
        <div key={i} className="space-y-3">
          <Bar tone={tone} className="h-4 w-32" />
          <div className="grid items-start gap-4 grid-cols-[repeat(auto-fill,minmax(320px,1fr))]">
            {Array.from({ length: room.tiles }, (_, j) => (
              <WidgetSkeleton key={j} tone={tone} compact={compact} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The boot visual — deliberately identical to the static #app-loader markup in
 * index.html.
 *
 * index.html paints it before any JS runs; React 18's createRoot().render()
 * clears #root and destroys it. Rendering the same thing as the Suspense
 * fallback and the auth gate is what makes the handoff continuous: previously
 * the user watched black → blank → white in the first second, three screens for
 * one wait.
 */
export function AppBootFallback({ status }: { status?: string } = {}) {
  // A short wait needs no words — a label that flashes for 200ms is noise. But
  // "stuck on a loading screen for ages" is exactly a wait that never says
  // anything, so past about a second the screen starts explaining itself. The
  // delay is what keeps this from being clutter on every fast boot.
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setWaited(true), 1200);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-7 bg-black"
      aria-label="Loading Homecast"
      role="status"
    >
      <img
        src="/icon-192.png"
        alt=""
        width={80}
        height={80}
        className="block rounded-[18px]"
      />
      <div className="h-[22px] w-[22px] animate-spin rounded-full border-2 border-white/10 border-t-white/50" />
      <p
        className={cn(
          'absolute bottom-24 px-8 text-center text-xs text-white/40 transition-opacity duration-500',
          waited ? 'opacity-100' : 'opacity-0'
        )}
      >
        {status ?? 'Starting up…'}
      </p>
    </div>
  );
}
