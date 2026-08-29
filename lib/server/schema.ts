import { z } from "zod";

/**
 * Wire validation for the vault API.
 *
 * The server cannot read any of this, so validation is about *shape and
 * size*, not meaning: reject anything that is not a well-formed envelope of
 * bounded size before it reaches storage. Strict objects mean an attacker
 * cannot smuggle extra fields through into the stored blob.
 */

const BASE64URL = /^[A-Za-z0-9_-]+$/;

const base64Url = (max: number) =>
  z.string().min(1).max(max).regex(BASE64URL, "expected base64url");

const sealedBox = z
  .object({
    v: z.literal(1),
    iv: base64Url(32),
    ct: base64Url(64 * 1024),
  })
  .strict();

const kdfParams = z
  .object({
    algorithm: z.literal("argon2id"),
    // Bounds mirror `assertAcceptableKdfParams` on the client. Enforcing them
    // here too means a compromised client cannot persist a downgraded
    // envelope that would weaken the vault on every future device.
    memoryKiB: z.number().int().min(19 * 1024).max(1024 * 1024),
    iterations: z.number().int().min(2).max(32),
    parallelism: z.number().int().min(1).max(16),
  })
  .strict();

export const keyEnvelopeSchema = z
  .object({
    version: z.literal(1),
    salt: base64Url(64),
    kdf: kdfParams,
    wrapped: sealedBox,
    verifier: sealedBox,
    /** The account's Ed25519 secret, sealed under a subkey of the root key. */
    auth: sealedBox,
    rootSalt: base64Url(128),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();

export const encryptedItemSchema = z
  .object({
    id: base64Url(64),
    payload: sealedBox,
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();

/**
 * A deletion, as it travels between devices.
 *
 * Nothing but an id and a time — there is no ciphertext to bound, and the id
 * is the same random string the entry had. Validated all the same, because a
 * list the server stores is a list the server has to keep bounded.
 */
const tombstoneSchema = z
  .object({
    id: base64Url(64),
    deletedAt: z.number().int().nonnegative(),
  })
  .strict();

export const MAX_ITEMS = 5000;

/** One tombstone per entry, so the same ceiling bounds both lists. */
export const MAX_TOMBSTONES = MAX_ITEMS;

function refuseDuplicates(
  entries: readonly { id: string }[],
  ctx: z.RefinementCtx,
  path: string,
): boolean {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) {
      ctx.addIssue({ code: "custom", message: `duplicate id: ${entry.id}`, path: [path] });
      return false;
    }
    ids.add(entry.id);
  }
  return true;
}

export const putVaultSchema = z
  .object({
    envelope: keyEnvelopeSchema,
    items: z.array(encryptedItemSchema).max(MAX_ITEMS),
    /** Optional: a client from before merging existed sends none. */
    deleted: z.array(tombstoneSchema).max(MAX_TOMBSTONES).optional(),
    revision: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!refuseDuplicates(value.items, ctx, "items")) return;
    if (!refuseDuplicates(value.deleted ?? [], ctx, "deleted")) return;

    // An entry cannot be both present and deleted: the client merges those
    // two lists before it writes, so a payload carrying both is either a bug
    // or a hand-made request, and neither should reach storage.
    const live = new Set(value.items.map((item) => item.id));
    for (const stone of value.deleted ?? []) {
      if (live.has(stone.id)) {
        ctx.addIssue({
          code: "custom",
          message: `entry is both present and deleted: ${stone.id}`,
          path: ["deleted"],
        });
        return;
      }
    }
  });

export type PutVaultBody = z.infer<typeof putVaultSchema>;

/** Hard cap on request size, checked before parsing. */
export const MAX_BODY_BYTES = 8 * 1024 * 1024;

// ------------------------------------------------------------------- auth

/** 32 raw bytes -> 43 base64url characters; 64 -> 86. Fixed lengths, so pin them. */
const fixedBase64Url = (bytes: number) =>
  z
    .string()
    .length(Math.ceil((bytes * 4) / 3))
    .regex(BASE64URL, "expected base64url");

export const challengeRequestSchema = z
  .object({ publicKey: fixedBase64Url(32) })
  .strict();

export const sessionRequestSchema = z
  .object({
    publicKey: fixedBase64Url(32),
    nonce: fixedBase64Url(32),
    signature: fixedBase64Url(64),
  })
  .strict();

/**
 * WebAuthn credential ids are opaque and can be up to 1023 bytes; anything
 * larger than that base64url-encoded is not a credential id.
 */
const credentialId = base64Url(1400);

/**
 * A passkey bootstrap record as the client submits it.
 *
 * `sealed` holds the root key and the account's auth secret, encrypted under
 * a key the authenticator derives (WebAuthn's PRF extension). The server
 * stores it and hands it back to whoever presents the credential id — it can
 * no more read this than it can read a vault.
 */
export const passkeyRecordSchema = z
  .object({
    credentialId,
    rootSalt: base64Url(128),
    sealed: sealedBox,
    /** The device's name, sealed under the vault's data key. */
    label: sealedBox.optional(),
  })
  .strict();

/**
 * The handle naming one passkey in a revoke request.
 *
 * A hash of the credential id rather than the id itself: it is what the
 * listing hands the client, and it means revoking a passkey does not require
 * the device it belongs to be present to state its own id.
 */
export const passkeyHashSchema = z.string().regex(/^[0-9a-f]{64}$/, "expected a hash");

export const passkeyLookupSchema = z.object({ credentialId }).strict();

/** Passkeys per account. A cap, so registration cannot be used as storage. */
export const MAX_PASSKEYS = 10;
