/**
 * Low-level crypto primitives.
 *
 * Everything here is browser-side and depends only on the WebCrypto API.
 * No key material is ever serialised through these helpers except as
 * ciphertext produced by `lib/crypto/aead`.
 */

/** Returns the platform WebCrypto implementation, or throws on insecure contexts. */
export function getCrypto(): Crypto {
  const c = globalThis.crypto;
  if (!c || !c.subtle) {
    throw new Error(
      "WebCrypto is unavailable. Purbo requires a secure context (HTTPS or localhost).",
    );
  }
  return c;
}

/** Cryptographically secure random bytes. */
export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  getCrypto().getRandomValues(out);
  return out;
}

/**
 * Uniform random integer in [0, max) without modulo bias.
 * Rejection sampling over the largest multiple of `max` that fits the draw.
 */
export function randomInt(max: number): number {
  if (!Number.isInteger(max) || max <= 0 || max > 0xffffffff) {
    throw new RangeError("randomInt: max must be an integer in (0, 2^32]");
  }
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  const c = getCrypto();
  let draw = 0;
  do {
    c.getRandomValues(buf);
    draw = buf[0]!;
  } while (draw >= limit);
  return draw % max;
}

/** Fisher–Yates shuffle driven by `randomInt`. Mutates and returns `items`. */
export function secureShuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const a = items[i]!;
    const b = items[j]!;
    items[i] = b;
    items[j] = a;
  }
  return items;
}

/**
 * Best-effort zeroisation of a byte buffer.
 *
 * JS gives no guarantee the allocation is not copied by the GC, but wiping
 * still shortens the window in which key material sits in a live heap and
 * removes it from any subsequent heap snapshot.
 */
export function wipe(...buffers: (Uint8Array | null | undefined)[]): void {
  for (const buf of buffers) {
    if (buf && buf.byteLength > 0) buf.fill(0);
  }
}

/** Length-independent equality is impossible; lengths are treated as public. */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

export function utf8Encode(value: string): Uint8Array {
  return TEXT_ENCODER.encode(value);
}

export function utf8Decode(bytes: Uint8Array): string {
  return TEXT_DECODER.decode(bytes);
}

/** base64url without padding — safe for JSON transport and URLs. */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(value: string): Uint8Array {
  const normalised = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalised.padEnd(Math.ceil(normalised.length / 4) * 4, "=");
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i]!.toString(16).padStart(2, "0");
  return out;
}

/** Concatenates buffers into a fresh allocation. */
export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * `Uint8Array` -> `ArrayBuffer` view accepted by WebCrypto.
 * Avoids passing a `SharedArrayBuffer`-backed view, which subtle rejects.
 */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

/** SHA-256 digest. */
export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const digest = await getCrypto().subtle.digest("SHA-256", toArrayBuffer(data));
  return new Uint8Array(digest);
}
