// Live view of what a relay is doing: socket traffic, HomeKit updates, automation runs.
//
// Built because every diagnosis of a misbehaving relay came from Cloud Logging
// queries the account owner cannot run, and the signal that mattered most — a
// request sent and never answered — appeared on no screen at all.
//
// One timeline rather than three panes, because the lanes are causally linked:
// a HomeKit update triggers an automation which causes socket traffic. Splitting
// them hides the chain, which is exactly what you are trying to read.

import { useMemo, useState } from 'react';
import { useRelayActivity } from '@/hooks/useRelayActivity';
import type { RelayActivityEntry } from '@/server/websocket';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Pause, Play, Trash2, ArrowLeftRight, Home, Zap, Copy, Check } from 'lucide-react';

type Lane = 'all' | 'socket' | 'homekit' | 'automation';

const LANES: { key: Lane; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'socket', label: 'Socket' },
  { key: 'homekit', label: 'HomeKit' },
  { key: 'automation', label: 'Automations' },
];

/** Gap worth calling out. Below this it is ordinary quiet. */
const SILENCE_THRESHOLD_MS = 60_000;

function clockTime(at: number): string {
  return new Date(at * 1000).toLocaleTimeString('en-GB', { hour12: false });
}

function describeDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

/** Values read as On/Off where that is what they mean, not as true/1. */
function readValue(value: unknown): string {
  if (value === true || value === 1) return 'On';
  if (value === false || value === 0) return 'Off';
  if (value === null || value === undefined) return '—';
  return String(value);
}

/**
 * The stream as text, for pasting somewhere else.
 *
 * Deliberately the same shape as the screen — including the silence markers,
 * which are usually the point of sharing it at all. Oldest last, as displayed,
 * so a pasted excerpt reads the same way as the panel it came from.
 */
function formatForSharing(entries: RelayActivityEntry[]): string {
  const lines: string[] = [
    `Homecast relay activity — ${new Date().toISOString()} — ${entries.length} entries`,
    '',
  ];

  entries.forEach((entry, i) => {
    const previous = entries[i + 1];
    const gapMs = previous ? (entry.at - previous.at) * 1000 : 0;

    let detail: string;
    if (entry.lane === 'socket') {
      const outcome =
        entry.phase === 'sent' ? 'waiting…'
        : entry.phase === 'failed' ? `FAILED ${entry.error ?? ''} ${entry.ms ? describeDuration(entry.ms) : ''}`.trim()
        : `ok ${entry.ms !== undefined ? describeDuration(entry.ms) : ''}`.trim();
      detail = `${entry.action}  ${outcome}`;
    } else if (entry.lane === 'homekit') {
      detail = `${entry.accessoryId ?? '?'}  ${entry.characteristicType ?? '?'} = ${readValue(entry.value)}`;
    } else {
      const ms =
        entry.startedAt && entry.finishedAt
          ? new Date(entry.finishedAt).getTime() - new Date(entry.startedAt).getTime()
          : undefined;
      detail = `${entry.name ?? 'Automation'}  ${entry.steps?.length ?? 0} steps  ${entry.status}${ms !== undefined ? ` ${describeDuration(ms)}` : ''}`;
    }

    lines.push(`${clockTime(entry.at)}  ${entry.lane.padEnd(10)} ${detail}`);
    if (gapMs >= SILENCE_THRESHOLD_MS) {
      lines.push(`${' '.repeat(10)}──── silent ${describeDuration(gapMs)} ────`);
    }
  });

  return lines.join('\n');
}

function LaneIcon({ lane }: { lane: RelayActivityEntry['lane'] }) {
  const cls = 'h-3 w-3 shrink-0';
  if (lane === 'socket') return <ArrowLeftRight className={cn(cls, 'text-sky-500')} />;
  if (lane === 'homekit') return <Home className={cn(cls, 'text-emerald-500')} />;
  return <Zap className={cn(cls, 'text-violet-500')} />;
}

function SocketRow({ entry }: { entry: RelayActivityEntry }) {
  // A request still outstanding is the most important thing this screen shows,
  // so it gets the strongest treatment rather than being one row among many.
  const pending = entry.phase === 'sent';
  const failed = entry.phase === 'failed';

  return (
    <>
      <span className="font-medium truncate">{entry.action}</span>
      <span
        className={cn(
          'ml-auto shrink-0 tabular-nums',
          pending && 'text-amber-600 dark:text-amber-500',
          failed && 'text-red-600 dark:text-red-400',
          !pending && !failed && 'text-muted-foreground',
        )}
      >
        {pending && 'waiting…'}
        {failed && `✕ ${entry.error ?? 'failed'}${entry.ms ? ` ${describeDuration(entry.ms)}` : ''}`}
        {!pending && !failed && entry.ms !== undefined && `✓ ${describeDuration(entry.ms)}`}
      </span>
    </>
  );
}

