import {
  accountIdFor,
  challengeMessage,
  verifyChallenge,
} from "@/lib/auth/identity";
import { fromBase64Url } from "@/lib/crypto/primitives";
import { getKv, nonceKey } from "@/lib/server/kv";
import { clientIdentity, rateLimit } from "@/lib/server/ratelimit";
import { handleError, json, rateLimited } from "@/lib/server/response";
import { sessionRequestSchema } from "@/lib/server/schema";
import { mintSessionToken } from "@/lib/server/token";

/**
 * Step two of login: redeem a signed nonce for a session token.
 *
 * The server verifies an Ed25519 signature over a message binding this
 * origin, the nonce it issued, and the public key being claimed. What it
 * cannot do is produce that signature — it holds no secret belonging to any
 * account, so there is no operator path to a session.
 *
 * Note what is *not* checked: whether a vault exists for this account. Any
 * valid signature gets a token, because the token only grants access to the
 * record at that account's id, which for an unknown key is empty. Refusing
 * unknown keys here would turn login into an account-existence oracle.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const limit = await rateLimit("auth-session", clientIdentity(request), {
      limit: 20,
      windowSeconds: 60,
    });
    if (!limit.allowed) return rateLimited(limit.retryAfterSeconds);

    const raw: unknown = await request.json().catch(() => null);
    const parsed = sessionRequestSchema.safeParse(raw);
    if (!parsed.success) return json({ error: "invalid_payload" }, 400);

    const { publicKey, nonce, signature } = parsed.data;

    // Single-use: read and delete in one operation, so two requests racing on
    // the same nonce cannot both redeem it.
    const pending = await getKv().consume<{ publicKey: string }>(nonceKey(nonce));
    if (!pending || pending.publicKey !== publicKey) {
      return json({ error: "invalid_challenge" }, 401);
    }

    // The origin is taken from the request URL rather than the Origin header:
    // it is what this deployment is actually serving, not what the caller
    // says it is. A signature made for one deployment will not verify here.
    const origin = new URL(request.url).origin;
    const message = challengeMessage(origin, nonce, publicKey);

    const valid = verifyChallenge(
      fromBase64Url(signature),
      message,
      fromBase64Url(publicKey),
    );
    if (!valid) return json({ error: "invalid_signature" }, 401);

    const accountId = await accountIdFor(fromBase64Url(publicKey));
    const { token, expiresAt } = await mintSessionToken(accountId);

    return json({ token, expiresAt, accountId }, 200);
  } catch (error) {
    return handleError("auth/session", error);
  }
}
