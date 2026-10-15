/**
 * actionQueue.js
 * ---------------
 * IndexedDB-backed queue for storing failed/offline generic API requests
 * (e.g., patient discharge, patient readmit, etc.).
 * Actions are stored locally and auto-synced when the network returns.
 */

const DB_NAME = 'hms_action_queue_db';
const STORE = 'action_queue';
const DB_VERSION = 1;

let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('by_status', 'status', { unique: false });
      }
    };

    req.onsuccess = (e) => {
      _db = e.target.result;
      resolve(_db);
    };

    req.onerror = (e) => {
      console.error('[actionQueue] Failed to open IndexedDB:', e.target.error);
      reject(e.target.error);
    };
  });
}

function withStore(mode, fn) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        const req = fn(store);
        if (req) {
          req.onsuccess = (e) => resolve(e.target.result);
          req.onerror = (e) => reject(e.target.error);
        } else {
          tx.oncomplete = () => resolve();
          tx.onerror = (e) => reject(e.target.error);
        }
      })
  );
}

export async function enqueueAction({ url, method, data }) {
  return withStore('readwrite', (store) =>
    store.add({
      url,
      method,
      data,
      timestamp: Date.now(),
      status: 'pending',
      retries: 0,
    })
  );
}

export async function getAllActions() {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const store = tx.objectStore(STORE);
        const req = store.getAll();
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (e) => reject(e.target.error);
      })
  );
}

export async function getPendingActions() {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const store = tx.objectStore(STORE);
        const index = store.index('by_status');
        const req = index.getAll('pending');
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (e) => reject(e.target.error);
      })
  );
}

export async function countActions() {
  const all = await getAllActions();
  return all.filter((i) => i.status !== 'syncing').length;
}

export async function updateActionStatus(id, status) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        const getReq = store.get(id);
        getReq.onsuccess = (e) => {
          const item = e.target.result;
          if (!item) return resolve();
          item.status = status;
          if (status === 'failed') item.retries = (item.retries || 0) + 1;
          const putReq = store.put(item);
          putReq.onsuccess = () => resolve();
          putReq.onerror = (ev) => reject(ev.target.error);
        };
        getReq.onerror = (e) => reject(e.target.error);
      })
  );
}

export async function removeAction(id) {
  return withStore('readwrite', (store) => store.delete(id));
}

export async function resetSyncingActions() {
  const all = await getAllActions();
  const syncing = all.filter((i) => i.status === 'syncing');
  await Promise.all(syncing.map((i) => updateActionStatus(i.id, 'pending')));
}

export async function retryFailedActions() {
  const all = await getAllActions();
  const failed = all.filter((i) => i.status === 'failed');
  await Promise.all(failed.map((i) => updateActionStatus(i.id, 'pending')));
}
