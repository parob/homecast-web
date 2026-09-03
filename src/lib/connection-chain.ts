/**
 * The path from this device to your home, as four nodes and the three hops
 * between them.
 *
 * This is the model behind option C of the status-bubble design work
 * (parob/homecast-cloud#38). The bubble used to lead with a round-trip number,
 * which answers "how fast" but never "which part is broken" — and in the states
 * the bubble exists for, "which part" is the only question worth answering.
 * "Homecast can't get an answer from your Mac" is actionable; "9s" is not.
 *
 * Pure and input-driven, like `connection-presentation.ts` and `status-badge.ts`
 * next door, so the rules below can be tested rather than eyeballed against a
 * throttled browser.
 *
 * ── Four rules here are load-bearing ───────────────────────────────────────
 *
 *  1. **Key the cloud-managed test on the account type, never on
 *     `isCloudManaged`.** That per-home flag rides the WebSocket `homes.list`
 *     payload, and the locally-answered `homes.list` does not carry it. So
 *     during Local Mode or a cloud outage the app forgets which homes are
 *     cloud-managed — precisely when this indicator matters most. Keyed on the
 *     flag, the chain would silently revert to "your Mac" copy in the one state
 *     where the user is least able to go and look at a Mac. `accountType` comes
 *     from the Apollo cache and survives the window.
 *
 *  2. **A cloud relay is never named as the user's hardware, and never offers
 *     them an action.** On the cloud plan the relay is a Mac in Homecast's
 *     estate, joined to the customer's Apple Home as a Resident; they own an
 *     Apple Home Hub and nothing else. When it dies the socket to Homecast is
 *     *fine*, so "Reconnect now" reconnects something that was never broken and
 *     "Take Over as Relay" invites them to seize duty for a home this device may
 *     have no HomeKit access to. `SetupState` has phrased this correctly on the
 *     page-level card the whole time; the bubble is the surface that never got
 *     the memo.
 *
 *  3. **The two relay words are the product's, not ours to reinvent.**
 *     `HomeOverviewSection` and `HomesSection` label them "Cloud Relay" and
 *     "Self-hosted relay"; `useRelayCannotEdit` types them
 *     `'cloud' | 'self-hosted'`. From the user's side of the screen the
 *     self-hosted one is "Your relay" — or "This Mac" when it is the very
 *     device being looked at.
 *
 *  4. **The last node is the user's home by name when we know it.**
 *     Every other node in the chain is named for the situation it is actually
 *     in; the home was the one that stayed generic, and "Home" reads as vague
 *     to someone whose home is called George Street
 *     (parob/homecast-cloud#61). The caller supplies the name, because which
 *     home this chain describes is a question about what the user is looking
 *     at, not about the connection. `'Home'` remains the fallback — during
 *     onboarding, or with several homes and none selected, there is genuinely
 *     no name to give.
 */

import type { ConnectionQuality } from '@/server/connection-quality';

/**
 * How a node or a hop is doing.
 *
 * `idle` is not a fault — it is "no claim", drawn as a dashed connector rather
 * than a coloured one. A hop beyond a break is idle, because nothing downstream
 * of a dead hop has been measured and painting it red would invent evidence.
 */
export type ChainTone = 'ok' | 'warn' | 'bad' | 'idle';

export type ChainNodeKey = 'device' | 'cloud' | 'relay' | 'home';

export interface ChainNode {
  key: ChainNodeKey;
  name: string;
  tone: ChainTone;
}

export interface ChainHop {
  tone: ChainTone;
  /** Drawn over the connector when there is something worth reading there. */
  label: string | null;
}

export interface ChainModel {
  nodes: ChainNode[];
  /** Always `nodes.length - 1`. */
  hops: ChainHop[];
  /** The headline. The drawing only makes it quick to read. */
  sentence: string;
  /**
   * Local Mode: the cloud hop is dead and the home is green anyway, because
   * this device is talking to Apple Home directly. Drawn as a bypass rather
   * than as a break, since nothing is actually broken from the user's side.
   */
  bypass: boolean;
  /**
   * Set when there is genuinely nothing for the user to do. Suppresses the
   * action button entirely — see rule 2.
   */
  noUserAction: string | null;
}

