/**
 * What the status popover says: one answer, then its evidence.
 *
 * Tap the dot and you are asking *does my home work?* The popover used to
 * answer with four sections — the chain, Reliability, Local Mode, Relay
 * Status — each an honest rendering of its own source, and together three
 * different tellings of who was serving the home, with "Offline" printed over
 * a home that worked (parob/homecast-cloud#109, and the screenshots under it).
 *
 * This module is the one answer. It reads the same two facts the dot reads —
 * this device's link (`quality`) and the home's `serving` — and produces a
 * card in a fixed order:
 *
 *   verdict   the home by name and whether it works, in the dot's own colour
 *   because   one sentence: why, and what happens next
 *   where     the chain from `connection-chain.ts` — ONLY when a hop is not
 *             green; healthy, it collapses to `via Cloud relay · 14ms`
 *   do        at most one thing: Reconnect, or a quiet "nothing to do"
 *
 * The two rows under it (Reliability, This Mac) are the component's; they are
 * history and duty, and neither is part of the answer.
 *
 * ── The colour rule ────────────────────────────────────────────────────────
 *
 *   green   working, the normal way
 *   amber   working, but not the normal way (this device or a standby Mac is
 *           standing in for a relay that has gone), or slowly, or expected to
 *           right itself in a moment
 *   red     not working
 *
 * Amber for a backup path is a choice: on a phone it ends when the app closes,
 * automations on the relay are not running, and other people at home may not
 * have the same access. The home works — the dot is not red — but the person
 * who owns it would want to know. Local Mode switched on by hand is not a
 * backup path and stays green.
 *
 * `statusPresentation` in `status-badge.ts` colours the dot from the same
 * ranking; `answer-card.test.ts` walks the whole state matrix asserting the two
 * agree, which is the property the merge in `StatusBadge.tsx` exists for.
 *
 * Pure, so every sentence below is a test rather than a screenshot.
 */

import type { LocalModeReason } from '@/server/local-mode';
import { servedByThisDevice, type HomeServing } from '@/server/home-serving';
import {
  buildChain,
  chainHasFault,
  linkFine,
  takeoverIn,
  type ChainInput,
  type ChainModel,
} from './connection-chain';

export type CardTone = 'ok' | 'warn' | 'bad' | 'idle';

export interface AnswerCard {
  tone: CardTone;
  /** Gentle motion for a state expected to resolve itself. */
  pulse: boolean;
  /** The headline. */
  verdict: string;
  /** Why, and what happens next. `null` when the verdict says it all. */
  because: string | null;
  /** The route and the number, shown in place of the drawing when nothing is broken. */
  via: string | null;
  /** An amber aside under the drawing — Local Mode running under Apple Home's names. */
  caveat: string | null;
  /** The quiet "nothing to do" note, for a fault that is Homecast's to fix. */
  note: string | null;
  /** Offer "Reconnect now" — only when this device's own link is the fault. */
  reconnect: boolean;
  chain: ChainModel;
  /** Draw the chain. False whenever every hop is green: the drawing only appears when it has something to point at. */
  showChain: boolean;
}

export interface AnswerCardInput extends ChainInput {
  /** The transient "it's back", which is not a ConnectionQuality. */
  reconnected: boolean;
  /** Local Mode is running under Apple Home's names rather than the user's. */
  unmapped: boolean;
  /** The Local Mode controller's own reason for being on, when it is. */
  localReason: LocalModeReason | null;
  /** What this device calls itself in a sentence: `iPhone`, `iPad`, `Mac`, or `device`. */
  deviceNoun: string;
  /** For the takeover countdown. Defaults to `Date.now()`. */
  now?: number;
}

const NOTIFIED = 'Nothing to do here — Homecast has been notified and is on it.';

/** "County Hall" as the subject of a sentence, or the generic when there is no name. */
export function homeSubject(homeName: string | null | undefined): string {
  return homeName?.trim() || 'Your home';
}

/**
 * Is Local Mode standing in for a relay that has gone, as opposed to having
 * been switched on by hand?
 *
 * Shared with `statusPresentation`, because it is the one place the dot's
 * colour and the card's colour could drift apart. Trusts the facts first and
 * the controller's stated reason second: if either says a relay or the cloud
 * is gone, this is a backup path.
 */
