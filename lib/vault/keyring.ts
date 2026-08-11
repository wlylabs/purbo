/**
 * The vault key hierarchy.
 *
 *   24-word recovery phrase
 *     └─ BIP39 seed            (PBKDF2-HMAC-SHA512, 2048 rounds, 64 bytes)
 *         └─ root key          (HKDF-SHA-256, label "purbo:root:v1", 32 bytes)
 *             └─ data key      (HKDF-SHA-256, label "purbo:data:v1", 32 bytes)
 *                 └─ AES-256-GCM over each entry, fresh IV, AAD-bound
 *
 *   passphrase
 *     └─ key-encryption key    (Argon2id 64 MiB / 3 passes, 32 bytes)
 *         └─ AES-256-GCM wrap of the root key  -> the KeyEnvelope
 *
 * Two independent paths reach the root key: the phrase (offline, portable,
 * survives a forgotten passphrase) and the passphrase (fast, per-device).
 * The server sees the wrapped root key and nothing else — no phrase, no
 * passphrase, no root key, no plaintext entry ever leaves the browser.
 *
 * Consequence, stated plainly: nobody, including whoever runs the server,
 * can reset a passphrase or recover a vault. That is the point.
 */

import { importAesKey, open, seal } from "@/lib/crypto/aead";
import {
  DEFAULT_KDF_PARAMS,
  assertAcceptableKdfParams,
  deriveKeyEncryptionKey,
  hkdf,
} from "@/lib/crypto/kdf";
import { phraseToSeed } from "@/lib/crypto/mnemonic";
import {
  fromBase64Url,
  randomBytes,
  toBase64Url,
  wipe,
} from "@/lib/crypto/primitives";
import type { KeyEnvelope } from "./types";

const ROOT_INFO = "purbo:root:v1";
const DATA_INFO = "purbo:data:v1";

/** AAD binding a wrapped root key to its owner. */
function envelopeAad(userId: string): string {
  return `purbo:envelope:v1:${userId}`;
}

/** AAD binding an entry ciphertext to its owner and its id. */
export function itemAad(userId: string, itemId: string): string {
  return `purbo:item:v1:${userId}:${itemId}`;
}

/**
 * The live, unlocked key material for one session.
 *
 * `dataKey` is a non-extractable CryptoKey: even with script execution in the
 * page, an attacker can use it but cannot read it out and take it away.
 */
export interface Keyring {
  readonly userId: string;
  readonly dataKey: CryptoKey;
}

async function rootToKeyring(
  userId: string,
  rootKey: Uint8Array,
  rootSalt: Uint8Array,
): Promise<Keyring> {
  const dataKeyBytes = await hkdf(rootKey, DATA_INFO, 32, rootSalt);
  try {
    return { userId, dataKey: await importAesKey(dataKeyBytes) };
  } finally {
    wipe(dataKeyBytes);
  }
}

/**
 * Creates a brand-new vault from a fresh recovery phrase and a passphrase.
 * Returns the envelope to persist and the keyring to use immediately.
 */
export async function createKeyring(
  userId: string,
  recoveryPhrase: string,
  passphrase: string,
): Promise<{ envelope: KeyEnvelope; keyring: Keyring }> {
  const seed = await phraseToSeed(recoveryPhrase);
  const rootSalt = randomBytes(32);
  const kdfSalt = randomBytes(16);
  let rootKey: Uint8Array | null = null;
  let kek: Uint8Array | null = null;

  try {
    rootKey = await hkdf(seed, ROOT_INFO, 32, rootSalt);
    kek = await deriveKeyEncryptionKey(passphrase, kdfSalt, DEFAULT_KDF_PARAMS);
    const wrapKey = await importAesKey(kek);
    const wrapped = await seal(wrapKey, rootKey, envelopeAad(userId));

    const envelope: KeyEnvelope = {
      version: 1,
      salt: toBase64Url(kdfSalt),
      kdf: DEFAULT_KDF_PARAMS,
      wrapped,
      rootSalt: toBase64Url(rootSalt),
      createdAt: Date.now(),
    };

    return { envelope, keyring: await rootToKeyring(userId, rootKey, rootSalt) };
  } finally {
    wipe(seed, rootKey, kek);
  }
}

