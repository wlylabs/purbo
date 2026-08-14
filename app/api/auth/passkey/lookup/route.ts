import { credentialHash, getKv, passkeyKey } from "@/lib/server/kv";
import { clientIdentity, rateLimit } from "@/lib/server/ratelimit";
import { handleError, json, rateLimited } from "@/lib/server/response";
import { passkeyLookupSchema } from "@/lib/server/schema";
import type { PasskeyRecord } from "@/lib/vault/types";

/**
 * Fetching a passkey's sealed record.
 *
 * Unauthenticated by necessity: this is what a device with no phrase, no
 * passphrase and no session calls in order to *become* authenticated. The
 * caller must already hold a credential id, which an authenticator only
 * returns after a successful user-verified assertion.
 *
 * What that means for the threat model, stated plainly: whoever knows a
 * credential id can download the record. The record is AES-256-GCM sealed
 * under a key derived from the authenticator's PRF secret, so downloading it
 * yields ciphertext and a salt. Rate limits here are about scraping volume,
 * not about protecting the contents.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const limit = await rateLimit("passkey-lookup", clientIdentity(request), {
      limit: 20,
      windowSeconds: 60,
    });
    if (!limit.allowed) return rateLimited(limit.retryAfterSeconds);

    const raw: unknown = await request.json().catch(() => null);
    const parsed = passkeyLookupSchema.safeParse(raw);
    if (!parsed.success) return json({ error: "invalid_payload" }, 400);

    const hash = await credentialHash(parsed.data.credentialId);
    const record = await getKv().get<PasskeyRecord>(passkeyKey(hash));
    if (!record) return json({ error: "not_found" }, 404);

    return json({ record }, 200);
  } catch (error) {
    return handleError("auth/passkey/lookup", error);
  }
}
