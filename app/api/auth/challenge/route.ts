import {
  clientIdentity,
  rateLimit,
} from "@/lib/server/ratelimit";
import { AuthConfigurationError, isAuthConfigured } from "@/lib/server/env";
import { getKv, nonceKey } from "@/lib/server/kv";
import { handleError, json, rateLimited } from "@/lib/server/response";
import { challengeRequestSchema } from "@/lib/server/schema";
import { randomBytes, toBase64Url } from "@/lib/crypto/primitives";

/**
 * Step one of login: issue a nonce.
 *
 * The nonce is stored against the public key that asked for it, with a short
 * expiry, and is redeemable exactly once. That is what makes a captured
 * signature worthless: it authenticates one nonce, and that nonce is gone the
 * moment it is used.
 *
 * Issuing one proves nothing and reveals nothing — in particular it does not
 * say whether the public key corresponds to an existing vault. An unregistered
 * key gets the same nonce as a registered one, so this endpoint cannot be used
 * to enumerate accounts.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Long enough for a slow phone to sign, short enough to bound the window. */
const NONCE_TTL_SECONDS = 120;

export async function POST(request: Request) {
  try {
    if (!isAuthConfigured()) throw new AuthConfigurationError();

    const limit = await rateLimit("auth-challenge", clientIdentity(request), {
      limit: 30,
      windowSeconds: 60,
    });
    if (!limit.allowed) return rateLimited(limit.retryAfterSeconds);

    const raw: unknown = await request.json().catch(() => null);
    const parsed = challengeRequestSchema.safeParse(raw);
    if (!parsed.success) return json({ error: "invalid_payload" }, 400);

    const nonce = toBase64Url(randomBytes(32));
    await getKv().set(
      nonceKey(nonce),
      { publicKey: parsed.data.publicKey },
      NONCE_TTL_SECONDS,
    );

    return json({ nonce, expiresInSeconds: NONCE_TTL_SECONDS }, 200);
  } catch (error) {
    return handleError("auth/challenge", error);
  }
}
