/**
 * Community mode: IndexedDB persistence layer.
 *
 * Stores settings, collections, stored entities, room groups, and
 * HC automations locally. Replaces the cloud PostgreSQL database
 * for Community mode.
 */

const DB_NAME = 'homecast-local';
const DB_VERSION = 4; // v4: added access_tokens

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
