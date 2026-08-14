/**
 * Local persistence (IndexedDB).
 *
 * Only ciphertext is written here. If someone walks off with the device and
 * dumps the browser profile, they get the same thing the server has: an
 * Argon2id-protected envelope and a pile of AES-GCM blobs.
 */

import type { EncryptedVault } from "@/lib/vault/types";
import { VAULT_STORE, withStore } from "./db";

export async function readLocalVault(accountId: string): Promise<EncryptedVault | null> {
  try {
    return (
      (await withStore<EncryptedVault | undefined>(VAULT_STORE, "readonly", (store) =>
        store.get(accountId),
      )) ?? null
    );
  } catch {
    return null;
  }
}

export async function writeLocalVault(
  accountId: string,
  vault: EncryptedVault,
): Promise<void> {
  try {
    await withStore(VAULT_STORE, "readwrite", (store) => store.put(vault, accountId));
  } catch {
    // Private-browsing modes and storage-pressure evictions can refuse writes.
    // The remote copy remains authoritative, so this is a cache miss, not a
    // data-loss event — it must not break the unlock flow.
  }
}

export async function clearLocalVault(accountId: string): Promise<void> {
  try {
    await withStore(VAULT_STORE, "readwrite", (store) => store.delete(accountId));
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

/**
 * Whether this device has ever opened the vault with a passkey.
 *
 * Purely a UI hint, and deliberately not a secret: it decides whether the lock
 * screen reaches for the authenticator on its own or waits to be asked.
 * Without it every visit would either fire a WebAuthn prompt at people who
 * have no passkey, or bury the fast path behind a button nobody presses.
 *
 * It can be wrong — a passkey deleted from the OS keychain leaves it set — so
 * the unlock path treats "no such record" as the signal to clear it rather
 * than trusting this flag as truth.
 */
const PASSKEY_HINT_KEY = "purbo:passkey";

export function readPasskeyHint(): boolean {
  try {
    return window.localStorage.getItem(PASSKEY_HINT_KEY) === "1";
  } catch {
    return false;
  }
}

export function writePasskeyHint(): void {
  try {
    window.localStorage.setItem(PASSKEY_HINT_KEY, "1");
  } catch {
    /* the hint is an optimisation; losing it only costs one extra tap */
  }
}

export function clearPasskeyHint(): void {
  try {
    window.localStorage.removeItem(PASSKEY_HINT_KEY);
  } catch {
    /* nothing recoverable to do */
  }
}
