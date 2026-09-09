/**
 * What the popover's Relay Status section says this Mac's relay is doing,
 * decided from the one serving fact per home.
 *
 * It used to be derived twice over: `getEffectiveState` from the socket's
 * per-account `relayStatus` boolean, then `cloudStandbyState` from the
 * `homeRoles` map the server pushes to the relay — two more readings of "who
 * serves this home" alongside the four the badge already had, and the reason
 * the section could say "Your homes are served by Homecast Cloud" while the
 * cloud relay had been dead for four minutes (homecast-cloud#99). Now every
 * home has a fact, `by` says whose it is, and the section is a fold over them.
 *
 * `waiting` is the state that had no name: the cloud relay is gone, this Mac
 * is connected, and the server is holding it back for the takeover grace. The
 * section now says so, with the countdown, instead of "Standby".
 *
 * Pure, like `status-badge.ts` and `connection-chain.ts`, so the rows of
 * invariant 4 (homecast-cloud#102) are a table rather than a Mac mini being
 * unplugged.
 */

import { servedByThisDevice, type HomeServing } from '@/server/home-serving';
import { takeoverIn } from './connection-chain';

export type RelayConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export type RelaySectionState =
  /** This Mac serves at least one of its self-hosted homes, or nothing says otherwise. */
  | 'connected_active'
  /** Another of the user's Macs serves the self-hosted homes; offer the takeover. */
  | 'connected_standby'
  /** The cloud relay serves every cloud-managed home; this Mac waits. Healthy. */
  | 'connected_cloud_standby'
  /** The cloud relay is gone and this Mac is inside the takeover grace. */
  | 'connected_cloud_waiting'
  /** The cloud relay is gone and this Mac has taken at least one home over. */
  | 'connected_cloud_serving'
  /** The cloud relay is gone and this Mac is not in line for it. */
  | 'connected_cloud_offline'
  | 'connecting'
  | 'reconnecting'
  | 'disconnected';

export interface RelaySectionHome {
  id: string;
  name?: string;
  isCloudManaged?: boolean;
}

export interface RelaySectionInput {
  connectionState: RelayConnectionState;
  /** Community mode on the relay Mac: always active, no socket to consult. */
  community: boolean;
  homes: ReadonlyArray<RelaySectionHome>;
  /** `effectiveServing(id)` — on a relay Mac the composition is the server's fact. */
  serving: (homeId: string) => HomeServing | null;
  thisDevice: string | null;
  now?: number;
}

export interface RelaySectionVerdict {
  state: RelaySectionState;
  /** Names of the cloud-managed homes this Mac is serving or waiting on, for the copy. */
  homeNames: string[];
  /** For `connected_cloud_waiting`: "in 3 min" / "in 40s" / "any moment". */
  takeover: string | null;
}

export function relaySectionState(i: RelaySectionInput): RelaySectionVerdict {
  const none = (state: RelaySectionState): RelaySectionVerdict => ({ state, homeNames: [], takeover: null });

  if (i.community) return none('connected_active');
  if (i.connectionState !== 'connected') return none(i.connectionState);

  const now = i.now ?? Date.now();
  const names = (hs: RelaySectionHome[]) => hs.map((h) => h.name ?? '').filter(Boolean);

  const cloud = i.homes.filter((h) => h.isCloudManaged);
  const own = i.homes.filter((h) => !h.isCloudManaged);
  const factOf = (h: RelaySectionHome) => i.serving(h.id);
  const mine = (h: RelaySectionHome) => servedByThisDevice(factOf(h), i.thisDevice);
  const is = (state: HomeServing['state']) => (h: RelaySectionHome) => factOf(h)?.state === state;

  // ── Cloud-managed homes: the standby story ───────────────────────────────
  //
  // Ordered by how much the user needs to know: this Mac has taken over,
  // then it is about to, then the cloud relay is fine, then it is gone and
  // this Mac is not going to help.
  const cloudMine = cloud.filter(mine);
  if (cloudMine.length > 0) {
    return { state: 'connected_cloud_serving', homeNames: names(cloudMine), takeover: null };
  }
  const waiting = cloud.filter(is('waiting'));
  if (waiting.length > 0) {
    // The earliest grace to end is the one worth counting down.
    const ends = waiting.map((h) => factOf(h)!.graceEndsAt).filter((g): g is string => !!g).sort();
    return { state: 'connected_cloud_waiting', homeNames: names(waiting), takeover: takeoverIn(ends[0] ?? null, now) };
  }

  // ── Self-hosted homes: whose relay is this ───────────────────────────────
  //
  // Checked before the healthy cloud-standby answer because a Mac that
  // should be serving its own homes and is not has something to say, whatever
  // the cloud relay is doing for the others.
  const ownServedByAnother = own.filter((h) => factOf(h)?.state === 'served' && !mine(h));
  const ownMine = own.filter(mine);
  if (ownServedByAnother.length > 0 && ownMine.length === 0) {
    return { state: 'connected_standby', homeNames: names(ownServedByAnother), takeover: null };
  }

  if (cloud.length > 0 && ownMine.length === 0) {
    const cloudServed = cloud.filter((h) => factOf(h)?.state === 'served');
    if (cloudServed.length > 0) return none('connected_cloud_standby');
    const gone = cloud.filter((h) => { const s = factOf(h)?.state; return s === 'offline' || s === 'reconnecting'; });
    if (gone.length > 0) return { state: 'connected_cloud_offline', homeNames: names(gone), takeover: null };
    // No fact yet for any cloud home: the older-server shape. Standby was
    // always the answer there, and still is.
    return none('connected_cloud_standby');
  }

  return none('connected_active');
}
