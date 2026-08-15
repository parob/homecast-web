// Making this device's HomeKit ids line up with the cloud's stable ones.
//
// The problem in one sentence: an entity is live under a *different* UUID in
// every HomeKit context, so the UUIDs an iPhone sees are not the ones the relay
// Mac reports, while everything the cloud has stored — layout, custom names,
// collections, room groups — is keyed by hc_id. Without a map, Local Mode shows
// raw HomeKit naming and none of the user's arrangement.
//
// The fix is to report this device's topology to the server, which already
// knows how to match a reported entity to its stable identity by natural key,
// and to keep the returned map. Because the map is minted *from this device's
// own report*, its inverse is correct by construction for this device — which
// is why translating in both directions here is safe even though asking the
// server to resolve hc → live is not (it cannot know which context is asking).

import { HomeKit } from '../native/homekit-bridge';
import { executeHomeKitAction } from '../relay/local-handler';

/**
 * Deliberately the same key sets as the server's
 * `homecast/identity/cache.py` (`ID_KEYS`, `ID_LIST_KEYS`, `RESPONSE_ID_KEYS`).
 * Every translation incident to date has been one key missing from one
 * hand-copied set, so these are kept adjacent in the comment on both sides.
 */
const ID_KEYS = new Set(['homeId', 'roomId', 'accessoryId', 'serviceGroupId', 'groupId', 'sceneId']);
const ID_LIST_KEYS = new Set(['accessoryIds', 'serviceGroupIds', 'roomIds', 'memberIds']);
const RESPONSE_ID_KEYS = new Set([...ID_KEYS, 'id']);

interface Cached {
  /** live UUID (upper) → hc_id */
  live: Record<string, string>;
  topologyHash: string;
  reportedAt: number;
  matched: number;
  reported: number;
}

export interface SyncResult { matched: number; reported: number; }

/** Re-report at most this often unless the topology itself changed. */
const RESYNC_MS = 24 * 60 * 60 * 1000;

function storageKey(userId: string): string {
  return `homecast-local-identity:${userId}`;
}

/** Who was signed in last, so an offline launch knows which map is theirs. */
const LAST_USER_KEY = 'homecast-local-identity:last';

class LocalIdentity {
  private liveToHc = new Map<string, string>();
  private hcToLive = new Map<string, string>();
  private cached: Cached | null = null;
  private userId = '';
  private inFlight: Promise<SyncResult | null> | null = null;

  /** Point at a user's cached map. Keyed per user so accounts can't bleed. */
  load(userId: string): void {
    if (!userId || userId === this.userId) return;
    this.userId = userId;
    this.liveToHc.clear();
    this.hcToLive.clear();
    this.cached = null;
    try {
      localStorage.setItem(LAST_USER_KEY, userId);
      const raw = localStorage.getItem(storageKey(userId));
      if (!raw) return;
      const c = JSON.parse(raw) as Cached;
      this.adopt(c);
    } catch {
      // A corrupt cache is worth nothing and costs a re-report. Ignore it.
    }
  }

  /**
   * Adopt the last signed-in user's map before auth has answered.
   *
   * `load()` is driven by `getMe()`, which needs the network — so on the one
   * launch where any of this matters (offline, or the relay unreachable, which
   * is when Local Mode takes over) it never ran at all. The device came up with
   * no map: raw Apple Home names, none of the user's layout, and a Settings
   * screen reporting "not matched yet" over a perfectly good map sitting in
   * storage.
   *
   * Safe to guess from: the map is only ids, `load()` replaces it the moment a
   * different user turns out to be signed in, and `forget()` removes it on
   * sign-out — the same treatment the persisted HomeKit cache already gets.
   */
  loadLast(): void {
    if (this.userId) return;
    try {
      const last = localStorage.getItem(LAST_USER_KEY);
      if (last) this.load(last);
    } catch {
      // No storage, no map. Local Mode still controls, just unpersonalised.
    }
  }

  /** Drop this device's map, so the next account to sign in starts clean. */
  forget(): void {
    const previous = this.userId;
    this.userId = '';
    this.cached = null;
    this.liveToHc.clear();
    this.hcToLive.clear();
    try {
      localStorage.removeItem(LAST_USER_KEY);
      if (previous) localStorage.removeItem(storageKey(previous));
    } catch {
      // Nothing to do — the map is already gone from memory.
    }
  }

  private adopt(c: Cached): void {
    this.cached = c;
    this.liveToHc = new Map(Object.entries(c.live));
    this.hcToLive = new Map();
    for (const [live, hc] of this.liveToHc) this.hcToLive.set(hc.toUpperCase(), live);
  }

