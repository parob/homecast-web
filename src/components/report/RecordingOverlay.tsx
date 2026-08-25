/**
 * The floating control shown while the screen is being recorded.
 *
 * It exists because the report sheet has to get out of the way: a recording
 * that starts with a dialog covering the app records the dialog. So the sheet
 * hides, this stays, and the user reproduces the problem with only a small pill
 * on screen.
 *
 * Two things about where it sits, both learned the hard way:
 *
 * It is above the mobile tab bar in BOTH senses. The bar is `fixed z-[10001]`,
 * so anything below that z-index is drawn underneath it — this was `z-[100]`
 * and disappeared behind the bar. And it is lifted clear of the bar's height so
 * the tabs stay tappable: someone reproducing a problem usually has to navigate
 * to it, and a recording control that blocks navigation defeats the recording.
 *
 * Bottom right and small, not centred and wide. While this is up, the app is
 * the thing being looked at; the control only has to be findable, not read.
 */

import { Square } from 'lucide-react';

interface RecordingOverlayProps {
  elapsedMs: number;
  maxMs: number;
  onStop: () => void;
}

function format(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function RecordingOverlay({ elapsedMs, maxMs, onStop }: RecordingOverlayProps) {
  const remaining = Math.max(0, maxMs - elapsedMs);
  const runningOut = remaining <= 10_000;

  return (
    <div
      // Excluded from a DOM screenshot; a screen recording will see it, which
      // is honest — the same way the OS shows its own recording indicator.
      data-report-exclude="true"
      // pointer-events-none on the frame so it never eats a tap meant for the
      // app; the pill itself takes them back.
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[10002] flex justify-end px-4"
      style={{ paddingBottom: 'calc(var(--safe-area-bottom, 0px) + 5rem)' }}
      role="status"
      aria-live="polite"
    >
      <button
        type="button"
        onClick={onStop}
        aria-label={`Stop recording (${format(elapsedMs)} elapsed)`}
        className="pointer-events-auto flex items-center gap-2 rounded-full border bg-background/90 py-1.5 pl-3 pr-2 shadow-lg backdrop-blur transition-colors hover:bg-background"
      >
        <span className="relative flex h-2 w-2" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-red-600" />
        </span>

        <span
          className={`text-xs font-medium tabular-nums ${
            runningOut ? 'text-destructive' : ''
          }`}
        >
          {/* Counts down only in the last ten seconds. A recording that stops
              itself without warning looks like a bug; before that, the elapsed
              time is the useful number and the quieter one. */}
          {remaining > 0 && runningOut ? `${format(remaining)} left` : format(elapsedMs)}
        </span>

        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-white">
          <Square className="h-2.5 w-2.5 fill-current" />
        </span>
      </button>
    </div>
  );
}
