/**
 * What the status popover says about your link to the cloud.
 *
 * Lifted out of the old `ConnectionBadge` popover unchanged, so that the one
 * merged bubble can stack it above Local Mode and Relay without any of the
 * three growing a popover of its own again.
 */

import { Button } from '@/components/ui/button';
import { Info, RefreshCw } from 'lucide-react';
import { serverConnection } from '@/server/connection';
import type { ConnectionQuality } from '@/server/connection-quality';
import { formatRtt, warnsUser } from '@/lib/connection-presentation';
import { SLOW_IN_FLIGHT_MS, SLOW_RTT_MS } from '@/server/connection-quality';
import type { ChainModel } from '@/lib/connection-chain';
import { ConnectionChain, type ChainVariant } from './ConnectionChain';

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

interface ConnectionSectionProps {
  quality: ConnectionQuality;
  /** The headline of whatever the bubble is currently reporting. */
  headline: string;
  onReconnect: () => void;
  /**
   * The path to the home. When present the panel leads with it and the hop
   * sentence becomes the headline — option C of #38. Absent, the section
   * renders exactly as it did before, which is what keeps this landable
   * independently of the design decision.
   */
  chain?: ChainModel;
  chainVariant?: ChainVariant;
}

/** Seconds, for a duration someone is watching tick upward. */
function secs(ms: number): string {
  return ms >= 1000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms)}ms`;
}

/**
 * The line under the headline: *why* we are saying what we are saying.
 *
 * It used to be the round trip unconditionally, which made the popover
 * contradict itself in exactly the states it exists for. Throttled testing
 * against production produced both of these:
 *
 *   "Your connection is slow"        / "Round trip 12ms"
 *   "Your home is not responding"    / "Round trip 30.0s · just now"
 *
 * The first is the classifier working correctly — the verdict came from a
 * request that had been outstanding for seconds, while the WebSocket round
 * trip was genuinely fine — but the evidence shown was the half that was not
 * the reason. The second rendered a missed pong, recorded deliberately as a
 * one-interval lower bound, as though it were a fresh measurement.
 *
 * So the reasons are ranked the same way the classifier ranks them, and the
 * round trip is reported only when it is actually the thing being complained
 * about.
 */
function reasonLine(): React.ReactNode {
  const inFlight = serverConnection.getOldestInFlightMs();
  const pendingPing = serverConnection.getPendingPingMs();
  const rtt = formatRtt(serverConnection.getLastRttMs());
  const measuredAt = ago(serverConnection.getLastRttAt() || null);

  // Leading indicator first, exactly as classifyQuality reads it.
  if (inFlight !== null && inFlight >= SLOW_IN_FLIGHT_MS) {
    return `A request has been waiting ${secs(inFlight)}.`;
  }
  // Nothing came back from the last check. Not a slow round trip — no round
  // trip, which is a different and worse thing.
  if (pendingPing !== null && pendingPing >= SLOW_RTT_MS) {
    return 'No reply to the last connection check.';
  }
  if (rtt) return <>Round trip {rtt}{measuredAt ? ` · ${measuredAt}` : ''}</>;
  return 'No round trip measured yet.';
}

export function ConnectionSection({
  quality,
  headline,
  onReconnect,
  chain,
  chainVariant = 'rail',
}: ConnectionSectionProps) {
  return (
    <div className="space-y-3">
      {chain ? (
        <>
          <ConnectionChain model={chain} variant={chainVariant} />
          <div>
            {/*
              The hop sentence takes the primary slot. This is the whole of
              option C: the round trip is still here, but it has stopped
              competing for the top with an answer to a question nobody asked.
              "Homecast can't get an answer from your relay" is what the user
              needs; "9s" is what we used to lead with.
            */}
            <p className="text-[13px] font-medium leading-snug">{chain.sentence}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{reasonLine()}</p>
          </div>
        </>
      ) : (
        <div>
          <p className="text-sm font-medium">{headline}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{reasonLine()}</p>
        </div>
      )}

      {quality !== 'good' && quality !== 'unknown' && !chain?.bypass && (
        <p className="text-xs text-muted-foreground">
          Changes you make may take a while to apply, or may not apply at all.
        </p>
      )}

      {/*
        The one action a user can actually take — offered only when there is
        something to fix.

        `serverConnection.reconnect()` is not a refresh: it tears the socket
        down and builds a new one, which rejects every in-flight request and
        drops the subscriptions with it. On a healthy connection that is a
        small footgun rather than a courtesy, so it would be inviting someone
        to break something that is working.

        The gate is `warnsUser`, which is exactly the set of states that carry
        a label — connecting, slow, not responding, offline. That keeps a
        useful invariant: we only offer a remedy for a problem we actually
        reported. Anything we were quiet about needs no fixing.
      */}
      {/*
        A cloud relay that has died leaves the socket to Homecast perfectly
        healthy, so "Reconnect now" would rebuild something that was never
        broken — and the user owns no hardware to go and restart. The model
        says so explicitly rather than the button being suppressed by a
        condition spelled out again here.
      */}
      {chain?.noUserAction ? (
        <div className="flex gap-2 rounded-md bg-muted/50 p-2">
          <Info className="mt-px h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <p className="text-[11px] leading-snug text-muted-foreground">{chain.noUserAction}</p>
        </div>
      ) : (
        warnsUser(quality) && !chain?.bypass && (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={onReconnect}
          >
            <RefreshCw className="h-3.5 w-3.5 mr-2" />
            Reconnect now
          </Button>
        )
      )}
    </div>
  );
}
