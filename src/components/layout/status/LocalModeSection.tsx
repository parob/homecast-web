/**
 * What the status popover says about this device serving Apple Home itself.
 *
 * Lifted from the old `LocalModeBadge` popover. Local Mode is a genuinely
 * different mode of operation — automations are not running, history is not
 * being recorded, and nobody else can see what this device can — so the detail
 * is worth saying. It is not worth 185px of icon rows: that was the largest
 * single block on a panel that did not fit the phone it was reported from
 * (homecast-cloud#103), and two sentences carry the same eight facts in about
 * 70px with nothing hidden behind a tap.
 *
 * What it is no longer worth is a second pill: Local Mode engages *because*
 * the connection is down, so it and the connection state are two halves of
 * one story and now share one bubble.
 *
 * Split into a view and a container the same way `ReliabilitySection` is, so
 * the section can be exercised without a relay or a browser.
 */

import { Check, X } from 'lucide-react';
import { useLocalMode } from '@/hooks/useLocalMode';
import type { IdentityState, LocalModeReason } from '@/server/local-mode';

const REASON_TEXT: Record<LocalModeReason, string> = {
  'manual': 'Local Mode is switched on in Settings.',
  'no-relay-ever': "You haven't set up a home relay yet.",
  'relay-offline': 'Your home relay is offline.',
  'socket-down': "This device can't reach Homecast's servers.",
};

/**
 * What Local Mode can and cannot do.
 *
 * These were eight rows with an icon each — 185px of a 449px section. Two
 * sentences carry the same eight facts in about 70px, and a list you read once
 * to find out what is missing reads at least as well as prose.
 */
const WORKS = 'lights, switches, plugs, sensors, thermostats, locks, blinds, scenes and rooms';
const DOESNT = 'automations, notifications, history recording and sharing with other people';

export interface LocalModeSectionViewProps {
  reason: LocalModeReason | null;
  identityState: IdentityState;
  matched: number;
  reported: number;
  /** Phrasing only — "this device" vs "this Mac". */
  isPhone: boolean;
  /** Opens Settings → Local Mode. Absent unless Developer Mode is on. */
  onOpenSettings?: () => void;
}

export function LocalModeSectionView({
  reason,
  identityState,
  matched,
  reported,
  isPhone,
  onOpenSettings,
}: LocalModeSectionViewProps) {
  const deviceWord = isPhone ? 'device' : 'Mac';
  const unmapped = identityState === 'unmapped';

  return (
    <div className="space-y-2">
      {/*
        No header row and no "Active" pill: you cannot reach this section
        without having tapped a green-dotted pill that already reads
        "Local Mode".

        And only the reason. "This device is talking to your Apple Home
        directly" is the connection chain's own sentence twenty pixels above
        this one — `buildChain` leads with it in every state where this section
        renders — so saying it again was the panel repeating itself at the top
        of its longest section. It stays as the fallback for the case where
        there is no reason to give, because then nothing else has said it.
      */}
      <p className="text-xs text-muted-foreground">
        {reason ? REASON_TEXT[reason] : `This ${deviceWord} is talking to your Apple Home directly.`}
      </p>

      <div className="space-y-1.5 text-[11px]">
        <div className="flex gap-1.5">
          <Check className="mt-px h-3 w-3 text-green-600 shrink-0" />
          <span className="leading-snug">Works: {WORKS}.</span>
        </div>
        <div className="flex gap-1.5 text-muted-foreground">
          <X className="mt-px h-3 w-3 shrink-0" />
          <span className="leading-snug">Paused: {DOESNT}.</span>
        </div>
      </div>

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

      {/* "Automations keep running on your relay when it comes back" went with
          the checklist: "Paused" already says they resume. What nothing else
          on the panel says is that on a phone this stops when the app does. */}
      {isPhone && (
        <p className="text-[11px] text-muted-foreground border-t pt-2">
          Local Mode works while the app is open.
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
