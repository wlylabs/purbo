import { authenticate } from "@/lib/server/auth";
import {
  credentialHash,
  getKv,
  passkeyIndexKey,
  passkeyKey,
} from "@/lib/server/kv";
import { rateLimit } from "@/lib/server/ratelimit";
import { handleError, json, rateLimited } from "@/lib/server/response";
import { MAX_PASSKEYS, passkeyRecordSchema } from "@/lib/server/schema";
import type { PasskeyRecord, PasskeySummary } from "@/lib/vault/types";

/**
 * Passkey bootstrap records.
 *
 * A record is a sealed copy of the root key, stored so a device that has
 * neither the recovery phrase nor the passphrase can still open the vault
 * with a biometric. It is as opaque to this server as a vault is: the key
 * that opens it exists only inside the user's authenticator.
 *
 * `accountId` is taken from the session, never from the body — otherwise a
 * caller could file their own record under someone else's account and make
 * that account's passkey list point at a key they control.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { accountId } = await authenticate(request);
    const limit = await rateLimit("passkey-list", accountId, {
      limit: 60,
      windowSeconds: 60,
    });
    if (!limit.allowed) return rateLimited(limit.retryAfterSeconds);

    const passkeys =
      (await getKv().get<PasskeySummary[]>(passkeyIndexKey(accountId))) ?? [];
    return json({ passkeys }, 200);
  } catch (error) {
    return handleError("auth/passkey", error);
  }
}

export async function PUT(request: Request) {
  try {
    const { accountId } = await authenticate(request);
    const limit = await rateLimit("passkey-write", accountId, {
      limit: 10,
      windowSeconds: 3600,
    });
    if (!limit.allowed) return rateLimited(limit.retryAfterSeconds);

    const raw: unknown = await request.json().catch(() => null);
    const parsed = passkeyRecordSchema.safeParse(raw);
    if (!parsed.success) return json({ error: "invalid_payload" }, 400);

    const kv = getKv();
    const indexKey = passkeyIndexKey(accountId);
    const index = (await kv.get<PasskeySummary[]>(indexKey)) ?? [];
    const hash = await credentialHash(parsed.data.credentialId);

    const alreadyRegistered = index.some((entry) => entry.hash === hash);
    if (!alreadyRegistered && index.length >= MAX_PASSKEYS) {
      return json({ error: "too_many_passkeys" }, 409);
    }

    const record: PasskeyRecord = {
      version: 1,
      accountId,
      rootSalt: parsed.data.rootSalt,
      sealed: parsed.data.sealed,
      createdAt: Date.now(),
    };

    await kv.set(passkeyKey(hash), record);
    if (!alreadyRegistered) {
      await kv.set(indexKey, [...index, { hash, createdAt: record.createdAt }]);
    }

    return json({ ok: true, count: alreadyRegistered ? index.length : index.length + 1 }, 200);
  } catch (error) {
    return handleError("auth/passkey", error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { accountId } = await authenticate(request);
    const limit = await rateLimit("passkey-delete", accountId, {
      limit: 10,
      windowSeconds: 3600,
    });
    if (!limit.allowed) return rateLimited(limit.retryAfterSeconds);

    const kv = getKv();
    const indexKey = passkeyIndexKey(accountId);
    const index = (await kv.get<PasskeySummary[]>(indexKey)) ?? [];

    for (const entry of index) {
      await kv.delete(passkeyKey(entry.hash));
    }
    await kv.delete(indexKey);

    return json({ ok: true, removed: index.length }, 200);
  } catch (error) {
    return handleError("auth/passkey", error);
  }
}
