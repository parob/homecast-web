// Settings → Local Mode.
//
// Three states rather than a switch, because "automatic" is genuinely a
// different intent from "on": most people want the rescue to happen without
// them, but someone testing the app, or deliberately working off the cloud,
// wants to pin it.

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useLocalMode } from '@/hooks/useLocalMode';
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
  // Live from the controller rather than a probe of our own: HomeKit is not
  // loaded when a screen first mounts, so a one-shot read here reported "no
  // permission" on a device that had permission all along.
  const { active, reason, identityState, matched, reported, blocked } = useLocalMode();
  const [override, setOverride] = useState<LocalModeOverride>(() => getLocalModeOverride());
  const [syncing, setSyncing] = useState(false);

  const choose = (v: LocalModeOverride) => {
    setOverride(v);
    setLocalModeOverride(v);
  };

  const resync = async () => {
    setSyncing(true);
    try { await controller.resyncIdentity(); } finally { setSyncing(false); }
  };

  const denied = blocked === 'no-permission' || blocked === 'restricted';
  const noHomes = blocked === 'no-homes';

  // Why Local Mode is, or isn't, running. Every branch here names something
  // the reader can act on — a blocker was once flattened into a generic "the
  // relay has this home", which made a selected "Always on" look broken. When
  // there is genuinely nothing to add beyond the Standby pill, the line is
  // dropped rather than filled with a restatement of it.
  const statusText = active
    ? reason === 'manual' ? 'Controlling Apple Home from this device.'
      : reason === 'no-relay-ever' ? "You haven't set up a relay yet, so this device is serving your home."
      : reason === 'socket-down' ? "This device can't reach Homecast's servers, so it's serving your home itself."
      : 'Your relay is offline, so this device is serving your home.'
    : blocked === 'off' ? 'Turned off for this device.'
    : blocked === 'is-relay' ? 'This Mac is the relay, so it already talks to Apple Home directly.'
    : blocked === 'no-permission' ? "Homecast can't use Apple Home on this device."
    : blocked === 'restricted' ? 'Access to Apple Home is restricted on this device.'
    : blocked === 'no-homes' ? "No homes on this device's Apple Account."
    : blocked === 'loading' ? 'Checking Apple Home on this device…'
    : override === 'on' ? 'Ready — waiting for Apple Home.'
    : null;

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
        {statusText && (
          <p className="text-[11px] text-muted-foreground">{statusText}</p>
        )}
        {/* "Always on" cannot override a device that physically can't serve.
            Saying so is kinder than leaving the radio selected and inert. */}
        {override === 'on' && !active && blocked && blocked !== 'off' && (
          <p className="text-[11px] text-amber-600">
            Always on can't apply until this is resolved.
          </p>
        )}
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
          {identityState !== 'unmapped'
            ? `${matched} of ${reported} accessories matched to your Homecast layout.`
            // Two very different situations shared one sentence, and the honest
            // one is worth separating: nothing reported yet is a matter of
            // waiting, whereas a report where nothing matched means this device
            // is looking at a different Apple Home than the relay is.
            : reported > 0
              ? `None of the ${reported} accessories this device can see matched your Homecast layout, so they show their Apple Home names. This usually means this device is signed in to a different Apple Account than your relay.`
              : "Not matched yet. Until it is, accessories show their Apple Home names rather than yours."}
        </p>
      </div>
    </div>
  );
}
