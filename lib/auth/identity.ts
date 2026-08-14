/**
 * Account identity, derived from the recovery phrase.
 *
 * Purbo has no identity provider. The 24-word phrase that roots the vault's
 * encryption also roots its identity: one HKDF branch produces an Ed25519
 * signing key, and the account id is a hash of the matching public key.
 *
 *   BIP39 seed ──HKDF "purbo:auth:v1"──▶ 32-byte Ed25519 secret
 *                                            │
 *                                            ├──▶ public key ──SHA-256──▶ accountId
 *                                            └──▶ signs the server's challenge
 *
 * The point of anchoring both here is that they cannot drift apart. With an
 * external provider, "signed in" and "can decrypt" are independent facts, so
 * a user who lost their phrase could still log in successfully and find a
 * vault they cannot open. Here, holding the key that authenticates is the
 * same as holding the key that decrypts.
 *
 * The server only ever sees the public key and a signature over a nonce it
 * issued. It cannot sign on a user's behalf, and it holds nothing that could
 * be replayed against another deployment.
 */

import { ed25519 } from "@noble/curves/ed25519.js";

import { hkdf } from "@/lib/crypto/kdf";
import { phraseToSeed } from "@/lib/crypto/mnemonic";
import { sha256, toHex, utf8Encode, wipe } from "@/lib/crypto/primitives";

/**
 * Domain separator for the auth branch.
 *
 * Deliberately salt-free (HKDF's default zero salt) rather than salted with
 * the envelope's `rootSalt`: the account id has to be computable from the
 * phrase *alone*, before any envelope has been fetched. A fresh device
 * restoring from the phrase must be able to authenticate in order to fetch
 * the envelope in the first place.
 */
const AUTH_INFO = "purbo:auth:v1";

/** Prefix hashed with the public key so ids are specific to this use. */
const ACCOUNT_INFO = "purbo:account:v1";

/** Bytes of the account id. 128 bits of a SHA-256 digest — no collisions to worry about. */
const ACCOUNT_ID_BYTES = 16;

export const AUTH_SECRET_BYTES = 32;
export const AUTH_PUBLIC_KEY_BYTES = 32;
export const AUTH_SIGNATURE_BYTES = 64;

/**
 * A live identity. `secret` is key material: it lives in memory for the
 * duration of an unlocked session and is never persisted in the clear.
 */
export interface AuthIdentity {
  readonly accountId: string;
  readonly publicKey: Uint8Array;
  readonly secret: Uint8Array;
}

/** HKDF branch: BIP39 seed -> Ed25519 secret. */
export async function authSecretFromSeed(seed: Uint8Array): Promise<Uint8Array> {
  return hkdf(seed, AUTH_INFO, AUTH_SECRET_BYTES);
}

/** The public, non-reversible account id for a public key. */
export async function accountIdFor(publicKey: Uint8Array): Promise<string> {
  const digest = await sha256(
    new Uint8Array([...utf8Encode(`${ACCOUNT_INFO}:`), ...publicKey]),
  );
  return toHex(digest.slice(0, ACCOUNT_ID_BYTES));
}

/** Completes an identity from its 32-byte secret. */
export async function identityFromSecret(secret: Uint8Array): Promise<AuthIdentity> {
  if (secret.length !== AUTH_SECRET_BYTES) {
    throw new Error("An auth secret must be exactly 32 bytes.");
  }
  const publicKey = ed25519.getPublicKey(secret);
  return { accountId: await accountIdFor(publicKey), publicKey, secret };
}

/**
 * The full derivation, from words to identity.
 * The intermediate seed is wiped; the returned secret is the caller's to hold.
 */
export async function identityFromRecoveryPhrase(phrase: string): Promise<AuthIdentity> {
  const seed = await phraseToSeed(phrase);
  let secret: Uint8Array | null = null;
  try {
    secret = await authSecretFromSeed(seed);
    return await identityFromSecret(secret);
  } finally {
    wipe(seed);
  }
}

/**
 * The exact bytes signed during login.
 *
 * Every field the signature is meant to commit to is in here explicitly:
 * a version tag, the origin (so a signature harvested by one deployment is
 * useless against another), the server's nonce (replay), and the public key
 * being claimed. Newlines separate fields that cannot themselves contain
 * newlines, so no two distinct inputs can produce the same message.
 */
export function challengeMessage(
  origin: string,
  nonce: string,
  publicKeyBase64Url: string,
): Uint8Array {
  return utf8Encode(
    ["purbo-auth-v1", origin, nonce, publicKeyBase64Url].join("\n"),
  );
}

export function signChallenge(secret: Uint8Array, message: Uint8Array): Uint8Array {
  return ed25519.sign(message, secret);
}

/** Verifies a challenge signature. Returns false rather than throwing on malformed input. */
export function verifyChallenge(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  if (
    signature.length !== AUTH_SIGNATURE_BYTES ||
    publicKey.length !== AUTH_PUBLIC_KEY_BYTES
  ) {
    return false;
  }
  try {
    return ed25519.verify(signature, message, publicKey);
  } catch {
    // Malformed points and non-canonical scalars land here. They are simply
    // "not a valid signature", and must not be distinguishable from one.
    return false;
  }
}
