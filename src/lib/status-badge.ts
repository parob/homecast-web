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
 */

import type { ConnectionQuality } from '@/server/connection-quality';
import { servedByThisDevice, type HomeServing } from '@/server/home-serving';
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
  /** This device's id, so `serving.by` can be recognised as "me". */
  thisDevice: string | null;
  /** Local Mode is running under Apple Home's names rather than the user's. */
  unmapped: boolean;
  /** This device is relay-capable and the relay is switched on. */
  relayEnabled: boolean;
  /** `accountType === 'cloud'`: the relay is Homecast's, not the user's. */
  managed: boolean;
  /** Community mode: no cloud, this Mac is the server, nothing to stand by for. */
  community: boolean;
}

/**
 * Local Mode, which outranks everything.
 *
 * Green rather than amber even though the cloud is unreachable, because the
 * statement being made is "your home works", not "something is wrong". Amber
 * is reserved for the case where it works but under the wrong names — an
 * unmapped identity means the user's own layout and naming are missing, which
 * is worth flagging on the dot itself.
 */
function localModePresentation(unmapped: boolean): ConnectionPresentation {
  return {
    label: 'Local Mode',
    dotClass: unmapped ? 'bg-amber-500' : 'bg-green-500',
    pulse: false,
    srLabel: 'Local Mode — this device is controlling Apple Home directly',
    headline: 'This device is serving your home',
  };
}

/** Relay-capable, but another device is doing the job. */
const STANDBY_PRESENTATION: ConnectionPresentation = {
  label: 'Standby',
  dotClass: 'bg-amber-500',
  pulse: false,
  srLabel: 'Standby relay',
  headline: 'Another device is the active relay',
};

/**
 * The standby has been activated: the cloud relay has been gone for the
 * takeover grace and this Mac is serving the home. Amber, because the thing
 * worth knowing is that the cloud relay is offline.
 */
export const CLOUD_SERVING_PRESENTATION: ConnectionPresentation = {
  label: 'Standby active',
  dotClass: 'bg-amber-500',
  pulse: false,
  srLabel: 'Standby relay active. The cloud relay is offline and this Mac is serving your homes',
  headline: 'This Mac is serving your homes while the cloud relay is offline',
};

/**
 * The cloud is answering perfectly, and it is answering "there is no relay".
 *
 * Worth its own state because every other one here is about *this device's*
 * link, and that link is flawless in this case — which is exactly why the dot
 * used to sit on quiet emerald while every write to the home failed. Amber
 * rather than red: the app is fine, the home is not.
 */
export const HOME_UNREACHABLE_PRESENTATION: ConnectionPresentation = {
  label: 'Relay offline',
  dotClass: 'bg-amber-500',
  pulse: false,
  srLabel: "Relay offline. This home's relay is not answering",
  headline: "This home's relay isn't answering",
};

/**
 * The state that had no name before the fact did: the relay is gone, a
 * standby is connected, and the server is holding it back for the takeover
 * grace. Same label as offline — from the user's side the home is equally
 * unreachable — but the headline says what happens next.
 */
export const HOME_WAITING_PRESENTATION: ConnectionPresentation = {
  label: 'Relay offline',
  dotClass: 'bg-amber-500',
  pulse: false,
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
 *
 * Relay duty ranks last because it describes what this machine is doing
 * rather than whether you can reach anything. When the connection is broken,
 * why is more useful than who.
 */
export function statusPresentation(i: StatusInputs): ConnectionPresentation {
  const s = i.serving;

  // 1. Local Mode: the most consequential fact, and the explanation for the
  //    connection state underneath it. `kind: 'local'` is a value only this
  //    device ever writes — see composeServing.
  if (s?.kind === 'local') return localModePresentation(i.unmapped);

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

  // 5. Relay duty, from the same fact: who `by` is. Only a device that could
  //    be the relay has a duty to report, and a Community Mac has nobody to
  //    stand by for.
  if (i.relayEnabled && s && !i.community) {
    const mine = servedByThisDevice(s, i.thisDevice);
    // A cloud-plan Mac serving the home is the activated standby: the cloud
    // relay is gone and this Mac took over. Amber, about the cloud relay.
    if (mine && i.managed) return CLOUD_SERVING_PRESENTATION;
    // A cloud-plan Mac *not* serving is the healthy shape of that plan — the
    // cloud relay holds the home — and says nothing here: the quiet dot. The
    // popover's relay section explains standby to anyone who opens it.
    if (!mine && !i.managed) return STANDBY_PRESENTATION;
  }

  // 6. Nothing to report: a quiet dot, emerald for good, muted for unknown.
  return connectionPresentation(i.quality);
}
