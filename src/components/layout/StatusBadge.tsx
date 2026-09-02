/**
 * The one status bubble: how you are reaching your home, and how well.
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
 * saying is now decided in one place, `lib/status-badge.ts`, and the rest goes
 * in the popover.
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
import { isCommunity } from '@/lib/config';
import { isRelayCapable, isRelayEnabled } from '@/native/homekit-bridge';
import { useWebSocket } from '@/contexts/WebSocketContext';
import { useLocalMode } from '@/hooks/useLocalMode';
import { statusPresentation } from '@/lib/status-badge';
import { warnsUser, RECONNECTED_VISIBLE_MS, formatRtt } from '@/lib/connection-presentation';
import { buildChain } from '@/lib/connection-chain';
import type { ChainVariant } from './status/ConnectionChain';
import { ConnectionSection } from './status/ConnectionSection';
import { LocalModeSection } from './status/LocalModeSection';
import { RelaySection } from './status/RelaySection';

/**
 * Which drawing of the path the panel uses.
 *
 * One constant rather than a setting: this is a design decision to be made
 * once, not a preference to expose.
 *
 * **Rail is the decision** (parob/homecast-cloud#38, chosen from real
 * screenshots of all three). It was picked over the sleeker Bar because the
 * popover is 280px, and the horizontal treatments all spend their width
 * fighting for it — Nodes truncates a long relay name and Bar's node labels
 * are tight at four words. Rail spends vertical space, which a popover has,
 * and is the only one where "Cloud relay" and a hop label are both
 * full-length in every state.
 *
 * The other two are kept rather than deleted: they are three renderings of
 * one model, the alternatives cost a few lines each, and a bottom sheet or a
 * header pill would want a different one. `design-mocks/status-chain-real.html`
 * renders all three.
 */
const CHAIN_VARIANT: ChainVariant = 'rail';

interface StatusBadgeProps {
  isDarkBackground?: boolean;
  accountType?: string;
  accessoryLimit?: number | null;
  includedAccessoryCount?: number;
  /** Opens Settings → Local Mode. Absent unless Developer Mode is on. */
  onOpenLocalModeSettings?: () => void;
}

export function StatusBadge({
  isDarkBackground,
  accountType,
  accessoryLimit,
  includedAccessoryCount,
  onOpenLocalModeSettings,
}: StatusBadgeProps) {
  const { quality } = useWebSocket();
  const localMode = useLocalMode();
  const [open, setOpen] = useState(false);
  const openTimeRef = useRef(0);

  // Relay duty, read from the subscription rather than sampled. The old badge
  // polled `getState()` every second for the whole life of the app to learn
  // this one boolean.
  const [relayStatus, setRelayStatus] = useState<boolean | null>(null);
  useEffect(() => {
    setRelayStatus(serverConnection.getState().relayStatus);
    return serverConnection.subscribe((s) => setRelayStatus(s.relayStatus));
  }, []);

  // Re-render the popover's relative times while it is open, and only then.
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

  // Community mode on the relay Mac has no connection to describe: Apple Home
  // is served from this very process and no socket is ever opened, so quality
  // sits on `unknown` for ever. Reporting that would be a dot permanently
  // saying "checking" about a hop that does not exist.
  //
  // What it reports instead is the truth of that setup: the home is reachable,
  // because this machine *is* the home's server. The relay section carries the
  // detail. With the relay switched off too there is nothing left to say, so
  // the bubble goes rather than sitting there empty.
  const communityRelayMac = isCommunity && isRelayCapable();
  const effectiveQuality: ConnectionQuality = communityRelayMac ? 'good' : quality;

  const p = statusPresentation({
    quality: effectiveQuality,
    reconnected,
    localMode: { active: localMode.active, unmapped: localMode.identityState === 'unmapped' },
    relayStatus,
  });

  if (communityRelayMac && !showRelay) return null;

  // Keyed on `accountType`, never on a home's `isCloudManaged` — that flag
  // rides the WebSocket `homes.list` payload and the locally-answered one does
  // not carry it, so it goes missing during Local Mode and cloud outages,
  // which is exactly when this panel is being read. See lib/connection-chain.ts.
  const chain = buildChain({
    quality: effectiveQuality,
    reconnected,
    relayStatus,
    localMode: { active: localMode.active, unmapped: localMode.identityState === 'unmapped' },
    managed: accountType === 'cloud',
    selfRelay: relayStatus === true,
    community: communityRelayMac,
    rtt: formatRtt(serverConnection.getLastRttMs()),
  });

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
        className="w-[280px] p-3 window-no-drag"
        onPointerDownOutside={(e) => {
          // Radix closes on pointerdown, which on touch fires before the tap
          // that opened it has finished — without this the popover flickers
          // shut. The other two badges had this guard; the connection one did
          // not, and inherited a real touch bug along with the omission.
          if (Date.now() - openTimeRef.current < 300) e.preventDefault();
        }}
      >
        <div className="space-y-3">
          {/* Sections in the same order the badge itself ranks them, so the
              headline you tapped is the first thing you read. */}
          {!communityRelayMac && (
            <ConnectionSection
              quality={effectiveQuality}
              headline={p.headline}
              onReconnect={() => { serverConnection.reconnect(); setOpen(false); }}
              chain={chain}
              chainVariant={CHAIN_VARIANT}
            />
          )}

          {localMode.active && (
            <>
              {!communityRelayMac && <div className="border-t" />}
              <LocalModeSection
                onOpenSettings={onOpenLocalModeSettings
                  ? () => { setOpen(false); onOpenLocalModeSettings(); }
                  : undefined}
              />
            </>
          )}

          {showRelay && (
            <>
              {(!communityRelayMac || localMode.active) && <div className="border-t" />}
              <RelaySection
                accountType={accountType}
                accessoryLimit={accessoryLimit}
                includedAccessoryCount={includedAccessoryCount}
              />
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
