/**
 * How well *your* connection is working — as distinct from the relay's.
 *
 * Nothing in the product used to say this. `RelayStatusBadge` reports the
 * relay's health and renders only when `isRelayEnabled()`, i.e. on the Mac
 * that *is* the relay, so a browser or a phone had no connection indicator at
 * all. Connection toasts are four seconds long and gated to three routes.
 * Everything else the user could see — tiles, values, controls — kept working
 * and kept looking authoritative while nothing was getting through.
 *
 * Conflating "the relay is fine" with "you can reach it" is precisely why
 * "the UI works" reads to a user as "everything works".
 *
 * ── Present at every state, including good ─────────────────────────────────
 *
 * An indicator that appears only when something is wrong cannot be told apart
 * from one that is broken, or from one that was never measuring: absence means
 * both "fine" and "nothing is checking", and the user has nowhere to look.
 * Showing the healthy state is what makes the degraded state legible *as a
 * change* — you can only notice a difference from something you have seen.
 *
 * Being present is not the same as asking for attention. At `good` this is a
 * single muted dot: no label, no motion, nothing to read. The escalation axis
 * is colour, label and motion, never presence. See lib/connection-presentation.ts,
 * where those rules are pinned by tests.
 */

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { serverConnection } from '@/server/connection';
import { isCommunity } from '@/lib/config';
import { isRelayCapable } from '@/native/homekit-bridge';
import { useWebSocket } from '@/contexts/WebSocketContext';
import { connectionPresentation, formatRtt } from '@/lib/connection-presentation';

interface ConnectionBadgeProps {
  isDarkBackground?: boolean;
}

/** "just now" / "3m ago", for a moment rather than a duration. */
function ago(at: number | null): string | null {
  if (!at) return null;
  const s = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

export function ConnectionBadge({ isDarkBackground }: ConnectionBadgeProps) {
  const { quality } = useWebSocket();
  const [open, setOpen] = useState(false);
  // Only while the popover is open: the numbers in it are relative to now, and
  // a ticker running behind a closed popover would be a wakeup a second for
  // something nobody is reading.
  const [, setNow] = useState(0);
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setNow(n => n + 1), 1000);
    return () => clearInterval(t);
  }, [open]);

  const p = connectionPresentation(quality);
  const rtt = formatRtt(serverConnection.getLastRttMs());
  const measuredAt = ago(serverConnection.getLastRttAt() || null);

  // Community mode on the relay Mac has no connection to describe: HomeKit is
  // served from this very process (`shouldActivate()` returns false, so no
  // socket is ever opened) and every request is a function call. Quality would
  // sit on `unknown` forever, which is true and useless — a dot permanently
  // saying "checking" about a hop that does not exist. `RelayStatusBadge`
  // already speaks for that machine.
  //
  // Checked on the static capability rather than on the async
  // `communityRelayConfirmed`, so the badge never appears and then vanishes a
  // moment into startup. Cloud mode on the same Mac is unaffected: there the
  // socket to the cloud is exactly what needs reporting.
  if (isCommunity && isRelayCapable()) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          aria-label={p.srLabel}
          className={cn(
            'flex items-center gap-1.5 px-2 py-1 rounded-full text-[13px] font-medium',
            // Width changes when a label appears. Eased rather than snapped:
            // the badge sits in a right-anchored cluster, so it grows leftward
            // and never disturbs the title — but a sudden jump still reads as a
            // glitch rather than as information.
            'transition-all duration-300 window-no-drag',
            isDarkBackground
              ? 'bg-black/40 backdrop-blur-xl hover:bg-black/50 text-white'
              : 'bg-transparent hover:bg-black/10 text-foreground',
          )}
        >
          <span
            className={cn(
              'h-2 w-2 rounded-full shrink-0',
              p.dotClass,
              // `motion-safe:` so a viewer who has asked for less movement gets
              // the colour and the label without the animation.
              p.pulse && 'motion-safe:animate-pulse',
            )}
          />
          {p.label}
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-64 p-3">
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium">{p.headline}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {rtt
                ? <>Round trip {rtt}{measuredAt ? ` · ${measuredAt}` : ''}</>
                : 'No round trip measured yet.'}
            </p>
          </div>

          {quality !== 'good' && quality !== 'unknown' && (
            <p className="text-xs text-muted-foreground">
              Changes you make may take a while to apply, or may not apply at all.
            </p>
          )}

          {/*
            The one action a user can actually take. `serverConnection.reconnect()`
            has existed all along and was called from nowhere in the UI — which is
            also why the connection toast was written deliberately neutral, since
            asking someone to act with no way to act is worse than saying nothing.
            There is a way now.
          */}
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => {
              serverConnection.reconnect();
              setOpen(false);
            }}
          >
            <RefreshCw className="h-3.5 w-3.5 mr-2" />
            Reconnect now
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
