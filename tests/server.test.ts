/**
 * The API routes, exercised as functions.
 *
 * A route handler here is an ordinary function from `Request` to `Response`,
 * so these run the real ones against the in-memory storage driver — no server,
 * no network. What they cover is what the crypto tests cannot: who is allowed
 * to write where, what happens when two devices race, and whether deleting a
 * vault actually deletes everything filed under it.
 */

import assert from "node:assert/strict";

import { DELETE as deletePasskeys, GET as listPasskeys, PUT as putPasskey } from "@/app/api/auth/passkey/route";
import { POST as lookupPasskey } from "@/app/api/auth/passkey/lookup/route";
import { POST as challenge } from "@/app/api/auth/challenge/route";
import { POST as session } from "@/app/api/auth/session/route";
import {
  DELETE as deleteVault,
  GET as getVault,
  POST as probeVault,
  PUT as putVault,
} from "@/app/api/vault/route";
import {
  accountIdFor,
  challengeMessage,
  identityFromRecoveryPhrase,
  signChallenge,
} from "@/lib/auth/identity";
import { createRecoveryPhrase } from "@/lib/crypto/mnemonic";
import { toBase64Url } from "@/lib/crypto/primitives";
import { mintSessionToken } from "@/lib/server/token";
import { report, test } from "./harness";

const ORIGIN = "https://purbo.test";

let accounts = 0;
/** A fresh account per test, so one test's rate-limit budget is its own. */
function newAccount(): string {
  accounts += 1;
  return `account${accounts}`.padStart(32, "0");
}

async function authorised(accountId: string): Promise<HeadersInit> {
  const { token } = await mintSessionToken(accountId);
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`${ORIGIN}${path}`, init);
}

const box = (ct: string) => ({ v: 1 as const, iv: "aaaaaaaaaaaaaaaa", ct });

function envelope(wrapped = "d3JhcHBlZA") {
  return {
    version: 1 as const,
    salt: "c2FsdHNhbHQ",
    kdf: { algorithm: "argon2id" as const, memoryKiB: 65536, iterations: 3, parallelism: 1 },
    wrapped: box(wrapped),
    verifier: box("dmVyaWZpZXI"),
    auth: box("YXV0aA"),
    rootSalt: "cm9vdHNhbHQ",
    createdAt: 1,
  };
}

const item = (id: string, ct = `Y3Q${id}`) => ({
  id,
  payload: box(ct),
  updatedAt: 1_700_000_000_000,
});

async function writeVault(
  accountId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return putVault(
    request("/api/vault", {
      method: "PUT",
      headers: await authorised(accountId),
      body: JSON.stringify({ envelope: envelope(), items: [], ...body }),
    }),
  );
}

async function readVault(accountId: string) {
  const response = await getVault(
    request("/api/vault", { headers: await authorised(accountId) }),
  );
  return (await response.json()) as { vault: null | Record<string, unknown> };
}

// ------------------------------------------------------------ authentication

await test("the vault refuses a request with no token", async () => {
  const response = await getVault(request("/api/vault"));
  assert.equal(response.status, 401);
});

await test("the vault refuses a forged token", async () => {
  const response = await getVault(
    request("/api/vault", { headers: { authorization: "Bearer v1.abc.def" } }),
  );
  assert.equal(response.status, 401);
});

await test("a signed challenge is redeemable exactly once", async () => {
  const identity = await identityFromRecoveryPhrase(createRecoveryPhrase());
  const publicKey = toBase64Url(identity.publicKey);

  const issued = await challenge(
    request("/api/auth/challenge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ publicKey }),
    }),
  );
  assert.equal(issued.status, 200);
  const { nonce } = (await issued.json()) as { nonce: string };

  const signature = toBase64Url(
    signChallenge(identity.secret, challengeMessage(ORIGIN, nonce, publicKey)),
  );
  const body = JSON.stringify({ publicKey, nonce, signature });

  const first = await session(
    request("/api/auth/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    }),
  );
  assert.equal(first.status, 200);
  const minted = (await first.json()) as { accountId: string };
  assert.equal(minted.accountId, await accountIdFor(identity.publicKey));

  const replay = await session(
    request("/api/auth/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    }),
  );
  assert.equal(replay.status, 401, "the nonce is spent");
});

await test("a signature for another origin does not verify here", async () => {
  const identity = await identityFromRecoveryPhrase(createRecoveryPhrase());
  const publicKey = toBase64Url(identity.publicKey);

  const issued = await challenge(
    request("/api/auth/challenge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ publicKey }),
    }),
  );
  const { nonce } = (await issued.json()) as { nonce: string };

  const signature = toBase64Url(
    signChallenge(
      identity.secret,
      challengeMessage("https://not-purbo.test", nonce, publicKey),
    ),
  );

  const response = await session(
    request("/api/auth/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ publicKey, nonce, signature }),
    }),
  );
  assert.equal(response.status, 401);
});

