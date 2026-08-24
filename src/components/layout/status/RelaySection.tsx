/**
 * What the status popover says about this Mac's relay duty.
 *
 * Lifted from the old `RelayStatusBadge` popover, with one behavioural change
 * worth knowing about: **the 1-second poll now runs only while the popover is
 * open.** It used to run for the entire life of the app, every second, on a
 * relay Mac that is up for weeks — and most of what it polled (uptime, the
 * activity sparkline, subscriber counts) is only ever read here. Connection
 * state, the one part the closed badge needed, is a subscription and is now
 * read that way by the badge itself rather than sampled.
 *
 * `selectedHomeRelayType` went with the move. It was a prop the only call site
 * never passed, so its "Cloud" label and cloud-standby copy could not run.
 */

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { serverConnection } from '@/server/connection';
import { HomeKit, isRelayCapable } from '@/native/homekit-bridge';
import { isCommunity } from '@/lib/config';
import type { HomeKitStats } from '@/native/homekit-bridge';
import { useHomes } from '@/hooks/useHomeKitData';
import { formatLastOnline } from '@/lib/relay-last-seen';

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
type EffectiveState = 'connected_active' | 'connected_standby' | 'connecting' | 'reconnecting' | 'disconnected';

const dotColorMap: Record<EffectiveState, string> = {
  connected_active: 'bg-green-500',
  connected_standby: 'bg-amber-500',
  connecting: 'bg-amber-500 animate-pulse',
  reconnecting: 'bg-amber-500 animate-pulse',
  disconnected: 'bg-red-500',
};

const statusLabelMap: Record<EffectiveState, string> = {
  connected_active: 'Active Relay',
  connected_standby: 'Standby',
  connecting: 'Connecting...',
  reconnecting: 'Reconnecting...',
  disconnected: 'Disconnected',
};

function getEffectiveState(connectionState: ConnectionState, relayStatus: boolean | null): EffectiveState {
  if (connectionState === 'connected') {
    return relayStatus === false ? 'connected_standby' : 'connected_active';
  }
  return connectionState;
}

