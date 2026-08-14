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

export async function readLocalVault(accountId: string): Promise<EncryptedVault | null> {
  try {
    return (await withStore("readonly", (store) => store.get(accountId))) ?? null;
  } catch {
    return null;
  }
}

export async function writeLocalVault(
  accountId: string,
  vault: EncryptedVault,
): Promise<void> {
  try {
    await withStore("readwrite", (store) => store.put(vault, accountId));
  } catch {
    // Private-browsing modes and storage-pressure evictions can refuse writes.
    // The remote copy remains authoritative, so this is a cache miss, not a
    // data-loss event — it must not break the unlock flow.
  }
}

export async function clearLocalVault(accountId: string): Promise<void> {
  try {
    await withStore("readwrite", (store) => store.delete(accountId));
  } catch {
    /* nothing recoverable to do */
  }
}

/**
 * Which account this browser last opened.
 *
 * With no identity provider there is no session cookie to consult on load, so
 * the app needs a local pointer to know whether to show a lock screen or a
 * fresh-start screen. It is only an account id — a hash of a public key, not
 * a credential — and holding it grants nothing: opening the vault it names
 * still requires the passphrase, the phrase, or a passkey.
 */
const ACTIVE_ACCOUNT_KEY = "purbo:account";

export function readActiveAccount(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_ACCOUNT_KEY);
  } catch {
    return null;
  }
}

export function writeActiveAccount(accountId: string): void {
  try {
    window.localStorage.setItem(ACTIVE_ACCOUNT_KEY, accountId);
  } catch {
    /* storage disabled; the vault still works, it just starts fresh each visit */
  }
}

export function clearActiveAccount(): void {
  try {
    window.localStorage.removeItem(ACTIVE_ACCOUNT_KEY);
  } catch {
    /* nothing recoverable to do */
  }
}
