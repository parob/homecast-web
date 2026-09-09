/**
 * What the status popover says about this device serving Apple Home itself.
 *
 * Lifted from the old `LocalModeBadge` popover. Local Mode is a genuinely
 * different mode of operation — automations are not running, history is not
 * being recorded, and nobody else can see what this device can — so that
 * detail has to be reachable. It does not have to be *open*: it is eight
 * static rows that never vary, so after the first read it is the largest
 * block of already-known text on a panel that overran the phone it was
 * reported from. It is a disclosure now, and the same sentence lives one tap
 * away in Settings → Local Mode.
 *
 * What it is no longer worth is a second pill: Local Mode engages *because*
 * the connection is down, so it and the connection state are two halves of
 * one story and now share one bubble.
 *
 * Split into a view and a container the same way `ReliabilitySection` is, so
 * the panel can be rendered at a real viewport without a relay — which is how
 * the before/after for #103 was measured.
 */

import { Check, ChevronRight, X } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useLocalMode } from '@/hooks/useLocalMode';
import type { IdentityState, LocalModeReason } from '@/server/local-mode';

const REASON_TEXT: Record<LocalModeReason, string> = {
  'manual': 'Local Mode is switched on in Settings.',
  'no-relay-ever': "You haven't set up a home relay yet.",
  'relay-offline': 'Your home relay is offline.',
  'socket-down': "This device can't reach Homecast's servers.",
};

const WORKS = ['Lights, switches and plugs', 'Sensors and thermostats', 'Locks and blinds', 'Scenes and rooms'];
const DOESNT = ['Automations', 'Notifications', 'History recording', 'Sharing with other people'];

export interface LocalModeSectionViewProps {
  reason: LocalModeReason | null;
  identityState: IdentityState;
  matched: number;
  reported: number;
  /** Phrasing only — "this device" vs "this Mac". */
  isPhone: boolean;
  /** Opens Settings → Local Mode. Absent unless Developer Mode is on. */
  onOpenSettings?: () => void;
  /** Start with the capability list open. Preview and tests only. */
  defaultDetailOpen?: boolean;
}

export function LocalModeSectionView({
  reason,
  identityState,
  matched,
  reported,
  isPhone,
  onOpenSettings,
  defaultDetailOpen = false,
}: LocalModeSectionViewProps) {
  const [detailOpen, setDetailOpen] = useState(defaultDetailOpen);
  const deviceWord = isPhone ? 'device' : 'Mac';
  const unmapped = identityState === 'unmapped';

  return (
    <div className="space-y-2">
      {/*
        No header row and no "Active" pill. You cannot reach this section
        without having tapped a green-dotted pill that already reads
        "Local Mode", and the sentence above it in ConnectionSection has
        already said the device is talking to the home directly. What is
        left to say is the part the chain cannot draw: *why*.
      */}
      {reason && (
        <p className="text-xs text-muted-foreground">{REASON_TEXT[reason]}</p>
      )}

      <button
        type="button"
        onClick={() => setDetailOpen((o) => !o)}
        aria-expanded={detailOpen}
        className="flex w-full items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className={cn('h-3 w-3 shrink-0 transition-transform', detailOpen && 'rotate-90')} />
        What works in Local Mode
      </button>

      {detailOpen && (
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
          <p className="pt-1 text-[11px] text-muted-foreground">
            Automations keep running on your relay when it comes back.
            {isPhone ? ' This works while the app is open.' : ''}
          </p>
        </div>
      )}

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

interface LocalModeSectionProps {
  /** Opens Settings → Local Mode. Absent unless Developer Mode is on. */
  onOpenSettings?: () => void;
}

export function LocalModeSection({ onOpenSettings }: LocalModeSectionProps) {
  const { reason, identityState, matched, reported } = useLocalMode();

  const isPhone = /iPhone|iPad/i.test(navigator.userAgent)
    || (window as Window & { isHomecastIOSApp?: boolean }).isHomecastIOSApp === true;

  return (
    <LocalModeSectionView
      reason={reason}
      identityState={identityState}
      matched={matched}
      reported={reported}
      isPhone={isPhone}
      onOpenSettings={onOpenSettings}
    />
  );
}
