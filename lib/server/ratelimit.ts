import "server-only";

import { getKv } from "./kv";

/**
 * Fixed-window rate limiting.
 *
 * The vault API is the only network surface that touches user data, and it
 * is authenticated — but limits still matter: they cap the damage from a
 * stolen token and stop a single client from hammering the storage backend.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  retryAfterSeconds: number;
}

export interface RateLimitOptions {
  limit: number;
  windowSeconds: number;
}

export async function rateLimit(
  bucket: string,
  identity: string,
  { limit, windowSeconds }: RateLimitOptions,
): Promise<RateLimitResult> {
  const window = Math.floor(Date.now() / 1000 / windowSeconds);
  const key = `purbo:rl:${bucket}:${identity}:${window}`;

  try {
    const count = await getKv().increment(key, windowSeconds);
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      limit,
      retryAfterSeconds: windowSeconds,
    };
  } catch {
    // Fail open on a limiter outage. The alternative — locking every user out
    // of their passwords because a counter is unreachable — is the worse
    // failure, and the routes behind this are already authenticated.
    return { allowed: true, remaining: limit, limit, retryAfterSeconds: 0 };
  }
}

/**
 * Best-effort client address, used only to bucket unauthenticated traffic.
 *
 * Every one of these headers is a claim the caller can make; they are
 * meaningful only because a proxy in front of this rewrites them. Vercel's
 * own header is preferred for that reason — it is set by the platform and a
 * client-supplied copy is discarded — with the conventional two behind it.
 *
 * Deploying this behind anything that does not rewrite `x-forwarded-for`
 * makes per-address limits bypassable by sending a different value each time.
 * The limits on authenticated routes are keyed by account and unaffected.
 */
export function clientIdentity(request: Request): string {
  const vercel = request.headers.get("x-vercel-forwarded-for");
  if (vercel) return vercel.split(",")[0]!.trim();

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();

  return request.headers.get("x-real-ip") ?? "unknown";
}
