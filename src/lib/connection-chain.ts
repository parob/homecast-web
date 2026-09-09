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
 * ── One node per fact ──────────────────────────────────────────────────────
 *
 * The drawing is honest because each node is painted from the one thing that
 * actually knows about it:
 *
 *   device → Homecast    `quality`, this device's socket
 *   Homecast → relay     the server's `HomeServing` fact for the home
 *   relay → home         whether the home is served at all, and by what
 *
 * Before the fact existed the middle hop was inferred — from a refusal, from a
 * stalled request, from a cached `relayState` — and in Local Mode it was not
 * even that: the branch painted "Homecast · no answer" unconditionally, so a
 * phone whose socket was perfectly healthy drew a dead cloud two lines above a
 * section saying the *relay* was the thing that had gone
 * (parob/homecast-cloud#103).
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
import { servedByThisDevice, type HomeServing, type ServingKind } from '@/server/home-serving';

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
   * Local Mode: the home is green whatever the hops before it say, because
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
  /**
   * `effectiveServing(homeId)`: the server's fact for the home with this
   * device's own Local Mode composed over it. `null` when nothing is known.
   */
  serving: HomeServing | null;
  /**
   * The server's fact on its own, for the relay node. Equal to `serving`
   * except in Local Mode, where the composition hides it — and the relay node
   * is precisely the thing Local Mode is bypassing, so the drawing wants the
   * uncomposed answer. `null` when nothing is known.
   */
  relayServing: HomeServing | null;
  /** This device's id, so `serving.by` can be recognised as "me". */
  thisDevice: string | null;
  /** Local Mode is running under Apple Home's names rather than the user's. */
  unmapped: boolean;
  /** `accountType === 'cloud'` — see rule 1. NOT the per-home flag. */
  managed: boolean;
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
  /** For the takeover countdown in `waiting`. Defaults to `Date.now()`. */
  now?: number;
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

/**
 * What the third node is called. Rule 3.
 *
 * `kind` is the server's word for the relay actually serving the home —
 * `cloud` or `self_hosted` — and when it is known it wins over `managed`. A
 * cloud-plan account is not the same thing as a cloud relay being the one
 * answering: switch the cloud relay off and a self-hosted Mac in the same
 * Apple Home takes the home over, and the server says so (`served, by: that
 * Mac, kind: self_hosted`). Naming that node "Cloud relay" was homecast-cloud#107's
 * second report — "it still thinks it's going via the cloud relay". `managed`
 * remains the answer when nothing is serving, which is when there is no
 * `kind` and the account is the only thing to go on.
 */
export function relayNodeName(input: {
  managed: boolean;
  selfRelay: boolean;
  community: boolean;
  kind?: ServingKind | null;
}): string {
  if (input.kind === 'self_hosted') return input.selfRelay ? 'This Mac' : 'Your relay';
  if (input.kind === 'cloud' || input.managed) return 'Cloud relay';
  if (input.community) return 'This Mac';
  if (input.selfRelay) return 'This Mac';
  return 'Your relay';
}

/** "in 3 min" / "in 40s" / "any moment" — the takeover countdown. */
export function takeoverIn(graceEndsAt: string | null, now: number): string {
  const end = graceEndsAt ? Date.parse(graceEndsAt) : NaN;
  if (Number.isNaN(end)) return 'shortly';
  const s = Math.ceil((end - now) / 1000);
  if (s <= 5) return 'any moment';
  if (s < 90) return `in ${s}s`;
  return `in ${Math.round(s / 60)} min`;
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

const linkFine = (q: ConnectionQuality) => q === 'good' || q === 'unknown';

/** The sentence for a relay the server says is not serving, by its state. */
function unservedSentence(state: HomeServing['state'], managed: boolean, graceEndsAt: string | null, now: number): string {
  const who = managed ? 'The cloud relay for this home' : 'Your relay';
  switch (state) {
    case 'reconnecting':
      return `${who} dropped off a moment ago and should be back shortly.`;
    case 'waiting':
      return managed
        ? `${who} isn't answering. Your own relay takes over ${takeoverIn(graceEndsAt, now)}.`
        : `${who} isn't answering. Another of your relays takes over ${takeoverIn(graceEndsAt, now)}.`;
    default:
      return managed
        ? "The cloud relay for this home isn't answering. Your device and your internet are both fine."
        : "Homecast can't get an answer from your relay. Your device and your internet are both fine.";
  }
}

export function buildChain(input: ChainInput): ChainModel {
  const { quality, reconnected, managed, community } = input;
  const now = input.now ?? Date.now();
  const serving = input.serving;
  const relayServing = input.relayServing ?? (serving?.kind === 'local' ? null : serving);

  const relayName = relayNodeName({
    managed,
    community,
    selfRelay: servedByThisDevice(relayServing, input.thisDevice),
    kind: relayServing?.state === 'served' ? relayServing.kind : null,
  });
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
  // The home works because this device is talking to Apple Home directly. The
  // hops before it are painted from what actually broke — the link, if it is
  // down; otherwise the relay, from the server's own fact — so the drawing
  // agrees with the sentence and with the Local Mode section beneath it. It
  // used to paint the cloud dead unconditionally (homecast-cloud#103).
  if (serving?.kind === 'local') {
    const linkDown = !linkFine(quality);
    const relayState = linkDown ? null : relayServing?.state ?? null;
    const relayDown = relayState !== null && relayState !== 'served';
    const relayTone: ChainTone = linkDown ? 'idle'
      : relayState === null ? 'idle'
      : relayState === 'served' ? 'ok'
      : relayState === 'reconnecting' ? 'warn'
      : 'bad';
    const why = linkDown
      ? 'Homecast is unreachable, so this device is talking to your home directly.'
      : relayDown
        ? `${managed ? 'The cloud relay' : 'Your relay'} isn't answering, so this device is talking to your home directly.`
        : 'This device is talking to your home directly.';
    return {
      nodes: [
        { key: 'device', name: 'This device', tone: 'ok' },
        { key: 'cloud', name: 'Homecast', tone: linkDown ? 'bad' : quality === 'unknown' ? 'idle' : 'ok' },
        { key: 'relay', name: relayName, tone: relayTone },
        { key: 'home', name: homeName, tone: 'ok' },
      ],
      hops: [
        linkDown
          ? { tone: 'bad', label: 'no answer' }
          : { tone: quality === 'unknown' ? 'idle' : 'ok', label: quality === 'unknown' ? null : input.rtt },
        relayTone === 'idle'
          ? { tone: 'idle', label: null }
          : relayTone === 'ok'
            ? { tone: 'ok', label: null }
            : { tone: relayTone, label: relayState === 'reconnecting' ? 'reconnecting' : 'no relay' },
        { tone: 'ok', label: 'direct' },
      ],
      sentence: input.unmapped ? `${why} Some devices may not be recognised yet.` : why,
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

  // ── The cloud is answering, and its answer is "nothing may serve this home" ─
  //
  // Ranked above the healthy return below, and reached only when the socket
  // itself has nothing to report — the same order `statusPresentation` uses,
  // so the dot and the panel under it cannot say different things.
  //
  // Without this the popover contradicted its own header: the bubble read
  // amber "Relay offline" while the panel two lines beneath it drew four green
  // nodes and said "Every hop is healthy", with `Cloud relay` — the dead one —
  // among them. That is precisely the sin the three-pill merge existed to end,
  // reintroduced one layer down (homecast-cloud#99).
  //
  // The break lands on hop 1 (Homecast → relay) and the copy is `stalled`'s,
  // because it is the same fault told two ways. `stalled` infers it from a
  // request that never came back; this is the server stating it as the fact
  // for the home, which is the stronger evidence and arrives without a timeout.
  if (serving && serving.state !== 'served' && linkFine(quality)) {
    const tone: ChainTone = serving.state === 'reconnecting' ? 'warn' : 'bad';
    hops[1].tone = tone;
    hops[1].label = serving.state === 'reconnecting' ? 'reconnecting' : 'no relay';
    nodes[2].tone = tone;
    hops[2].tone = 'idle';
    nodes[3].tone = 'idle';
    return {
      nodes,
      hops,
      sentence: unservedSentence(serving.state, managed, serving.graceEndsAt, now),
      bypass: false,
      // A blip needs no reassurance; an outage on the cloud plan gets rule 2.
      noUserAction: managed && serving.state !== 'reconnecting' ? CLOUD_DOWN : null,
    };
  }

  if (linkFine(quality) || reconnected) {
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