function formatUptime(connectedAt: number | null): string {
  if (!connectedAt) return '--';
  const seconds = Math.floor((Date.now() - connectedAt) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return `${hours}h ${remainingMinutes}m`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return `${days}d ${remainingHours}h`;
}

function Sparkline({ data, width = 160, height = 24 }: { data: number[]; width?: number; height?: number }) {
  const max = Math.max(1, ...data);
  const step = width / (data.length - 1);
  const points = data.map((v, i) => `${i * step},${height - (v / max) * height}`).join(' ');
  const areaPoints = `0,${height} ${points} ${width},${height}`;
  const hasActivity = data.some(v => v > 0);

  return (
    <svg width={width} height={height} className="shrink-0">
      <polygon points={areaPoints} fill="currentColor" opacity={0.1} />
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity={hasActivity ? 0.6 : 0.2}
      />
    </svg>
  );
}

interface RelaySectionProps {
  accountType?: string;
  accessoryLimit?: number | null;
  includedAccessoryCount?: number;
}

export function RelaySection({ accountType, accessoryLimit, includedAccessoryCount }: RelaySectionProps) {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [relayStatus, setRelayStatus] = useState<boolean | null>(null);
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [lastConnectedAt, setLastConnectedAt] = useState<number | null>(null);
  const [subscriberStatus, setSubscriberStatus] = useState<ReturnType<typeof serverConnection.getSubscriberStatus> | null>(null);
  const [stats, setStats] = useState<HomeKitStats | null>(null);
  const [uptime, setUptime] = useState('--');
  const [activity, setActivity] = useState<number[]>(() => new Array(60).fill(0));
  const statsRequested = useRef(false);

  const { data: homes } = useHomes();
  const selfHostedHomes = homes?.filter(h => !h.isCloudManaged);
  const selfHostedHomeCount = selfHostedHomes?.length;
  const selfHostedAccessoryCount = selfHostedHomes?.reduce((sum, h) => sum + (h.accessoryCount ?? 0), 0);

  // Only while this is on screen. Uptime ticks and the sparkline moves, so it
  // does need a timer — but only for as long as someone is looking at them.
  useEffect(() => {
    const update = () => {
      const state = serverConnection.getState();
      setConnectionState(state.connectionState);
      setRelayStatus(state.relayStatus);
      const at = serverConnection.getConnectedAt();
      setConnectedAt(at);
      setLastConnectedAt(serverConnection.getLastConnectedAt());
      setUptime(formatUptime(at));
      setSubscriberStatus(serverConnection.getSubscriberStatus());
      setActivity(serverConnection.getActivityHistory());
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (statsRequested.current) return;
    statsRequested.current = true;
    HomeKit.getStats().then(setStats).catch(() => {});
  }, []);

  // Community mode on the relay Mac: always active — direct HomeKit access,
  // and no server WebSocket whose state could say otherwise.
  const effectiveState = (isCommunity && isRelayCapable())
    ? 'connected_active' as EffectiveState
    : getEffectiveState(connectionState, relayStatus);
  const isStandby = effectiveState === 'connected_standby';
  const allHomesCloudManaged = effectiveState === 'connected_active'
    && homes != null && homes.length > 0 && selfHostedHomeCount === 0;

  const webClientCount = subscriberStatus?.webClientCount ?? 0;
  const subscriptionCount = subscriberStatus?.subscriptionCount ?? 0;
  const webhookCount = subscriberStatus?.webhookCount ?? 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold">Relay Status</span>
        <span className={cn(
          "flex items-center gap-1.5 text-[11px] font-medium px-1.5 py-0.5 rounded-full",
          effectiveState === 'connected_active' ? "bg-green-500/10 text-green-600" :
          effectiveState === 'disconnected' ? "bg-red-500/10 text-red-600" :
          "bg-amber-500/10 text-amber-600"
        )}>
          <span className={cn("h-1.5 w-1.5 rounded-full", dotColorMap[effectiveState])} />
          {statusLabelMap[effectiveState]}
        </span>
      </div>

      {isStandby ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Another Mac is the active relay. Take over to handle HomeKit requests from this device.
          </p>
          <button
            onClick={() => { serverConnection.claimRelay(); }}
            className="w-full text-xs font-medium px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Take Over as Relay
          </button>
        </div>
      ) : effectiveState === 'disconnected' ? (
        <p className="text-xs text-muted-foreground">
          Not connected to the server. {formatLastOnline(lastConnectedAt)}.
        </p>
      ) : allHomesCloudManaged ? (
        <p className="text-xs text-muted-foreground">
          All your homes are cloud-managed. You can switch off the relay in Settings.
        </p>
      ) : (
        <>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Uptime</span>
              <span className="font-medium">{connectedAt ? uptime : '--'}</span>
            </div>

            <div className="flex justify-between">
              <span className="text-muted-foreground">Clients</span>
              <span className={cn("font-medium", webClientCount > 0 ? "text-green-600" : "text-muted-foreground")}>
                {webClientCount > 0 ? `${webClientCount} connected` : 'None'}
              </span>
            </div>

            {!(isCommunity && isRelayCapable()) && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subscriptions</span>
                <span className={cn("font-medium", subscriptionCount > 0 ? "text-green-600" : "text-muted-foreground")}>
                  {subscriptionCount > 0 ? `${subscriptionCount} active` : 'None'}
                </span>
              </div>
            )}

            <div className="flex justify-between">
              <span className="text-muted-foreground">Webhooks</span>
              <span className={cn("font-medium", webhookCount > 0 ? "text-green-600" : "text-muted-foreground")}>
                {webhookCount > 0 ? `${webhookCount} active` : 'None'}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Activity</span>
              <Sparkline data={activity} />
            </div>
          </div>

          {stats && (
            <>
              <div className="border-t" />
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Homes</span>
                  <span className="font-medium">{selfHostedHomeCount ?? stats.homes}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Accessories</span>
                  <span className="font-medium">
                    {selfHostedAccessoryCount ?? stats.accessories}
                  </span>
                </div>
                {accountType === 'free' && accessoryLimit && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Plan Limit</span>
                    <span className="font-medium">
                      {includedAccessoryCount || 0} / {accessoryLimit}
                    </span>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
