import { authenticate } from "@/lib/server/auth";
import {
  credentialHash,
  getKv,
  passkeyIndexKey,
  passkeyKey,
} from "@/lib/server/kv";
import { rateLimit } from "@/lib/server/ratelimit";
import { handleError, json, rateLimited } from "@/lib/server/response";
import { MAX_PASSKEYS, passkeyHashSchema, passkeyRecordSchema } from "@/lib/server/schema";
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
 *
 * Records are keyed by a hash of the credential id, which is one namespace
 * for every account on the deployment. So a write also has to check who is
 * already there: without that, any caller holding a session — and the session
 * endpoint issues one for any valid signature, by design — could overwrite
 * the record behind someone else's credential id and take that passkey out of
 * service for good.
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

    // A record already filed under this credential by a different account is
    // not ours to overwrite: doing so would evict that account's passkey and
    // leave it permanently unable to open its vault that way. One of our own
    // that the index has lost track of is a different matter — that is a
    // half-finished registration, and re-adopting it is the repair.
    const occupant = await kv.get<PasskeyRecord>(passkeyKey(hash));
    if (occupant && occupant.accountId !== accountId) {
      return json({ error: "credential_in_use" }, 409);
    }

    const createdAt =
      index.find((entry) => entry.hash === hash)?.createdAt ?? Date.now();

    const record: PasskeyRecord = {
      version: 1,
      accountId,
      rootSalt: parsed.data.rootSalt,
      sealed: parsed.data.sealed,
      createdAt,
    };

    const summary: PasskeySummary = { hash, createdAt, label: parsed.data.label };

    await kv.set(passkeyKey(hash), record);
    await kv.set(indexKey, [
      ...index.filter((entry) => entry.hash !== hash),
      summary,
    ]);

    return json({ ok: true, count: alreadyRegistered ? index.length : index.length + 1 }, 200);
  } catch (error) {
    return handleError("auth/passkey", error);
  }
}

/**
 * Revokes one passkey, or all of them.
 *
 * `?hash=` names a single authenticator — the lost phone, the old laptop —
 * and its absence means all of them. Only hashes this account's index lists
 * are touched, so naming another account's passkey deletes nothing.
 */
export async function DELETE(request: Request) {
  try {
    const { accountId } = await authenticate(request);
    const limit = await rateLimit("passkey-delete", accountId, {
      limit: 10,
      windowSeconds: 3600,
    });
    if (!limit.allowed) return rateLimited(limit.retryAfterSeconds);

    const requested = new URL(request.url).searchParams.get("hash");
    if (requested !== null && !passkeyHashSchema.safeParse(requested).success) {
      return json({ error: "invalid_payload" }, 400);
    }

    const kv = getKv();
    const indexKey = passkeyIndexKey(accountId);
    const index = (await kv.get<PasskeySummary[]>(indexKey)) ?? [];

    const doomed = requested ? index.filter((entry) => entry.hash === requested) : index;
    if (requested && doomed.length === 0) return json({ error: "not_found" }, 404);

    for (const entry of doomed) {
      await kv.delete(passkeyKey(entry.hash));
    }

    const remaining = index.filter((entry) => !doomed.includes(entry));
    if (remaining.length === 0) await kv.delete(indexKey);
    else await kv.set(indexKey, remaining);

    return json({ ok: true, removed: doomed.length, remaining: remaining.length }, 200);
  } catch (error) {
    return handleError("auth/passkey", error);
  }
}
