/**
 * The vault key hierarchy.
 *
 *   24-word recovery phrase
 *     └─ BIP39 seed            (PBKDF2-HMAC-SHA512, 2048 rounds, 64 bytes)
 *         ├─ auth secret       (HKDF-SHA-256, label "purbo:auth:v1", 32 bytes)
 *         │   └─ Ed25519 key pair -> account id, and the signature that
 *         │      authenticates every request to the server
 *         └─ root key          (HKDF-SHA-256, label "purbo:root:v1", 32 bytes)
 *             ├─ data key      (HKDF-SHA-256, label "purbo:data:v1", 32 bytes)
 *             │   └─ AES-256-GCM over each entry, fresh IV, AAD-bound
 *             └─ auth-wrap key (HKDF-SHA-256, label "purbo:auth-wrap:v1")
 *                 └─ AES-256-GCM wrap of the auth secret -> stored in the envelope
 *
 *   passphrase
 *     └─ key-encryption key    (Argon2id 64 MiB / 3 passes, 32 bytes)
 *         └─ AES-256-GCM wrap of the root key  -> the KeyEnvelope
 *
 * Two independent paths reach the root key: the phrase (offline, portable,
 * survives a forgotten passphrase) and the passphrase (fast, per-device).
 *
 * The auth secret is reachable from both, which is what makes identity and
 * decryption inseparable. From the phrase it is derived directly — necessary,
 * because a fresh device must be able to authenticate *before* it has an
 * envelope to fetch. From the passphrase it comes out of the envelope's
 * `auth` box, sealed under a subkey of the root key.
 *
 * Consequence, stated plainly: nobody, including whoever runs the server,
 * can reset a passphrase or recover a vault. That is the point.
 */

import {
  authSecretFromSeed,
  identityFromSecret,
  type AuthIdentity,
} from "@/lib/auth/identity";
import { importAesKey, open, seal, type SealedBox } from "@/lib/crypto/aead";
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
  utf8Decode,
  utf8Encode,
  wipe,
} from "@/lib/crypto/primitives";
import type { KeyEnvelope } from "./types";

const ROOT_INFO = "purbo:root:v1";
const DATA_INFO = "purbo:data:v1";
const VERIFY_INFO = "purbo:verify:v1";
const AUTH_WRAP_INFO = "purbo:auth-wrap:v1";

/** Sealed under the verify subkey to prove a root key belongs to a vault. */
const VERIFIER_PLAINTEXT = "purbo:root-key-check:v1";

/** AAD binding a wrapped root key to its owner. */
function envelopeAad(accountId: string): string {
  return `purbo:envelope:v1:${accountId}`;
}

/** AAD binding an entry ciphertext to its owner and its id. */
export function itemAad(accountId: string, itemId: string): string {
  return `purbo:item:v1:${accountId}:${itemId}`;
}

/** AAD binding the root-key verifier to its owner. */
function verifierAad(accountId: string): string {
  return `purbo:verifier:v1:${accountId}`;
}

/** AAD binding the wrapped auth secret to its owner. */
function authAad(accountId: string): string {
  return `purbo:auth-secret:v1:${accountId}`;
}

async function subkey(
  rootKey: Uint8Array,
  info: string,
  rootSalt: Uint8Array,
): Promise<Uint8Array> {
  return hkdf(rootKey, info, 32, rootSalt);
}

/** Seals the verifier constant under a subkey of the root key. */
async function buildVerifier(
  accountId: string,
  rootKey: Uint8Array,
  rootSalt: Uint8Array,
): Promise<SealedBox> {
  const verifyKeyBytes = await subkey(rootKey, VERIFY_INFO, rootSalt);
  try {
    const verifyKey = await importAesKey(verifyKeyBytes);
    return await seal(verifyKey, utf8Encode(VERIFIER_PLAINTEXT), verifierAad(accountId));
  } finally {
    wipe(verifyKeyBytes);
  }
}

/** Seals the account's Ed25519 secret under a subkey of the root key. */
async function wrapAuthSecret(
  accountId: string,
  rootKey: Uint8Array,
  rootSalt: Uint8Array,
  authSecret: Uint8Array,
): Promise<SealedBox> {
  const wrapKeyBytes = await subkey(rootKey, AUTH_WRAP_INFO, rootSalt);
  try {
    return await seal(await importAesKey(wrapKeyBytes), authSecret, authAad(accountId));
  } finally {
    wipe(wrapKeyBytes);
  }
}

async function unwrapAuthSecret(
  accountId: string,
  envelope: KeyEnvelope,
  rootKey: Uint8Array,
  rootSalt: Uint8Array,
): Promise<Uint8Array> {
  const wrapKeyBytes = await subkey(rootKey, AUTH_WRAP_INFO, rootSalt);
  try {
    return await open(await importAesKey(wrapKeyBytes), envelope.auth, authAad(accountId));
  } finally {
    wipe(wrapKeyBytes);
  }
}

