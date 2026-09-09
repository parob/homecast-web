/**
 * Which of the overlapping facts the one status bubble should say.
 *
 * The header used to carry three separate pills, each with its own dot and its
 * own popover, all answering versions of the same question — "can this app
 * reach your home, and how?":
 *
 *   ConnectionBadge   your link to the cloud
 *   RelayStatusBadge  this Mac's relay duty
 *   LocalModeBadge    this device is serving Apple Home itself
 *
 * They were not merely redundant, they actively contradicted each other. On a
 * socket drop you got a red "Offline" in the left cluster and a green "Local
 * Mode" in the right one, separated by the Guest pill, while the home was in
 * fact working perfectly through the second of them. Local Mode's own popover
 * explained itself with "This device can't reach Homecast's servers" — the
 * identical fact the other pill was reporting in the opposite colour.
 *
 * So the pixels merge, and this module decides what the single label says.
 * Pure, so the ordering is testable rather than something you have to
 * reproduce by pulling a network cable.
 *
 * ── Two inputs, not five ───────────────────────────────────────────────────
 *
 * Everything about the *home* — whether a relay may serve it, which one, and
 * whether that relay is this device or this device's own HomeKit — arrives as
 * one value: `serving`, the composed `effectiveServing` from
 * `server/home-serving.ts`. It used to be four separate booleans
 * (`localMode.active`, `relayStatus`, `cloudStandby`, `homeUnreachable`),
 * each derived from a different source, and the pairs that disagreed were
 * homecast-cloud#99. Now the only other input is the *link*: `quality`, which
 * is about this device's socket and nothing else.
 *
 * ── The dot is about the home, not about this machine ──────────────────────
 *
 * The colour rule is the answer card's (`lib/answer-card.ts`): green is
 * working, amber is working but not the normal way — or slowly, or expected to
 * right itself — and red is not working. Two things follow that used to be
 * otherwise:
 *
 *  - **Relay duty is not on the dot.** A self-hosted Mac standing by for
 *    another Mac used to show an amber "Standby" pill over a home that worked
 *    perfectly. Duty describes what this machine is doing, not whether you can
 *    reach anything; it is a row in the popover now, and the dot is green.
 *  - **A home that cannot be reached is red**, not amber. The amber reasoned
 *    from the app's side ("the app is fine, the home is not"); from the user's
 *    side the home does not work.
 *
 * `answer-card.test.ts` walks the whole state matrix asserting the dot and the
 * card agree on colour, so the two cannot drift.
 */

import type { ConnectionQuality } from '@/server/connection-quality';
import type { LocalModeReason } from '@/server/local-mode';
import { servedByThisDevice, type HomeServing } from '@/server/home-serving';
import { localModeStandingIn } from './answer-card';
import {
  connectionPresentation,
  RECONNECTED_PRESENTATION,
  type ConnectionPresentation,
} from './connection-presentation';

export interface StatusInputs {
  quality: ConnectionQuality;
  /** The transient recovery confirmation is currently showing. */
  reconnected: boolean;
  /**
   * `effectiveServing(homeId)` for the home on screen: the server's fact with
   * this device's own Local Mode composed over it. `null` when no home is on
   * screen, or nothing has been heard about it yet.
   */
  serving: HomeServing | null;
  /**
   * The server's fact on its own. Equal to `serving` except in Local Mode,
   * where the composition hides it — and whether Local Mode is a backup path
   * or a choice is decided by what the server says about the relay.
   */
  relayServing: HomeServing | null;
  /** This device's id, so `serving.by` can be recognised as "me". */
  thisDevice: string | null;
  /** Local Mode is running under Apple Home's names rather than the user's. */
  unmapped: boolean;
  /** The Local Mode controller's own reason for being on, when it is. */
  localReason: LocalModeReason | null;
  /**
   * This device is relay-capable and the relay is switched on. Not consulted
   * by the ranking — kept because `StatusBadge` still decides from it whether
   * to render the "This Mac" row — and so the card, which has no such input,
   * cannot disagree with the dot.
   */
  relayEnabled: boolean;
  /** `accountType === 'cloud'`: the relay is Homecast's, not the user's. */
  managed: boolean;
  /** Community mode: no cloud, this Mac is the server, nothing to stand by for. */
  community: boolean;
}

/**
 * Local Mode, which outranks everything.
 *
 * Amber when it is standing in for a relay that has gone, because the caveat
 * is real — on a phone it ends when the app closes, automations on the relay
 * are not running — and green when it was switched on by hand, because then
 * nothing is wrong. An unmapped identity is amber either way: the user's own
 * names and layout are missing, which is worth flagging on the dot itself.
 */
function localModePresentation(standingIn: boolean, unmapped: boolean): ConnectionPresentation {
  if (standingIn) return STANDING_IN_PRESENTATION;
  return {
    label: 'Local Mode',
    dotClass: unmapped ? 'bg-amber-500' : 'bg-green-500',
    pulse: false,
    srLabel: 'Local Mode — this device is controlling Apple Home directly',
    headline: 'This device is serving your home',
  };
}

