import "server-only";

import { NextResponse } from "next/server";

import { AuthConfigurationError, UnauthorizedError } from "./auth";
import { StorageConfigurationError } from "./kv";

/**
 * Shared response shape for every API route.
 *
 * All of them handle credentials or ciphertext, so all of them are
 * unconditionally uncacheable and all of them collapse failures to the same
 * small set of codes. Error text is never derived from an exception message:
 * internal strings are the cheapest source of reconnaissance there is.
 */

const NO_STORE = {
  "Cache-Control": "no-store, no-cache, must-revalidate, private",
  "Pragma": "no-cache",
} as const;

export function json(body: unknown, status: number, extraHeaders: HeadersInit = {}) {
  return NextResponse.json(body, {
    status,
    headers: { ...NO_STORE, ...extraHeaders },
  });
}

export function rateLimited(retryAfterSeconds: number) {
  return json({ error: "rate_limited" }, 429, {
    "Retry-After": String(retryAfterSeconds),
  });
}

export function handleError(scope: string, error: unknown) {
  if (error instanceof UnauthorizedError) {
    return json({ error: "unauthorized" }, 401);
  }
  if (error instanceof AuthConfigurationError) {
    return json({ error: "auth_not_configured", message: error.message }, 503);
  }
  if (error instanceof StorageConfigurationError) {
    return json({ error: "storage_not_configured", message: error.message }, 503);
  }
  console.error(`[${scope}] unhandled error`, error);
  return json({ error: "internal_error" }, 500);
}
