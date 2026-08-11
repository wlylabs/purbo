/**
 * BIP39 recovery phrase — the "wallet" half of the wallet metaphor.
 *
 * The phrase is the sole root of the vault. It is generated in the browser,
 * shown once, and never transmitted. Losing it and forgetting the passphrase
 * means the vault is unrecoverable; that is the intended trade-off of a
 * zero-knowledge design, not a gap in it.
 */

import {
  generateMnemonic,
  mnemonicToSeed,
  validateMnemonic,
} from "@scure/bip39";
// @scure/bip39 v2 exports wordlists with an explicit .js path.
import { wordlist } from "@scure/bip39/wordlists/english.js";

/** 256 bits of entropy -> 24 words. */
const ENTROPY_BITS = 256;

export const RECOVERY_PHRASE_WORDS = 24;

/** Generates a fresh 24-word recovery phrase using WebCrypto entropy. */
export function createRecoveryPhrase(): string {
  return generateMnemonic(wordlist, ENTROPY_BITS);
}

/** Normalises user input: collapse whitespace, lowercase, NFKD per BIP39. */
export function normalisePhrase(input: string): string {
  return input.normalize("NFKD").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Checksum-validates a phrase against the English wordlist. */
export function isValidRecoveryPhrase(phrase: string): boolean {
  try {
    return validateMnemonic(normalisePhrase(phrase), wordlist);
  } catch {
    return false;
  }
}

/**
 * BIP39 seed (PBKDF2-HMAC-SHA512, 2048 rounds) — 64 bytes.
 * This feeds HKDF in `lib/vault/keyring`, never a cipher directly.
 */
export async function phraseToSeed(phrase: string): Promise<Uint8Array> {
  const normalised = normalisePhrase(phrase);
  if (!isValidRecoveryPhrase(normalised)) {
    throw new Error("Recovery phrase failed checksum validation.");
  }
  return mnemonicToSeed(normalised);
}

/** The English BIP39 wordlist, for autocomplete during phrase entry. */
export const BIP39_WORDLIST: readonly string[] = wordlist;
