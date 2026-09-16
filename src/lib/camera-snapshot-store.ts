import type { SnapshotImage } from './camera-snapshot';

interface StoredSnapshot {
  id: string;
  account: string;
  key: string;
  image: SnapshotImage;
}

// Separate from the Community database: a private, disposable last-image
// cache, not a recording archive. One row per account/home/camera.
const DATABASE = 'homecast-camera-snapshots';
const STORE = 'snapshots';
let database: Promise<IDBDatabase> | undefined;

function open(): Promise<IDBDatabase> {
  if (!database) {
    database = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Camera cache is unavailable'));
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); database = undefined; };
        resolve(db);
      };
    }).catch(error => { database = undefined; throw error; });
  }
  return database;
}

export const cameraSnapshotStore = {
  async read(account: string, key: string): Promise<SnapshotImage | undefined> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(JSON.stringify([account, key]));
      tx.oncomplete = () => resolve((request.result as StoredSnapshot | undefined)?.image);
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  },
  async write(account: string, key: string, image: SnapshotImage): Promise<void> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ id: JSON.stringify([account, key]), account, key, image } satisfies StoredSnapshot);
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  },
  async remove(account: string, key?: string, homeId?: string): Promise<void> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const entry = cursor.value as StoredSnapshot;
        if (entry.account === account && (key === undefined || entry.key === key) &&
          (homeId === undefined || JSON.parse(entry.key)[0] === homeId)) cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  },
  async clear(): Promise<void> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  },
};