/** Unlocks an existing vault with the passphrase. */
export async function unlockWithPassphrase(
  userId: string,
  envelope: KeyEnvelope,
  passphrase: string,
): Promise<Keyring> {
  // Validated before use: the envelope arrives from storage, which is
  // untrusted, and weak parameters here would silently gut the KDF.
  assertAcceptableKdfParams(envelope.kdf);

  const kdfSalt = fromBase64Url(envelope.salt);
  const rootSalt = fromBase64Url(envelope.rootSalt);
  let kek: Uint8Array | null = null;
  let rootKey: Uint8Array | null = null;

  try {
    kek = await deriveKeyEncryptionKey(passphrase, kdfSalt, envelope.kdf);
    const wrapKey = await importAesKey(kek);
    try {
      rootKey = await open(wrapKey, envelope.wrapped, envelopeAad(userId));
    } catch {
      // GCM tag failure. Uniform message: never distinguish "wrong
      // passphrase" from "tampered blob" to whoever is watching.
      throw new IncorrectPassphraseError();
    }
    return await rootToKeyring(userId, rootKey, rootSalt);
  } finally {
    wipe(kek, rootKey);
  }
}

/**
 * Unlocks using the recovery phrase, bypassing the passphrase entirely.
 * Used when a passphrase is forgotten or the vault is restored on a new
 * device — the phrase reconstructs the root key from scratch.
 */
export async function unlockWithRecoveryPhrase(
  userId: string,
  envelope: KeyEnvelope,
  recoveryPhrase: string,
): Promise<Keyring> {
  const seed = await phraseToSeed(recoveryPhrase);
  const rootSalt = fromBase64Url(envelope.rootSalt);
  let rootKey: Uint8Array | null = null;
  try {
    rootKey = await hkdf(seed, ROOT_INFO, 32, rootSalt);
    return await rootToKeyring(userId, rootKey, rootSalt);
  } finally {
    wipe(seed, rootKey);
  }
}

/**
 * Re-wraps the existing root key under a new passphrase.
 *
 * The root key is unchanged, so every stored ciphertext stays valid — only
 * the envelope is replaced. Requires the recovery phrase, which is what makes
 * this safe to expose as "forgot passphrase".
 */
export async function rewrapWithNewPassphrase(
  userId: string,
  envelope: KeyEnvelope,
  recoveryPhrase: string,
  newPassphrase: string,
): Promise<KeyEnvelope> {
  const seed = await phraseToSeed(recoveryPhrase);
  const rootSalt = fromBase64Url(envelope.rootSalt);
  const kdfSalt = randomBytes(16);
  let rootKey: Uint8Array | null = null;
  let kek: Uint8Array | null = null;

  try {
    rootKey = await hkdf(seed, ROOT_INFO, 32, rootSalt);
    kek = await deriveKeyEncryptionKey(newPassphrase, kdfSalt, DEFAULT_KDF_PARAMS);
    const wrapKey = await importAesKey(kek);
    const wrapped = await seal(wrapKey, rootKey, envelopeAad(userId));

    return {
      version: 1,
      salt: toBase64Url(kdfSalt),
      kdf: DEFAULT_KDF_PARAMS,
      wrapped,
      rootSalt: envelope.rootSalt,
      createdAt: envelope.createdAt,
    };
  } finally {
    wipe(seed, rootKey, kek);
  }
}

export class IncorrectPassphraseError extends Error {
  constructor() {
    super("That passphrase does not unlock this vault.");
    this.name = "IncorrectPassphraseError";
  }
}
