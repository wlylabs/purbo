import type { SealedBox } from "@/lib/crypto/aead";
import type { KdfParams } from "@/lib/crypto/kdf";

/** A decrypted vault entry. Exists only in memory, only while unlocked. */
export interface VaultItem {
  id: string;
  /** Display name — "GitHub", "Bank BCA". */
  name: string;
  username: string;
  password: string;
  url?: string;
  notes?: string;
  favourite?: boolean;
  createdAt: number;
  updatedAt: number;
}

/** The fields the user actually fills in. */
export type VaultItemDraft = Omit<VaultItem, "id" | "createdAt" | "updatedAt">;

/**
 * An item as it exists at rest and in transit.
 *
 * Note what is *not* here: no name, no username, no URL. Every field of the
 * entry lives inside `payload`. The server can count a user's entries and see
 * when they changed, and that is the whole of its knowledge.
 */
export interface EncryptedItem {
  id: string;
  payload: SealedBox;
  updatedAt: number;
}

/**
 * The wrapped root key plus the public parameters needed to unwrap it.
 *
 * `wrapped` is the vault root key sealed under a key derived from the user's
 * passphrase. Everything in this record is safe to store on an untrusted
 * server: without the passphrase it is 32 bytes of noise behind Argon2id.
 */
export interface KeyEnvelope {
  readonly version: 1;
  /** base64url Argon2id salt (16 bytes). */
  readonly salt: string;
  readonly kdf: KdfParams;
  readonly wrapped: SealedBox;
  /**
   * A known constant sealed under a key derived from the root key.
   *
   * This is what lets the recovery path tell "the right phrase" from "a
   * different phrase that happens to have a valid checksum". Without it,
   * recovery would accept any well-formed phrase and silently re-wrap the
   * vault around the wrong key. It reveals nothing: it is a ciphertext under
   * a key that an attacker would already need the root key to derive.
   */
  readonly verifier: SealedBox;
  /**
   * The account's Ed25519 signing secret, sealed under a subkey of the root
   * key.
   *
   * It is the same secret the recovery phrase derives directly. Storing a
   * wrapped copy is what lets the passphrase path reach it: a device unlocking
   * with the passphrase never sees the BIP39 seed, but still has to be able
   * to authenticate in order to sync.
   */
  readonly auth: SealedBox;
  /**
   * HKDF salt for root -> data-key expansion. Public by design; HKDF salts
   * are not secrets, they just separate derivations.
   */
  readonly rootSalt: string;
  readonly createdAt: number;
}

/**
 * What a passkey stores on the server so a device holding neither the phrase
 * nor the passphrase can still open the vault.
 *
 * `sealed` holds the root key and the auth secret, encrypted under a key that
 * only the authenticator can reproduce (WebAuthn's PRF extension, gated
 * behind the user's biometric or device PIN). The server hands this record to
 * anyone presenting the credential id — which is why the contents are sealed:
 * the credential id is a lookup handle, never the secret.
 */
export interface PasskeyRecord {
  readonly version: 1;
  readonly accountId: string;
  readonly rootSalt: string;
  readonly sealed: SealedBox;
  readonly createdAt: number;
}

/** Server-side listing of the passkeys registered to an account. */
export interface PasskeySummary {
  /** Hash of the credential id — the record's storage key, not the id itself. */
  readonly hash: string;
  readonly createdAt: number;
}

/** The complete server-side record for one user. All opaque. */
export interface EncryptedVault {
  envelope: KeyEnvelope;
  items: EncryptedItem[];
  /** Monotonic counter for conflict detection on sync. */
  revision: number;
  updatedAt: number;
}

export type VaultStatus =
  | "loading"
  /** Authenticated, but no vault exists yet — needs onboarding. */
  | "absent"
  /** A vault exists and is sealed; needs the passphrase. */
  | "locked"
  | "unlocked";
