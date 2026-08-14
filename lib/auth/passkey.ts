"use client";

/**
 * Passkeys as a key-wrapping factor.
 *
 * This is deliberately *not* WebAuthn-as-login. The server never verifies an
 * assertion signature and stores no credential public key, because the
 * passkey is not what proves who you are — the Ed25519 key derived from your
 * recovery phrase is, and that check happens in `/api/auth/session` either
 * way. What the passkey provides is the WebAuthn PRF extension: a stable
 * 32-byte secret that only this authenticator can reproduce, and only after
 * the user has presented a biometric or device PIN.
 *
 * That secret wraps a copy of the root key and the auth secret. So:
 *
 *   biometric ─▶ authenticator PRF ─▶ HKDF ─▶ AES key ─▶ root key + auth secret
 *
 * Registering a passkey therefore adds a *third* path to the same root key,
 * alongside the passphrase and the phrase. It creates no new trust: the
 * sealed record is as opaque to the server as everything else it holds, and
 * an attacker who steals the record without the authenticator has 32 bytes of
 * noise.
 *
 * The credential id is the lookup handle for that record. It is unguessable
 * but not a secret, which is exactly why the record it points at is sealed.
 */

import { open, importAesKey, seal } from "@/lib/crypto/aead";
import { hkdf } from "@/lib/crypto/kdf";
import {
  fromBase64Url,
  randomBytes,
  sha256,
  toArrayBuffer,
  toBase64Url,
  utf8Decode,
  utf8Encode,
  wipe,
} from "@/lib/crypto/primitives";
import type { RootMaterial } from "@/lib/vault/keyring";
import type { PasskeyRecord, PasskeySummary } from "@/lib/vault/types";
import { getSessionToken } from "./session";

const RP_NAME = "Purbo";
const PRF_LABEL = "purbo:prf:v1";
const WRAP_INFO = "purbo:passkey:v1";

export class PasskeyUnsupportedError extends Error {
  constructor(message = "This device cannot store a Purbo passkey.") {
    super(message);
    this.name = "PasskeyUnsupportedError";
  }
}

export class PasskeyCancelledError extends Error {
  constructor() {
    super("Passkey prompt was dismissed.");
    this.name = "PasskeyCancelledError";
  }
}

export class NoPasskeyRecordError extends Error {
  constructor() {
    super("That passkey is not registered with any vault here.");
    this.name = "NoPasskeyRecordError";
  }
}

/**
 * Whether WebAuthn exists at all here.
 *
 * Deliberately not `isUserVerifyingPlatformAuthenticatorAvailable` — that
 * answers "does this machine have Touch ID", which would hide the passkey
 * option from a desktop whose passkey lives on a phone or a security key.
 * Whether PRF in particular is supported is only knowable by trying, which is
 * why registration checks the extension result rather than asking first.
 */
export function isPasskeySupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential === "function" &&
    typeof navigator.credentials?.create === "function"
  );
}

/**
 * The PRF input, fixed for the whole app.
 *
 * It has to be identical at registration and at unlock — a different salt
 * gives a different secret, and the wrapped root key would simply stop
 * opening. Hashed rather than used raw so the input is a full 32 bytes.
 */
async function prfSalt(): Promise<Uint8Array> {
  return sha256(utf8Encode(PRF_LABEL));
}

function prfResult(credential: PublicKeyCredential): Uint8Array | null {
  const results = credential.getClientExtensionResults() as {
    prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } };
  };
  const first = results.prf?.results?.first;
  return first ? new Uint8Array(first) : null;
}

/** Derives the AES key the record is sealed under. Wipes the PRF output. */
async function wrapKeyFromPrf(prf: Uint8Array): Promise<CryptoKey> {
  const bytes = await hkdf(prf, WRAP_INFO, 32);
  try {
    return await importAesKey(bytes);
  } finally {
    wipe(bytes, prf);
  }
}

function recordAad(accountId: string, credentialId: string): string {
  return `purbo:passkey:v1:${accountId}:${credentialId}`;
}

/** What the sealed half of a passkey record contains. */
interface SealedMaterial {
  root: string;
  auth: string;
}

function isCancellation(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "NotAllowedError" || error.name === "AbortError")
  );
}

/**
 * Creates a passkey and seals the root material under its PRF secret.
 *
 * `material` is the caller's to wipe — this function reads it and does not
 * take ownership.
 */
