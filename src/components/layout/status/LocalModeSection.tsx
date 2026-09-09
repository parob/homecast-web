/**
 * What the status popover says about this device serving Apple Home itself.
 *
 * Lifted from the old `LocalModeBadge` popover, and trimmed twice. #103 moved
 * the reason into the chain above and folded the capability list behind a
 * disclosure; #107 says it is *still* far too long, and it was right — a
 * heading, two paragraphs, a disclosure and a link, under a chain that has
 * already explained the situation, on a 440pt phone.
 *
 * So this section now says only what nothing else can say, in at most two
 * short lines:
 *
 *   - the reason, when the chain's sentence has not already given it
 *     (`manual`, `no-relay-ever`; the other two *are* the chain's sentence);
 *   - how much of the home is under the user's own names;
 *   - on a phone, that this lasts only while the app is open.
 *
 * What went, and where it lives instead: the eight-row works/doesn't list and
 * "automations keep running on your relay" are both Settings → Local Mode,
 * which is one tap away at the bottom of this section. Reference material
 * about a mode belongs on the mode's own page, not in a status bubble.
 */

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

interface LocalModeSectionProps {
  /** Opens Settings → Local Mode. Absent unless Developer Mode is on. */
  onOpenSettings?: () => void;
}

export function LocalModeSection({ onOpenSettings }: LocalModeSectionProps) {
  const { reason, identityState, matched, reported } = useLocalMode();

  const isPhone = /iPhone|iPad/i.test(navigator.userAgent)
    || (window as Window & { isHomecastIOSApp?: boolean }).isHomecastIOSApp === true;
  const deviceWord = isPhone ? 'device' : 'Mac';
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
      {identityState === 'unmapped' && (
        <p className="text-[11px] text-amber-600">
          Your custom names and layout will come back when this {deviceWord} is next online.
        </p>
      )}

      {/* The one caveat with nowhere else to live: closing the app ends it. */}
      {isPhone && (
        <p className="text-[11px] text-muted-foreground">Works while Homecast is open.</p>
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
