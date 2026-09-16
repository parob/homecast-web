import { useEffect, useState } from 'react';
import { Wifi, Globe, Router, Lock, LockOpen, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getRelayAddress, isCommunity } from '@/lib/config';
import { probeRelay, describeRoute, ROUTE_LABELS, type RelayHealth, type RelayRoute } from '@/lib/relay-probe';
import { useWebSocket } from '@/contexts/WebSocketContext';
import { connectionPresentation } from '@/lib/connection-presentation';
import { useStatusLog } from '@/hooks/useStatusLog';

/**
 * What this device is connected to, and how.
 *
 * A Community client used to show nothing at all about its relay: no name, no
 * connection state, no hint that it was reaching the Mac over a VPN rather than
 * the LAN — so "it feels slow" and "it stopped working" had nothing behind them
 * to look at. The relay now reports its name and every address it answers on,
 * which is enough to say all of it.
 */

const ROUTE_ICON: Record<RelayRoute, typeof Wifi> = {
  lan: Wifi,
  mesh: Router,
  remote: Globe,
};

/**
 * The relay this page is talking to.
 *
 * `getRelayAddress()` answers for a client that was pointed at a relay — the
 * iOS app, or a browser that typed an address. It answers *null* for the most
 * ordinary case of all: a browser the relay is itself serving, which has no
 * stored address because it never needed one. There the page's own origin is
 * the relay, and falling back to it is what makes the card appear at all.
 *
 * Never reached on the relay Mac, where the card is not rendered — there the
 * page origin is loopback and would be a lie.
 */
function activeRelayOrigin(): string | null {
  return getRelayAddress() ?? (isCommunity ? window.location.origin : null);
}

export function RelayInfoCard() {
  const [origin, setOrigin] = useState<string | null>(activeRelayOrigin());
  const [health, setHealth] = useState<RelayHealth | null>(null);
  const [checking, setChecking] = useState(false);
  const { quality } = useWebSocket();
  const presentation = connectionPresentation(quality);
  const label = quality === 'good' ? 'Connected' : presentation.label ?? presentation.headline;
  useStatusLog('community_relay', { quality, label, colour: presentation.dotClass });

  const refresh = async (target = activeRelayOrigin()) => {
    setOrigin(target);
    if (!target) { setHealth(null); return; }
    setChecking(true);
    setHealth(await probeRelay(target, 4000));
    setChecking(false);
  };

  useEffect(() => { void refresh(); }, []);

  // The address can change under us when the network moves — that is the whole
  // point of the address list, so this panel should not sit there stale.
  useEffect(() => {
    const onMoved = () => { void refresh(); };
    window.addEventListener('homecast:relay-address-changed', onMoved);
    return () => window.removeEventListener('homecast:relay-address-changed', onMoved);
  }, []);

  if (!origin) return null;

  const route = describeRoute(origin);
  const RouteIcon = ROUTE_ICON[route];

  // Everything the relay knows about itself, plus the one we are on — which
  // will not be in its list when it is a tunnel the relay cannot see.
  const addresses = Array.from(new Set([origin, ...(health?.addresses ?? [])]));

  return (
    <div className="rounded-lg border p-3 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{health?.name || 'Relay'}</p>
          <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
            <RouteIcon className="h-3 w-3 shrink-0" />
            {ROUTE_LABELS[route]}
            {health?.authEnabled === false && (
              <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                <LockOpen className="h-3 w-3" /> No password
              </span>
            )}
            {health?.authEnabled === true && (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <Lock className="h-3 w-3" /> Password set
              </span>
            )}
          </p>
        </div>
        <span className="flex items-center gap-1.5 text-[10px] font-medium shrink-0 pt-0.5">
          <span className={cn('h-1.5 w-1.5 rounded-full', presentation.dotClass, presentation.pulse && 'animate-pulse')} />
          {label}
        </span>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {addresses.length === 1 ? 'Address' : 'Addresses'}
          </p>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={checking}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3 w-3', checking && 'animate-spin')} />
            Check
          </button>
        </div>
        {addresses.map(addr => {
          const inUse = addr === origin;
          const kind = describeRoute(addr);
          return (
            <div key={addr} className="flex items-center gap-2 text-xs">
              <span
                className={cn('h-1.5 w-1.5 rounded-full shrink-0', inUse ? presentation.dotClass : 'bg-muted-foreground/30')}
              />
              <span className={cn('font-mono truncate', inUse ? 'text-foreground' : 'text-muted-foreground')}>
                {addr}
              </span>
              <span className="text-muted-foreground shrink-0 ml-auto">
                {ROUTE_LABELS[kind]}{inUse ? ' · in use' : ''}
              </span>
            </div>
          );
        })}
        {!health && !checking && (
          // This HTTP metadata probe is separate from the control socket.
          <p className="text-xs text-amber-600 dark:text-amber-400 pt-1">
            Could not refresh relay details at this address.
          </p>
        )}
      </div>
    </div>
  );
}