/**
 * Confirms a candidate root key is the one this vault was built with.
 *
 * The recovery phrase alone cannot be checked against the envelope — that is
 * wrapped under the passphrase, which a recovering user does not have. This
 * closes that gap so a wrong-but-valid phrase fails here rather than silently
 * re-wrapping the vault around a key that decrypts nothing.
 */
async function assertRootKeyMatches(
  accountId: string,
  envelope: KeyEnvelope,
  rootKey: Uint8Array,
  rootSalt: Uint8Array,
): Promise<void> {
  const verifyKeyBytes = await subkey(rootKey, VERIFY_INFO, rootSalt);
  try {
    const verifyKey = await importAesKey(verifyKeyBytes);
    const opened = await open(verifyKey, envelope.verifier, verifierAad(accountId));
    if (utf8Decode(opened) !== VERIFIER_PLAINTEXT) throw new Error("verifier mismatch");
  } catch {
    throw new IncorrectRecoveryPhraseError();
  } finally {
    wipe(verifyKeyBytes);
  }
}

/**
 * The live, unlocked key material for one session.
 *
 * `dataKey` is a non-extractable CryptoKey: even with script execution in the
 * page, an attacker can use it but cannot read it out and take it away. The
 * identity's signing secret cannot be given the same treatment — Ed25519 is
 * not in every browser's WebCrypto — so it is held as bytes and dropped when
 * the vault locks.
 */
export interface Keyring {
  readonly accountId: string;
  readonly dataKey: CryptoKey;
  readonly identity: AuthIdentity;
}

/** The material a passkey registration seals. Callers must wipe it. */
export interface RootMaterial {
  rootKey: Uint8Array;
  authSecret: Uint8Array;
  rootSalt: Uint8Array;
}

async function assembleKeyring(
  rootKey: Uint8Array,
  rootSalt: Uint8Array,
  authSecret: Uint8Array,
): Promise<Keyring> {
  const identity = await identityFromSecret(authSecret);
  const dataKeyBytes = await subkey(rootKey, DATA_INFO, rootSalt);
  try {
    return {
      accountId: identity.accountId,
      dataKey: await importAesKey(dataKeyBytes),
      identity,
    };
  } finally {
    wipe(dataKeyBytes);
  }
}

/**
 * Creates a brand-new vault from a fresh recovery phrase and a passphrase.
 * Returns the envelope to persist and the keyring to use immediately.
 */
export async function createKeyring(
  recoveryPhrase: string,
  passphrase: string,
): Promise<{ envelope: KeyEnvelope; keyring: Keyring }> {
  const seed = await phraseToSeed(recoveryPhrase);
  const rootSalt = randomBytes(32);
  const kdfSalt = randomBytes(16);
  let rootKey: Uint8Array | null = null;
  let kek: Uint8Array | null = null;
  let authSecret: Uint8Array | null = null;

  try {
    authSecret = await authSecretFromSeed(seed);
    const { accountId } = await identityFromSecret(authSecret);

    rootKey = await hkdf(seed, ROOT_INFO, 32, rootSalt);
    kek = await deriveKeyEncryptionKey(passphrase, kdfSalt, DEFAULT_KDF_PARAMS);
    const wrapKey = await importAesKey(kek);
    const wrapped = await seal(wrapKey, rootKey, envelopeAad(accountId));

    const envelope: KeyEnvelope = {
      version: 1,
      salt: toBase64Url(kdfSalt),
      kdf: DEFAULT_KDF_PARAMS,
      wrapped,
      verifier: await buildVerifier(accountId, rootKey, rootSalt),
      auth: await wrapAuthSecret(accountId, rootKey, rootSalt, authSecret),
      rootSalt: toBase64Url(rootSalt),
      createdAt: Date.now(),
    };

    return { envelope, keyring: await assembleKeyring(rootKey, rootSalt, authSecret) };
  } finally {
    wipe(seed, rootKey, kek, authSecret);
  }
}

/**
 * Unlocks an existing vault with the passphrase.
 *
 * `accountId` is what the device believes this vault belongs to. The auth
 * secret recovered from the envelope is checked against it, so a swapped or
 * misfiled envelope fails here rather than producing a session for one
 * account holding another account's keys.
 */
export async function unlockWithPassphrase(
  accountId: string,
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
  let authSecret: Uint8Array | null = null;

  try {
    kek = await deriveKeyEncryptionKey(passphrase, kdfSalt, envelope.kdf);
    const wrapKey = await importAesKey(kek);
    try {
      rootKey = await open(wrapKey, envelope.wrapped, envelopeAad(accountId));
      authSecret = await unwrapAuthSecret(accountId, envelope, rootKey, rootSalt);
    } catch {
      // GCM tag failure. Uniform message: never distinguish "wrong
      // passphrase" from "tampered blob" to whoever is watching.
      throw new IncorrectPassphraseError();
    }

    const keyring = await assembleKeyring(rootKey, rootSalt, authSecret);
    if (keyring.accountId !== accountId) throw new AccountMismatchError();
    return keyring;
  } finally {
    wipe(kek, rootKey, authSecret);
  }
}

