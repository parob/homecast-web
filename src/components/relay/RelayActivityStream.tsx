// Live view of what a relay is doing: socket traffic, HomeKit updates, automation runs.
//
// Built because every diagnosis of a misbehaving relay came from Cloud Logging
// queries the account owner cannot run, and the signal that mattered most — a
// request sent and never answered — appeared on no screen at all.
//
// One timeline rather than three panes, because the lanes are causally linked:
// a HomeKit update triggers an automation which causes socket traffic. Splitting
// them hides the chain, which is exactly what you are trying to read.

import { useEffect, useMemo, useState } from 'react';
import { useRelayActivity } from '@/hooks/useRelayActivity';
import type { RelayActivityEntry } from '@/server/websocket';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Pause, Play, Trash2, ArrowLeftRight, Home, Zap, Copy, Check, Cloud, Cpu } from 'lucide-react';

type Lane = 'all' | 'faults' | 'socket' | 'bridge' | 'homekit' | 'automation' | 'cloud';

// Named by direction, because two of these involve HomeKit and mean opposite
// things: "HomeKit calls" are calls this relay makes *into* HomeKit, "HomeKit
// updates" are HomeKit telling the relay something changed.
const LANES: { key: Lane; label: string }[] = [
  { key: 'all', label: 'All' },
  // Not a lane but a filter across all of them, and first after All because
  // it is what you are looking for when something is wrong.
  { key: 'faults', label: 'Faults' },
  { key: 'socket', label: 'Requests' },
  { key: 'bridge', label: 'HomeKit calls' },
  { key: 'homekit', label: 'HomeKit updates' },
  { key: 'automation', label: 'Automations' },
  { key: 'cloud', label: 'Cloud' },
];

/** Gap worth calling out. Below this it is ordinary quiet. */
const SILENCE_THRESHOLD_MS = 60_000;

/**
 * How long a request may be outstanding before it is worth showing.
 *
 * Almost every request completes in tens of milliseconds, and its outcome
 * replaces the pending row. Showing that flicker is pure noise — so a request
 * is invisible until it has been waiting long enough to be interesting.
 */
const PENDING_VISIBLE_AFTER_MS = 2_000;
/** Past this, it is not slow, it is stuck — and it is said plainly. */
const PENDING_STUCK_AFTER_MS = 10_000;

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
    if (entry.lane === 'socket' || entry.lane === 'bridge') {
      const outcome =
        entry.phase === 'sent' ? `NO RESPONSE (still waiting)`
        : entry.phase === 'failed' ? `FAILED ${entry.error ?? ''} ${entry.ms ? describeDuration(entry.ms) : ''}`.trim()
        : `ok ${entry.ms !== undefined ? describeDuration(entry.ms) : ''}`.trim();
      detail = `${entry.action}${entry.origin === 'cloud' ? ' [cloud]' : ''}  ${outcome}`;
    } else if (entry.lane === 'cloud') {
      detail = `${entry.action}  (received from cloud)`;
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
    if (entry.request !== undefined) lines.push(`${' '.repeat(12)}request  ${JSON.stringify(entry.request)}`);
    if (entry.response !== undefined) lines.push(`${' '.repeat(12)}response ${JSON.stringify(entry.response)}`);
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
  if (lane === 'cloud') return <Cloud className={cn(cls, 'text-slate-400')} />;
  if (lane === 'bridge') return <Cpu className={cn(cls, 'text-orange-500')} />;
  return <Zap className={cn(cls, 'text-violet-500')} />;
}