// -------------------------------------------------------------------- vaults

await test("a vault round-trips, and only to its own account", async () => {
  const mine = newAccount();
  const yours = newAccount();

  assert.equal((await writeVault(mine, { items: [item("aaa")], revision: 1 })).status, 200);

  const read = await readVault(mine);
  assert.equal((read.vault as { revision: number }).revision, 1);

  const theirs = await readVault(yours);
  assert.equal(theirs.vault, null, "another account sees nothing");
});

await test("a stale revision is refused rather than applied", async () => {
  const account = newAccount();
  await writeVault(account, { items: [item("aaa")], revision: 4 });

  const response = await writeVault(account, { items: [], revision: 4 });
  assert.equal(response.status, 409);
  const body = (await response.json()) as { currentRevision: number };
  assert.equal(body.currentRevision, 4);

  const read = await readVault(account);
  assert.equal((read.vault as { items: unknown[] }).items.length, 1, "the write did not land");
});

await test("tombstones survive a round trip", async () => {
  const account = newAccount();
  const deleted = [{ id: "ZGVhZA", deletedAt: 1_700_000_000_000 }];

  assert.equal((await writeVault(account, { deleted, revision: 1 })).status, 200);

  const read = await readVault(account);
  assert.deepEqual((read.vault as { deleted: unknown }).deleted, deleted);
});

await test("an entry cannot be present and deleted in the same write", async () => {
  const account = newAccount();
  const response = await writeVault(account, {
    items: [item("YWFh")],
    deleted: [{ id: "YWFh", deletedAt: 1 }],
    revision: 1,
  });
  assert.equal(response.status, 400);
});

await test("duplicate entry ids are refused", async () => {
  const response = await writeVault(newAccount(), {
    items: [item("YWFh"), item("YWFh", "b3RoZXI")],
    revision: 1,
  });
  assert.equal(response.status, 400);
});

await test("a downgraded KDF cannot be stored", async () => {
  const response = await writeVault(newAccount(), {
    envelope: { ...envelope(), kdf: { algorithm: "argon2id", memoryKiB: 8, iterations: 1, parallelism: 1 } },
    revision: 1,
  });
  assert.equal(response.status, 400);
});

await test("an oversized body is refused even when it lies about its length", async () => {
  const account = newAccount();
  // No content-length is set on a Request built from a stream-sized string
  // here, so this is the check that has to catch it: the header used to be
  // the only bound, and a request without one went straight to the parser.
  const huge = "A".repeat(9 * 1024 * 1024);
  const response = await putVault(
    request("/api/vault", {
      method: "PUT",
      headers: await authorised(account),
      body: JSON.stringify({ envelope: envelope(), items: [item("YWFh", huge)], revision: 1 }),
    }),
  );
  assert.equal(response.status, 413);
});

await test("malformed JSON is a 400, not a crash", async () => {
  const response = await putVault(
    request("/api/vault", {
      method: "PUT",
      headers: await authorised(newAccount()),
      body: "{not json",
    }),
  );
  assert.equal(response.status, 400);
});

await test("POST to the vault is a bounded 405", async () => {
  const response = await probeVault(request("/api/vault", { method: "POST" }));
  assert.equal(response.status, 405);
});

// ------------------------------------------------------------------ passkeys

const CREDENTIAL = "Y3JlZGVudGlhbC1vbmU";

async function registerPasskey(
  accountId: string,
  credentialId: string,
  extra: Record<string, unknown> = {},
): Promise<Response> {
  return putPasskey(
    request("/api/auth/passkey", {
      method: "PUT",
      headers: await authorised(accountId),
      body: JSON.stringify({
        credentialId,
        rootSalt: "cm9vdHNhbHQ",
        sealed: box("c2VhbGVk"),
        ...extra,
      }),
    }),
  );
}

async function lookup(credentialId: string): Promise<Response> {
  return lookupPasskey(
    request("/api/auth/passkey/lookup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ credentialId }),
    }),
  );
}