/**
 * Unlocks using the recovery phrase, bypassing the passphrase entirely.
 * Used when a passphrase is forgotten or the vault is restored on a new
 * device — the phrase reconstructs both the root key and the identity.
 */
export async function unlockWithRecoveryPhrase(
  envelope: KeyEnvelope,
  recoveryPhrase: string,
): Promise<Keyring> {
  const seed = await phraseToSeed(recoveryPhrase);
  const rootSalt = fromBase64Url(envelope.rootSalt);
  let rootKey: Uint8Array | null = null;
  let authSecret: Uint8Array | null = null;

  try {
    authSecret = await authSecretFromSeed(seed);
    const { accountId } = await identityFromSecret(authSecret);

    rootKey = await hkdf(seed, ROOT_INFO, 32, rootSalt);
    await assertRootKeyMatches(accountId, envelope, rootKey, rootSalt);
    return await assembleKeyring(rootKey, rootSalt, authSecret);
  } finally {
    wipe(seed, rootKey, authSecret);
  }
}

/** Rebuilds a keyring from material recovered by a passkey. */
export async function keyringFromRootMaterial(material: RootMaterial): Promise<Keyring> {
  return assembleKeyring(material.rootKey, material.rootSalt, material.authSecret);
}

/**
 * Recovers the raw root material, for the one caller that needs it: sealing a
 * copy under a passkey. Requires the passphrase again rather than reusing the
 * unlocked session, so adding an authenticator is an explicit re-authorisation
 * and the root key spends no longer in memory than that one operation.
 */
export async function exportRootMaterial(
  accountId: string,
  envelope: KeyEnvelope,
  passphrase: string,
): Promise<RootMaterial> {
  assertAcceptableKdfParams(envelope.kdf);

  const kdfSalt = fromBase64Url(envelope.salt);
  const rootSalt = fromBase64Url(envelope.rootSalt);
  let kek: Uint8Array | null = null;

  try {
    kek = await deriveKeyEncryptionKey(passphrase, kdfSalt, envelope.kdf);
    const wrapKey = await importAesKey(kek);
    let rootKey: Uint8Array;
    try {
      rootKey = await open(wrapKey, envelope.wrapped, envelopeAad(accountId));
    } catch {
      throw new IncorrectPassphraseError();
    }
    const authSecret = await unwrapAuthSecret(accountId, envelope, rootKey, rootSalt);
    return { rootKey, authSecret, rootSalt };
  } finally {
    wipe(kek);
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
  envelope: KeyEnvelope,
  recoveryPhrase: string,
  newPassphrase: string,
): Promise<KeyEnvelope> {
  const seed = await phraseToSeed(recoveryPhrase);
  const rootSalt = fromBase64Url(envelope.rootSalt);
  const kdfSalt = randomBytes(16);
  let rootKey: Uint8Array | null = null;
  let kek: Uint8Array | null = null;
  let authSecret: Uint8Array | null = null;

  try {
    authSecret = await authSecretFromSeed(seed);
    const { accountId } = await identityFromSecret(authSecret);

    rootKey = await hkdf(seed, ROOT_INFO, 32, rootSalt);
    // Refuse to re-wrap around a key this vault was not built with.
    await assertRootKeyMatches(accountId, envelope, rootKey, rootSalt);

    kek = await deriveKeyEncryptionKey(newPassphrase, kdfSalt, DEFAULT_KDF_PARAMS);
    const wrapKey = await importAesKey(kek);
    const wrapped = await seal(wrapKey, rootKey, envelopeAad(accountId));

    return {
      version: 1,
      salt: toBase64Url(kdfSalt),
      kdf: DEFAULT_KDF_PARAMS,
      wrapped,
      // The root key is unchanged, so the existing verifier and wrapped auth
      // secret still apply.
      verifier: envelope.verifier,
      auth: envelope.auth,
      rootSalt: envelope.rootSalt,
      createdAt: envelope.createdAt,
    };
  } finally {
    wipe(seed, rootKey, kek, authSecret);
  }
}

export class IncorrectPassphraseError extends Error {
  constructor() {
    super("That passphrase does not unlock this vault.");
    this.name = "IncorrectPassphraseError";
  }
}

export class IncorrectRecoveryPhraseError extends Error {
  constructor() {
    super("That recovery phrase does not belong to this vault.");
    this.name = "IncorrectRecoveryPhraseError";
  }
}

export class AccountMismatchError extends Error {
  constructor() {
    super("This vault belongs to a different account.");
    this.name = "AccountMismatchError";
  }
}
