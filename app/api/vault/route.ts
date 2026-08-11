import { NextResponse } from "next/server";

import {
  AuthConfigurationError,
  UnauthorizedError,
  authenticate,
  storageIdFor,
} from "@/lib/server/auth";
import { getKv, vaultKey } from "@/lib/server/kv";
import { clientIdentity, rateLimit } from "@/lib/server/ratelimit";
import { MAX_BODY_BYTES, putVaultSchema } from "@/lib/server/schema";
import type { EncryptedVault } from "@/lib/vault/types";

/**
 * The encrypted vault endpoint.
 *
 * Everything crossing this boundary is ciphertext. The server's entire job is
 * to authenticate the caller, check the blob is well-formed and bounded, and
 * store it against that caller's id. It cannot read, search or recover any of
 * it — by construction, not by policy.
 */

// Node runtime: @privy-io/server-auth needs Node crypto internals.
export const runtime = "nodejs";
// Vault reads must never be served from a cache.
export const dynamic = "force-dynamic";

const NO_STORE = {
  "Cache-Control": "no-store, no-cache, must-revalidate, private",
  "Pragma": "no-cache",
} as const;

function json(body: unknown, status: number, extraHeaders: HeadersInit = {}) {
  return NextResponse.json(body, {
    status,
    headers: { ...NO_STORE, ...extraHeaders },
  });
}

function handleError(error: unknown) {
  if (error instanceof UnauthorizedError) {
    return json({ error: "unauthorized" }, 401);
  }
  if (error instanceof AuthConfigurationError) {
    return json({ error: "auth_not_configured", message: error.message }, 503);
  }
  if (error instanceof Error && error.message.includes("No vault storage configured")) {
    return json({ error: "storage_not_configured", message: error.message }, 503);
  }
  // Never surface internal error text: it is the cheapest source of recon.
  console.error("[vault] unhandled error", error);
  return json({ error: "internal_error" }, 500);
}

export async function GET(request: Request) {
  try {
    const user = await authenticate(request);
    const limit = await rateLimit("vault-read", user.userId, {
      limit: 120,
      windowSeconds: 60,
    });
    if (!limit.allowed) {
      return json({ error: "rate_limited" }, 429, {
        "Retry-After": String(limit.retryAfterSeconds),
      });
    }

    const id = await storageIdFor(user.userId);
    const vault = await getKv().get<EncryptedVault>(vaultKey(id));

    if (!vault) return json({ vault: null }, 200);
    return json({ vault }, 200);
  } catch (error) {
    return handleError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const user = await authenticate(request);
    const limit = await rateLimit("vault-write", user.userId, {
      limit: 60,
      windowSeconds: 60,
    });
    if (!limit.allowed) {
      return json({ error: "rate_limited" }, 429, {
        "Retry-After": String(limit.retryAfterSeconds),
      });
    }

    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_BODY_BYTES) {
      return json({ error: "payload_too_large" }, 413);
    }

    const raw: unknown = await request.json().catch(() => null);
    const parsed = putVaultSchema.safeParse(raw);
    if (!parsed.success) {
      return json({ error: "invalid_payload" }, 400);
    }

    const id = await storageIdFor(user.userId);
    const key = vaultKey(id);
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
      revision: parsed.data.revision,
      updatedAt: Date.now(),
    };

    await getKv().set(key, vault);
    return json({ ok: true, revision: vault.revision, updatedAt: vault.updatedAt }, 200);
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await authenticate(request);
    const limit = await rateLimit("vault-delete", user.userId, {
      limit: 5,
      windowSeconds: 3600,
    });
    if (!limit.allowed) {
      return json({ error: "rate_limited" }, 429, {
        "Retry-After": String(limit.retryAfterSeconds),
      });
    }

    const id = await storageIdFor(user.userId);
    await getKv().delete(vaultKey(id));
    return json({ ok: true }, 200);
  } catch (error) {
    return handleError(error);
  }
}

/** Unauthenticated probes get nothing but a bounded 401. */
export async function POST(request: Request) {
  const limit = await rateLimit("vault-probe", clientIdentity(request), {
    limit: 30,
    windowSeconds: 60,
  });
  if (!limit.allowed) return json({ error: "rate_limited" }, 429);
  return json({ error: "method_not_allowed" }, 405);
}