function SocketRow({ entry, nowSec }: { entry: RelayActivityEntry; nowSec: number }) {
  const pending = entry.phase === 'sent';
  const failed = entry.phase === 'failed';
  // Counts up while outstanding, so a stuck request visibly gets worse rather
  // than sitting at a fixed, reassuring "waiting".
  const waitingMs = pending ? Math.max(0, (nowSec - entry.at) * 1000) : 0;
  const stuck = pending && waitingMs >= PENDING_STUCK_AFTER_MS;

  return (
    <>
      <span className="font-medium truncate">{entry.action}</span>
      {entry.origin === 'cloud' && (
        <span className="shrink-0 rounded bg-muted px-1 text-[9px] text-muted-foreground">cloud</span>
      )}
      <span
        className={cn(
          'ml-auto shrink-0 tabular-nums',
          stuck && 'font-semibold text-red-600 dark:text-red-400',
          pending && !stuck && 'text-amber-600 dark:text-amber-500',
          failed && 'text-red-600 dark:text-red-400',
          !pending && !failed && 'text-muted-foreground',
        )}
      >
        {stuck && `⚠ NO RESPONSE ${describeDuration(waitingMs)}`}
        {pending && !stuck && `waiting ${describeDuration(waitingMs)}`}
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

function CloudRow({ entry }: { entry: RelayActivityEntry }) {
  return (
    <>
      <span className="font-medium truncate">{entry.action}</span>
      <span className="ml-auto shrink-0 text-muted-foreground">from cloud</span>
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

/** One row, expandable where there is a payload worth reading. */
function ActivityRow({ entry, nowSec }: { entry: RelayActivityEntry; nowSec: number }) {
  const [open, setOpen] = useState(false);
  const hasDetail =
    entry.request !== undefined || entry.response !== undefined || entry.steps !== undefined;

  return (
    <div className="border-b border-border/40 last:border-0">
      <div
        className={cn('flex items-center gap-2 px-3 py-1', hasDetail && 'cursor-pointer hover:bg-muted/40')}
        onClick={hasDetail ? () => setOpen(!open) : undefined}
      >
        <span className="shrink-0 tabular-nums text-muted-foreground">{clockTime(entry.at)}</span>
        <LaneIcon lane={entry.lane} />
        {(entry.lane === 'socket' || entry.lane === 'bridge') && (
          <SocketRow entry={entry} nowSec={nowSec} />
        )}
        {entry.lane === 'homekit' && <HomeKitRow entry={entry} />}
        {entry.lane === 'automation' && <AutomationRow entry={entry} />}
        {entry.lane === 'cloud' && <CloudRow entry={entry} />}
      </div>

      {open && (
        // Collapsed by default: payloads are large and drown the timeline,
        // which is the thing you are scanning.
        <div className="space-y-1 bg-muted/30 px-3 pb-2">
          {entry.request !== undefined && (
            <pre className="overflow-x-auto text-[10px]">request  {JSON.stringify(entry.request, null, 2)}</pre>
          )}
          {entry.response !== undefined && (
            <pre className="overflow-x-auto text-[10px]">response {JSON.stringify(entry.response, null, 2)}</pre>
          )}
          {entry.steps !== undefined && (
            <pre className="overflow-x-auto text-[10px]">{JSON.stringify(entry.steps, null, 2)}</pre>
          )}
        </div>
      )}
    </div>
  );
}

export function RelayActivityStream({ deviceId }: { deviceId: string | undefined }) {
  const { entries, paused, setPaused, clear, pendingWhilePaused } = useRelayActivity(deviceId);
  const [lane, setLane] = useState<Lane>('all');
  const [copied, setCopied] = useState(false);
  const [nowSec, setNowSec] = useState(() => Date.now() / 1000);

  // Only tick while something is actually outstanding — an idle relay should
  // not re-render this list once a second forever.
  const hasPending = entries.some(
    (e) => (e.lane === 'socket' || e.lane === 'bridge') && e.phase === 'sent',
  );
  useEffect(() => {
    if (!hasPending) return;
    const t = setInterval(() => setNowSec(Date.now() / 1000), 500);
    return () => clearInterval(t);
  }, [hasPending]);

  const visible = useMemo(() => {
    const byLane =
      lane === 'all' ? entries
      : lane === 'faults'
        ? entries.filter((e) => e.error || e.phase === 'failed' || e.status === 'error')
        : entries.filter((e) => e.lane === lane);
    // Almost every request finishes in milliseconds and its outcome replaces the
    // pending row, so showing that flicker is noise. A request appears only once
    // it has been waiting long enough to be worth knowing about.
    return byLane.filter((e) => {
      if ((e.lane !== 'socket' && e.lane !== 'bridge') || e.phase !== 'sent') return true;
      return (nowSec - e.at) * 1000 >= PENDING_VISIBLE_AFTER_MS;
    });
  }, [entries, lane, nowSec]);

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
            {!deviceId ? 'No relay connected'
              : lane === 'faults' ? 'Nothing has failed.'
              : 'Waiting for activity…'}
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

              <ActivityRow entry={entry} nowSec={nowSec} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