export function localModeStandingIn(i: {
  quality: ChainInput['quality'];
  relayServing: HomeServing | null;
  thisDevice: string | null;
  managed: boolean;
  localReason: LocalModeReason | null;
}): boolean {
  if (!linkFine(i.quality)) return true;
  const relay = i.relayServing;
  if (relay && relay.state !== 'served') return true;
  // A cloud-plan Mac that the server says is serving the home is the activated
  // standby: the cloud relay is gone and this Mac took the home over.
  if (i.managed && servedByThisDevice(relay, i.thisDevice)) return true;
  return i.localReason === 'relay-offline' || i.localReason === 'socket-down';
}

export function buildAnswerCard(input: AnswerCardInput): AnswerCard {
  const { quality, managed, community, reconnected, deviceNoun } = input;
  const now = input.now ?? Date.now();
  const serving = input.serving;
  const relayServing = input.relayServing ?? (serving?.kind === 'local' ? null : serving);
  const chain = buildChain(input);
  const H = homeSubject(input.homeName);
  const dev = deviceNoun;
  const isPhone = dev === 'iPhone' || dev === 'iPad';
  const relayCap = managed ? 'The cloud relay' : 'Your relay';
  const relayNode = chain.nodes.find(n => n.key === 'relay');
  const via = relayNode ? (input.rtt ? `via ${relayNode.name} · ${input.rtt}` : `via ${relayNode.name}`) : null;

  const card = (over: Partial<AnswerCard> & Pick<AnswerCard, 'tone' | 'verdict'>): AnswerCard => ({
    pulse: false,
    because: null,
    via: null,
    caveat: null,
    note: null,
    reconnect: false,
    chain,
    showChain: chainHasFault(chain),
    ...over,
  });

  // ── Community: this Mac is the server, nothing leaves the house ──────────
  if (community) {
    return card({
      tone: 'ok',
      verdict: `${H} is working`,
      because: 'This Mac is serving it on its own. Nothing is going through the cloud.',
      showChain: false,
    });
  }

  // ── Local Mode: this device is talking to Apple Home directly ────────────
  //
  // Outranks everything, as it does on the dot: it is a superset of the link
  // being down — the cloud is unreachable AND the home works — and saying
  // "Offline" over a working home is the contradiction the merge removed.
  if (serving?.kind === 'local') {
    const standingIn = localModeStandingIn({ ...input, relayServing });
    const linkDown = !linkFine(quality);
    const relayDown = !linkDown && !!relayServing && relayServing.state !== 'served';
    const tookOver = !linkDown && managed && servedByThisDevice(relayServing, input.thisDevice);
    const tail = standingIn && isPhone ? ' — while Homecast is open' : '';
    const direct = `this ${dev} is talking to your home directly${tail}.`;
    const because = linkDown
      ? `Homecast is unreachable, so ${direct}`
      : tookOver
        ? "The cloud relay is offline, so this Mac is standing in — for you, and for everyone else at home — until it's back."
        : relayDown
          ? `${relayCap} isn't answering, so ${direct}`
          : input.localReason === 'manual'
            ? `This ${dev} is talking to your home directly — Local Mode is switched on in Settings.`
            : input.localReason === 'no-relay-ever'
              ? `This ${dev} is talking to your home directly — you haven't set up a relay yet.`
              : standingIn
                ? `${relayCap} went offline, so ${direct}`
                : `This ${dev} is talking to your home directly.`;
    return card({
      tone: standingIn || input.unmapped ? 'warn' : 'ok',
      verdict: `${H} is working`,
      because,
      caveat: input.unmapped
        ? `Some devices show their Apple Home names until this ${dev} can reach Homecast again.`
        : null,
    });
  }

  // ── This device's own link ───────────────────────────────────────────────
  //
  // Ranked above the home's fact because a broken link explains an unreachable
  // home, and is the one fault the person holding the device can do something
  // about.
  if (!linkFine(quality)) {
    switch (quality) {
      case 'offline':
        return card({
          tone: 'bad',
          verdict: `This ${dev} can't reach Homecast`,
          because: `Check your wifi or mobile signal. ${H} itself may be fine — it's this ${dev} that's cut off.`,
          reconnect: true,
          showChain: true,
        });
      case 'connecting':
        return card({
          tone: 'idle',
          pulse: true,
          verdict: 'Reconnecting to Homecast…',
          reconnect: true,
          showChain: true,
        });
      case 'slow':
        // Where the old copy was actively wrong: "Your connection is slow" got
        // said about a 28ms connection, because the slowness was further along.
        return card({
          tone: 'warn',
          verdict: `${H} is working, slowly`,
          because: `Reaching Homecast is slow right now. ${relayCap} is answering normally behind it.`,
          reconnect: true,
          showChain: true,
        });
      case 'stalled':
        // The flagship contrast: identical red hop, opposite advice. A dead
        // cloud relay leaves the socket to Homecast perfectly healthy, so
        // "Reconnect now" would rebuild something that was never broken — and
        // the user owns no hardware to go and restart.
        return card({
          tone: 'warn',
          pulse: true,
          verdict: `${H} isn't responding`,
          because: managed
            ? `The cloud relay for this home isn't answering. Your ${dev} and your internet are both fine.`
            : `Homecast can't get an answer from your relay. Your ${dev} and your internet are both fine.`,
          note: managed ? NOTIFIED : null,
          reconnect: !managed,
          showChain: true,
        });
    }
  }

  // ── The cloud is answering, and its answer is "nothing may serve this home" ─
  //
  // The same fault `stalled` infers from a timeout, stated outright by the
  // server as the fact for the home. Nothing here offers Reconnect: the link is
  // fine, and a fresh socket would reach the same answer.
  if (serving && serving.state !== 'served') {
    switch (serving.state) {
      case 'reconnecting':
        return card({
          tone: 'warn',
          pulse: true,
          verdict: `${H} can't be reached right now`,
          because: `${relayCap} dropped off a moment ago and should be back shortly.`,
          showChain: true,
        });
      case 'waiting':
        // The state that had no name (homecast-cloud#99): five minutes of a
        // green dot over a home refusing every write. The countdown is the
        // whole message, so it is the second line rather than an aside.
        return card({
          tone: 'warn',
          pulse: true,
          verdict: `${H} can't be reached right now`,
          because: managed
            ? `The cloud relay isn't answering. Your own relay takes over ${takeoverIn(serving.graceEndsAt, now)}.`
            : `Your relay isn't answering. Another of your relays takes over ${takeoverIn(serving.graceEndsAt, now)}.`,
          showChain: true,
        });
      default:
        // Red rather than the old amber. The amber reasoned from the app's side
        // ("the app is fine, the home is not"); from the user's side the home
        // does not work, which is the worst thing this card can say.
        return card({
          tone: 'bad',
          verdict: `${H} can't be reached`,
          because: managed
            ? `The cloud relay isn't answering. Your ${dev} and your internet are both fine.`
            : `Homecast can't get an answer from your relay. Your ${dev} and your internet are both fine — check that the relay is on and online.`,
          note: managed ? NOTIFIED : null,
          showChain: true,
        });
    }
  }

  // ── The activated standby ────────────────────────────────────────────────
  //
  // A cloud-plan Mac that the server says is serving is the standby that took
  // over. The path through it is green — it works — so the drawing stays
  // hidden and the sentence carries the fact worth knowing, in amber. Ranked
  // above the expired-link case below: a home fact outranks a reading that has
  // merely gone stale, as it does on the dot.
  if (serving && managed && servedByThisDevice(serving, input.thisDevice)) {
    return card({
      tone: 'warn',
      verdict: `${H} is working`,
      because: "The cloud relay is offline, so this Mac is standing in — for you, and for everyone else at home — until it's back.",
      via: quality === 'unknown' ? null : via,
      showChain: false,
    });
  }

  // ── Healthy, in its three flavours ───────────────────────────────────────
  if (quality === 'unknown') {
    // No claim, rather than a confident green: the evidence expired, which
    // happens innocently every time a tab is backgrounded.
    return card({ tone: 'idle', verdict: `Checking the route to ${H}…`, showChain: false });
  }

  if (!serving) {
    // Onboarding, or several homes and none selected: there is a link to
    // report on and no home to make a claim about.
    return card({
      tone: 'ok',
      verdict: 'Connected to Homecast',
      via: input.rtt ? `Round trip ${input.rtt}` : null,
      showChain: false,
    });
  }

  return card({
    tone: 'ok',
    verdict: reconnected ? `${H} is working again` : `${H} is working`,
    via,
    showChain: false,
  });
}
