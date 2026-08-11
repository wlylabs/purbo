/**
 * Per-entry encryption.
 *
 * Every field of an entry — name, username, password, URL, notes — is sealed
 * into a single ciphertext. Nothing is stored in the clear "just for search"
 * or "just for the list view"; search runs in memory over decrypted entries
 * while the vault is unlocked.
 */

import { openJson, sealJson } from "@/lib/crypto/aead";
import { toBase64Url, randomBytes } from "@/lib/crypto/primitives";
import { itemAad, type Keyring } from "./keyring";
import type { EncryptedItem, VaultItem, VaultItemDraft } from "./types";

/** 128-bit random id — no counter, so ids leak no ordering information. */
export function newItemId(): string {
  return toBase64Url(randomBytes(16));
}

/** The shape actually sealed inside the ciphertext. */
type ItemPayload = Omit<VaultItem, "id">;

export async function encryptItem(
  keyring: Keyring,
  item: VaultItem,
): Promise<EncryptedItem> {
  const { id, ...payload } = item;
  return {
    id,
    payload: await sealJson(keyring.dataKey, payload satisfies ItemPayload, itemAad(keyring.userId, id)),
    updatedAt: item.updatedAt,
  };
}

export async function decryptItem(
  keyring: Keyring,
  encrypted: EncryptedItem,
): Promise<VaultItem> {
  const payload = await openJson<ItemPayload>(
    keyring.dataKey,
    encrypted.payload,
    itemAad(keyring.userId, encrypted.id),
  );
  return { ...payload, id: encrypted.id };
}

/**
 * Decrypts a whole vault, skipping entries that fail authentication.
 *
 * A single corrupted or tampered record must not make the entire vault
 * unreadable — the user keeps access to everything still intact, and the
 * failures are surfaced rather than swallowed.
 */
export async function decryptAll(
  keyring: Keyring,
  encrypted: EncryptedItem[],
): Promise<{ items: VaultItem[]; failed: string[] }> {
  const items: VaultItem[] = [];
  const failed: string[] = [];

  const results = await Promise.allSettled(
    encrypted.map((record) => decryptItem(keyring, record)),
  );

  results.forEach((result, index) => {
    if (result.status === "fulfilled") items.push(result.value);
    else failed.push(encrypted[index]!.id);
  });

  return { items, failed };
}

export function draftToItem(draft: VaultItemDraft): VaultItem {
  const now = Date.now();
  return { ...draft, id: newItemId(), createdAt: now, updatedAt: now };
}

export function applyDraft(item: VaultItem, draft: VaultItemDraft): VaultItem {
  return { ...item, ...draft, updatedAt: Date.now() };
}
