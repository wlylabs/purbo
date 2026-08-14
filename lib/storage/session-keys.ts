/**
 * Keys held open for the lifetime of one tab.
 *
 * The problem this solves is narrow: reloading the page, following a link, or
 * coming back from the OS share sheet threw away the whole session and asked
 * for the passphrase again — a full second of Argon2id for something the user
 * experiences as "I never left".
 *
 * What is cached, and what deliberately is not:
 *
 *   dataKey     a non-extractable CryptoKey. Script in this origin can use it
 *               while the record lives, but cannot read it out and take it.
 *   authSecret  sealed under a second non-extractable key, both stored side by
 *               side. Same property: usable here, not portable elsewhere.
 *   rootKey     never stored. It is the permanent master — it survives every
 *               passphrase change and cannot be rotated — and a resumed tab
 *               has no use for it, so it does not go near disk.
 *
 * Scope is one tab, enforced by keeping the record's key in `sessionStorage`:
 * closing the tab destroys the handle, and the orphaned record is unreachable
 * and pruned on the next visit. A hard expiry bounds what a tab that died
 * without cleaning up can leave behind, and locking deletes the record
 * outright — so auto-lock still means what it says.
 */

import { open, seal, type SealedBox } from "@/lib/crypto/aead";
import { getCrypto, randomBytes, toBase64Url } from "@/lib/crypto/primitives";
import { SESSION_STORE, withStore } from "./db";

/** Where the tab keeps the key to its own record. */
const HANDLE_KEY = "purbo:session";

/**
 * The ceiling on a resumed session, independent of auto-lock.
 *
 * Auto-lock removes the record on the way past, so this only governs the case
 * it cannot reach: a tab killed by a crash or an OS memory sweep, which leaves
 * a record behind with no one to delete it.
 */
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

interface SessionRecord {
  readonly handle: string;
  readonly accountId: string;
  readonly dataKey: CryptoKey;
  readonly authKey: CryptoKey;
  readonly authBox: SealedBox;
  readonly expiresAt: number;
}

export interface SessionKeys {
  readonly accountId: string;
  readonly dataKey: CryptoKey;
  readonly authSecret: Uint8Array;
}

/** Binds a cached secret to the account and the tab it was cached for. */
function sessionAad(accountId: string, handle: string): string {
  return `purbo:session:v1:${accountId}:${handle}`;
}

function readHandle(): string | null {
  try {
    return window.sessionStorage.getItem(HANDLE_KEY);
  } catch {
    return null;
  }
}

/** The current tab's handle, minting one on first use. */
function ensureHandle(): string | null {
  try {
    const existing = window.sessionStorage.getItem(HANDLE_KEY);
    if (existing) return existing;
    const handle = toBase64Url(randomBytes(16));
    window.sessionStorage.setItem(HANDLE_KEY, handle);
    return handle;
  } catch {
    // Session storage disabled. Without a handle there is nothing to scope a
    // record to, so the tab simply does without the cache.
    return null;
  }
}

/**
 * Drops every record that has aged out.
 *
 * Expiry is the only safe test available here. A record belonging to another
 * open tab is indistinguishable from one left by a tab that died — both are
 * just a handle this tab does not hold — so the live one must be left alone
 * and the dead one waits for its clock to run out.
 */
async function prune(): Promise<void> {
  try {
    const records = await withStore<SessionRecord[]>(SESSION_STORE, "readonly", (store) =>
      store.getAll(),
    );
    const now = Date.now();
    for (const record of records) {
      if (!record?.handle || record.expiresAt > now) continue;
      await withStore(SESSION_STORE, "readwrite", (store) => store.delete(record.handle));
    }
  } catch {
    /* pruning is hygiene, never a precondition for unlocking */
  }
}

/**
 * Caches the keys this tab is holding. Takes a copy of `authSecret`; the
 * caller keeps ownership of theirs.
 */
export async function saveSessionKeys(keys: SessionKeys): Promise<void> {
  const handle = ensureHandle();
  if (!handle) return;

  try {
    const authKey = await getCrypto().subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      // Not extractable: the wrapping key can open the secret in this tab and
      // nowhere else, which is the entire point of sealing it rather than
      // storing the bytes.
      false,
      ["encrypt", "decrypt"],
    );

    const record: SessionRecord = {
      handle,
      accountId: keys.accountId,
      dataKey: keys.dataKey,
      authKey,
      authBox: await seal(authKey, keys.authSecret, sessionAad(keys.accountId, handle)),
      expiresAt: Date.now() + SESSION_TTL_MS,
    };

    await withStore(SESSION_STORE, "readwrite", (store) => store.put(record, handle));
  } catch {
    // Private browsing, a storage quota, or a browser that refuses to
    // structured-clone CryptoKeys. Losing the cache costs one passphrase
    // prompt on the next reload; it must never fail the unlock in progress.
  }
}

/** The keys this tab cached, or null if there are none to resume. */
export async function loadSessionKeys(): Promise<SessionKeys | null> {
  await prune();

  const handle = readHandle();
  if (!handle) return null;

  try {
    const record = await withStore<SessionRecord | undefined>(
      SESSION_STORE,
      "readonly",
      (store) => store.get(handle),
    );
    if (!record || record.expiresAt <= Date.now()) return null;

    return {
      accountId: record.accountId,
      dataKey: record.dataKey,
      authSecret: await open(
        record.authKey,
        record.authBox,
        sessionAad(record.accountId, handle),
      ),
    };
  } catch {
    // A tag failure means the record does not belong to this handle. Nothing
    // to salvage and nothing to explain — fall back to the lock screen.
    return null;
  }
}

/** Ends the cached session. Called on lock, sign-out and vault deletion. */
export async function clearSessionKeys(): Promise<void> {
  const handle = readHandle();
  try {
    window.sessionStorage.removeItem(HANDLE_KEY);
  } catch {
    /* nothing recoverable to do */
  }
  if (!handle) return;

  try {
    await withStore(SESSION_STORE, "readwrite", (store) => store.delete(handle));
  } catch {
    /* nothing recoverable to do */
  }
}
