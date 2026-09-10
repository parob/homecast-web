/**
 * The one status bubble: does your home work, and if not, why.
 *
 * This replaces three separate pills that were all answering versions of the
 * same question, each with its own dot and its own popover —
 * `ConnectionBadge` (your link to the cloud), `RelayStatusBadge` (this Mac's
 * relay duty) and `LocalModeBadge` (this device serving Apple Home itself).
 *
 * They did not merely repeat each other, they disagreed. On a socket drop you
 * got a red "Offline" in the header's left cluster and a green "Local Mode" in
 * the right one, separated by the Guest pill, while the home was working
 * perfectly through the second of them. Which of the three facts is worth
 * saying is now decided in one place, `lib/status-badge.ts`.
 *
 * ── The popover is one answer, not four sections ───────────────────────────
 *
 * After the merge the popover still stacked four sections — the chain, a
 * Reliability preview, a Local Mode section and Relay Status — each an honest
 * rendering of its own source, and together three different tellings of who
 * was serving the home, with "Offline" printed over a home that worked
 * (parob/homecast-cloud#109 and the screenshots under it). It is now the
 * answer card from `lib/answer-card.ts` — verdict, because, the chain only when
 * a hop is not green, at most one action — and two rows linking to the pages
 * that hold the detail. Everything that left is still one tap away, on a page
 * that already showed it.
 *
 * ── Present at every state, including good ─────────────────────────────────
 *
 * An indicator that appears only when something is wrong cannot be told apart
 * from one that is broken, or from one that was never measuring: absence means
 * both "fine" and "nothing is checking", and the user has nowhere to look.
 * Showing the healthy state is what makes the degraded state legible *as a
 * change*.
 *
 * Being present is not the same as asking for attention. When there is nothing
 * to report this is a single muted dot in a 24×24 circle: no label, no motion,
 * nothing to read. Escalation is carried by colour, label and movement, never
 * by appearing. (`rounded-full` on a non-square box is a stadium, not a circle
 * — equal height and width is what actually makes it round, so the labelled
 * state is the only one that becomes a pill.)
 */

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { serverConnection } from '@/server/connection';
import type { ConnectionQuality } from '@/server/connection-quality';
import { SLOW_IN_FLIGHT_MS, SLOW_RTT_MS } from '@/server/connection-quality';
import { isCommunity } from '@/lib/config';
import { thisDeviceNoun } from '@/lib/platform';
import { isRelayCapable, isRelayEnabled } from '@/native/homekit-bridge';
import { useWebSocket } from '@/contexts/WebSocketContext';
import { useLocalMode } from '@/hooks/useLocalMode';
import { statusPresentation } from '@/lib/status-badge';
import { buildAnswerCard } from '@/lib/answer-card';
import { linkFine } from '@/lib/connection-chain';
import {
  composeServing,
  effectiveServing,
  getHomeServing,
  getThisDevice,
  subscribeHomeServing,
} from '@/server/home-serving';
import { warnsUser, RECONNECTED_VISIBLE_MS, rttForDisplay } from '@/lib/connection-presentation';
import { AnswerCardView, RelayRow, ReliabilityRow } from './status/AnswerCard';

interface StatusBadgeProps {
  isDarkBackground?: boolean;
  accountType?: string;
  /**
   * The home the card's verdict and the chain's last node are named for.
   * Absent falls back to "Your home" / "Home" — see `homeSubject` and rule 3
   * in `lib/connection-chain.ts`. Passed in rather than resolved here because
   * which home this is describing is a fact about what the user is looking
   * at, and the Dashboard is what knows that.
   */
  homeName?: string | null;
  /**
   * The home the dashboard is showing, whose reliability the popover's row
   * summarises. Absent (nothing selected, or Community mode, which has no
   * uptime record) and the row is not rendered.
   */
  homeId?: string | null;
  /** Opens Settings → that home → Reliability. */
  onOpenReliability?: () => void;
  /** Opens Settings → Relay. Absent hides the row's chevron. */
  onOpenRelaySettings?: () => void;
}

