/**
 * In-memory identity resolution cache for Community mode — the client twin of
 * the server's homecast/identity/cache.py.
 *
 * Forward (`any id -> hc_id`) is append-only and safe long-lived (old rotated
 * UUIDs stay valid). Reverse (`hc_id -> current live UUID`) is refreshed
 * whenever reconciliation moves a live UUID, so a relay call always targets the
 * current UUID. Everything is single-process here (the Mac app is both client
 * and relay), so both directions live in memory, hydrated from IndexedDB.
 */

const idToHc = new Map<string, string>(); // UPPER any id -> UPPER hc_id
const hcToLive = new Map<string, string>(); // UPPER hc_id -> UPPER live uuid

const RESPONSE_ID_KEYS = new Set(['id', 'homeId', 'roomId', 'accessoryId', 'serviceGroupId', 'sceneId']);
const RESPONSE_ID_LIST_KEYS = new Set(['accessoryIds', 'serviceGroupIds', 'roomIds', 'memberIds']);

export function noteIdentity(liveUuid: string | null | undefined, hcId: string): void {
  if (!liveUuid) return;
  const u = liveUuid.toUpperCase();
  const hc = hcId.toUpperCase();
  idToHc.set(u, hc);
  idToHc.set(hc, hc);
  hcToLive.set(hc, u);
}

export function clearCache(): void {
  idToHc.clear();
  hcToLive.clear();
}

/** any id -> hc_id (cache-only). undefined on miss. */
export function peekHc(someId: string | null | undefined): string | undefined {
  if (!someId) return undefined;
  return idToHc.get(someId.toUpperCase());
}

/** hc_id -> current live UUID. Passes an unknown/live id through unchanged. */
export function toLiveUuid(someId: string | null | undefined): string | undefined {
  if (!someId) return undefined;
  const key = someId.toUpperCase();
  const hc = idToHc.get(key);
  if (hc && hc === key) {
    // key is itself an hc_id
    return hcToLive.get(hc) ?? key;
  }
  return key; // already a live UUID (or unknown)
}

function walk(obj: unknown, conv: (v: string) => string): unknown {
  if (Array.isArray(obj)) return obj.map((x) => walk(x, conv));
  if (obj && typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (RESPONSE_ID_KEYS.has(k) && typeof v === 'string') {
        out[k] = conv(v);
      } else if (RESPONSE_ID_LIST_KEYS.has(k) && Array.isArray(v)) {
        out[k] = v.map((x) => (typeof x === 'string' ? conv(x) : walk(x, conv)));
      } else {
        out[k] = walk(v, conv);
      }
    }
    return out;
  }
  return obj;
}

/** Rewrite live UUIDs -> hc_ids in a relay list response before the client sees it. */
export function translateResponseOut<T>(obj: T): T {
  return walk(obj, (v) => idToHc.get(v.toUpperCase()) ?? v) as T;
}

/** Rewrite hc_ids -> live UUIDs in a payload before it hits the native bridge. */
export function translatePayloadToLive<T>(obj: T): T {
  return walk(obj, (v) => toLiveUuid(v) ?? v) as T;
}
