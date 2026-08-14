"use client";

/**
 * The client half of challenge–response login.
 *
 *   1. Ask the server for a nonce, naming the public key we intend to use.
 *   2. Sign a message binding the origin, that nonce and that public key.
 *   3. Exchange the signature for a short-lived bearer token.
 *
 * The identity lives in module memory for as long as the vault is unlocked
 * and is never written to storage: a signing secret in localStorage would be
 * readable by any script that reaches this origin, which is precisely the
 * attacker the rest of the design is built against.
 *
 * Tokens are refreshed silently. Because the secret is right here, a
 * re-login costs one round-trip and no user interaction — so tokens can be
 * short-lived without anyone noticing them expire.
 */

import {
  challengeMessage,
  signChallenge,
  type AuthIdentity,
} from "@/lib/auth/identity";
import { toBase64Url, wipe } from "@/lib/crypto/primitives";

/** Re-authenticate this far before expiry rather than waiting for a 401. */
const REFRESH_MARGIN_MS = 60_000;

interface Session {
  token: string;
  expiresAt: number;
}

let identity: AuthIdentity | null = null;
let session: Session | null = null;
/** Collapses concurrent callers onto one login round-trip. */
let inflight: Promise<Session> | null = null;

export class NotAuthenticatedError extends Error {
  constructor() {
    super("The vault is locked.");
    this.name = "NotAuthenticatedError";
  }
}

export class LoginFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoginFailedError";
  }
}

export function setAuthIdentity(next: AuthIdentity): void {
  if (identity && identity !== next) {
    // Switching accounts, or re-deriving the same one: the outgoing secret is
    // no longer referenced by anything, so wipe it rather than leaving a
    // second copy of signing material on the heap.
    if (identity.accountId !== next.accountId) session = null;
    wipe(identity.secret);
  }
  identity = next;
}

export function getAuthIdentity(): AuthIdentity | null {
  return identity;
}

/** Drops the identity and any live session. Called on lock and on sign-out. */
export function clearAuthIdentity(): void {
  if (identity) wipe(identity.secret);
  identity = null;
  session = null;
  inflight = null;
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    credentials: "omit",
  });
}

async function login(current: AuthIdentity): Promise<Session> {
  const publicKey = toBase64Url(current.publicKey);

  const challengeResponse = await postJson("/api/auth/challenge", { publicKey });
  if (!challengeResponse.ok) {
    throw new LoginFailedError(await failureMessage(challengeResponse));
  }
  const { nonce } = (await challengeResponse.json()) as { nonce: string };

  const signature = signChallenge(
    current.secret,
    challengeMessage(window.location.origin, nonce, publicKey),
  );

  const sessionResponse = await postJson("/api/auth/session", {
    publicKey,
    nonce,
    signature: toBase64Url(signature),
  });
  if (!sessionResponse.ok) {
    throw new LoginFailedError(await failureMessage(sessionResponse));
  }

  const body = (await sessionResponse.json()) as { token: string; expiresAt: number };
  return { token: body.token, expiresAt: body.expiresAt };
}

async function failureMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
  };
  if (body.message) return body.message;
  if (response.status === 429) return "Too many attempts. Wait a minute and try again.";
  if (response.status === 503) return "The server is not configured for sign-in yet.";
  return `Could not sign in (${response.status}).`;
}

/**
 * A live bearer token, minting one if needed.
 * `force` discards the cached token first, for retrying a rejected request.
 */
export async function getSessionToken(force = false): Promise<string> {
  const current = identity;
  if (!current) throw new NotAuthenticatedError();

  if (force) session = null;
  if (session && session.expiresAt - Date.now() > REFRESH_MARGIN_MS) {
    return session.token;
  }

  inflight ??= login(current)
    .then((next) => {
      session = next;
      return next;
    })
    .finally(() => {
      inflight = null;
    });

  return (await inflight).token;
}
