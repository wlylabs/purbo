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
   * HKDF salt for root -> data-key expansion. Public by design; HKDF salts
   * are not secrets, they just separate derivations.
   */
  readonly rootSalt: string;
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
