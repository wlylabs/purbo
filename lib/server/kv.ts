import "server-only";

import { Redis } from "@upstash/redis";

import { credentialHash } from "@/lib/auth/credential";
import { isRemoteStorageConfigured, serverEnv } from "./env";

export { credentialHash };

/**
 * Storage for encrypted vault blobs.
 *
 * The backing store only ever holds ciphertext, so it needs no special
 * trust — but it does need to exist. Upstash/Vercel KV is used when
 * configured; otherwise an in-process map keeps local development working.
 *
 * The in-memory driver is explicitly refused in production: silently losing
 * every user's vault on the next serverless cold start would be far worse
 * than failing loudly at deploy time.
 */

/**
 * Raised when production has no storage configured.
 *
 * A class rather than a message: the response layer has to recognise this to
 * answer 503 instead of 500, and recognising it by matching on the text of an
 * exception is a coupling that breaks silently the first time the wording is
 * improved.
 */
export class StorageConfigurationError extends Error {
  constructor() {
    super(
      "No vault storage configured. Set UPSTASH_REDIS_REST_URL and " +
        "UPSTASH_REDIS_REST_TOKEN (or the KV_REST_API_* equivalents) " +
        "before deploying.",
    );
    this.name = "StorageConfigurationError";
  }
}

export interface KvDriver {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
  /**
   * Reads a key and deletes it in one operation.
   *
   * Login nonces must be single-use, and "read, check, then delete" is a race
   * two concurrent requests can both win. This collapses it into one atomic
   * step so exactly one caller can ever redeem a given nonce.
   */
  consume<T>(key: string): Promise<T | null>;
  /** Fixed-window counter used by the rate limiter. */
  increment(key: string, windowSeconds: number): Promise<number>;
}

function createRedisDriver(): KvDriver {
  const redis = new Redis({
    url: serverEnv.upstashUrl!,
    token: serverEnv.upstashToken!,
  });

  return {
    async get<T>(key: string) {
      return (await redis.get<T>(key)) ?? null;
    },
    async set<T>(key: string, value: T, ttlSeconds?: number) {
      if (ttlSeconds && ttlSeconds > 0) {
        await redis.set(key, value, { ex: ttlSeconds });
        return;
      }
      await redis.set(key, value);
    },
    async delete(key: string) {
      await redis.del(key);
    },
    async consume<T>(key: string) {
      return (await redis.getdel<T>(key)) ?? null;
    },
    async increment(key: string, windowSeconds: number) {
      const count = await redis.incr(key);
      // Only the first request in a window sets the TTL, so the window is
      // fixed from its first hit rather than sliding forward on every call.
      if (count === 1) await redis.expire(key, windowSeconds);
      return count;
    },
  };
}

function createMemoryDriver(): KvDriver {
  const store = new Map<string, { value: unknown; expiresAt: number | null }>();
  const counters = new Map<string, { count: number; expiresAt: number }>();

  const read = (key: string) => {
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      store.delete(key);
      return null;
    }
    return entry;
  };

  return {
    async get<T>(key: string) {
      return (read(key)?.value as T) ?? null;
    },
    async set<T>(key: string, value: T, ttlSeconds?: number) {
      store.set(key, {
        value,
        expiresAt: ttlSeconds && ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null,
      });
    },
    async delete(key: string) {
      store.delete(key);
    },
    async consume<T>(key: string) {
      const entry = read(key);
      store.delete(key);
      return (entry?.value as T) ?? null;
    },
    async increment(key: string, windowSeconds: number) {
      const now = Date.now();
      const existing = counters.get(key);
      if (!existing || existing.expiresAt <= now) {
        counters.set(key, { count: 1, expiresAt: now + windowSeconds * 1000 });
        return 1;
      }
      existing.count += 1;
      return existing.count;
    },
  };
}

let cached: KvDriver | null = null;

export function getKv(): KvDriver {
  if (cached) return cached;

  if (isRemoteStorageConfigured()) {
    cached = createRedisDriver();
  } else {
    if (serverEnv.isProduction) throw new StorageConfigurationError();
    cached = createMemoryDriver();
  }

  return cached;
}

export function vaultKey(accountId: string): string {
  return `purbo:vault:${accountId}`;
}

/** A pending login nonce. Short-lived and single-use. */
export function nonceKey(nonce: string): string {
  return `purbo:nonce:${nonce}`;
}

/** A passkey bootstrap record, keyed by the hash above. */
export function passkeyKey(hash: string): string {
  return `purbo:passkey:${hash}`;
}

/** The list of credential hashes registered to an account. */
export function passkeyIndexKey(accountId: string): string {
  return `purbo:passkeys:${accountId}`;
}
