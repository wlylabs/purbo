import "server-only";

import { PrivyClient } from "@privy-io/server-auth";

import { isPrivyConfigured, serverEnv } from "./env";

/**
 * Request authentication.
 *
 * Identity comes from a Privy access token presented as a bearer token. The
 * token is verified cryptographically on every request — the `userId` claim
 * is the only thing that decides which vault a request may touch, so it is
 * never read from a header, a cookie, or the request body where a caller
 * could set it themselves.
 */

let client: PrivyClient | null = null;

function getPrivyClient(): PrivyClient {
  if (!isPrivyConfigured()) {
    throw new AuthConfigurationError();
  }
  client ??= new PrivyClient(serverEnv.privyAppId!, serverEnv.privyAppSecret!);
  return client;
}

export class AuthConfigurationError extends Error {
  constructor() {
    super(
      "Privy is not configured. Set NEXT_PUBLIC_PRIVY_APP_ID and PRIVY_APP_SECRET.",
    );
    this.name = "AuthConfigurationError";
  }
}

export class UnauthorizedError extends Error {
  constructor(message = "Authentication required.") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

function extractBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const [scheme, ...rest] = header.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer") return null;
  const token = rest.join(" ").trim();
  return token.length > 0 ? token : null;
}

export interface AuthenticatedUser {
  userId: string;
  sessionId: string;
  expiresAt: number;
}

/**
 * Verifies the bearer token and returns its claims.
 * Throws `UnauthorizedError` for anything that is not a valid, live token.
 */
export async function authenticate(request: Request): Promise<AuthenticatedUser> {
  const token = extractBearerToken(request);
  if (!token) throw new UnauthorizedError();

  // Bound the input before it reaches the JWT parser; a multi-megabyte
  // "token" should be rejected on sight, not parsed.
  if (token.length > 4096) throw new UnauthorizedError();

  try {
    const claims = await getPrivyClient().verifyAuthToken(
      token,
      serverEnv.privyVerificationKey,
    );
    if (!claims.userId) throw new UnauthorizedError();
    return {
      userId: claims.userId,
      sessionId: claims.sessionId,
      expiresAt: claims.expiration,
    };
  } catch (error) {
    if (error instanceof AuthConfigurationError) throw error;
    // Expiry, bad signature and malformed input collapse to one response:
    // an attacker probing tokens learns only "no".
    throw new UnauthorizedError();
  }
}

/**
 * A stable, non-reversible storage key for a Privy user id.
 *
 * Privy ids look like `did:privy:clxxxx`. Hashing keeps raw identifiers out
 * of the storage layer's key space, so a dump of key names alone does not
 * enumerate the app's user base.
 */
export async function storageIdFor(userId: string): Promise<string> {
  const data = new TextEncoder().encode(`purbo:uid:v1:${userId}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
