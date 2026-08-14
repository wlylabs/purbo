import "server-only";

/**
 * Session tokens.
 *
 * A token is minted only after the caller has proved control of an account's
 * Ed25519 key, and it says one thing: "this bearer is account X until time T".
 * It is an HMAC-SHA-256 tag over a tiny JSON payload — not a JWT, because the
 * one field of a JWT that matters here (the algorithm) is the one field an
 * attacker gets to choose, and there is nothing else in the format this needs.
 *
 * Stateless by design: no session table means no per-request storage read on
 * the hot path, and nothing about who is signed in for the storage layer to
 * leak. The cost is that a token cannot be revoked before it expires, which
 * is why they are short-lived and why the client re-signs a fresh challenge
 * rather than holding one for a day.
 */

import {
  constantTimeEqual,
  fromBase64Url,
  getCrypto,
  toArrayBuffer,
  toBase64Url,
  utf8Decode,
  utf8Encode,
} from "@/lib/crypto/primitives";
import { AuthConfigurationError, sessionSecret } from "./env";

/** One hour. Long enough to cover a working session, short enough to expire. */
export const SESSION_TTL_SECONDS = 60 * 60;

const PREFIX = "v1";

/** Bounds the parser's input: a real token is well under 200 bytes. */
export const MAX_TOKEN_LENGTH = 512;

interface TokenPayload {
  /** Account id — the only claim that decides which vault is reachable. */
  sub: string;
  /** Issued-at and expiry, in seconds. */
  iat: number;
  exp: number;
}

let cachedKey: { secret: string; key: CryptoKey } | null = null;

async function macKey(): Promise<CryptoKey> {
  const secret = sessionSecret();
  if (!secret) throw new AuthConfigurationError();
  if (cachedKey?.secret === secret) return cachedKey.key;

  const key = await getCrypto().subtle.importKey(
    "raw",
    toArrayBuffer(utf8Encode(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  cachedKey = { secret, key };
  return key;
}

async function tag(body: string): Promise<string> {
  const mac = await getCrypto().subtle.sign(
    "HMAC",
    await macKey(),
    toArrayBuffer(utf8Encode(body)),
  );
  return toBase64Url(new Uint8Array(mac));
}

export async function mintSessionToken(
  accountId: string,
  ttlSeconds = SESSION_TTL_SECONDS,
): Promise<{ token: string; expiresAt: number }> {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + ttlSeconds;
  const payload: TokenPayload = { sub: accountId, iat, exp };
  const body = `${PREFIX}.${toBase64Url(utf8Encode(JSON.stringify(payload)))}`;
  return { token: `${body}.${await tag(body)}`, expiresAt: exp * 1000 };
}

/**
 * Returns the account id a token authenticates, or null.
 *
 * Every failure — wrong format, bad signature, expired — returns null rather
 * than a reason. Whoever is probing tokens learns "no", and nothing else.
 */
export async function readSessionToken(token: string): Promise<string | null> {
  if (token.length > MAX_TOKEN_LENGTH) return null;

  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== PREFIX) return null;
  const [, encoded, signature] = parts as [string, string, string];

  const expected = await tag(`${PREFIX}.${encoded}`);
  // Compared as bytes in constant time: a byte-at-a-time string comparison
  // leaks the length of the matching prefix, which is enough to forge a tag.
  if (!constantTimeEqual(utf8Encode(expected), utf8Encode(signature))) return null;

  let payload: TokenPayload;
  try {
    payload = JSON.parse(utf8Decode(fromBase64Url(encoded))) as TokenPayload;
  } catch {
    return null;
  }

  if (typeof payload.sub !== "string" || payload.sub.length === 0) return null;
  if (typeof payload.exp !== "number") return null;
  if (payload.exp * 1000 <= Date.now()) return null;

  return payload.sub;
}
