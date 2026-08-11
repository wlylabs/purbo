/**
 * Local persistence (IndexedDB).
 *
 * Only ciphertext is written here. If someone walks off with the device and
 * dumps the browser profile, they get the same thing the server has: an
 * Argon2id-protected envelope and a pile of AES-GCM blobs.
 */

import type { EncryptedVault } from "@/lib/vault/types";

const DB_NAME = "purbo";
const DB_VERSION = 1;
const STORE = "vaults";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB unavailable"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = fn(tx.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
    });
  } finally {
    db.close();
  }
}

export async function readLocalVault(userId: string): Promise<EncryptedVault | null> {
  try {
    return (await withStore("readonly", (store) => store.get(userId))) ?? null;
  } catch {
    return null;
  }
}

export async function writeLocalVault(
  userId: string,
  vault: EncryptedVault,
): Promise<void> {
  try {
    await withStore("readwrite", (store) => store.put(vault, userId));
  } catch {
    // Private-browsing modes and storage-pressure evictions can refuse writes.
    // The remote copy remains authoritative, so this is a cache miss, not a
    // data-loss event — it must not break the unlock flow.
  }
}

export async function clearLocalVault(userId: string): Promise<void> {
  try {
    await withStore("readwrite", (store) => store.delete(userId));
  } catch {
    /* nothing recoverable to do */
  }
}