function HomeKitRow({ entry }: { entry: RelayActivityEntry }) {
  return (
    <>
      <span className="font-medium truncate">{entry.accessoryId?.slice(0, 8) ?? 'accessory'}</span>
      <span className="text-muted-foreground truncate">{entry.characteristicType}</span>
      <span className="ml-auto shrink-0">{readValue(entry.value)}</span>
    </>
  );
}

function AutomationRow({ entry }: { entry: RelayActivityEntry }) {
  const failed = entry.status === 'error';
  const ms =
    entry.startedAt && entry.finishedAt
      ? new Date(entry.finishedAt).getTime() - new Date(entry.startedAt).getTime()
      : undefined;

  return (
    <>
      <span className="font-medium truncate">{entry.name ?? 'Automation'}</span>
      <span className="text-muted-foreground truncate">
        {(entry.steps?.length ?? 0)} step{(entry.steps?.length ?? 0) === 1 ? '' : 's'}
      </span>
      <span
        className={cn(
          'ml-auto shrink-0 tabular-nums',
          failed ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground',
        )}
      >
        {failed ? '✕ error' : '✓'} {ms !== undefined && describeDuration(ms)}
      </span>
    </>
  );
}

export function RelayActivityStream({ deviceId }: { deviceId: string | undefined }) {
  const { entries, paused, setPaused, clear, pendingWhilePaused } = useRelayActivity(deviceId);
  const [lane, setLane] = useState<Lane>('all');
  const [copied, setCopied] = useState(false);

  const visible = useMemo(
    () => (lane === 'all' ? entries : entries.filter((e) => e.lane === lane)),
    [entries, lane],
  );

  // Copies what is on screen, filter and all: a shared excerpt should match
  // what the person sharing it was looking at.
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(formatForSharing(visible));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be refused; say nothing rather than throw at the user.
    }
  };

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <div className="flex gap-1">
          {LANES.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setLane(key)}
              className={cn(
                'rounded-md px-2 py-1 text-xs transition-colors',
                lane === key ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1">
          {paused && pendingWhilePaused > 0 && (
            // Say what resuming will reveal — a paused live log that hides its
            // backlog makes you wonder whether anything happened at all.
            <span className="mr-1 text-[11px] text-amber-600 dark:text-amber-500">
              {pendingWhilePaused} while paused
            </span>
          )}
          <Button variant="ghost" size="sm" onClick={copy} disabled={visible.length === 0} title="Copy as text">
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setPaused(!paused)}>
            {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          </Button>
          <Button variant="ghost" size="sm" onClick={clear}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="max-h-[26rem] overflow-y-auto font-mono text-[11px]">
        {visible.length === 0 && (
          <p className="px-3 py-6 text-center text-muted-foreground">
            {deviceId ? 'Waiting for activity…' : 'No relay connected'}
          </p>
        )}

        {visible.map((entry, i) => {
          // Entries are newest-first, so the older neighbour is the next one.
          const previous = visible[i + 1];
          const gapMs = previous ? (entry.at - previous.at) * 1000 : 0;

          return (
            <div key={`${entry.at}-${i}`}>
              {gapMs >= SILENCE_THRESHOLD_MS && (
                // The gap is the point. A relay that answers nothing for minutes
                // took an entire evening to establish from the outside once.
                <div className="flex items-center gap-2 px-3 py-1 text-[10px] text-amber-600 dark:text-amber-500">
                  <span className="h-px flex-1 bg-amber-500/30" />
                  silent {describeDuration(gapMs)}
                  <span className="h-px flex-1 bg-amber-500/30" />
                </div>
              )}

              <div className="flex items-center gap-2 border-b border-border/40 px-3 py-1 last:border-0">
                <span className="shrink-0 tabular-nums text-muted-foreground">{clockTime(entry.at)}</span>
                <LaneIcon lane={entry.lane} />
                {entry.lane === 'socket' && <SocketRow entry={entry} />}
                {entry.lane === 'homekit' && <HomeKitRow entry={entry} />}
                {entry.lane === 'automation' && <AutomationRow entry={entry} />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