  /** hc_id → live UUID, for addressing this device's own HomeKit. */
  stableToLive(): ReadonlyMap<string, string> { return this.hcToLive; }

  hasMap(): boolean { return this.liveToHc.size > 0; }

  /**
   * Whether a user's cache has been pointed at yet.
   *
   * `sync()` is worthless before this: the reconcile mutation needs a signed-in
   * user, and a map minted without one cannot be written to storage — see the
   * guard in `doSync`.
   */
  hasUser(): boolean { return this.userId !== ''; }

  /**
   * The last known match counts, whatever their source.
   *
   * Restored by `load()` as well as set by `sync()`, so a device that matched
   * last week and is offline today still reports it. The controller reads this
   * every tick rather than only on a successful sync — otherwise a sync that
   * fails (which is the normal case when Local Mode engaged *because* the cloud
   * is unreachable) leaves the UI claiming "not matched yet" over a map that is
   * loaded and working.
   */
  counts(): SyncResult | null {
    return this.cached ? { matched: this.cached.matched, reported: this.cached.reported } : null;
  }

  /** One id, live → stable. Unmapped ids pass through unchanged. */
  toStable(id: string): string {
    return this.liveToHc.get(id.toUpperCase()) ?? id;
  }

  /** One id, stable → live. Unmapped ids pass through unchanged. */
  toLive(id: string): string {
    return this.hcToLive.get(id.toUpperCase()) ?? id;
  }

  toStablePayload(obj: unknown): unknown { return this.walk(obj, RESPONSE_ID_KEYS, (v) => this.toStable(v)); }
  toLivePayload(obj: Record<string, unknown>): Record<string, unknown> {
    return this.walk(obj, ID_KEYS, (v) => this.toLive(v)) as Record<string, unknown>;
  }

  private walk(obj: unknown, keys: ReadonlySet<string>, map: (v: string) => string): unknown {
    if (Array.isArray(obj)) return obj.map((x) => this.walk(x, keys, map));
    if (obj && typeof obj === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        if (keys.has(k) && typeof v === 'string') out[k] = map(v);
        else if (ID_LIST_KEYS.has(k) && Array.isArray(v)) {
          out[k] = v.map((x) => (typeof x === 'string' ? map(x) : this.walk(x, keys, map)));
        } else out[k] = this.walk(v, keys, map);
      }
      return out;
    }
    return obj;
  }

  // ── reporting ─────────────────────────────────────────────────────────────

  /**
   * Report this device's topology and keep the returned map.
   *
   * Best-effort by design: if the cloud cannot be reached we keep whatever map
   * we already had, and if we never had one the app runs on raw HomeKit ids.
   * Accessories still list and still control — only the personalisation is
   * missing, which is exactly the no-relay-yet experience.
   */
  async sync(force = false): Promise<SyncResult | null> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.doSync(force).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async doSync(force: boolean): Promise<SyncResult | null> {
    // No user yet means no cache to key and no auth to report under. The
    // controller starts on module load, long before `getMe()` answers, so
    // without this the first attempt would build a topology, spend a mutation
    // that 401s — or worse, succeed and then drop the map on the floor at the
    // `if (this.userId)` write below — and set the retry clock for ten minutes.
    if (!this.userId) return null;

    let topology: TopologyReport;
    try {
      topology = await buildTopology();
    } catch (err) {
      console.warn('[LocalIdentity] Could not read topology from HomeKit:', err);
      return null;
    }
    if (topology.homes.length === 0) return null;

    const hash = hashTopology(topology);
    const fresh = this.cached
      && this.cached.topologyHash === hash
      && Date.now() - this.cached.reportedAt < RESYNC_MS;
    if (fresh && !force) {
      return { matched: this.cached!.matched, reported: this.cached!.reported };
    }

    try {
      const { reconcileLocalTopology } = await import('../lib/graphql/local-identity-api');
      const res = await reconcileLocalTopology(topology);
      if (!res) return null;

      const live: Record<string, string> = {};
      for (const kind of Object.values(res.map)) {
        for (const [uuid, hc] of Object.entries(kind)) live[uuid.toUpperCase()] = hc;
      }
      const next: Cached = {
        live,
        topologyHash: hash,
        reportedAt: Date.now(),
        matched: res.matched,
        reported: res.reported,
      };
      this.adopt(next);
      if (this.userId) localStorage.setItem(storageKey(this.userId), JSON.stringify(next));

      if (res.matched < res.reported) {
        // A low ratio is the signal that this device is in a genuinely
        // different HomeKit context than the relay, and that the feature will
        // read as half-broken for this user. Worth saying out loud.
        console.warn(`[LocalIdentity] Only ${res.matched}/${res.reported} entities matched the cloud's identities`);
      }
      return { matched: res.matched, reported: res.reported };
    } catch (err) {
      console.warn('[LocalIdentity] Reconcile failed — continuing with the cached map:', err);
      return this.cached ? { matched: this.cached.matched, reported: this.cached.reported } : null;
    }
  }
}

