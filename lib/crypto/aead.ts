/**
 * Authenticated encryption: AES-256-GCM.
 *
 * Every ciphertext produced here carries a random 96-bit IV and is bound to
 * an associated-data string. The AAD is what stops an attacker who controls
 * the storage layer from *moving* a valid ciphertext to a place it does not
 * belong — swapping one user's wrapped root key onto another user's record,
 * or replaying a v1 blob into a v2 slot. The bytes decrypt only in the
 * context they were sealed for.
 */

import {
  fromBase64Url,
  getCrypto,
  randomBytes,
  toArrayBuffer,
  toBase64Url,
  utf8Decode,
  utf8Encode,
} from "./primitives";

/** 96 bits — the GCM-native IV size, the only one without extra hashing. */
const IV_LENGTH = 12;
const TAG_LENGTH_BITS = 128;

/** A sealed payload, safe to hand to any untrusted storage. */
export interface SealedBox {
  /** Format version, so the envelope can evolve without ambiguity. */
  readonly v: 1;
  /** base64url IV. */
  readonly iv: string;
  /** base64url ciphertext with the GCM tag appended. */
  readonly ct: string;
}

/** Imports raw bytes as a non-extractable AES-GCM key. */
export async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  if (raw.length !== 32) throw new Error("AES-256-GCM requires a 32-byte key.");
  return getCrypto().subtle.importKey(
    "raw",
    toArrayBuffer(raw),
    { name: "AES-GCM", length: 256 },
    // extractable: false — once imported, the key cannot be read back out of
    // the CryptoKey handle, so a later XSS payload cannot exfiltrate it.
    false,
    ["encrypt", "decrypt"],
  );
}

export async function seal(
  key: CryptoKey,
  plaintext: Uint8Array,
  associatedData: string,
): Promise<SealedBox> {
  const iv = randomBytes(IV_LENGTH);
  const ct = await getCrypto().subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(utf8Encode(associatedData)),
      tagLength: TAG_LENGTH_BITS,
    },
    key,
    toArrayBuffer(plaintext),
  );
  return { v: 1, iv: toBase64Url(iv), ct: toBase64Url(new Uint8Array(ct)) };
}

/**
 * Opens a sealed box. Throws on any tag mismatch — a wrong passphrase, a
 * tampered ciphertext and a mismatched AAD are indistinguishable here, which
 * is exactly the property we want: the error leaks nothing about which.
 */
export async function open(
  key: CryptoKey,
  box: SealedBox,
  associatedData: string,
): Promise<Uint8Array> {
  if (box?.v !== 1) throw new Error("Unsupported ciphertext version.");
  const plaintext = await getCrypto().subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(fromBase64Url(box.iv)),
      additionalData: toArrayBuffer(utf8Encode(associatedData)),
      tagLength: TAG_LENGTH_BITS,
    },
    key,
    toArrayBuffer(fromBase64Url(box.ct)),
  );
  return new Uint8Array(plaintext);
}

export async function sealJson(
  key: CryptoKey,
  value: unknown,
  associatedData: string,
): Promise<SealedBox> {
  return seal(key, utf8Encode(JSON.stringify(value)), associatedData);
}

export async function openJson<T>(
  key: CryptoKey,
  box: SealedBox,
  associatedData: string,
): Promise<T> {
  return JSON.parse(utf8Decode(await open(key, box, associatedData))) as T;
}
