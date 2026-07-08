/**
 * offlineQueue.js
 * ---------------
 * IndexedDB-backed queue for storing failed/offline document uploads.
 * Uploads are stored locally and auto-synced when the network returns.
 *
 * Schema per item:
 *   id          — auto-increment IDB key
 *   patientId   — string
 *   docType     — string
 *   fileName    — string
 *   notes       — string | null
 *   fileBlob    — Blob (the compressed file)
 *   timestamp   — number (Date.now())
 *   status      — 'pending' | 'syncing' | 'failed'
 *   retries     — number
 */

const DB_NAME = 'hms_offline_db';
const STORE = 'upload_queue';
const DB_VERSION = 1;

// ── Open / initialise DB ─────────────────────────────────────────────────────

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
        store.createIndex('by_patient', 'patientId', { unique: false });
      }
    };

    req.onsuccess = (e) => {
      _db = e.target.result;
      resolve(_db);
    };

    req.onerror = (e) => {
      console.error('[offlineQueue] Failed to open IndexedDB:', e.target.error);
      reject(e.target.error);
    };
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Add a new pending upload to the queue.
 * @param {Object} item - { patientId, docType, fileName, notes, fileBlob }
 * @returns {Promise<number>} The new item's IDB id
 */
export async function enqueue({ patientId, docType, fileName, notes, fileBlob }) {
  return withStore('readwrite', (store) =>
    store.add({
      patientId,
      docType,
      fileName,
      notes: notes || null,
      fileBlob,
      timestamp: Date.now(),
      status: 'pending',
      retries: 0,
    })
  );
}

/**
 * Get all items in the queue (all statuses).
 * @returns {Promise<Array>}
 */
export async function getAll() {
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

/**
 * Get only pending items (ready to sync).
 * @returns {Promise<Array>}
 */
export async function getPending() {
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

/**
 * Count pending + failed items (for badge display).
 * @returns {Promise<number>}
 */
export async function count() {
  const all = await getAll();
  return all.filter((i) => i.status !== 'syncing').length;
}

/**
 * Update the status of a queued item.
 * @param {number} id
 * @param {'pending'|'syncing'|'failed'} status
 */
export async function updateStatus(id, status) {
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

/**
 * Remove a successfully synced item.
 * @param {number} id
 */
export async function remove(id) {
  return withStore('readwrite', (store) => store.delete(id));
}

/**
 * Reset all 'syncing' items back to 'pending' (e.g., on app restart after crash).
 */
export async function resetSyncing() {
  const all = await getAll();
  const syncing = all.filter((i) => i.status === 'syncing');
  await Promise.all(syncing.map((i) => updateStatus(i.id, 'pending')));
}

/**
 * Reset all 'failed' items back to 'pending' (manual retry).
 */
export async function retryFailed() {
  const all = await getAll();
  const failed = all.filter((i) => i.status === 'failed');
  await Promise.all(failed.map((i) => updateStatus(i.id, 'pending')));
}

/**
 * Save an unassigned scanned PDF to drafts.
 */
export async function saveDraft({ fileName, fileBlob, pageCount }) {
  return withStore('readwrite', (store) =>
    store.add({
      patientId: 'draft',
      docType: 'draft',
      fileName: fileName || 'Scanned Document',
      notes: `${pageCount || 1} pages`,
      fileBlob,
      timestamp: Date.now(),
      status: 'draft',
      retries: 0,
    })
  );
}

/**
 * Get all unassigned draft scans.
 */
export async function getDrafts() {
  const all = await getAll();
  return all.filter((i) => i.status === 'draft' || i.patientId === 'draft');
}
