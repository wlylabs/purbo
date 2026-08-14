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
  /** HMAC key for session tokens. The only secret the auth layer needs. */
  get authSessionSecret() {
    return optional("AUTH_SESSION_SECRET");
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

export class AuthConfigurationError extends Error {
  constructor() {
    super(
      "No session secret configured. Set AUTH_SESSION_SECRET to a long random " +
        "string before deploying.",
    );
    this.name = "AuthConfigurationError";
  }
}

/**
 * A per-process secret, used only when none is configured in development.
 *
 * It exists so `npm run dev` works with an empty `.env.local`: sessions stay
 * valid for the life of the process and every restart silently invalidates
 * them, which the client handles by re-signing a challenge. In production
 * this fallback is refused outright — a secret that changes on every cold
 * start would sign out every user at random, and a serverless deployment
 * runs many processes that would each mint tokens the others reject.
 */
let ephemeralSecret: string | null = null;

export function sessionSecret(): string | undefined {
  const configured = serverEnv.authSessionSecret;
  if (configured) return configured;
  if (serverEnv.isProduction) return undefined;

  if (!ephemeralSecret) {
    ephemeralSecret = crypto.randomUUID() + crypto.randomUUID();
    console.warn(
      "[auth] AUTH_SESSION_SECRET is not set; using an ephemeral development " +
        "secret. Sessions will not survive a restart.",
    );
  }
  return ephemeralSecret;
}

export function isAuthConfigured(): boolean {
  return Boolean(sessionSecret());
}

export function isRemoteStorageConfigured(): boolean {
  return Boolean(serverEnv.upstashUrl && serverEnv.upstashToken);
}
