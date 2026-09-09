/**
 * What the status popover says about this device serving Apple Home itself.
 *
 * Lifted from the old `LocalModeBadge` popover. Local Mode is a genuinely
 * different mode of operation — automations are not running, history is not
 * being recorded, and nobody else can see what this device can — so the detail
 * is worth keeping. What it is no longer worth is a second telling: the chain
 * above this section already draws the bypass and already says why it is
 * happening, and on an iPhone the three of them together ran the popover off
 * the bottom of the screen (parob/homecast-cloud#103).
 *
 * So this section says only what nothing else in the popover does:
 *
 *   - the reason, when the chain's sentence has not already given it
 *     (`manual`, `no-relay-ever`; the other two *are* the chain's sentence);
 *   - how much of the home is under the user's own names;
 *   - what does and does not work here — behind a disclosure, closed by
 *     default, because it is reference material rather than status;
 *   - that automations resume on the relay.
 */

import { useState } from 'react';
import { Check, ChevronRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLocalMode } from '@/hooks/useLocalMode';
import type { LocalModeReason } from '@/server/local-mode';

/**
 * The two reasons the chain sentence does not cover. `relay-offline` and
 * `socket-down` are exactly what the chain draws and says, so repeating them
 * here was the redundancy #103 reported.
 */
const REASON_TEXT: Partial<Record<LocalModeReason, string>> = {
  'manual': 'Local Mode is switched on in Settings.',
  'no-relay-ever': "You haven't set up a home relay yet, so this device is serving your home itself.",
};

const WORKS = ['Lights, switches and plugs', 'Sensors and thermostats', 'Locks and blinds', 'Scenes and rooms'];
const DOESNT = ['Automations', 'Notifications', 'History recording', 'Sharing with other people'];

interface LocalModeSectionProps {
  /** Opens Settings → Local Mode. Absent unless Developer Mode is on. */
  onOpenSettings?: () => void;
}

export function LocalModeSection({ onOpenSettings }: LocalModeSectionProps) {
  const { reason, identityState, matched, reported } = useLocalMode();
  const [showCapabilities, setShowCapabilities] = useState(false);

  const isPhone = /iPhone|iPad/i.test(navigator.userAgent)
    || (window as Window & { isHomecastIOSApp?: boolean }).isHomecastIOSApp === true;
  const deviceWord = isPhone ? 'device' : 'Mac';
  const unmapped = identityState === 'unmapped';
  const reasonText = reason ? REASON_TEXT[reason] : undefined;

  return (
    <div className="space-y-2">
      <span className="text-xs font-semibold">Local Mode</span>

      {reasonText && <p className="text-xs text-muted-foreground">{reasonText}</p>}

      {/* Only worth saying when it is not the whole story. */}
      {identityState === 'partial' && (
        <p className="text-[11px] text-muted-foreground">
          {matched} of {reported} accessories matched your Homecast layout. The rest
          show their Apple Home names.
        </p>
      )}
      {unmapped && (
        <p className="text-[11px] text-amber-600">
          Your custom names and layout will come back when this {deviceWord} is next online.
        </p>
      )}

      {/* Reference, not status: closed until asked for. Nothing is removed —
          the eight rows are one tap away rather than eight rows tall. */}
      <button
        type="button"
        onClick={() => setShowCapabilities(v => !v)}
        aria-expanded={showCapabilities}
        className="flex w-full items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className={cn('h-3 w-3 shrink-0 transition-transform', showCapabilities && 'rotate-90')} />
        What works in Local Mode
      </button>
      {showCapabilities && (
        <div className="space-y-1.5 pl-4">
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
      )}

      <p className="text-[11px] text-muted-foreground">
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
