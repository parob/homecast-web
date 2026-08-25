/**
 * The floating control shown while the screen is being recorded.
 *
 * It exists because the report sheet has to get out of the way: a recording
 * that starts with a dialog covering the app records the dialog. So the sheet
 * hides, this stays, and the user reproduces the problem with only a small pill
 * on screen.
 *
 * Deliberately shows the elapsed time against the cap. A recording that stops
 * itself without warning looks like a bug, and someone demonstrating a slow
 * problem needs to know how long they have.
 */

import { Square } from 'lucide-react';

import { Button } from '@/components/ui/button';

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
      className="fixed inset-x-0 bottom-6 z-[100] flex justify-center px-4"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-3 rounded-full border bg-background/95 px-4 py-2 shadow-lg backdrop-blur">
        <span className="relative flex h-2.5 w-2.5" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-600" />
        </span>

        <span className="text-sm font-medium tabular-nums">
          {format(elapsedMs)}
        </span>
        <span
          className={`text-xs tabular-nums ${
            runningOut ? 'text-destructive' : 'text-muted-foreground'
          }`}
        >
          {remaining > 0 ? `${format(remaining)} left` : 'stopping…'}
        </span>

        <span className="hidden text-xs text-muted-foreground sm:inline">
          Show us the problem
        </span>

        <Button type="button" size="sm" variant="destructive" onClick={onStop}>
          <Square className="mr-1.5 h-3 w-3 fill-current" />
          Stop
        </Button>
      </div>
    </div>
  );
}
