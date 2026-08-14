// Settings → Local Mode.
//
// Three states rather than a switch, because "automatic" is genuinely a
// different intent from "on": most people want the rescue to happen without
// them, but someone testing the app, or deliberately working off the cloud,
// wants to pin it.

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { useLocalMode } from '@/hooks/useLocalMode';
import { HomeKit, type HomeKitStatus } from '@/native/homekit-bridge';
import { openExternalUrl } from '@/lib/open-url';
import {
  getLocalModeOverride, setLocalModeOverride, controller,
} from '@/server/local-mode-controller';
import type { LocalModeOverride } from '@/server/local-mode';

const OPTIONS: Array<{ value: LocalModeOverride; label: string; hint: string }> = [
  { value: 'auto', label: 'Automatic', hint: 'Take over when the relay is unavailable' },
  { value: 'on', label: 'Always on', hint: 'Always control Apple Home from this device' },
  { value: 'off', label: 'Off', hint: 'Never control Apple Home from this device' },
];

export function LocalModeSection() {
  const { active, reason, identityState, matched, reported } = useLocalMode();
  const [override, setOverride] = useState<LocalModeOverride>(() => getLocalModeOverride());
  const [status, setStatus] = useState<HomeKitStatus | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => { void HomeKit.getStatus().then(setStatus); }, []);

  const choose = (v: LocalModeOverride) => {
    setOverride(v);
    setLocalModeOverride(v);
  };

  const resync = async () => {
    setSyncing(true);
    try { await controller.resyncIdentity(); } finally { setSyncing(false); }
  };

  const denied = status !== null && status.determined && !status.authorized;
  const noHomes = status !== null && status.authorized && status.homeCount === 0;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium mb-1">Local Mode</h3>
        <p className="text-xs text-muted-foreground">
          When your relay can't be reached, this device can control your Apple Home
          directly — as long as it has access to the home. Automations, notifications
          and history stay with the relay.
        </p>
      </div>

      {denied && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
          <p className="text-xs text-amber-600">
            Homecast doesn't have permission to use your Apple Home on this device,
            so Local Mode can't work here.
          </p>
          <button
            className="text-xs text-primary hover:underline"
            onClick={() => openExternalUrl('app-settings:')}
          >
            Open Settings
          </button>
        </div>
      )}

      {noHomes && (
        <div className="rounded-lg border bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">
            This device has permission, but there are no homes on the Apple ID it's
            signed in to.
          </p>
        </div>
      )}

      <div className="space-y-2">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            onClick={() => choose(o.value)}
            className={cn(
              'w-full flex items-start gap-3 rounded-lg border p-3 text-left transition-colors',
              override === o.value ? 'border-primary bg-primary/5' : 'hover:bg-muted/50',
            )}
          >
            <span className={cn(
              'mt-0.5 h-4 w-4 rounded-full border-2 shrink-0',
              override === o.value ? 'border-primary bg-primary' : 'border-muted-foreground/40',
            )} />
            <span className="min-w-0">
              <span className="block text-xs font-medium">{o.label}</span>
              <span className="block text-[11px] text-muted-foreground">{o.hint}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="rounded-lg border p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">Status</span>
          <span className={cn(
            'flex items-center gap-1.5 text-[11px] font-medium px-1.5 py-0.5 rounded-full',
            active ? 'bg-green-500/10 text-green-600' : 'bg-muted text-muted-foreground',
          )}>
            <span className={cn('h-1.5 w-1.5 rounded-full', active ? 'bg-green-500' : 'bg-muted-foreground/50')} />
            {active ? 'Active' : 'Standby'}
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {active
            ? reason === 'manual' ? 'Switched on here.'
              : reason === 'no-relay-ever' ? "You haven't set up a relay yet."
              : reason === 'socket-down' ? "This device can't reach Homecast's servers."
              : 'Your relay is offline.'
            : override === 'off' ? 'Turned off for this device.'
            : 'Your relay is handling this home.'}
        </p>
      </div>

      <div className="rounded-lg border p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">Matching</span>
          <button
            onClick={resync}
            disabled={syncing}
            className="text-[11px] text-primary hover:underline disabled:opacity-50"
          >
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {/* This is what decides whether an outage looks like your home or like
              a stranger's: the accessory ids this device sees are not the ones
              the relay reports, and matching is what reconciles them. */}
          {identityState === 'unmapped'
            ? "Not matched yet. Until it is, accessories show their Apple Home names rather than yours."
            : `${matched} of ${reported} accessories matched to your Homecast layout.`}
        </p>
      </div>
    </div>
  );
}