await test("a passkey record is stored and served back by credential id", async () => {
  const account = newAccount();
  assert.equal((await registerPasskey(account, CREDENTIAL)).status, 200);

  const found = await lookup(CREDENTIAL);
  assert.equal(found.status, 200);
  const { record } = (await found.json()) as { record: { accountId: string } };
  assert.equal(record.accountId, account);

  const missing = await lookup("bm90LXJlZ2lzdGVyZWQ");
  assert.equal(missing.status, 404);
});

await test("another account cannot overwrite a registered credential", async () => {
  const victim = newAccount();
  const attacker = newAccount();
  const credential = "dmljdGltLWNyZWRlbnRpYWw";

  assert.equal((await registerPasskey(victim, credential)).status, 200);

  const hijack = await registerPasskey(attacker, credential);
  assert.equal(hijack.status, 409, "the credential is already someone else's");
  assert.equal(((await hijack.json()) as { error: string }).error, "credential_in_use");

  // The victim's record is untouched — the point of the check.
  const { record } = (await (await lookup(credential)).json()) as {
    record: { accountId: string };
  };
  assert.equal(record.accountId, victim);
});

await test("re-registering the same authenticator updates it in place", async () => {
  const account = newAccount();
  const credential = "cmUtcmVnaXN0ZXJlZA";

  await registerPasskey(account, credential, { label: box("bmFtZQ") });
  const second = await registerPasskey(account, credential, { label: box("cmVuYW1lZA") });
  assert.equal(second.status, 200);

  const listed = await listPasskeys(
    request("/api/auth/passkey", { headers: await authorised(account) }),
  );
  const { passkeys } = (await listed.json()) as {
    passkeys: { label?: { ct: string } }[];
  };
  assert.equal(passkeys.length, 1, "not a second row");
  assert.equal(passkeys[0]!.label?.ct, "cmVuYW1lZA");
});

await test("one passkey can be revoked without touching the others", async () => {
  const account = newAccount();
  await registerPasskey(account, "Zmlyc3Q");
  await registerPasskey(account, "c2Vjb25k");

  const listed = await listPasskeys(
    request("/api/auth/passkey", { headers: await authorised(account) }),
  );
  const { passkeys } = (await listed.json()) as { passkeys: { hash: string }[] };
  assert.equal(passkeys.length, 2);

  const removed = await deletePasskeys(
    request(`/api/auth/passkey?hash=${passkeys[0]!.hash}`, {
      method: "DELETE",
      headers: await authorised(account),
    }),
  );
  assert.equal(removed.status, 200);
  assert.deepEqual(await removed.json(), { ok: true, removed: 1, remaining: 1 });

  const after = await listPasskeys(
    request("/api/auth/passkey", { headers: await authorised(account) }),
  );
  const remaining = (await after.json()) as { passkeys: { hash: string }[] };
  assert.equal(remaining.passkeys.length, 1);
  assert.equal(remaining.passkeys[0]!.hash, passkeys[1]!.hash);
});

await test("revoking a passkey this account does not have changes nothing", async () => {
  const account = newAccount();
  const response = await deletePasskeys(
    request(`/api/auth/passkey?hash=${"0".repeat(64)}`, {
      method: "DELETE",
      headers: await authorised(account),
    }),
  );
  assert.equal(response.status, 404);
});

await test("a malformed hash is refused", async () => {
  const response = await deletePasskeys(
    request("/api/auth/passkey?hash=not-a-hash", {
      method: "DELETE",
      headers: await authorised(newAccount()),
    }),
  );
  assert.equal(response.status, 400);
});

await test("deleting the vault deletes the passkeys with it", async () => {
  const account = newAccount();
  const credential = "ZGVsZXRlLWNhc2NhZGU";

  await writeVault(account, { items: [item("YWFh")], revision: 1 });
  await registerPasskey(account, credential);
  assert.equal((await lookup(credential)).status, 200);

  const removed = await deleteVault(
    request("/api/vault", { method: "DELETE", headers: await authorised(account) }),
  );
  assert.equal(removed.status, 200);
  assert.equal(((await removed.json()) as { passkeysRemoved: number }).passkeysRemoved, 1);

  // The sealed record holds a copy of the root key. Leaving it behind would
  // mean "delete my vault" kept the keys to it, still served to anyone
  // holding the credential id.
  assert.equal((await lookup(credential)).status, 404);
  assert.equal((await readVault(account)).vault, null);

  const listed = await listPasskeys(
    request("/api/auth/passkey", { headers: await authorised(account) }),
  );
  assert.deepEqual(await listed.json(), { passkeys: [] });
});

report("server checks");
