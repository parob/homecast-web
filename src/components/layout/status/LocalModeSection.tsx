/**
 * What the status popover says about this device serving Apple Home itself.
 *
 * Lifted from the old `LocalModeBadge` popover. Local Mode is a genuinely
 * different mode of operation — automations are not running, history is not
 * being recorded, and nobody else can see what this device can — so the detail
 * is worth all of this space. What it is no longer worth is a second pill:
 * Local Mode engages *because* the connection is down, so it and the
 * connection state are two halves of one story and now share one bubble.
 */

import { Check, X } from 'lucide-react';
import { useLocalMode } from '@/hooks/useLocalMode';
import type { LocalModeReason } from '@/server/local-mode';

const REASON_TEXT: Record<LocalModeReason, string> = {
  'manual': 'Local Mode is switched on in Settings.',
  'no-relay-ever': "You haven't set up a home relay yet.",
  'relay-offline': 'Your home relay is offline.',
  'socket-down': "This device can't reach Homecast's servers.",
};

const WORKS = ['Lights, switches and plugs', 'Sensors and thermostats', 'Locks and blinds', 'Scenes and rooms'];
const DOESNT = ['Automations', 'Notifications', 'History recording', 'Sharing with other people'];

interface LocalModeSectionProps {
  /** Opens Settings → Local Mode. Absent unless Developer Mode is on. */
  onOpenSettings?: () => void;
}

export function LocalModeSection({ onOpenSettings }: LocalModeSectionProps) {
  const { reason, identityState, matched, reported } = useLocalMode();

  const isPhone = /iPhone|iPad/i.test(navigator.userAgent)
    || (window as Window & { isHomecastIOSApp?: boolean }).isHomecastIOSApp === true;
  const deviceWord = isPhone ? 'device' : 'Mac';
  const unmapped = identityState === 'unmapped';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold">Local Mode</span>
        <span className="flex items-center gap-1.5 text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-600">
          <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
          Active
        </span>
      </div>

      <p className="text-xs text-muted-foreground">
        This {deviceWord} is talking to your Apple Home directly.
        {reason ? ` ${REASON_TEXT[reason]}` : ''}
      </p>

      <div className="space-y-1.5">
        {WORKS.map((w) => (
          <div key={w} className="flex items-center gap-1.5 text-[11px]">
            <Check className="h-3 w-3 text-green-600 shrink-0" />
            <span>{w}</span>
          </div>
        ))}
        {DOESNT.map((d) => (
          <div key={d} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <X className="h-3 w-3 shrink-0" />
            <span>{d}</span>
          </div>
        ))}
      </div>

      {/* Only worth saying when it is not the whole story. */}
      {identityState === 'partial' && (
        <p className="text-[11px] text-muted-foreground border-t pt-2">
          {matched} of {reported} accessories matched your Homecast layout. The rest
          show their Apple Home names.
        </p>
      )}
      {unmapped && (
        <p className="text-[11px] text-amber-600 border-t pt-2">
          Your custom names and layout will come back when this {deviceWord} is next online.
        </p>
      )}

      <p className="text-[11px] text-muted-foreground border-t pt-2">
        Automations keep running on your relay when it comes back.
        {isPhone ? ' This works while the app is open.' : ''}
      </p>

      {onOpenSettings && (
        <button
          onClick={onOpenSettings}
          className="w-full text-[11px] text-primary hover:underline text-left"
        >
          Local Mode settings
        </button>
      )}
    </div>
  );
}
