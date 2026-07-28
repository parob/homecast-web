// The one place a write this relay performed gets announced.
//
// HomeKit fires no observer for a write the relay itself initiated. Two
// separate consumers therefore have to be told by hand:
//
//   1. the automation engine, whose only source of state is that observer
//   2. everyone else — the cloud (which broadcasts to web/iOS and publishes to
//      MQTT) or, in Community mode, LAN clients directly
//
// Those were wired per write path, by hand, in three different files. Every new
// path silently forgot at least one consumer, three times over:
//
//   - `state.set` (REST, MCP, Home Assistant) told neither, so an assistant
//     changing a light triggered no automation and updated no app
//   - the automation engine's own writes told nobody, so an automation-driven
//     change reached apps only when something else happened to notice
//   - `scene.execute` told neither, and still didn't after the first two fixes
//
// So the fan-out lives here, once, and every write path calls it. Adding a
// write path without calling it is caught by relay-write.test.ts, which walks
// the handler's own source.

import { notifyRelayWrite, notifyRelayGroupWrite } from '@/automation';

/**
 * Who performed the write.
 *
 * This is the loop guard, and it is a required argument precisely so that a new
 * call site has to think about it. A write the automation engine made must
 * never be fed back into the engine: its own action would land as a state
 * change, re-satisfy the trigger that caused it, and run again — a light that
 * turns itself on forever. Client writes have no such cycle, and *must* be fed
 * in, or automations only ever react to Apple Home.
 *
 * Announcing to clients is safe from either origin: a broadcast is a statement
 * about state, not a command, so nothing writes back in response to it.
 */
export type WriteOrigin = 'client' | 'automation';

/** One accessory-level change, with ids already resolved to HomeKit UUIDs. */
export interface RelayWriteChange {
  accessoryId: string;
  characteristicType: string;
  value: unknown;
  homeId?: string;
}

/**
 * How this relay reaches everyone that isn't the automation engine. Cloud mode
 * sends events to the server; Community mode broadcasts on the LAN. Registered
 * at startup rather than passed per call, so no write path can be wired up
 * without it.
 */
export interface RelayWritePublisher {
  characteristic(change: RelayWriteChange): void;
  serviceGroup(groupId: string, characteristicType: string, value: unknown, homeId?: string, affectedCount?: number): void;
}

let publisher: RelayWritePublisher | null = null;

/** Called once when the relay starts serving. Pass null on teardown. */
export function setRelayWritePublisher(next: RelayWritePublisher | null): void {
  publisher = next;
}

/** Test seam: what is currently registered. */
export function getRelayWritePublisher(): RelayWritePublisher | null {
  return publisher;
}

/**
 * Announce accessory-level changes this relay just made.
 *
 * Call only after the write has succeeded — announcing a change that did not
 * happen leaves every client showing a state the device is not in.
 */
export function announceRelayWrite(changes: RelayWriteChange[], origin: WriteOrigin): void {
  for (const change of changes) {
    if (!change.accessoryId || !change.characteristicType) continue;

    // Loop guard: see WriteOrigin. Engine writes are announced outward but
    // never fed back inward.
    if (origin === 'client') {
      notifyRelayWrite(change.accessoryId, change.characteristicType, change.value);
    }

    try {
      publisher?.characteristic(change);
    } catch (e) {
      // A publisher that throws must not fail the write that already landed.
      console.warn('[RelayWrite] publish failed', e);
    }
  }
}

/**
 * Announce a service-group write.
 *
 * The engine side expands to the group's members, because triggers are
 * evaluated per accessory; the publish side stays group-shaped, because the
 * group tile in the UI ignores per-member updates.
 */
export function announceRelayGroupWrite(
  groupId: string,
  characteristicType: string,
  value: unknown,
  origin: WriteOrigin,
  homeId?: string,
  affectedCount = 0,
): void {
  if (!groupId || !characteristicType) return;

  if (origin === 'client') {
    notifyRelayGroupWrite(groupId, characteristicType, value);
  }

  try {
    publisher?.serviceGroup(groupId, characteristicType, value, homeId, affectedCount);
  } catch (e) {
    console.warn('[RelayWrite] group publish failed', e);
  }
}
