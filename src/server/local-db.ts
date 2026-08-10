/**
 * Community mode: IndexedDB persistence layer.
 *
 * Stores settings, collections, stored entities, room groups, and
 * HC automations locally. Replaces the cloud PostgreSQL database
 * for Community mode.
 */

const DB_NAME = 'homecast-local';
const DB_VERSION = 9; // v9: added history_series, history_samples, history_rollups

let dbPromise: Promise<IDBDatabase> | null = null;

/** Close any open database connection so deleteDatabase can proceed. */
export async function closeDB(): Promise<void> {
  if (dbPromise) {
    try {
      const db = await dbPromise;
      db.close();
    } catch {}
    dbPromise = null;
  }
}

/** Wipe all data from all stores (more reliable than deleteDatabase which can be blocked). */
export async function wipeAllData(): Promise<void> {
  try {
    const db = await openDB();
    const storeNames = Array.from(db.objectStoreNames);
    if (storeNames.length === 0) return;
    const tx = db.transaction(storeNames, 'readwrite');
    for (const name of storeNames) {
      tx.objectStore(name).clear();
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error('[LocalDB] wipeAllData failed:', e);
  }
}

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('collections')) {
        db.createObjectStore('collections', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('stored_entities')) {
        db.createObjectStore('stored_entities', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('room_groups')) {
        db.createObjectStore('room_groups', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('hc_automations')) {
        db.createObjectStore('hc_automations', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('users')) {
        db.createObjectStore('users', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('webhooks')) {
        db.createObjectStore('webhooks', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('entity_access')) {
        db.createObjectStore('entity_access', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('home_members')) {
        db.createObjectStore('home_members', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('access_tokens')) {
        db.createObjectStore('access_tokens', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('webhook_deliveries')) {
        const deliveryStore = db.createObjectStore('webhook_deliveries', { keyPath: 'id' });
        deliveryStore.createIndex('webhookId', 'webhookId', { unique: false });
      }
      if (!db.objectStoreNames.contains('oauth_clients')) {
        db.createObjectStore('oauth_clients', { keyPath: 'client_id' });
      }
      if (!db.objectStoreNames.contains('authorization_codes')) {
        db.createObjectStore('authorization_codes', { keyPath: 'code' });
      }
      if (!db.objectStoreNames.contains('refresh_tokens')) {
        db.createObjectStore('refresh_tokens', { keyPath: 'token_hash' });
      }
      if (!db.objectStoreNames.contains('user_consents')) {
        db.createObjectStore('user_consents', { keyPath: 'id' });
      }
      // v7: Automation engine stores
      if (!db.objectStoreNames.contains('execution_traces')) {
        const traceStore = db.createObjectStore('execution_traces', { keyPath: 'id' });
        traceStore.createIndex('automationId', 'automationId', { unique: false });
      }
      if (!db.objectStoreNames.contains('automation_versions')) {
        const versionStore = db.createObjectStore('automation_versions', { keyPath: 'id' });
        versionStore.createIndex('automationId', 'automationId', { unique: false });
      }
      if (!db.objectStoreNames.contains('credentials')) {
        db.createObjectStore('credentials', { keyPath: 'id' });
      }
      // v8: Helpers (virtual switches, timers, counters, modes). Definitions
      // and values are stored separately — values change constantly, and a
      // counter that resets on every relay restart is useless.
      if (!db.objectStoreNames.contains('hc_virtual_accessories')) {
        db.createObjectStore('hc_virtual_accessories', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('hc_virtual_states')) {
        db.createObjectStore('hc_virtual_states', { keyPath: 'id' });
      }
      // v9: Characteristic history (opt-in). Samples are keyed by
      // [seriesKey, ts] so range reads and pruning are cursor walks over a
      // contiguous key range — at history scale (tens of thousands of rows
      // per series) getAll-and-sort is not an option.
      if (!db.objectStoreNames.contains('history_series')) {
        const seriesStore = db.createObjectStore('history_series', { keyPath: 'id' });
        seriesStore.createIndex('homeId', 'homeId', { unique: false });
      }
      if (!db.objectStoreNames.contains('history_samples')) {
        const sampleStore = db.createObjectStore('history_samples', { keyPath: ['sid', 'ts'] });
        sampleStore.createIndex('ts', 'ts', { unique: false });
      }
      if (!db.objectStoreNames.contains('history_rollups')) {
        db.createObjectStore('history_rollups', { keyPath: ['sid', 'tier', 'bucket'] });
      }
    };

    request.onsuccess = () => {
      // Request persistent storage to prevent eviction. Best-effort: this must
      // never stop the database opening. A bare `navigator` reference throws a
      // ReferenceError under Node < 21 (no global navigator), which left the
      // promise unsettled and hung every caller forever.
      try {
        if (typeof navigator !== 'undefined') navigator.storage?.persist?.();
      } catch { /* persistence is optional */ }
      resolve(request.result);
    };

    request.onerror = () => {
      console.error('[LocalDB] Failed to open database:', request.error);
      dbPromise = null;
      reject(request.error);
    };
  });

  return dbPromise;
}

// Generic CRUD operations

async function getAll<T>(store: string): Promise<T[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getById<T>(store: string, id: string): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function put<T>(store: string, item: T): Promise<T> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(item);
    tx.oncomplete = () => resolve(item);
    tx.onerror = () => reject(tx.error);
  });
}

async function remove(store: string, id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- Generic Settings (key-value) ---

export async function getSetting(key: string): Promise<string | null> {
  const item = await getById<{ key: string; data: string }>('settings', key);
  return item?.data ?? null;
}

export async function setSetting(key: string, data: string): Promise<void> {
  await put('settings', { key, data });
}

// --- User Settings (display preferences) ---

export async function getSettings(): Promise<string> {
  const item = await getById<{ key: string; data: string }>('settings', 'user-settings');
  return item?.data ?? '{}';
}

export async function updateSettings(data: string): Promise<string> {
  await put('settings', { key: 'user-settings', data });
  return data;
}

// --- Collections ---

interface Collection {
  id: string;
  name: string;
  payload: string | null;
  createdAt: string;
}

export async function getCollections(): Promise<Collection[]> {
  return getAll<Collection>('collections');
}

export async function createCollection(name: string): Promise<Collection> {
  const collection: Collection = {
    id: crypto.randomUUID(),
    name,
    payload: null,
    createdAt: new Date().toISOString(),
  };
  await put('collections', collection);
  return collection;
}

export async function updateCollection(id: string, name?: string, payload?: string): Promise<Collection | null> {
  const collection = await getById<Collection>('collections', id);
  if (!collection) return null;
  if (name !== undefined) collection.name = name;
  if (payload !== undefined) collection.payload = payload;
  await put('collections', collection);
  return collection;
}

export async function deleteCollection(id: string): Promise<boolean> {
  await remove('collections', id);
  return true;
}

// --- Stored Entities ---

interface StoredEntity {
  id: string;
  entityType: string;
  entityId: string;
  data: string;
  layoutJson: string | null;
  createdAt: string;
}

export async function getStoredEntities(): Promise<StoredEntity[]> {
  return getAll<StoredEntity>('stored_entities');
}

export async function syncEntities(entities: Array<{ entityType: string; entityId: string; data: string }>): Promise<StoredEntity[]> {
  const results: StoredEntity[] = [];
  for (const e of entities) {
    const id = `${e.entityType}:${e.entityId}`;
    const existing = await getById<StoredEntity>('stored_entities', id);
    const entity: StoredEntity = {
      id,
      entityType: e.entityType,
      entityId: e.entityId,
      data: e.data,
      layoutJson: existing?.layoutJson ?? null,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    await put('stored_entities', entity);
    results.push(entity);
  }
  return results;
}

export async function updateStoredEntityLayout(entityType: string, entityId: string, layoutJson: string): Promise<StoredEntity | null> {
  const id = `${entityType}:${entityId}`;
  let entity = await getById<StoredEntity>('stored_entities', id);
  if (!entity) {
    entity = { id, entityType, entityId, data: '{}', layoutJson, createdAt: new Date().toISOString() };
  } else {
    entity.layoutJson = layoutJson;
  }
  await put('stored_entities', entity);
  return entity;
}

// --- Room Groups ---

interface RoomGroup {
  id: string;
  name: string;
  homeId: string;
  roomIds: string[];
  createdAt: string;
}

export async function getRoomGroups(): Promise<RoomGroup[]> {
  return getAll<RoomGroup>('room_groups');
}

export async function createRoomGroup(name: string, homeId: string, roomIds: string[]): Promise<RoomGroup> {
  const group: RoomGroup = {
    id: crypto.randomUUID(),
    name,
    homeId,
    roomIds,
    createdAt: new Date().toISOString(),
  };
  await put('room_groups', group);
  return group;
}

export async function updateRoomGroup(groupId: string, name?: string, roomIds?: string[]): Promise<RoomGroup | null> {
  const group = await getById<RoomGroup>('room_groups', groupId);
  if (!group) return null;
  if (name !== undefined) group.name = name;
  if (roomIds !== undefined) group.roomIds = roomIds;
  await put('room_groups', group);
  return group;
}

export async function deleteRoomGroup(groupId: string): Promise<boolean> {
  await remove('room_groups', groupId);
  return true;
}

// --- HC Automations ---

interface HcAutomation {
  id: string;
  homeId: string;
  data: string;
  createdAt: string;
  /** Absent on rows written before this field existed — fall back to createdAt. */
  updatedAt?: string;
}

/** Pass a homeId to scope results; omitting it returns every home's automations. */
export async function getHcAutomations(homeId?: string): Promise<HcAutomation[]> {
  const all = await getAll<HcAutomation>('hc_automations');
  return homeId ? all.filter(a => a.homeId === homeId) : all;
}

export async function saveHcAutomation(homeId: string, automationId: string | null, data: string): Promise<HcAutomation> {
  const id = automationId ?? crypto.randomUUID();
  const existing = await getById<HcAutomation>('hc_automations', id);

  // Snapshot current version before overwriting (auto-versioning)
  if (existing) {
    try {
      const versions = await getAutomationVersions(id);
      const nextVersion = (versions[0]?.version ?? 0) + 1;
      await saveAutomationVersion({
        id: crypto.randomUUID(),
        automationId: id,
        version: nextVersion,
        dataJson: existing.data,
        savedAt: new Date().toISOString(),
      });
    } catch { /* versioning is best-effort */ }
  }

  const now = new Date().toISOString();
  const automation: HcAutomation = {
    id,
    homeId,
    data,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await put('hc_automations', automation);
  return automation;
}

export async function deleteHcAutomation(automationId: string): Promise<boolean> {
  await remove('hc_automations', automationId);
  return true;
}

// --- Helpers (virtual switches, timers, counters, modes) ---

interface VirtualAccessoryRow {
  id: string;
  homeId: string;
  /** Serialized VirtualAccessoryDefinition. */
  data: string;
  createdAt: string;
  updatedAt: string;
}

interface VirtualAccessoryState {
  id: string;
  value: string; // JSON-encoded so booleans/numbers/strings round-trip
  updatedAt: string;
}

export async function getVirtualAccessories(homeId?: string): Promise<VirtualAccessoryRow[]> {
  const all = await getAll<VirtualAccessoryRow>('hc_virtual_accessories');
  return homeId ? all.filter(h => h.homeId === homeId) : all;
}

export async function saveVirtualAccessory(homeId: string, accessoryId: string | null, data: string): Promise<VirtualAccessoryRow> {
  const id = accessoryId ?? crypto.randomUUID();
  const existing = await getById<VirtualAccessoryRow>('hc_virtual_accessories', id);
  const now = new Date().toISOString();
  const helper: VirtualAccessoryRow = { id, homeId, data, createdAt: existing?.createdAt ?? now, updatedAt: now };
  await put('hc_virtual_accessories', helper);
  return helper;
}

export async function deleteVirtualAccessory(accessoryId: string): Promise<boolean> {
  await remove('hc_virtual_accessories', accessoryId);
  await remove('hc_virtual_states', accessoryId);
  return true;
}

export async function saveVirtualAccessoryState(accessoryId: string, value: unknown): Promise<void> {
  await put('hc_virtual_states', {
    id: accessoryId,
    value: JSON.stringify(value ?? null),
    updatedAt: new Date().toISOString(),
  });
}

/** All persisted helper values, keyed by helper id. */
export async function getVirtualAccessoryStates(): Promise<Record<string, unknown>> {
  const rows = await getAll<VirtualAccessoryState>('hc_virtual_states');
  const out: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      out[row.id] = JSON.parse(row.value);
    } catch { /* skip a corrupt row rather than failing the whole load */ }
  }
  return out;
}

// --- Users ---

export async function getUsers(): Promise<any[]> {
  return getAll('users');
}

export async function putUser(user: any): Promise<any> {
  return put('users', user);
}

export async function deleteUser(userId: string): Promise<void> {
  await remove('users', userId);
}

// --- Webhooks ---

export async function getWebhooks(): Promise<any[]> {
  return getAll('webhooks');
}

export async function getWebhook(id: string): Promise<any | undefined> {
  return getById('webhooks', id);
}

export async function putWebhook(webhook: any): Promise<any> {
  return put('webhooks', webhook);
}

export async function deleteWebhook(id: string): Promise<void> {
  await remove('webhooks', id);
}

// --- Access Tokens ---

export async function getAccessTokens(): Promise<any[]> {
  return getAll('access_tokens');
}

export async function putAccessToken(token: any): Promise<any> {
  return put('access_tokens', token);
}

export async function deleteAccessToken(id: string): Promise<void> {
  await remove('access_tokens', id);
}

// --- Entity Access (sharing) ---

export async function getEntityAccess(): Promise<any[]> {
  return getAll('entity_access');
}

export async function putEntityAccess(access: any): Promise<any> {
  return put('entity_access', access);
}

export async function deleteEntityAccess(id: string): Promise<void> {
  await remove('entity_access', id);
}

// --- Home Members ---

export async function getHomeMembers(): Promise<any[]> {
  return getAll('home_members');
}

export async function putHomeMember(member: any): Promise<any> {
  return put('home_members', member);
}

export async function deleteHomeMember(id: string): Promise<void> {
  await remove('home_members', id);
}

// --- Webhook Deliveries ---

export async function getWebhookDeliveries(webhookId: string, limit = 50): Promise<any[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('webhook_deliveries', 'readonly');
    const index = tx.objectStore('webhook_deliveries').index('webhookId');
    const req = index.getAll(webhookId);
    req.onsuccess = () => {
      const results = req.result
        .sort((a: any, b: any) => (b.createdAt || '').localeCompare(a.createdAt || ''))
        .slice(0, limit);
      resolve(results);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function putWebhookDelivery(delivery: any): Promise<any> {
  return put('webhook_deliveries', delivery);
}

export async function deleteWebhookDeliveriesForWebhook(webhookId: string): Promise<void> {
  const deliveries = await getWebhookDeliveries(webhookId, Infinity);
  const db = await openDB();
  const tx = db.transaction('webhook_deliveries', 'readwrite');
  for (const d of deliveries) {
    tx.objectStore('webhook_deliveries').delete(d.id);
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- OAuth Clients ---

export async function getOAuthClient(clientId: string): Promise<any | undefined> {
  return getById('oauth_clients', clientId);
}

export async function putOAuthClient(client: any): Promise<any> {
  return put('oauth_clients', client);
}

export async function getAllOAuthClients(): Promise<any[]> {
  return getAll('oauth_clients');
}

// --- Authorization Codes ---

export async function getAuthorizationCode(code: string): Promise<any | undefined> {
  return getById('authorization_codes', code);
}

export async function putAuthorizationCode(authCode: any): Promise<any> {
  return put('authorization_codes', authCode);
}

export async function deleteAuthorizationCode(code: string): Promise<void> {
  await remove('authorization_codes', code);
}

// --- Refresh Tokens ---

export async function getRefreshToken(tokenHash: string): Promise<any | undefined> {
  return getById('refresh_tokens', tokenHash);
}

export async function putRefreshToken(token: any): Promise<any> {
  return put('refresh_tokens', token);
}

export async function deleteRefreshToken(tokenHash: string): Promise<void> {
  await remove('refresh_tokens', tokenHash);
}

export async function deleteRefreshTokensByFamily(family: string): Promise<void> {
  const all = await getAll<any>('refresh_tokens');
  const matching = all.filter(t => t.family === family);
  const database = await openDB();
  const tx = database.transaction('refresh_tokens', 'readwrite');
  for (const t of matching) {
    tx.objectStore('refresh_tokens').delete(t.token_hash);
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- User Consents ---

export async function getUserConsent(id: string): Promise<any | undefined> {
  return getById('user_consents', id);
}

export async function putUserConsent(consent: any): Promise<any> {
  return put('user_consents', consent);
}

export async function getAllUserConsents(): Promise<any[]> {
  return getAll('user_consents');
}

export async function deleteUserConsent(id: string): Promise<void> {
  await remove('user_consents', id);
}

// --- Execution Traces ---

const MAX_TRACES_PER_AUTOMATION = 100;

interface StoredTrace {
  id: string;
  automationId: string;
  automationName: string;
  status: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  triggerSummary: string;
  traceJson: string; // Full ExecutionTrace serialized
}

export async function saveExecutionTrace(trace: StoredTrace): Promise<void> {
  await put('execution_traces', trace);

  // Prune old traces — keep last MAX_TRACES_PER_AUTOMATION per automation
  try {
    const db = await openDB();
    const tx = db.transaction('execution_traces', 'readwrite');
    const store = tx.objectStore('execution_traces');
    const index = store.index('automationId');
    const req = index.getAll(trace.automationId);
    req.onsuccess = () => {
      const traces = req.result as StoredTrace[];
      if (traces.length > MAX_TRACES_PER_AUTOMATION) {
        // Sort by startedAt descending, delete oldest
        traces.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
        for (let i = MAX_TRACES_PER_AUTOMATION; i < traces.length; i++) {
          store.delete(traces[i].id);
        }
      }
    };
  } catch { /* pruning is best-effort */ }
}

export async function getExecutionTraces(automationId: string, limit = 50): Promise<StoredTrace[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('execution_traces', 'readonly');
    const index = tx.objectStore('execution_traces').index('automationId');
    const req = index.getAll(automationId);
    req.onsuccess = () => {
      const traces = (req.result as StoredTrace[])
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, limit);
      resolve(traces);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getExecutionTrace(traceId: string): Promise<StoredTrace | undefined> {
  return getById<StoredTrace>('execution_traces', traceId);
}

// --- Automation Versions ---

interface AutomationVersion {
  id: string;
  automationId: string;
  version: number;
  dataJson: string;
  savedAt: string;
}

export async function saveAutomationVersion(version: AutomationVersion): Promise<void> {
  await put('automation_versions', version);

  // Keep last 50 versions per automation
  try {
    const db = await openDB();
    const tx = db.transaction('automation_versions', 'readwrite');
    const store = tx.objectStore('automation_versions');
    const index = store.index('automationId');
    const req = index.getAll(version.automationId);
    req.onsuccess = () => {
      const versions = req.result as AutomationVersion[];
      if (versions.length > 50) {
        versions.sort((a, b) => b.version - a.version);
        for (let i = 50; i < versions.length; i++) {
          store.delete(versions[i].id);
        }
      }
    };
  } catch { /* pruning is best-effort */ }
}

export async function getAutomationVersions(automationId: string): Promise<AutomationVersion[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('automation_versions', 'readonly');
    const index = tx.objectStore('automation_versions').index('automationId');
    const req = index.getAll(automationId);
    req.onsuccess = () => {
      const versions = (req.result as AutomationVersion[]).sort((a, b) => b.version - a.version);
      resolve(versions);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getAutomationVersion(versionId: string): Promise<AutomationVersion | undefined> {
  return getById<AutomationVersion>('automation_versions', versionId);
}

// --- Credentials ---

interface StoredCredential {
  id: string;
  name: string;
  type: 'api_key' | 'bearer' | 'basic_auth' | 'header';
  encryptedValue: string;
  iv: string;
  createdAt: string;
  updatedAt: string;
}

export async function getCredentials(): Promise<Omit<StoredCredential, 'encryptedValue' | 'iv'>[]> {
  const creds = await getAll<StoredCredential>('credentials');
  // Never return encrypted values
  return creds.map(({ encryptedValue, iv, ...rest }) => rest);
}

export async function getCredentialById(id: string): Promise<StoredCredential | undefined> {
  return getById<StoredCredential>('credentials', id);
}

export async function saveCredential(cred: StoredCredential): Promise<void> {
  await put('credentials', cred);
}

export async function deleteCredential(id: string): Promise<void> {
  await remove('credentials', id);
}

// --- Characteristic History ---
//
// Three stores, mirroring the cloud's history_series / history_sample /
// history_rollup_* tables. The series row doubles as per-series recording
// config: absence of an override field means the profile default applies
// (see src/history/policy.ts). Samples and rollups are keyed by compound
// keys so every access pattern — range read, prune, cascade delete — is a
// cursor over one contiguous key range.

export interface HistorySeriesRow {
  /** seriesKey(): `HOMEID|ACCESSORYID|characteristic_type` (ids uppercase). */
  id: string;
  homeId: string;
  accessoryId: string;
  characteristicType: string;
  kind: 'numeric' | 'bool' | 'enum';
  unit?: string;
  /** User override; undefined = profile default decides. */
  enabled?: boolean;
  minIntervalS?: number;
  deadband?: number;
  createdAt: string;
}

export interface HistorySampleRow {
  /** Series id (HistorySeriesRow.id). */
  sid: string;
  /** Epoch ms. */
  ts: number;
  v: number;
  /** 0 = device-reported, 1 = relay-write announcement. */
  src: number;
}

export interface HistoryRollupRow {
  sid: string;
  tier: 'h' | 'd';
  /** Bucket start, epoch ms (UTC-aligned). */
  bucket: number;
  vMin: number | null;
  vMax: number | null;
  vAvg: number | null;
  vLast: number;
  count: number;
  stateMs: Record<string, number> | null;
  transitions: number | null;
}

export async function getHistorySeries(homeId?: string): Promise<HistorySeriesRow[]> {
  if (homeId === undefined) return getAll<HistorySeriesRow>('history_series');
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('history_series', 'readonly');
    const req = tx.objectStore('history_series').index('homeId').getAll(homeId.toUpperCase());
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getHistorySeriesById(id: string): Promise<HistorySeriesRow | undefined> {
  return getById<HistorySeriesRow>('history_series', id);
}

export async function putHistorySeries(row: HistorySeriesRow): Promise<void> {
  await put('history_series', row);
}

/** One transaction for a whole flush batch; creates missing series rows too. */
export async function putHistoryBatch(
  samples: HistorySampleRow[],
  newSeries: HistorySeriesRow[],
): Promise<void> {
  if (samples.length === 0 && newSeries.length === 0) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['history_samples', 'history_series'], 'readwrite');
    const sampleStore = tx.objectStore('history_samples');
    const seriesStore = tx.objectStore('history_series');
    for (const row of newSeries) seriesStore.put(row);
    for (const row of samples) sampleStore.put(row);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function putHistoryRollups(rows: HistoryRollupRow[]): Promise<void> {
  if (rows.length === 0) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('history_rollups', 'readwrite');
    const store = tx.objectStore('history_rollups');
    for (const row of rows) store.put(row);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Samples in [fromTs, toTs), ascending. Cursor-chunked, never getAll-the-store. */
export async function getHistorySamples(
  sid: string,
  fromTs: number,
  toTs: number,
  limit = 100_000,
): Promise<HistorySampleRow[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('history_samples', 'readonly');
    const range = IDBKeyRange.bound([sid, fromTs], [sid, toTs], false, true);
    const req = tx.objectStore('history_samples').openCursor(range);
    const out: HistorySampleRow[] = [];
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor && out.length < limit) {
        out.push(cursor.value as HistorySampleRow);
        cursor.continue();
      } else {
        resolve(out);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

/** The LOCF seed: last sample strictly before ts. */
export async function getLastHistorySampleBefore(
  sid: string,
  ts: number,
): Promise<HistorySampleRow | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('history_samples', 'readonly');
    const range = IDBKeyRange.bound([sid, 0], [sid, ts], false, true);
    const req = tx.objectStore('history_samples').openCursor(range, 'prev');
    req.onsuccess = () => resolve((req.result?.value as HistorySampleRow) ?? undefined);
    req.onerror = () => reject(req.error);
  });
}

/** Rollup rows for one series/tier in [fromBucket, toBucket), ascending. */
export async function getHistoryRollups(
  sid: string,
  tier: 'h' | 'd',
  fromBucket: number,
  toBucket: number,
): Promise<HistoryRollupRow[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('history_rollups', 'readonly');
    const range = IDBKeyRange.bound([sid, tier, fromBucket], [sid, tier, toBucket], false, true);
    const req = tx.objectStore('history_rollups').openCursor(range);
    const out: HistoryRollupRow[] = [];
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        out.push(cursor.value as HistoryRollupRow);
        cursor.continue();
      } else {
        resolve(out);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getLastHistoryRollupBefore(
  sid: string,
  tier: 'h' | 'd',
  bucket: number,
): Promise<HistoryRollupRow | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('history_rollups', 'readonly');
    const range = IDBKeyRange.bound([sid, tier, 0], [sid, tier, bucket], false, true);
    const req = tx.objectStore('history_rollups').openCursor(range, 'prev');
    req.onsuccess = () => resolve((req.result?.value as HistoryRollupRow) ?? undefined);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Delete samples older than cutoff, in bounded chunks with an event-loop
 * yield between transactions — a months-deep prune must not freeze the relay
 * that is also serving live requests. Returns rows deleted.
 */
export async function pruneHistorySamples(
  cutoffTs: number,
  sid?: string,
  chunkSize = 500,
): Promise<number> {
  const db = await openDB();
  let deleted = 0;
  for (;;) {
    const batch: number = await new Promise((resolve, reject) => {
      const tx = db.transaction('history_samples', 'readwrite');
      const store = tx.objectStore('history_samples');
      let n = 0;
      const req = sid
        ? store.openCursor(IDBKeyRange.bound([sid, 0], [sid, cutoffTs], false, true))
        : store.index('ts').openCursor(IDBKeyRange.upperBound(cutoffTs, true));
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor && n < chunkSize) {
          cursor.delete();
          n++;
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve(n);
      tx.onerror = () => reject(tx.error);
    });
    deleted += batch;
    if (batch < chunkSize) return deleted;
    await new Promise((r) => setTimeout(r, 0));
  }
}

/** Cascade removal of one series: config row, samples, rollups. */
export async function deleteHistorySeries(sid: string): Promise<void> {
  await pruneHistorySamples(Number.MAX_SAFE_INTEGER, sid);
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['history_series', 'history_rollups'], 'readwrite');
    tx.objectStore('history_series').delete(sid);
    const range = IDBKeyRange.bound([sid, 'd', 0], [sid, 'h', Number.MAX_SAFE_INTEGER]);
    const req = tx.objectStore('history_rollups').openCursor(range);
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteHistoryForHome(homeId: string): Promise<void> {
  const series = await getHistorySeries(homeId);
  for (const row of series) {
    await deleteHistorySeries(row.id);
  }
}

export interface HistoryStorageStats {
  seriesCount: number;
  sampleRows: number;
  rollupRows: number;
  oldestSampleTs: number | null;
}

export async function getHistoryStorageStats(homeId?: string): Promise<HistoryStorageStats> {
  const series = await getHistorySeries(homeId);
  const sids = new Set(series.map((s) => s.id));
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['history_samples', 'history_rollups'], 'readonly');
    let sampleRows = 0;
    let rollupRows = 0;
    let oldestSampleTs: number | null = null;

    if (homeId === undefined) {
      // Whole-store counts are O(1); per-home falls back to per-series counts.
      const sampleCount = tx.objectStore('history_samples').count();
      sampleCount.onsuccess = () => { sampleRows = sampleCount.result; };
      const rollupCount = tx.objectStore('history_rollups').count();
      rollupCount.onsuccess = () => { rollupRows = rollupCount.result; };
      const oldest = tx.objectStore('history_samples').index('ts').openCursor();
      oldest.onsuccess = () => {
        if (oldest.result) oldestSampleTs = (oldest.result.value as HistorySampleRow).ts;
      };
    } else {
      for (const sid of sids) {
        const sc = tx.objectStore('history_samples')
          .count(IDBKeyRange.bound([sid, 0], [sid, Number.MAX_SAFE_INTEGER]));
        sc.onsuccess = () => { sampleRows += sc.result; };
        const rc = tx.objectStore('history_rollups')
          .count(IDBKeyRange.bound([sid, 'd', 0], [sid, 'h', Number.MAX_SAFE_INTEGER]));
        rc.onsuccess = () => { rollupRows += rc.result; };
        const oc = tx.objectStore('history_samples')
          .openCursor(IDBKeyRange.bound([sid, 0], [sid, Number.MAX_SAFE_INTEGER]));
        oc.onsuccess = () => {
          const row = oc.result?.value as HistorySampleRow | undefined;
          if (row && (oldestSampleTs === null || row.ts < oldestSampleTs)) oldestSampleTs = row.ts;
        };
      }
    }

    tx.oncomplete = () => resolve({ seriesCount: series.length, sampleRows, rollupRows, oldestSampleTs });
    tx.onerror = () => reject(tx.error);
  });
}

/** Delete rollup rows before a bucket boundary (time-bounded purge). */
export async function pruneHistoryRollups(sid: string, beforeBucket: number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('history_rollups', 'readwrite');
    const store = tx.objectStore('history_rollups');
    for (const tier of ['d', 'h'] as const) {
      const range = IDBKeyRange.bound([sid, tier, 0], [sid, tier, beforeBucket], false, true);
      const req = store.openCursor(range);
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Sample count for one series — an index count, not a scan. */
export async function countHistorySamples(sid: string): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('history_samples', 'readonly');
    const req = tx.objectStore('history_samples')
      .count(IDBKeyRange.bound([sid, 0], [sid, Number.MAX_SAFE_INTEGER]));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