/**
 * Something other than the usual relay is carrying the home: this device's own
 * HomeKit, or a cloud-plan Mac whose standby has been activated. One label for
 * the situation rather than one per mechanism ("Local Mode", "Standby active").
 * Amber, because the thing worth knowing is that the relay is gone.
 */
export const STANDING_IN_PRESENTATION: ConnectionPresentation = {
  label: 'Standing in',
  dotClass: 'bg-amber-500',
  pulse: false,
  srLabel: 'Standing in. Your home works, but not through its usual relay',
  headline: 'Your home is working on a backup path',
};

/**
 * The cloud is answering perfectly, and it is answering "there is no relay".
 *
 * Worth its own state because every other one here is about *this device's*
 * link, and that link is flawless in this case — which is exactly why the dot
 * used to sit on quiet emerald while every write to the home failed.
 */
export const HOME_UNREACHABLE_PRESENTATION: ConnectionPresentation = {
  label: 'Relay offline',
  dotClass: 'bg-red-500',
  pulse: false,
  srLabel: "Relay offline. This home's relay is not answering",
  headline: "This home's relay isn't answering",
};

/**
 * The state that had no name before the fact did: the relay is gone, a
 * standby is connected, and the server is holding it back for the takeover
 * grace. Amber and pulsing rather than red, because it is about to resolve
 * itself — the headline says what happens next.
 */
export const HOME_WAITING_PRESENTATION: ConnectionPresentation = {
  label: 'Relay offline',
  dotClass: 'bg-amber-500',
  pulse: true,
  srLabel: "Relay offline. This home's relay is not answering; a standby is about to take over",
  headline: "This home's relay isn't answering — a standby takes over shortly",
};

/**
 * The relay dropped off within the last couple of minutes and is expected
 * back: the server's reconnect grace. Pulsing amber, the same treatment
 * `connecting` gets on the link, because it is the same kind of claim — a
 * fault that is probably transient.
 */
export const HOME_RECONNECTING_PRESENTATION: ConnectionPresentation = {
  label: 'Relay reconnecting',
  dotClass: 'bg-amber-500',
  pulse: true,
  srLabel: "Relay reconnecting. This home's relay dropped off and should be back shortly",
  headline: "This home's relay dropped off and should be back shortly",
};

/**
 * The one thing worth saying.
 *
 * **Local Mode wins over Offline, deliberately.** It is not merely the more
 * important fact, it is a *superset* of the other one: it says the cloud is
 * unreachable *and* that your home still works. Saying "Offline" over the top
 * of a working home is exactly the contradiction this merge removes. Nothing
 * is lost — the connection detail moves into the popover, which is where a
 * second-order fact belongs.
 */
export function statusPresentation(i: StatusInputs): ConnectionPresentation {
  const s = i.serving;

  // 1. Local Mode: the most consequential fact, and the explanation for the
  //    connection state underneath it. `kind: 'local'` is a value only this
  //    device ever writes — see composeServing.
  if (s?.kind === 'local') {
    return localModePresentation(localModeStandingIn(i), i.unmapped);
  }

  // 2. Anything the connection itself wants to report. `good` and `unknown`
  //    carry no label, so they fall through rather than pre-empting the rest.
  if (i.quality !== 'good' && i.quality !== 'unknown') {
    return connectionPresentation(i.quality);
  }

  // 3. The home itself is not served. Ranked below the connection because a
  //    broken link *explains* an unreachable home and is the more actionable
  //    of the two, and above the recovery confirmation because "it's back" is
  //    a claim about the link that would read, wrongly, as "and your home
  //    works again".
  if (s && s.state !== 'served') {
    if (s.state === 'waiting') return HOME_WAITING_PRESENTATION;
    if (s.state === 'reconnecting') return HOME_RECONNECTING_PRESENTATION;
    return HOME_UNREACHABLE_PRESENTATION;
  }

  // 4. The transient "it's back", once there is nothing louder to say.
  if (i.reconnected) return RECONNECTED_PRESENTATION;

  // 5. A cloud-plan Mac that the server says is serving the home is the
  //    activated standby: the cloud relay is gone and this Mac took over. Amber,
  //    about the cloud relay. The server naming this device is evidence enough
  //    that its relay is on — `relayEnabled` is not consulted, so the card
  //    (which has no such input) reaches the same answer. Every other shape of
  //    relay duty — this Mac is the relay, another Mac is, the cloud relay is —
  //    is the home working the normal way, and says nothing here; the popover's
  //    "This Mac" row does.
  if (s && !i.community && i.managed && servedByThisDevice(s, i.thisDevice)) {
    return STANDING_IN_PRESENTATION;
  }

  // 6. Nothing to report: a quiet dot, emerald for good, muted for unknown.
  return connectionPresentation(i.quality);
}
