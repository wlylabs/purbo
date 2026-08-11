/**
 * Key derivation.
 *
 * Two distinct jobs, two distinct functions:
 *
 *  - `deriveKeyEncryptionKey` turns a human passphrase into a 256-bit key.
 *    Humans pick low-entropy secrets, so this must be *slow and memory-hard*:
 *    Argon2id, the PHC winner, with parameters that cost a GPU/ASIC attacker
 *    real memory bandwidth per guess.
 *
 *  - `hkdf` turns an already-high-entropy secret (the vault root key, a BIP39
 *    seed) into subkeys. The input is already unguessable, so this must be
 *    *fast*: HKDF-SHA-256 with domain-separating `info` labels.
 *
 * Using HKDF where Argon2id belongs would make passphrase cracking trivial;
 * using Argon2id where HKDF belongs would just waste 64 MiB for nothing.
 */

import { argon2id } from "hash-wasm";

import { getCrypto, toArrayBuffer, utf8Encode } from "./primitives";

/** Argon2id cost parameters, versioned so stored vaults can be upgraded. */
export interface KdfParams {
  readonly algorithm: "argon2id";
  /** Memory cost in KiB. */
  readonly memoryKiB: number;
  /** Time cost (passes). */
  readonly iterations: number;
  /** Lanes / degree of parallelism. */
  readonly parallelism: number;
}

/**
 * Defaults: 64 MiB, 3 passes, 1 lane.
 *
 * Comfortably above the OWASP minimum (19 MiB / 2 passes) and roughly the
 * cost profile Bitwarden and 1Password ship. Runs in well under a second on
 * a mid-range phone but forces an attacker to commit 64 MiB per parallel
 * guess, which is what collapses large-scale GPU cracking.
 */
export const DEFAULT_KDF_PARAMS: KdfParams = Object.freeze({
  algorithm: "argon2id",
  memoryKiB: 64 * 1024,
  iterations: 3,
  parallelism: 1,
});

const MIN_KDF_PARAMS = { memoryKiB: 19 * 1024, iterations: 2, parallelism: 1 };

/**
 * Rejects params weaker than the OWASP floor.
 *
 * Cost parameters travel with the ciphertext, so a server that has been
 * compromised could otherwise hand back `iterations: 1, memoryKiB: 8` and
 * silently downgrade every unlock to something brute-forceable. Validating
 * on the client is what makes that attack fail closed.
 */
export function assertAcceptableKdfParams(params: KdfParams): void {
  if (params.algorithm !== "argon2id") {
    throw new Error(`Unsupported KDF algorithm: ${String(params.algorithm)}`);
  }
  if (
    !Number.isInteger(params.memoryKiB) ||
    !Number.isInteger(params.iterations) ||
    !Number.isInteger(params.parallelism) ||
    params.memoryKiB < MIN_KDF_PARAMS.memoryKiB ||
    params.iterations < MIN_KDF_PARAMS.iterations ||
    params.parallelism < MIN_KDF_PARAMS.parallelism ||
    // Upper bounds stop a hostile blob from wedging the tab with a 4 GiB alloc.
    params.memoryKiB > 1024 * 1024 ||
    params.iterations > 32 ||
    params.parallelism > 16
  ) {
    throw new Error("Vault KDF parameters are below the minimum security floor.");
  }
}

/**
 * Argon2id over a passphrase. Returns raw 32 bytes.
 *
 * The passphrase is normalised to NFKC so a key derived from a passphrase
 * typed on iOS matches one typed on Linux.
 */
export async function deriveKeyEncryptionKey(
  passphrase: string,
  salt: Uint8Array,
  params: KdfParams = DEFAULT_KDF_PARAMS,
): Promise<Uint8Array> {
  assertAcceptableKdfParams(params);
  if (salt.length < 16) throw new Error("KDF salt must be at least 128 bits.");

  const hash = await argon2id({
    password: utf8Encode(passphrase.normalize("NFKC")),
    salt,
    memorySize: params.memoryKiB,
    iterations: params.iterations,
    parallelism: params.parallelism,
    hashLength: 32,
    outputType: "binary",
  });
  return new Uint8Array(hash);
}

/**
 * HKDF-SHA-256 expansion of a high-entropy secret into a labelled subkey.
 *
 * `info` is the domain separator: two subkeys derived from the same root with
 * different labels are computationally unrelated, so leaking one does not
 * compromise the other.
 */
export async function hkdf(
  ikm: Uint8Array,
  info: string,
  length = 32,
  salt: Uint8Array = new Uint8Array(32),
): Promise<Uint8Array> {
  const subtle = getCrypto().subtle;
  const baseKey = await subtle.importKey("raw", toArrayBuffer(ikm), "HKDF", false, [
    "deriveBits",
  ]);
  const bits = await subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: toArrayBuffer(salt),
      info: toArrayBuffer(utf8Encode(info)),
    },
    baseKey,
    length * 8,
  );
  return new Uint8Array(bits);
}