export async function registerPasskey(
  accountId: string,
  material: RootMaterial,
): Promise<void> {
  if (!isPasskeySupported()) throw new PasskeyUnsupportedError();

  const salt = await prfSalt();
  let credential: PublicKeyCredential;

  try {
    credential = (await navigator.credentials.create({
      publicKey: {
        rp: { id: window.location.hostname, name: RP_NAME },
        user: {
          // No email, no username — there is no such thing here. The account
          // id is already a hash, and it is all the authenticator needs to
          // label the credential.
          id: toArrayBuffer(fromHex(accountId)),
          name: `purbo-${accountId.slice(0, 8)}`,
          displayName: "Purbo vault",
        },
        challenge: toArrayBuffer(randomBytes(32)),
        // Ed25519, ES256, RS256 — the algorithm is irrelevant to us since no
        // assertion is ever verified, but the field is required.
        pubKeyCredParams: [
          { type: "public-key", alg: -8 },
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: {
          // Discoverable, so a fresh device can offer the passkey without
          // being told which account to look for.
          residentKey: "required",
          requireResidentKey: true,
          userVerification: "required",
        },
        extensions: { prf: { eval: { first: toArrayBuffer(salt) } } },
      },
    })) as PublicKeyCredential;
  } catch (error) {
    if (isCancellation(error)) throw new PasskeyCancelledError();
    throw new PasskeyUnsupportedError();
  }

  const extensions = credential.getClientExtensionResults() as {
    prf?: { enabled?: boolean };
  };
  if (extensions.prf?.enabled === false) {
    throw new PasskeyUnsupportedError(
      "This authenticator cannot derive an encryption key (no PRF support), so it " +
        "cannot unlock a Purbo vault. The passkey it just created is unused — delete " +
        "it in your password manager.",
    );
  }

  const credentialId = toBase64Url(new Uint8Array(credential.rawId));

  // Some platforms return the PRF output straight from creation; others only
  // produce it on a subsequent assertion. Ask once more when it is missing.
  const prf =
    prfResult(credential) ?? (await assertPrf(salt, [credential.rawId])).prf;

  const wrapKey = await wrapKeyFromPrf(prf);
  const sealed = await seal(
    wrapKey,
    utf8Encode(
      JSON.stringify({
        root: toBase64Url(material.rootKey),
        auth: toBase64Url(material.authSecret),
      } satisfies SealedMaterial),
    ),
    recordAad(accountId, credentialId),
  );

  const response = await fetch("/api/auth/passkey", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${await getSessionToken()}`,
    },
    body: JSON.stringify({
      credentialId,
      rootSalt: toBase64Url(material.rootSalt),
      sealed,
    }),
    cache: "no-store",
    credentials: "omit",
  });

  if (!response.ok) {
    throw new Error(
      response.status === 409
        ? "This account already has the maximum number of passkeys."
        : `Could not save the passkey (${response.status}).`,
    );
  }
}

async function assertPrf(
  salt: Uint8Array,
  allow: ArrayBuffer[] = [],
): Promise<{ credentialId: string; prf: Uint8Array }> {
  let assertion: PublicKeyCredential;
  try {
    assertion = (await navigator.credentials.get({
      publicKey: {
        challenge: toArrayBuffer(randomBytes(32)),
        rpId: window.location.hostname,
        userVerification: "required",
        allowCredentials: allow.map((id) => ({ type: "public-key" as const, id })),
        extensions: { prf: { eval: { first: toArrayBuffer(salt) } } },
      },
    })) as PublicKeyCredential;
  } catch (error) {
    if (isCancellation(error)) throw new PasskeyCancelledError();
    throw new PasskeyUnsupportedError();
  }

  const prf = prfResult(assertion);
  if (!prf) {
    throw new PasskeyUnsupportedError(
      "This authenticator did not return an encryption key, so it cannot unlock the vault.",
    );
  }

  return { credentialId: toBase64Url(new Uint8Array(assertion.rawId)), prf };
}

/**
 * Opens the vault with a passkey: one biometric prompt, no phrase, no
 * passphrase. Returns the account and the root material to build a keyring
 * from — the caller owns and must wipe it.
 */
export async function unlockWithPasskey(): Promise<{
  accountId: string;
  material: RootMaterial;
}> {
  if (!isPasskeySupported()) throw new PasskeyUnsupportedError();

  const salt = await prfSalt();
  const { credentialId, prf } = await assertPrf(salt);

  const response = await fetch("/api/auth/passkey/lookup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ credentialId }),
    cache: "no-store",
    credentials: "omit",
  });

  if (response.status === 404) {
    wipe(prf);
    throw new NoPasskeyRecordError();
  }
  if (!response.ok) {
    wipe(prf);
    throw new Error(`Could not load the passkey record (${response.status}).`);
  }

  const { record } = (await response.json()) as { record: PasskeyRecord };
  const wrapKey = await wrapKeyFromPrf(prf);

  let material: SealedMaterial;
  try {
    material = JSON.parse(
      utf8Decode(await open(wrapKey, record.sealed, recordAad(record.accountId, credentialId))),
    ) as SealedMaterial;
  } catch {
    // A tag failure here means the record was tampered with or belongs to a
    // different credential. Either way it is not openable, and saying which
    // would be telling an attacker how far they got.
    throw new NoPasskeyRecordError();
  }

  return {
    accountId: record.accountId,
    material: {
      rootKey: fromBase64Url(material.root),
      authSecret: fromBase64Url(material.auth),
      rootSalt: fromBase64Url(record.rootSalt),
    },
  };
}

/** The passkeys registered to the signed-in account. */
export async function listPasskeys(): Promise<PasskeySummary[]> {
  const response = await fetch("/api/auth/passkey", {
    headers: { authorization: `Bearer ${await getSessionToken()}` },
    cache: "no-store",
    credentials: "omit",
  });
  if (!response.ok) return [];
  const body = (await response.json()) as { passkeys: PasskeySummary[] };
  return body.passkeys;
}

/** Revokes every passkey on the account. */
export async function removeAllPasskeys(): Promise<void> {
  const response = await fetch("/api/auth/passkey", {
    method: "DELETE",
    headers: { authorization: `Bearer ${await getSessionToken()}` },
    cache: "no-store",
    credentials: "omit",
  });
  if (!response.ok) throw new Error(`Could not remove passkeys (${response.status}).`);
}

function fromHex(value: string): Uint8Array {
  const out = new Uint8Array(value.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
