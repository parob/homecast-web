/**
 * Which of three overlapping facts the one status bubble should say.
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
 */

import type { ConnectionQuality } from '@/server/connection-quality';
import {
  connectionPresentation,
  RECONNECTED_PRESENTATION,
  type ConnectionPresentation,
} from './connection-presentation';

export interface StatusInputs {
  quality: ConnectionQuality;
  /** The transient recovery confirmation is currently showing. */
  reconnected: boolean;
  localMode: { active: boolean; unmapped: boolean };
  /**
   * This device's relay duty. `null` when it is not relay-capable at all,
   * `true` when it is the active relay, `false` when it is standing by.
   */
  relayStatus: boolean | null;
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
 * The one thing worth saying, chosen from the three.
 *
 * **Local Mode wins over Offline, deliberately.** It is not merely the more
 * important fact, it is a *superset* of the other one: it says the cloud is
 * unreachable *and* that your home still works. Saying "Offline" over the top
 * of a working home is exactly the contradiction this merge removes. Nothing
 * is lost — the connection detail moves into the popover, which is where a
 * second-order fact belongs.
 *
 * Relay duty ranks last of the three because it describes what this machine is
 * doing rather than whether you can reach anything. When the connection is
 * broken, why is more useful than who.
 */
export function statusPresentation(i: StatusInputs): ConnectionPresentation {
  // 1. Local Mode: the most consequential fact, and the explanation for the
  //    connection state underneath it.
  if (i.localMode.active) return localModePresentation(i.localMode.unmapped);

  // 2. Anything the connection itself wants to report. `good` and `unknown`
  //    carry no label, so they fall through rather than pre-empting the rest.
  if (i.quality !== 'good' && i.quality !== 'unknown') {
    return connectionPresentation(i.quality);
  }

  // 3. The transient "it's back", once there is nothing louder to say.
  if (i.reconnected) return RECONNECTED_PRESENTATION;

  // 4. Standing by while another device relays. Worth a word, but only when
  //    nothing about the connection is wrong.
  if (i.relayStatus === false) return STANDBY_PRESENTATION;

  // 5. Nothing to report: a quiet dot, emerald for good, muted for unknown.
  return connectionPresentation(i.quality);
}
