/**
 * What the status popover says about your link to the cloud.
 *
 * Lifted out of the old `ConnectionBadge` popover unchanged, so that the one
 * merged bubble can stack it above Local Mode and Relay without any of the
 * three growing a popover of its own again.
 */

import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { serverConnection } from '@/server/connection';
import type { ConnectionQuality } from '@/server/connection-quality';
import { formatRtt, warnsUser } from '@/lib/connection-presentation';

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
}

export function ConnectionSection({ quality, headline, onReconnect }: ConnectionSectionProps) {
  const rtt = formatRtt(serverConnection.getLastRttMs());
  const measuredAt = ago(serverConnection.getLastRttAt() || null);

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">{headline}</p>
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
      {warnsUser(quality) && (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={onReconnect}
        >
          <RefreshCw className="h-3.5 w-3.5 mr-2" />
          Reconnect now
        </Button>
      )}
    </div>
  );
}
