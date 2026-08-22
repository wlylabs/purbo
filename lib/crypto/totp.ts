/**
 * Time-based one-time passwords (RFC 6238).
 *
 * The second factor lives in the same ciphertext as the password it belongs
 * to. That is a real trade-off and worth stating: a vault that holds both
 * factors is one thing to steal rather than two. What it buys is that the
 * factor is *used* — a code the user can reach in the place they are already
 * typing the password is a code they will turn on, and an account with a
 * shared vault-bound TOTP is still far ahead of one with no second factor at
 * all. The secret is never at rest outside the entry's AES-GCM box and never
 * reaches the server in any other form.
 *
 * Codes are computed here, in the browser, from WebCrypto's HMAC. Nothing is
 * fetched, and there is no clock but the device's own.
 */

import { getCrypto, toArrayBuffer } from "./primitives";

export type TotpAlgorithm = "SHA-1" | "SHA-256" | "SHA-512";

export interface TotpConfig {
  /** Decoded shared secret. */
  readonly secret: Uint8Array;
  readonly digits: number;
  /** Step length in seconds. */
  readonly period: number;
  readonly algorithm: TotpAlgorithm;
  /** From an otpauth URI, for display only. */
  readonly issuer?: string;
  readonly label?: string;
}

export class InvalidTotpError extends Error {
  constructor(message = "That is not a recognisable authenticator secret.") {
    super(message);
    this.name = "InvalidTotpError";
  }
}

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

const DEFAULT_DIGITS = 6;
const DEFAULT_PERIOD = 30;
const DEFAULT_ALGORITHM: TotpAlgorithm = "SHA-1";

/**
 * RFC 4648 base32, as authenticator secrets are actually written.
 *
 * Padding is optional and the spaces every issuer sprinkles through a
 * hand-copyable secret are ignored — refusing "JBSW Y3DP" because of the gap
 * a QR-code fallback screen put there would fail the exact case this is for.
 */
export function base32Decode(value: string): Uint8Array {
  const cleaned = value.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  if (cleaned.length === 0) throw new InvalidTotpError();

  const out: number[] = [];
  let buffer = 0;
  let bits = 0;

  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) throw new InvalidTotpError();
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }

  // A trailing group of leftover bits is padding and must be zero; anything
  // else means the string was truncated mid-character.
  if (bits >= 5 || (buffer & ((1 << bits) - 1)) !== 0) throw new InvalidTotpError();
  if (out.length === 0) throw new InvalidTotpError();

  return Uint8Array.from(out);
}

function parseAlgorithm(value: string | null): TotpAlgorithm {
  if (!value) return DEFAULT_ALGORITHM;
  const normalised = value.toUpperCase().replace("-", "");
  if (normalised === "SHA1") return "SHA-1";
  if (normalised === "SHA256") return "SHA-256";
  if (normalised === "SHA512") return "SHA-512";
  throw new InvalidTotpError(`Unsupported algorithm: ${value}.`);
}

function parseBounded(value: string | null, fallback: number, min: number, max: number): number {
  if (value === null || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new InvalidTotpError();
  }
  return parsed;
}

/**
 * Accepts what people actually have in front of them.
 *
 * Either the bare base32 secret an issuer prints under its QR code, or the
 * whole `otpauth://totp/...` URI a QR scanner yields. Anything else — an
 * `otpauth://hotp/` counter-based URI in particular — is refused rather than
 * quietly treated as time-based, because a counter code that does not work is
 * worse than one that was never accepted.
 */
export function parseTotpInput(input: string): TotpConfig {
  const trimmed = input.trim();
  if (!trimmed) throw new InvalidTotpError();

  if (!/^otpauth:\/\//i.test(trimmed)) {
    return {
      secret: base32Decode(trimmed),
      digits: DEFAULT_DIGITS,
      period: DEFAULT_PERIOD,
      algorithm: DEFAULT_ALGORITHM,
    };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new InvalidTotpError();
  }

  if (url.host.toLowerCase() !== "totp") {
    throw new InvalidTotpError("Only time-based (TOTP) codes are supported.");
  }

  const params = url.searchParams;
  const secret = params.get("secret");
  if (!secret) throw new InvalidTotpError();

  const label = decodeURIComponent(url.pathname.replace(/^\//, "")) || undefined;
  const issuer = params.get("issuer") ?? label?.split(":")[0]?.trim() ?? undefined;

  return {
    secret: base32Decode(secret),
    digits: parseBounded(params.get("digits"), DEFAULT_DIGITS, 6, 10),
    period: parseBounded(params.get("period"), DEFAULT_PERIOD, 5, 300),
    algorithm: parseAlgorithm(params.get("algorithm")),
    issuer: issuer || undefined,
    label,
  };
}

/** Whether a stored value would produce codes, without producing any. */
export function isValidTotpInput(input: string): boolean {
  try {
    parseTotpInput(input);
    return true;
  } catch {
    return false;
  }
}

/** The RFC 6238 counter: elapsed periods since the Unix epoch, big-endian. */
function counterBytes(counter: number): Uint8Array {
  const out = new Uint8Array(8);
  // Two 32-bit halves rather than BigInt: the value fits comfortably in a
  // double for any date this code will see, and the halves are exact.
  const high = Math.floor(counter / 0x100000000);
  const low = counter >>> 0;
  new DataView(out.buffer).setUint32(0, high);
  new DataView(out.buffer).setUint32(4, low);
  return out;
}

/** The code for a given moment. `atMs` exists so tests can pin the clock. */
export async function generateTotpCode(
  config: TotpConfig,
  atMs: number = Date.now(),
): Promise<string> {
  const counter = Math.floor(atMs / 1000 / config.period);
  const key = await getCrypto().subtle.importKey(
    "raw",
    toArrayBuffer(config.secret),
    { name: "HMAC", hash: config.algorithm },
    false,
    ["sign"],
  );

  const mac = new Uint8Array(
    await getCrypto().subtle.sign("HMAC", key, toArrayBuffer(counterBytes(counter))),
  );

  // Dynamic truncation, RFC 4226 §5.3.
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary =
    ((mac[offset]! & 0x7f) << 24) |
    (mac[offset + 1]! << 16) |
    (mac[offset + 2]! << 8) |
    mac[offset + 3]!;

  return String(binary % 10 ** config.digits).padStart(config.digits, "0");
}

/** Seconds until the current code is replaced. */
export function secondsRemaining(config: TotpConfig, atMs: number = Date.now()): number {
  const seconds = Math.floor(atMs / 1000);
  return config.period - (seconds % config.period);
}

/**
 * Groups a code for reading aloud — "482 913" rather than "482913".
 *
 * A one-time code is read off one screen and typed into another, which is the
 * one job digits grouped in threes are measurably better at.
 */
export function formatTotpCode(code: string): string {
  if (code.length === 6) return `${code.slice(0, 3)} ${code.slice(3)}`;
  if (code.length === 8) return `${code.slice(0, 4)} ${code.slice(4)}`;
  return code;
}
