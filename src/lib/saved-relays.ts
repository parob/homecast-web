/**
 * The relays this device knows about, and every way it has found to reach them.
 *
 * A relay is one machine with several addresses — on the LAN, over a mesh VPN,
 * through a tunnel someone typed. Storing a single address is what made leaving
 * the house break the app: the stored LAN address stops answering and there is
 * nothing else to try.
 *
 * Identity is the relay's `instanceId`, which is exactly what it was minted
 * for. Addresses come and go around it; the id does not.
 */

import type { RelayHealth } from './relay-probe';

export type AddressSource =
  /** Found on the network over Bonjour. */
  | 'discovered'
  /** The relay named it itself, on /health. */
  | 'advertised'
  /** Somebody typed it. */
  | 'manual';

export interface SavedAddress {
  origin: string;
  source: AddressSource;
  /** When this address last answered. Absent means it never has. */
  lastOkAt?: number;
}

export interface SavedRelay {
  /** The relay's stable instanceId. */
  id: string;
  /** Last name the relay reported, or what the user saw when pairing. */
  name: string;
  addresses: SavedAddress[];
  wsPort: number | null;
  authEnabled: boolean | null;
  /** Tried first next time — usually right, and free when it is. */
  lastConnectedOrigin: string | null;
  lastSeenAt: number | null;
}

const STORAGE_KEY = 'homecast-relays';

// --- pure helpers (the interesting part, and where the tests are) ---

/**
 * Fold a successful probe into what we already knew about a relay.
 *
 * The rule that matters: **a typed address is never dropped.** The relay
 * advertises the interfaces it can see, which will not include a tunnel
 * hostname someone configured — so treating /health as the complete list would
 * silently delete the only address that works from outside the house. Advertised
 * addresses are merged in alongside, not swapped in place of.
 */
export function mergeHealth(
  existing: SavedRelay | null,
  health: RelayHealth,
  source: AddressSource = 'manual',
  now: number = Date.now(),
): SavedRelay {
  const id = health.instanceId ?? existing?.id ?? '';
  const addresses: SavedAddress[] = [];
  const seen = new Set<string>();

  const add = (origin: string, src: AddressSource, lastOkAt?: number) => {
    if (!origin || seen.has(origin)) return;
    seen.add(origin);
    addresses.push(lastOkAt === undefined ? { origin, source: src } : { origin, source: src, lastOkAt });
  };

  // The one that just answered, first — it is the most trustworthy thing here.
  const existingForOrigin = existing?.addresses.find(a => a.origin === health.origin);
  add(health.origin, existingForOrigin?.source ?? source, now);

  // Everything we already had, keeping its provenance and its last success.
  for (const a of existing?.addresses ?? []) add(a.origin, a.source, a.lastOkAt);

  // What the relay says about itself. New ones only — an address we already
  // hold keeps the source it was added under.
  for (const origin of health.addresses) add(origin, 'advertised');

  return {
    id,
    name: health.name ?? existing?.name ?? '',
    addresses,
    wsPort: health.wsPort ?? existing?.wsPort ?? null,
    authEnabled: health.authEnabled ?? existing?.authEnabled ?? null,
    lastConnectedOrigin: health.origin,
    lastSeenAt: now,
  };
}

/** Replace the entry with this id, or append it. Order is otherwise kept. */
export function upsertRelay(list: SavedRelay[], relay: SavedRelay): SavedRelay[] {
  if (!relay.id) return list;
  const i = list.findIndex(r => r.id === relay.id);
  if (i === -1) return [...list, relay];
  const next = [...list];
  next[i] = relay;
  return next;
}

/**
 * Add an address a user typed, without needing the relay to be reachable.
 *
 * Marked `manual` so nothing later treats it as disposable — see `mergeHealth`.
 */
export function addManualAddress(relay: SavedRelay, origin: string): SavedRelay {
  if (!origin || relay.addresses.some(a => a.origin === origin)) return relay;
  return { ...relay, addresses: [...relay.addresses, { origin, source: 'manual' }] };
}

/** Drop one address. The last one cannot be removed — that is forgetting the relay. */
export function removeAddress(relay: SavedRelay, origin: string): SavedRelay {
  if (relay.addresses.length <= 1) return relay;
  const addresses = relay.addresses.filter(a => a.origin !== origin);
  if (addresses.length === relay.addresses.length) return relay;
  return {
    ...relay,
    addresses,
    lastConnectedOrigin: relay.lastConnectedOrigin === origin ? null : relay.lastConnectedOrigin,
  };
}

/** Every origin worth trying for this relay, best guess first. */
export function candidateOrigins(relay: SavedRelay): string[] {
  const last = relay.lastConnectedOrigin;
  const rest = relay.addresses.map(a => a.origin).filter(o => o !== last);
  return last ? [last, ...rest] : rest;
}

// --- storage ---

export function loadRelays(): SavedRelay[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Anything without an id cannot be matched to a relay again, so it is not
    // worth keeping — and a half-written record should not break the picker.
    return parsed.filter(
      (r): r is SavedRelay => !!r && typeof r.id === 'string' && !!r.id && Array.isArray(r.addresses),
    );
  } catch {
    return [];
  }
}

export function saveRelays(list: SavedRelay[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // A full or disabled store is not worth failing a connection over.
  }
}

export function forgetSavedRelay(id: string): SavedRelay[] {
  const next = loadRelays().filter(r => r.id !== id);
  saveRelays(next);
  return next;
}

/** Record a successful connection, learning whatever the relay reported. */
export function rememberConnection(health: RelayHealth, source: AddressSource = 'manual'): SavedRelay | null {
  if (!health.instanceId) return null;   // nothing stable to file it under
  const list = loadRelays();
  const existing = list.find(r => r.id === health.instanceId) ?? null;
  const merged = mergeHealth(existing, health, source);
  saveRelays(upsertRelay(list, merged));
  return merged;
}

/**
 * Fold the pre-list single-relay keys into a record, once.
 *
 * Returns the migrated relay, or null when there was nothing to migrate. The
 * old keys are deliberately left in place: they are still what the runtime and
 * the native shell read for "the currently selected relay", and this list sits
 * above them rather than replacing them.
 */
export function migrateLegacyRelay(
  address: string | null,
  wsPort: number | null,
  pairedId: string | null,
  name = '',
): SavedRelay | null {
  if (!address || !pairedId) return null;
  const list = loadRelays();
  if (list.some(r => r.id === pairedId)) return null;   // already done
  const relay: SavedRelay = {
    id: pairedId,
    name,
    addresses: [{ origin: address, source: 'manual' }],
    wsPort,
    authEnabled: null,
    lastConnectedOrigin: address,
    lastSeenAt: null,
  };
  saveRelays(upsertRelay(list, relay));
  return relay;
}
