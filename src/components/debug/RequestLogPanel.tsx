// A docked log of everything this client has asked the relay for.
//
// Docked rather than floating on purpose: it squashes the app instead of
// covering it, so you can watch a screen and the traffic behind it at the same
// time — which is the whole point when the question is "what did it do when it
// opened, and does the screen match".
//
// Developer Mode only, off by default, and its own switch lives beside that one
// in Settings → Account.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Copy, Trash2, X, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  getRequestLog, subscribeRequestLog, clearRequestLog, formatRequestLog,
  setRequestPanelEnabled, type RequestLogEntry,
} from '@/lib/request-log';

/** Height of the dock. Enough for ~12 rows without dominating a phone. */
const DEFAULT_HEIGHT = 260;
const MIN_HEIGHT = 120;

function statusColour(e: RequestLogEntry): string {
  if (e.kind === 'event') return 'text-sky-400';
  if (e.status === 'error') return 'text-red-400';
  if (e.status === 'pending') return 'text-amber-400';
  return 'text-emerald-400';
}

/** Slow enough to be worth noticing, at a glance. */
function durationColour(ms: number): string {
  if (ms >= 3000) return 'text-red-400';
  if (ms >= 1000) return 'text-amber-400';
  return 'text-white/40';
}

function Row({ e }: { e: RequestLogEntry }) {
  return (
    <div className="flex items-baseline gap-2 px-3 py-[3px] hover:bg-white/5 font-mono text-[11px] leading-snug">
      {/* Relative to page load — the axis that matters when reading a launch. */}
      <span className="text-white/30 tabular-nums shrink-0 w-[52px] text-right">
        +{(e.at / 1000).toFixed(2)}s
      </span>
      <span className={cn('shrink-0 w-3', statusColour(e))}>
        {e.kind === 'event' ? '·' : e.status === 'pending' ? '◌' : e.status === 'error' ? '✕' : '✓'}
      </span>
      <span className={cn('shrink-0', e.kind === 'event' ? 'text-sky-300' : 'text-white/90')}>
        {e.action}
      </span>
      {e.detail && <span className="text-white/40 truncate">{e.detail}</span>}
      <span className="flex-1" />
      {e.error && <span className="text-red-400 shrink-0">{e.error}</span>}
      {e.via && e.via !== 'ws' && <span className="text-violet-300 shrink-0">{e.via}</span>}
      {e.durationMs !== undefined && (
        <span className={cn('tabular-nums shrink-0', durationColour(e.durationMs))}>
          {e.durationMs}ms
        </span>
      )}
    </div>
  );
}

export function RequestLogPanel() {
  const [, forceRender] = useState(0);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [follow, setFollow] = useState(true);
  const [copied, setCopied] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => subscribeRequestLog(() => forceRender(n => n + 1)), []);

  const entries = getRequestLog();

  // Stick to the bottom while following, so a launch scrolls past live. Reading
  // back through history turns following off until you return to the bottom.
  useEffect(() => {
    if (!follow) return;
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length, follow]);

  const onScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setFollow(atBottom);
  }, []);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(formatRequestLog());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard refused (insecure context, or denied). Nothing useful to do.
    }
  }, []);

  // Drag the top edge to resize. Pointer events so it works with touch too.
  const startResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = height;
    const move = (ev: PointerEvent) => {
      const next = Math.max(MIN_HEIGHT, Math.min(window.innerHeight - 80, startHeight - (ev.clientY - startY)));
      setHeight(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [height]);

  const errors = entries.filter(e => e.status === 'error').length;

  return (
    <div
      className="shrink-0 flex flex-col bg-[#0b0e14] text-white border-t border-white/10 select-none"
      style={{ height }}
    >
      <div
        onPointerDown={startResize}
        className="h-1.5 shrink-0 cursor-ns-resize bg-white/5 hover:bg-white/20 transition-colors"
        role="separator"
        aria-label="Resize request log"
      />
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/10 shrink-0">
        <span className="text-[11px] font-semibold tracking-wide text-white/80">Requests</span>
        <span className="text-[11px] text-white/35 tabular-nums">{entries.length}</span>
        {errors > 0 && (
          <span className="text-[11px] text-red-400 tabular-nums">{errors} failed</span>
        )}
        <span className="flex-1" />
        {!follow && (
          <button
            onClick={() => { setFollow(true); const el = scrollerRef.current; if (el) el.scrollTop = el.scrollHeight; }}
            className="flex items-center gap-1 text-[11px] text-white/50 hover:text-white px-1.5 py-0.5 rounded hover:bg-white/10"
          >
            <ChevronDown className="h-3 w-3" /> Follow
          </button>
        )}
        <button
          onClick={copy}
          title="Copy as text"
          className="flex items-center gap-1 text-[11px] text-white/50 hover:text-white px-1.5 py-0.5 rounded hover:bg-white/10"
        >
          {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button
          onClick={() => clearRequestLog()}
          title="Clear"
          className="text-white/50 hover:text-white p-1 rounded hover:bg-white/10"
        >
          <Trash2 className="h-3 w-3" />
        </button>
        <button
          onClick={() => setRequestPanelEnabled(false)}
          title="Close (re-enable in Settings → Account)"
          className="text-white/50 hover:text-white p-1 rounded hover:bg-white/10"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto overscroll-contain"
      >
        {entries.length === 0 ? (
          <p className="px-3 py-3 text-[11px] text-white/35 font-mono">
            Nothing yet. Reload the app with this open to capture a launch.
          </p>
        ) : (
          entries.map(e => <Row key={e.id} e={e} />)
        )}
      </div>
    </div>
  );
}

export default RequestLogPanel;
