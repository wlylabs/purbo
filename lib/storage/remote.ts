import { NotAuthenticatedError, getSessionToken } from "@/lib/auth/session";
import type { EncryptedVault, KeyEnvelope, EncryptedItem } from "@/lib/vault/types";

/**
 * Client for the encrypted vault API.
 *
 * Session tokens are short-lived and minted on demand from the identity held
 * in memory, so a request that comes back 401 is retried once against a fresh
 * token rather than surfacing as a spurious "session expired" mid-edit. The
 * user is never asked to sign in again for a token that simply aged out.
 */

export class RevisionConflictError extends Error {
  constructor(public readonly currentRevision: number) {
    super("The vault changed on another device.");
    this.name = "RevisionConflictError";
  }
}

export class RemoteUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemoteUnavailableError";
  }
}

async function send(input: string, init: RequestInit, token: string) {
  return fetch(input, {
    ...init,
    headers: {
      ...init.headers,
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    cache: "no-store",
    credentials: "omit",
  });
}

async function authorisedFetch(input: string, init: RequestInit = {}) {
  let token: string;
  try {
    token = await getSessionToken();
  } catch (error) {
    if (error instanceof NotAuthenticatedError) {
      throw new RemoteUnavailableError("Not authenticated.");
    }
    throw new RemoteUnavailableError(
      error instanceof Error ? error.message : "Could not sign in.",
    );
  }

  const response = await send(input, init, token);
  if (response.status !== 401) return response;

  // One retry with a freshly signed token. A second 401 is a real refusal.
  try {
    return await send(input, init, await getSessionToken(true));
  } catch {
    return response;
  }
}

async function readError(response: Response): Promise<string | undefined> {
  const body = (await response.json().catch(() => ({}))) as { message?: string };
  return body.message;
}

async function guard(response: Response): Promise<void> {
  if (response.ok) return;
  if (response.status === 401) throw new RemoteUnavailableError("Session expired.");
  if (response.status === 503) {
    throw new RemoteUnavailableError(
      (await readError(response)) ?? "Sync backend unavailable.",
    );
  }
  throw new RemoteUnavailableError(`Sync failed (${response.status}).`);
}

export async function fetchRemoteVault(): Promise<EncryptedVault | null> {
  const response = await authorisedFetch("/api/vault", { method: "GET" });
  await guard(response);

  const body = (await response.json()) as { vault: EncryptedVault | null };
  return body.vault;
}

export async function pushRemoteVault(payload: {
  envelope: KeyEnvelope;
  items: EncryptedItem[];
  revision: number;
}): Promise<{ revision: number; updatedAt: number }> {
  const response = await authorisedFetch("/api/vault", {
    method: "PUT",
    body: JSON.stringify(payload),
  });

  if (response.status === 409) {
    const body = (await response.json().catch(() => ({}))) as { currentRevision?: number };
    throw new RevisionConflictError(body.currentRevision ?? payload.revision);
  }
  await guard(response);

  return (await response.json()) as { revision: number; updatedAt: number };
}

export async function deleteRemoteVault(): Promise<void> {
  const response = await authorisedFetch("/api/vault", { method: "DELETE" });
  if (!response.ok && response.status !== 404) {
    throw new RemoteUnavailableError(`Delete failed (${response.status}).`);
  }
}
