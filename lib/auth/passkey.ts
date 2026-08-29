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

import { credentialHash } from "@/lib/auth/credential";
import { open, importAesKey, seal, sealJson, openJson, type SealedBox } from "@/lib/crypto/aead";
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

/**
 * AAD for a device name.
 *
 * Bound to the passkey it names rather than only to the account, so a label
 * cannot be moved from one row to another — the name of the phone you are
 * about to revoke has to be the name of the phone you are about to revoke.
 */
function labelAad(accountId: string, hash: string): string {
  return `purbo:passkey-label:v1:${accountId}:${hash}`;
}

/** A device name, sealed for storage beside its record. */
export async function sealPasskeyLabel(
  dataKey: CryptoKey,
  accountId: string,
  hash: string,
  label: string,
): Promise<SealedBox> {
  return sealJson(dataKey, label, labelAad(accountId, hash));
}

/**
 * Reads a device name back, or null.
 *
 * Null is an ordinary answer, not an error: a passkey registered before names
 * existed simply has none, and a row whose label will not open is a row the
 * user should still be able to see and revoke.
 */
export async function openPasskeyLabel(
  dataKey: CryptoKey,
  accountId: string,
  summary: PasskeySummary,
): Promise<string | null> {
  if (!summary.label) return null;
  try {
    const label = await openJson<string>(
      dataKey,
      summary.label,
      labelAad(accountId, summary.hash),
    );
    return typeof label === "string" && label.length > 0 ? label : null;
  } catch {
    return null;
  }
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
 * Whether a WebAuthn prompt is currently up.
 *
 * On Android and on some desktop configurations the authenticator's sheet is
 * a separate window, and the page behind it goes `hidden` while it is open.
 * Anything that reacts to the page being hidden — locking, in particular —
 * has to know the difference between "the user switched away" and "the user
 * is looking at the prompt we asked for", or asking for a passkey becomes a
 * way to lock yourself out mid-gesture.
 */
let openPrompts = 0;

export function isPasskeyPromptOpen(): boolean {
  return openPrompts > 0;
}

async function whilePrompting<T>(fn: () => Promise<T>): Promise<T> {
  openPrompts++;
  try {
    return await fn();
  } finally {
    openPrompts--;
  }
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
  /** The vault's data key and what to call this device, both optional. */
  naming?: { dataKey: CryptoKey; label: string },
): Promise<void> {
  if (!isPasskeySupported()) throw new PasskeyUnsupportedError();

  const salt = await prfSalt();
  let credential: PublicKeyCredential;

  try {
    credential = (await whilePrompting(() =>
      navigator.credentials.create({
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
      }),
    )) as PublicKeyCredential;
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

  const label =
    naming && naming.label.trim().length > 0
      ? await sealPasskeyLabel(
          naming.dataKey,
          accountId,
          await credentialHash(credentialId),
          naming.label.trim(),
        )
      : undefined;

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
      ...(label ? { label } : {}),
    }),
    cache: "no-store",
    credentials: "omit",
  });

  if (!response.ok) {
    throw new Error(
      response.status === 409
        ? await conflictMessage(response)
        : `Could not save the passkey (${response.status}).`,
    );
  }
}

/** Tells the two 409s apart, which mean very different things to a user. */
async function conflictMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  return body.error === "credential_in_use"
    ? "That passkey is already registered to a different vault."
    : "This account already has the maximum number of passkeys.";
}

async function assertPrf(
  salt: Uint8Array,
  allow: ArrayBuffer[] = [],
): Promise<{ credentialId: string; prf: Uint8Array }> {
  let assertion: PublicKeyCredential;
  try {
    assertion = (await whilePrompting(() =>
      navigator.credentials.get({
        publicKey: {
          challenge: toArrayBuffer(randomBytes(32)),
          rpId: window.location.hostname,
          userVerification: "required",
          allowCredentials: allow.map((id) => ({ type: "public-key" as const, id })),
          extensions: { prf: { eval: { first: toArrayBuffer(salt) } } },
        },
      }),
    )) as PublicKeyCredential;
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
  await revoke("/api/auth/passkey");
}

/**
 * Revokes one passkey, named by the hash the listing gave.
 *
 * This is the everyday case the all-or-nothing version could not serve: a
 * phone that was lost, replaced, or sold. The others keep working, so nobody
 * has to re-register three devices to retire a fourth.
 */
export async function removePasskey(hash: string): Promise<void> {
  await revoke(`/api/auth/passkey?hash=${encodeURIComponent(hash)}`);
}

async function revoke(url: string): Promise<void> {
  const response = await fetch(url, {
    method: "DELETE",
    headers: { authorization: `Bearer ${await getSessionToken()}` },
    cache: "no-store",
    credentials: "omit",
  });
  // A passkey that is already gone is the outcome the caller asked for.
  if (!response.ok && response.status !== 404) {
    throw new Error(`Could not remove passkeys (${response.status}).`);
  }
}

function fromHex(value: string): Uint8Array {
  const out = new Uint8Array(value.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