/** Seconds, for a duration someone is watching tick upward. */
function secs(ms: number): string {
  return ms >= 1000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms)}ms`;
}

/**
 * What the socket is waiting on, ranked exactly as `classifyQuality` reads it.
 *
 * Shown only while the link is the thing being complained about. The round
 * trip itself is not repeated here — it is on the chain's first hop, or in the
 * card's `via` line, and never in both places at once.
 */
function linkEvidence(): string | null {
  const inFlight = serverConnection.getOldestInFlightMs();
  if (inFlight !== null && inFlight >= SLOW_IN_FLIGHT_MS) return `A request has been waiting ${secs(inFlight)}.`;
  const pendingPing = serverConnection.getPendingPingMs();
  if (pendingPing !== null && pendingPing >= SLOW_RTT_MS) return 'No reply to the last connection check.';
  return null;
}

export function StatusBadge({
  isDarkBackground,
  accountType,
  homeName,
  homeId,
  onOpenReliability,
  onOpenRelaySettings,
}: StatusBadgeProps) {
  const { quality } = useWebSocket();
  const localMode = useLocalMode();
  const [open, setOpen] = useState(false);
  const openTimeRef = useRef(0);

  // Everything about the *home* — whether a relay may serve it, which one,
  // whether that is this device — is one fact, read from one store. It used
  // to be four separate readings here (relay duty from the socket, cloud
  // standby from the roles map, a refusal from relay-reachability, Local Mode
  // from its controller), and the pairs that disagreed were homecast-cloud#99.
  // The store notifies on change; the fact itself is read at render time so
  // the Local Mode composition is never a frame stale.
  const [, bumpServing] = useState(0);
  useEffect(() => subscribeHomeServing(() => bumpServing(n => n + 1)), []);
  const thisDevice = getThisDevice();
  // With several homes and none selected there is no home to ask about, and
  // the only fact left is this device's own — which is still worth the label.
  const serving = homeId
    ? effectiveServing(homeId)
    : composeServing(null, { active: localMode.active }, thisDevice);
  const relayServing = homeId ? getHomeServing(homeId) : null;
  const unmapped = localMode.identityState === 'unmapped';

  // Re-render the popover's live figures while it is open, and only then.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, [open]);

  // The recovery confirmation, which used to be the "Reconnected" toast.
  //
  // It lives here rather than in the classifier because it is not a state of
  // the connection — it is a statement about one the connection just left, and
  // the classifier is deliberately memoryless. Same rule the toast used: only
  // confirm a recovery if we actually showed the user a warning to recover
  // from, so a blip nobody saw does not announce itself.
  const [reconnected, setReconnected] = useState(false);
  const prevQuality = useRef<ConnectionQuality>(quality);
  useEffect(() => {
    const was = prevQuality.current;
    prevQuality.current = quality;
    if (quality === 'good' && warnsUser(was)) {
      setReconnected(true);
      const t = setTimeout(() => setReconnected(false), RECONNECTED_VISIBLE_MS);
      return () => clearTimeout(t);
    }
    if (quality !== 'good') setReconnected(false);
  }, [quality]);

  const showRelay = isRelayEnabled();

  // Community mode on the relay Mac has no *socket* to describe: Apple Home is
  // served from this very process and none is ever opened, so `quality` sits on
  // `unknown` for ever. Pinning it to `good` is what keeps a dot from
  // permanently saying "checking" about a hop that does not exist.
  //
  // It does have a connection to describe, though, and the card describes it —
  // This Mac -> Local server -> Home, with no cloud node at all, and "Nothing is
  // going through the cloud."
  //
  // With the relay switched off, this machine is not serving the home and the
  // card would be claiming something false, so the bubble still goes.
  const communityRelayMac = isCommunity && isRelayCapable();
  const effectiveQuality: ConnectionQuality = communityRelayMac ? 'good' : quality;

  const managed = accountType === 'cloud';
  const p = statusPresentation({
    quality: effectiveQuality,
    reconnected,
    serving,
    relayServing,
    thisDevice,
    unmapped,
    localReason: localMode.reason,
    relayEnabled: showRelay,
    managed,
    community: communityRelayMac,
  });

  if (communityRelayMac && !showRelay) return null;

  // Keyed on `accountType`, never on a home's `isCloudManaged` — that flag
  // rides the WebSocket `homes.list` payload and the locally-answered one does
  // not carry it, so it goes missing during Local Mode and cloud outages,
  // which is exactly when this panel is being read. See lib/connection-chain.ts.
  //
  // The round trip is drawn only when the classifier would stand behind it: a
  // missed pong is recorded as a lower bound, and painting that green on the
  // first hop was parob/homecast-web#98.
  const card = buildAnswerCard({
    quality: effectiveQuality,
    reconnected,
    serving,
    relayServing,
    thisDevice,
    unmapped,
    localReason: localMode.reason,
    managed,
    community: communityRelayMac,
    rtt: rttForDisplay(
      serverConnection.getLastRttMs(),
      serverConnection.getPendingPingMs(),
      serverConnection.getOldestInFlightMs(),
      { slowRttMs: SLOW_RTT_MS, slowInFlightMs: SLOW_IN_FLIGHT_MS },
    ),
    homeName: homeName ?? null,
    deviceNoun: thisDeviceNoun(),
  });

  // The rows need the server: neither is worth a stale figure under a card
  // that has just said this device cannot reach Homecast.
  const linkUp = linkFine(effectiveQuality);
  const showReliabilityRow = !!homeId && !isCommunity && linkUp;
  const showRelayRow = showRelay && !communityRelayMac && linkUp;

  return (
    <Popover open={open} onOpenChange={(o) => {
      if (o) openTimeRef.current = Date.now();
      setOpen(o);
    }}>
      <PopoverTrigger asChild>
        <button
          aria-label={p.srLabel}
          className={cn(
            'flex items-center justify-center rounded-full text-[13px] font-medium',
            // Width changes when a label appears. Eased rather than snapped:
            // the badge sits in a right-anchored cluster, so it grows leftward
            // and never disturbs the title — but a sudden jump still reads as a
            // glitch rather than as information.
            'transition-all duration-300 window-no-drag',
            p.label ? 'gap-1.5 px-2 py-1' : 'h-6 w-6 p-0',
            isDarkBackground
              ? 'bg-black/40 backdrop-blur-xl hover:bg-black/50 text-white'
              : 'bg-transparent hover:bg-black/10 text-foreground',
          )}
        >
          <span
            className={cn(
              'h-2 w-2 rounded-full shrink-0',
              p.dotClass,
              // `motion-safe:` so a viewer who has asked for less movement gets
              // the colour and the label without the animation.
              p.pulse && 'motion-safe:animate-pulse',
            )}
          />
          {p.label}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        // The last row's `py-1.5` stacks on the card's own padding, so with the
        // rows present there was 5px more air under the bottom row than above
        // the first line and the card read as bottom-heavy. The row keeps its
        // padding — it is a tap target — and the card stops counting it twice.
        // Done here rather than as a `-mb-1` on the rows container, which
        // `space-y-3` overrides: it sets `margin-bottom` on every child after
        // the first, at a higher specificity.
        className={cn('w-[280px] p-3 window-no-drag', (showReliabilityRow || showRelayRow) && 'pb-2')}
        onPointerDownOutside={(e) => {
          // Radix closes on pointerdown, which on touch fires before the tap
          // that opened it has finished — without this the popover flickers
          // shut. The other two badges had this guard; the connection one did
          // not, and inherited a real touch bug along with the omission.
          if (Date.now() - openTimeRef.current < 300) e.preventDefault();
        }}
      >
        <div className="space-y-3">
          <AnswerCardView
            card={card}
            evidence={linkUp ? null : linkEvidence()}
            onReconnect={() => { serverConnection.reconnect(); setOpen(false); }}
          />

          {(showReliabilityRow || showRelayRow) && (
            <div className="divide-y border-t pt-1">
              {showReliabilityRow && (
                <ReliabilityRow
                  homeId={homeId!}
                  onOpen={onOpenReliability
                    ? () => { setOpen(false); onOpenReliability(); }
                    : undefined}
                />
              )}
              {showRelayRow && (
                <RelayRow
                  onOpen={onOpenRelaySettings
                    ? () => { setOpen(false); onOpenRelaySettings(); }
                    : undefined}
                />
              )}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