// ── building the report ─────────────────────────────────────────────────────

export interface TopologyReport {
  homes: Array<{ id: string; name: string }>;
  by_home: Record<string, {
    rooms: Array<{ id: string; name: string }>;
    accessories: Array<{ id: string; name: string; roomName?: string; category?: string; serialNumber?: string }>;
    service_groups: Array<{ id: string; name: string; accessoryIds: string[] }>;
    scenes: Array<{ id: string; name: string }>;
  }>;
}

interface RawAccessory {
  id: string; name: string; roomId?: string; category?: string;
  services?: Array<{ characteristics?: Array<{ characteristicType: string; value?: unknown }> }>;
}

/**
 * Build the exact shape the server's `reconcile_topology` already accepts.
 *
 * `includeAll: true` is required, not incidental: the plan-limit filter would
 * otherwise silently truncate the accessory list, and the serial fingerprint
 * built from a truncated list is the primary match anchor. A thin report turns
 * a strong match into a weak one.
 *
 * Characteristic *values* are deliberately not sent — only the serial number is
 * lifted out of them. That keeps the payload at a few KB instead of megabytes,
 * and means no reading of anyone's home leaves the device.
 */
async function buildTopology(): Promise<TopologyReport> {
  const homes = await HomeKit.listHomes();
  const report: TopologyReport = { homes: [], by_home: {} };

  for (const home of homes) {
    const id = home.id.toUpperCase();
    report.homes.push({ id, name: home.name });

    const [rooms, accessories, groups, scenes] = await Promise.all([
      executeHomeKitAction('rooms.list', { homeId: home.id }).catch(() => null),
      executeHomeKitAction('accessories.list', { homeId: home.id, includeAll: true, includeValues: true }).catch(() => null),
      executeHomeKitAction('serviceGroups.list', { homeId: home.id }).catch(() => null),
      executeHomeKitAction('scenes.list', { homeId: home.id }).catch(() => null),
    ]);

    const roomList = ((rooms as { rooms?: Array<{ id: string; name: string }> })?.rooms) ?? [];
    const roomNames = new Map(roomList.map((r) => [r.id.toUpperCase(), r.name]));
    const accList = ((accessories as { accessories?: RawAccessory[] })?.accessories) ?? [];

    report.by_home[id] = {
      rooms: roomList.map((r) => ({ id: r.id.toUpperCase(), name: r.name })),
      accessories: accList.map((a) => ({
        id: a.id.toUpperCase(),
        name: a.name,
        roomName: a.roomId ? roomNames.get(a.roomId.toUpperCase()) : undefined,
        category: a.category,
        serialNumber: serialOf(a),
      })),
      service_groups: (((groups as { serviceGroups?: Array<{ id: string; name: string; accessoryIds?: string[] }> })?.serviceGroups) ?? [])
        .map((g) => ({
          id: g.id.toUpperCase(),
          name: g.name,
          accessoryIds: (g.accessoryIds ?? []).map((x) => x.toUpperCase()),
        })),
      scenes: (((scenes as { scenes?: Array<{ id: string; name: string }> })?.scenes) ?? [])
        .map((s) => ({ id: s.id.toUpperCase(), name: s.name })),
    };
  }
  return report;
}

/** Pull the serial out of the characteristics, so the payload can drop them. */
function serialOf(a: RawAccessory): string | undefined {
  for (const svc of a.services ?? []) {
    for (const ch of svc.characteristics ?? []) {
      if (ch.characteristicType === 'serial_number' && typeof ch.value === 'string' && ch.value) {
        return ch.value;
      }
    }
  }
  return undefined;
}

/** Cheap content hash, so an unchanged topology is not re-reported. */
function hashTopology(t: TopologyReport): string {
  const shape = t.homes.map((h) => {
    const s = t.by_home[h.id];
    return [h.id, h.name,
      s?.rooms.length ?? 0, s?.accessories.length ?? 0,
      s?.service_groups.length ?? 0, s?.scenes.length ?? 0,
      (s?.accessories ?? []).map((a) => a.id).join(','),
    ].join(':');
  }).join('|');

  let h = 0;
  for (let i = 0; i < shape.length; i++) {
    h = ((h << 5) - h + shape.charCodeAt(i)) | 0;
  }
  return String(h);
}

export const localIdentity = new LocalIdentity();