export interface ChainInput {
  quality: ConnectionQuality;
  /** The transient "it's back" state, which is not a ConnectionQuality. */
  reconnected: boolean;
  /** Is this device the active relay? `null` while unknown. */
  relayStatus: boolean | null;
  localMode: { active: boolean; unmapped: boolean };
  /** `accountType === 'cloud'` — see rule 1. NOT the per-home flag. */
  managed: boolean;
  /** This device can be, and is, the relay serving the home. */
  selfRelay: boolean;
  /** Community mode: nothing leaves the house, so there is no cloud hop. */
  community: boolean;
  /** Formatted round trip, e.g. `34ms`. Rendered on the first hop when known. */
  rtt: string | null;
  /**
   * The home this chain describes, named. `null` when there is none to name —
   * see rule 4. Whitespace-only is treated as absent, because a HomeKit home
   * can be renamed to one and a chain node of pure spaces is worse than the
   * generic.
   */
  homeName: string | null;
}

const CLOUD_DOWN =
  "Homecast has been notified and is already on it — nothing to restart at your end.";

/**
 * What the last node is called. Rule 4.
 *
 * Exported so the one fallback lives in one place: three branches of
 * `buildChain` build the home node and all three must agree about what an
 * absent name means.
 */
export function homeNodeName(homeName: string | null | undefined): string {
  return homeName?.trim() || 'Home';
}

/** What the third node is called. Rule 3. */
export function relayNodeName(input: Pick<ChainInput, 'managed' | 'selfRelay' | 'community'>): string {
  if (input.managed) return 'Cloud relay';
  if (input.community) return 'This Mac';
  if (input.selfRelay) return 'This Mac';
  return 'Your relay';
}

/**
 * Which hop is broken, for each quality.
 *
 * The index is the hop that fails: 0 = this device → Homecast, 1 = Homecast →
 * relay, 2 = relay → home. `null` means nothing is broken.
 *
 * `slow` and `stalled` differ in *where* they are, which is the whole point of
 * the chain. `offline` is the near hop — this device cannot get out. `stalled`
 * is the far one: we reach Homecast fine, and Homecast gets no answer from the
 * relay. That distinction is currently invisible, and it is the difference
 * between "check your wifi" and "nothing you can do".
 */
function brokenHop(quality: ConnectionQuality): number | null {
  switch (quality) {
    case 'offline':
      return 0;
    case 'connecting':
      return 0;
    case 'stalled':
      return 1;
    case 'slow':
      return 0;
    default:
      return null;
  }
}

