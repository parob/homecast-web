// A docked log of everything this client has asked the relay for.
//
// Docked rather than floating on purpose: it squashes the app instead of
// covering it, so you can watch a screen and the traffic behind it at the same
// time — which is the whole point when the question is "what did it do when it
// opened, and does the screen match".
//
// Minimised is the other half of that bargain, and it is the opposite shape: a
// button in the bottom-right corner, floating over the app, reserving nothing.
// It used to be a full-width bar across the bottom edge, on the reasoning that
// a flush bar reads as the app's own chrome where an inset one reads as a
// floating card. True, but it cost 52px of squashed app and lifted the tab bar
// by the same, which is a lot of screen to spend on something whose only job
// is to say "still recording, tap to come back". See homecast-cloud#122.
//
// Developer Mode only, off by default, and its own switch lives beside that one
// in Settings → Account.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronUp, Copy, Trash2, Minus, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  getRequestLog, subscribeRequestLog, clearRequestLog, formatRequestLog,
  type RequestLogEntry,
} from '@/lib/request-log';
import { setDebugDockHeight, setDebugDockRail } from '@/lib/debug-dock';

/** Height of the dock. Enough for ~12 rows without dominating a phone. */
const DEFAULT_HEIGHT = 260;
const MIN_HEIGHT = 120;
/** Clearance between the minimised button and whatever is beside it. */
const RAIL_GAP = 8;
/**
 * The floor the tab bar's pill stands on, copied from its render so the two
 * line up exactly rather than approximately. The `max()` is what keeps the
 * button off the physical edge on a phone whose bottom inset is 0.
 */
const BOTTOM_FLOOR = 'max(6px, var(--safe-area-bottom, 0px))';

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
  // Collapsed to its corner button. Recording carries on regardless — the
  // recorder does not know or care whether anything is on screen.
  const [minimised, setMinimised] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => subscribeRequestLog(() => forceRender(n => n + 1)), []);

  // What the dock is costing the bottom of the screen, for chrome that portals
  // out of it and so cannot be squashed by it — the tab bar. See lib/debug-dock.
  // Zero while minimised: the button floats, so there is nothing to make room
  // for below the app.
  const dockHeight = minimised ? 0 : height;
  useEffect(() => {
    setDebugDockHeight(dockHeight);
    return () => setDebugDockHeight(0);
  }, [dockHeight]);

  const entries = getRequestLog();
  const errors = entries.filter(e => e.status === 'error').length;

  // …but the corner it floats in belongs to the tab bar too, so publish how
  // much of it is taken. Measured, because the button is as wide as its counts.
  useEffect(() => {
    if (!minimised) {
      setDebugDockRail(0);
      return;
    }
    const el = buttonRef.current;
    if (!el) return;
    const measure = () => setDebugDockRail(Math.ceil(el.getBoundingClientRect().width) + RAIL_GAP);
    measure();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      setDebugDockRail(0);
    };
    // The counts are in the button's text, so a re-measure on each is what
    // keeps the rail honest as the log fills up and the first failure lands.
  }, [minimised, entries.length, errors]);

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

  // Minimised, the only thing left in the flex column is a zero-height box that
  // exists so the collapse can animate — height does not transition to or from
  // `auto`, and it does not transition from an element that is not there at all.
  // The button itself is portalled, below.
  const dock = (
    <div
      className={cn(
        'shrink-0 flex flex-col overflow-hidden bg-[#0b0e14] text-white select-none',
        'transition-[height] duration-200 ease-out',
        // No border while collapsed: a 1px rule across the bottom of the app is
        // still a mark on the screen, and reserving nothing means nothing.
        !minimised && 'border-t border-white/10',
      )}
      style={{ height: dockHeight }}
      aria-hidden={minimised}
    >
      {!minimised && (
        <div
          onPointerDown={startResize}
          className="h-1.5 shrink-0 cursor-ns-resize bg-white/5 hover:bg-white/20 transition-colors"
          role="separator"
          aria-label="Resize request log"
        />
      )}
      {!minimised && (
        <div className="flex items-center gap-2 shrink-0 px-3 py-1.5 border-b border-white/10">
          <span className="text-[11px] font-semibold tracking-wide text-white/80">Requests</span>
          <span className="text-[11px] text-white/35 tabular-nums">{entries.length}</span>
          {errors > 0 && (
            <span className="text-[11px] text-red-400 tabular-nums">{errors} failed</span>
          )}
          <span className="flex-1" />
          {/* Follow scrolls the list to the bottom, so it means nothing without
              a list on screen. */}
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
            className="text-white/50 hover:text-white p-2 rounded hover:bg-white/10"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          {/* Minimise, not close: switching the log off entirely belongs in
              Settings, and an X here is a trap — it looks like "hide for now"
              and actually costs you the capture you are in the middle of
              taking. */}
          <button
            onClick={() => setMinimised(true)}
            title="Minimise"
            aria-expanded
            className="shrink-0 self-stretch flex items-center text-white/50 hover:text-white rounded hover:bg-white/10 p-2"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
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

  return (
    <>
      {dock}
      {minimised && typeof document !== 'undefined' && createPortal(
        /* Portalled to the body for the same reason the tab bar is: `DebugDock`
           makes its wrapper a containing block for `fixed` children, so a
           `fixed` element left inside the dock would be positioned against the
           squashed app rather than the screen. A child of `body` is measured
           against the viewport, which is what "floats over the app" means.

           The floor and the gutter are the tab bar's own numbers — `px-4`
           inside `safe-area-x`, on a `max(6px, safe-area-bottom)` base — so the
           two sit on one line rather than nearly on one. */
        <div
          className="fixed bottom-0 right-0 z-[10001] pointer-events-none safe-area-x"
          style={{ paddingBottom: BOTTOM_FLOOR }}
        >
          <div className="flex justify-end px-4">
            <button
              ref={buttonRef}
              onClick={() => setMinimised(false)}
              aria-label="Expand request log"
              aria-expanded={false}
              data-testid="request-log-button"
              title="Request log"
              // Counts and a chevron, and no label. Every pixel of this thing is
              // width the tab bar beside it has to give up (see the rail in
              // lib/debug-dock), and "Requests" is a word for something only the
              // person who switched it on can see. 36px tall so it is still a
              // target on a phone, which was most of what the full-width bar was
              // buying.
              className={cn(
                'pointer-events-auto group flex h-9 items-center gap-1.5 rounded-full pl-3 pr-2',
                'bg-[#0b0e14]/90 backdrop-blur-sm border border-white/10 shadow-lg text-white select-none',
                'transition-colors hover:bg-[#0b0e14]',
              )}
            >
              <span className="text-[11px] font-semibold tabular-nums text-white/70 transition-colors group-hover:text-white">
                {entries.length}
              </span>
              {errors > 0 && (
                <span className="text-[11px] font-semibold tabular-nums text-red-400">{errors}</span>
              )}
              <ChevronUp className="h-4 w-4 text-white/50 transition-colors group-hover:text-white" />
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

export default RequestLogPanel;
