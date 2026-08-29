import { authenticate } from "@/lib/server/auth";
import { getKv, passkeyIndexKey, passkeyKey, vaultKey } from "@/lib/server/kv";
import { clientIdentity, rateLimit } from "@/lib/server/ratelimit";
import { handleError, json, rateLimited } from "@/lib/server/response";
import { MAX_BODY_BYTES, putVaultSchema } from "@/lib/server/schema";
import type { EncryptedVault, PasskeySummary } from "@/lib/vault/types";

/**
 * The encrypted vault endpoint.
 *
 * Everything crossing this boundary is ciphertext. The server's entire job is
 * to authenticate the caller, check the blob is well-formed and bounded, and
 * store it against that caller's account id. It cannot read, search or
 * recover any of it — by construction, not by policy.
 */

export const runtime = "nodejs";
// Vault reads must never be served from a cache.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { accountId } = await authenticate(request);
    const limit = await rateLimit("vault-read", accountId, {
      limit: 120,
      windowSeconds: 60,
    });
    if (!limit.allowed) return rateLimited(limit.retryAfterSeconds);

    const vault = await getKv().get<EncryptedVault>(vaultKey(accountId));

    if (!vault) return json({ vault: null }, 200);
    return json({ vault }, 200);
  } catch (error) {
    return handleError("vault", error);
  }
}

export async function PUT(request: Request) {
  try {
    const { accountId } = await authenticate(request);
    const limit = await rateLimit("vault-write", accountId, {
      limit: 60,
      windowSeconds: 60,
    });
    if (!limit.allowed) return rateLimited(limit.retryAfterSeconds);

    // The header is a claim, not a measurement: a chunked request carries no
    // `content-length` at all, and one that lies is trivial to send. Reading
    // the body as text and weighing it is what actually bounds the parse.
    if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
      return json({ error: "payload_too_large" }, 413);
    }

    const body = await request.text().catch(() => null);
    if (body === null) return json({ error: "invalid_payload" }, 400);
    if (new Blob([body]).size > MAX_BODY_BYTES) {
      return json({ error: "payload_too_large" }, 413);
    }

    let raw: unknown = null;
    try {
      raw = JSON.parse(body);
    } catch {
      return json({ error: "invalid_payload" }, 400);
    }
    const parsed = putVaultSchema.safeParse(raw);
    if (!parsed.success) {
      return json({ error: "invalid_payload" }, 400);
    }

    const key = vaultKey(accountId);
    const existing = await getKv().get<EncryptedVault>(key);

    // Optimistic concurrency. A client that fetched revision N may only write
    // N+1; a second device that wrote in between forces a re-sync instead of
    // silently overwriting entries the user just saved elsewhere.
    if (existing && parsed.data.revision <= existing.revision) {
      return json(
        { error: "revision_conflict", currentRevision: existing.revision },
        409,
      );
    }

    const vault: EncryptedVault = {
      envelope: parsed.data.envelope,
      items: parsed.data.items,
      deleted: parsed.data.deleted ?? [],
      revision: parsed.data.revision,
      updatedAt: Date.now(),
    };

    await getKv().set(key, vault);
    return json({ ok: true, revision: vault.revision, updatedAt: vault.updatedAt }, 200);
  } catch (error) {
    return handleError("vault", error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { accountId } = await authenticate(request);
    const limit = await rateLimit("vault-delete", accountId, {
      limit: 5,
      windowSeconds: 3600,
    });
    if (!limit.allowed) return rateLimited(limit.retryAfterSeconds);

    // Deleting the vault deletes the passkeys with it. Each sealed record
    // holds a copy of the root key and the auth secret, and `lookup` serves
    // them to anyone with the credential id — so leaving them behind would
    // mean "delete my vault" quietly kept the keys to it on the server.
    const kv = getKv();
    const index = (await kv.get<PasskeySummary[]>(passkeyIndexKey(accountId))) ?? [];
    for (const entry of index) await kv.delete(passkeyKey(entry.hash));
    await kv.delete(passkeyIndexKey(accountId));
    await kv.delete(vaultKey(accountId));

    return json({ ok: true, passkeysRemoved: index.length }, 200);
  } catch (error) {
    return handleError("vault", error);
  }
}

/** Unauthenticated probes get nothing but a bounded 405. */
export async function POST(request: Request) {
  const limit = await rateLimit("vault-probe", clientIdentity(request), {
    limit: 30,
    windowSeconds: 60,
  });
  if (!limit.allowed) return rateLimited(limit.retryAfterSeconds);
  return json({ error: "method_not_allowed" }, 405);
}
