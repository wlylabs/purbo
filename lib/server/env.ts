import "server-only";

/**
 * Server configuration.
 *
 * Reads are lazy and never throw at module load — a missing integration must
 * degrade to a clear runtime error on the affected route, not a build failure
 * or a blank deployment.
 */

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

export const serverEnv = {
  get privyAppId() {
    return optional("NEXT_PUBLIC_PRIVY_APP_ID");
  },
  get privyAppSecret() {
    return optional("PRIVY_APP_SECRET");
  },
  /** Optional; skips a network round-trip per token verification. */
  get privyVerificationKey() {
    return optional("PRIVY_VERIFICATION_KEY");
  },
  get upstashUrl() {
    return optional("UPSTASH_REDIS_REST_URL") ?? optional("KV_REST_API_URL");
  },
  get upstashToken() {
    return optional("UPSTASH_REDIS_REST_TOKEN") ?? optional("KV_REST_API_TOKEN");
  },
  get isProduction() {
    return process.env.NODE_ENV === "production";
  },
} as const;

export function isPrivyConfigured(): boolean {
  return Boolean(serverEnv.privyAppId && serverEnv.privyAppSecret);
}

export function isRemoteStorageConfigured(): boolean {
  return Boolean(serverEnv.upstashUrl && serverEnv.upstashToken);
}
