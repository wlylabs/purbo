import "server-only";

import { Redis } from "@upstash/redis";

import { isRemoteStorageConfigured, serverEnv } from "./env";

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

export interface KvDriver {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
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
    async set<T>(key: string, value: T) {
      await redis.set(key, value);
    },
    async delete(key: string) {
      await redis.del(key);
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
  const store = new Map<string, unknown>();
  const counters = new Map<string, { count: number; expiresAt: number }>();

  return {
    async get<T>(key: string) {
      return (store.get(key) as T) ?? null;
    },
    async set<T>(key: string, value: T) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
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
    if (serverEnv.isProduction) {
      throw new Error(
        "No vault storage configured. Set UPSTASH_REDIS_REST_URL and " +
          "UPSTASH_REDIS_REST_TOKEN (or the KV_REST_API_* equivalents) " +
          "before deploying.",
      );
    }
    cached = createMemoryDriver();
  }

  return cached;
}

export function vaultKey(userId: string): string {
  return `purbo:vault:${userId}`;
}
