/**
 * The browser database.
 *
 * Two stores, both holding nothing a thief could read on their own:
 *
 *   vaults   — the encrypted vault, exactly as the server holds it.
 *   sessions — the keys one tab is holding open, so a reload does not have to
 *              spend a second of Argon2id re-deriving them.
 *
 * They share a connection because they share a database version: adding the
 * session store is a schema change, and splitting the opener would mean two
 * modules racing to upgrade the same database.
 */

const DB_NAME = "purbo";
const DB_VERSION = 2;

export const VAULT_STORE = "vaults";
export const SESSION_STORE = "sessions";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of [VAULT_STORE, SESSION_STORE]) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB unavailable"));
  });
}

export async function withStore<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const request = fn(tx.objectStore(store));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
    });
  } finally {
    db.close();
  }
}
