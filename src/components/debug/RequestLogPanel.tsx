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
import { ChevronDown, ChevronUp, Copy, Trash2, Minus, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  getRequestLog, subscribeRequestLog, clearRequestLog, formatRequestLog,
  type RequestLogEntry,
} from '@/lib/request-log';
import { setDebugDockHeight } from '@/lib/debug-dock';

/** Height of the dock. Enough for ~12 rows without dominating a phone. */
const DEFAULT_HEIGHT = 260;
const MIN_HEIGHT = 120;
/**
 * Height of the collapsed bar. Explicit rather than `auto` so the open/close can
 * animate — height does not transition to or from `auto`. Generous, because this
 * is the only way back into the panel and it sits on the bottom edge of the
 * screen, where a thumb is least accurate.
 */
const COLLAPSED_HEIGHT = 52;

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
  // Collapsed to its header bar. Recording carries on regardless — the
  // recorder does not know or care whether anything is on screen.
  const [minimised, setMinimised] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => subscribeRequestLog(() => forceRender(n => n + 1)), []);

  // What the dock is costing the bottom of the screen, for chrome that portals
  // out of it and so cannot be squashed by it — the tab bar. See lib/debug-dock.
  const dockHeight = minimised ? COLLAPSED_HEIGHT : height;
  useEffect(() => {
    setDebugDockHeight(dockHeight);
    return () => setDebugDockHeight(0);
  }, [dockHeight]);

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
      // Rounded: clientY is fractional on a trackpad, and a panel sitting on a
      // half-pixel renders every glyph and icon in it blurry.
      const next = Math.round(Math.max(MIN_HEIGHT, Math.min(window.innerHeight - 80, startHeight - (ev.clientY - startY))));
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
      className={cn(
        'shrink-0 flex flex-col overflow-hidden bg-[#0b0e14] text-white select-none',
        'transition-[height] duration-200 ease-out',
        // Collapsed it is a bar across the bottom edge: full width, square, and
        // flush — an inset one read as a floating card rather than part of the
        // app's own chrome, and an inset underneath just wasted the space the
        // collapse had saved.
        'border-t border-white/10',
      )}
      style={{ height: dockHeight }}
    >
      {!minimised && (
        <div
          onPointerDown={startResize}
          className="h-1.5 shrink-0 cursor-ns-resize bg-white/5 hover:bg-white/20 transition-colors"
          role="separator"
          aria-label="Resize request log"
        />
      )}
      {/* Minimised, this bar is the only way back — and it sits on the very
          bottom edge of the screen, where a 20px icon is not a target a thumb
          can find. So the summary itself becomes the button, spanning the whole
          width, and the row grows to a size a finger can actually land on. */}
      <div className={`flex items-center gap-2 shrink-0 ${minimised ? 'h-full py-0 px-4' : 'px-3 py-1.5 border-b border-white/10'}`}>
        {minimised ? (
          <button
            onClick={() => setMinimised(false)}
            aria-label="Expand request log"
            // Full width so the whole bar is the target, but nothing painted:
            // it used to pull out into the row's padding with a negative margin
            // and fill it on hover, which put a colour where the inset should be.
            // Feedback is on the text instead, which tints nothing but itself.
            className="group relative flex flex-1 items-center gap-2 self-stretch text-left"
          >
            <span className="text-[11px] font-semibold tracking-wide text-white/80 transition-colors group-hover:text-white">Requests</span>
            <span className="text-[11px] text-white/35 tabular-nums">{entries.length}</span>
            {errors > 0 && (
              <span className="text-[11px] text-red-400 tabular-nums">{errors} failed</span>
            )}
            <ChevronUp className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 text-white/50 transition-colors group-hover:text-white" />
          </button>
        ) : (
          <>
            <span className="text-[11px] font-semibold tracking-wide text-white/80">Requests</span>
            <span className="text-[11px] text-white/35 tabular-nums">{entries.length}</span>
            {errors > 0 && (
              <span className="text-[11px] text-red-400 tabular-nums">{errors} failed</span>
            )}
            <span className="flex-1" />
          </>
        )}
        {/* Follow scrolls the list to the bottom, so it means nothing without a
            list on screen — and collapsed it was the one thing still painting a
            background inside the bar's padding. */}
        {!follow && !minimised && (
          <button
            onClick={() => { setFollow(true); const el = scrollerRef.current; if (el) el.scrollTop = el.scrollHeight; }}
            className="flex items-center gap-1 text-[11px] text-white/50 hover:text-white px-1.5 py-0.5 rounded hover:bg-white/10"
          >
            <ChevronDown className="h-3 w-3" /> Follow
          </button>
        )}
        {!minimised && <button
          onClick={copy}
          title="Copy as text"
          className="flex items-center gap-1 text-[11px] text-white/50 hover:text-white px-1.5 py-0.5 rounded hover:bg-white/10"
        >
          {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>}
        {!minimised && <button
          onClick={() => clearRequestLog()}
          title="Clear"
          className="text-white/50 hover:text-white p-2 rounded hover:bg-white/10"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>}
        {/* Minimise, not close: switching the log off entirely belongs in
            Settings, and an X here is a trap — it looks like "hide for now" and
            actually costs you the capture you are in the middle of taking. */}
        {!minimised && <button
          onClick={() => setMinimised(true)}
          title="Minimise"
          aria-expanded
          className="shrink-0 self-stretch flex items-center text-white/50 hover:text-white rounded hover:bg-white/10 p-2"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>}
      </div>
      {!minimised && (
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
      )}
    </div>
  );
}

export default RequestLogPanel;
