import "server-only";

/**
 * Request authentication.
 *
 * Identity is a session token presented as a bearer token, minted only after
 * the caller signed a server-issued nonce with the Ed25519 key derived from
 * their recovery phrase. The `sub` claim is the only thing that decides which
 * vault a request may touch, so it is never read from a header, a cookie, or
 * the request body where a caller could set it themselves.
 *
 * There is no identity provider behind this, and nothing here can mint a
 * token without a valid signature — including the operator.
 */

import { AuthConfigurationError } from "./env";
import { readSessionToken } from "./token";

export { AuthConfigurationError };

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

export interface AuthenticatedAccount {
  /** The hashed public key this session belongs to; also its storage key. */
  accountId: string;
}

/**
 * Verifies the bearer token and returns the account it authenticates.
 * Throws `UnauthorizedError` for anything that is not a valid, live token.
 */
export async function authenticate(request: Request): Promise<AuthenticatedAccount> {
  const token = extractBearerToken(request);
  if (!token) throw new UnauthorizedError();

  const accountId = await readSessionToken(token);
  if (!accountId) throw new UnauthorizedError();
  return { accountId };
}
