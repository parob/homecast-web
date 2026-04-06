/**
 * Community mode: IndexedDB persistence layer.
 *
 * Stores settings, collections, stored entities, room groups, and
 * HC automations locally. Replaces the cloud PostgreSQL database
 * for Community mode.
 */

const DB_NAME = 'homecast-local';
const DB_VERSION = 7; // v7: added execution_traces, automation_versions, credentials

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
    };

    request.onsuccess = () => {
      // Request persistent storage to prevent eviction
      navigator.storage?.persist?.();
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
}

export async function getHcAutomations(): Promise<HcAutomation[]> {
  return getAll<HcAutomation>('hc_automations');
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

  const automation: HcAutomation = {
    id,
    homeId,
    data,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
  await put('hc_automations', automation);
  return automation;
}

export async function deleteHcAutomation(automationId: string): Promise<boolean> {
  await remove('hc_automations', automationId);
  return true;
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