export function buildChain(input: ChainInput): ChainModel {
  const { quality, reconnected, localMode, managed, community } = input;

  const relayName = relayNodeName(input);
  const homeName = homeNodeName(input.homeName);

  // ── Community: no cloud in the path at all ───────────────────────────────
  //
  // The hops rename themselves, because on the same Wi-Fi nothing goes through
  // Homecast and saying otherwise would be a lie of omission. No wording on a
  // single dot can convey this; the chain can.
  if (community) {
    return {
      nodes: [
        { key: 'device', name: 'This Mac', tone: 'ok' },
        { key: 'relay', name: 'Local server', tone: 'ok' },
        { key: 'home', name: homeName, tone: 'ok' },
      ],
      hops: [
        { tone: 'ok', label: null },
        { tone: 'ok', label: null },
      ],
      sentence: 'This Mac is serving your home on its own. Nothing is going through the cloud.',
      bypass: false,
      noUserAction: null,
    };
  }

  // ── Local Mode: a bypass, not a break ────────────────────────────────────
  //
  // Homecast is unreachable and the home works anyway, because this device is
  // talking to Apple Home directly. Leading with the socket here is what the
  // three-pill merge existed to stop: a green home and "You're not connected"
  // in the same box.
  if (localMode.active) {
    return {
      nodes: [
        { key: 'device', name: 'This device', tone: 'ok' },
        { key: 'cloud', name: 'Homecast', tone: 'bad' },
        { key: 'relay', name: relayName, tone: 'idle' },
        { key: 'home', name: homeName, tone: 'ok' },
      ],
      hops: [
        { tone: 'bad', label: 'no answer' },
        { tone: 'idle', label: null },
        { tone: 'ok', label: 'direct' },
      ],
      sentence: localMode.unmapped
        ? 'Homecast is unreachable, so this device is talking to your home directly. Some devices may not be recognised yet.'
        : 'Homecast is unreachable, so this device is talking to your home directly.',
      bypass: true,
      noUserAction: null,
    };
  }

  const nodes: ChainNode[] = [
    { key: 'device', name: 'This device', tone: 'ok' },
    { key: 'cloud', name: 'Homecast', tone: 'ok' },
    { key: 'relay', name: relayName, tone: 'ok' },
    { key: 'home', name: homeName, tone: 'ok' },
  ];
  const hops: ChainHop[] = [
    { tone: 'ok', label: input.rtt },
    { tone: 'ok', label: null },
    { tone: 'ok', label: null },
  ];

  if (quality === 'good' || quality === 'unknown' || reconnected) {
    const sentence = reconnected
      ? 'Every hop is healthy again.'
      : quality === 'unknown'
        ? 'Checking the route to your home.'
        : 'Every hop is healthy.';
    if (quality === 'unknown') {
      // No claim, rather than a confident green. The evidence expired — which
      // happens innocently every time a tab is backgrounded.
      for (const n of nodes) n.tone = 'idle';
      for (const h of hops) h.tone = 'idle';
      hops[0].label = null;
    }
    return { nodes, hops, sentence, bypass: false, noUserAction: null };
  }

  const broken = brokenHop(quality);
  const warnOnly = quality === 'slow';
  const tone: ChainTone = warnOnly ? 'warn' : 'bad';

  if (broken !== null) {
    hops[broken].tone = tone;
    hops[broken].label = warnOnly ? input.rtt : quality === 'connecting' ? 'connecting' : 'no answer';
    // The node the broken hop lands on carries the tone; everything past it is
    // idle, because nothing beyond a break has been measured.
    nodes[broken + 1].tone = tone;
    if (!warnOnly) {
      for (let i = broken + 1; i < hops.length; i++) {
        hops[i].tone = 'idle';
        hops[i].label = null;
      }
      for (let i = broken + 2; i < nodes.length; i++) nodes[i].tone = 'idle';
    }
  }

  let sentence: string;
  let noUserAction: string | null = null;

  switch (quality) {
    case 'offline':
      sentence = "This device can't reach Homecast. Check your wifi or mobile signal.";
      break;
    case 'connecting':
      sentence = 'Re-establishing the link to Homecast.';
      break;
    case 'slow':
      // Where today's copy is actively wrong: "Your connection is slow" gets
      // said about a 28ms connection, because the slowness is further along.
      sentence = managed
        ? 'Reaching Homecast is slow right now. The cloud relay is answering normally behind it.'
        : 'Reaching Homecast is slow right now. Your relay is answering normally behind it.';
      break;
    case 'stalled':
      // The flagship contrast: identical red hop, opposite advice.
      if (managed) {
        sentence =
          "The cloud relay for this home isn't answering. Your device and your internet are both fine.";
        noUserAction = CLOUD_DOWN;
      } else {
        sentence =
          "Homecast can't get an answer from your relay. Your device and your internet are both fine.";
      }
      break;
    default:
      sentence = 'Every hop is healthy.';
  }

  return { nodes, hops, sentence, bypass: false, noUserAction };
}
