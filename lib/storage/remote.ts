import { getAccessToken } from "@privy-io/react-auth";

import type { EncryptedVault, KeyEnvelope, EncryptedItem } from "@/lib/vault/types";

/**
 * Client for the encrypted vault API.
 *
 * A fresh Privy access token is attached per request rather than cached in a
 * module variable — tokens are short-lived, and a stale one produces a
 * confusing 401 mid-session.
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

async function authorisedFetch(input: string, init: RequestInit = {}) {
  const token = await getAccessToken();
  if (!token) throw new RemoteUnavailableError("Not authenticated.");

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

export async function fetchRemoteVault(): Promise<EncryptedVault | null> {
  const response = await authorisedFetch("/api/vault", { method: "GET" });

  if (response.status === 401) throw new RemoteUnavailableError("Session expired.");
  if (response.status === 503) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new RemoteUnavailableError(body.message ?? "Sync backend unavailable.");
  }
  if (!response.ok) throw new RemoteUnavailableError(`Sync failed (${response.status}).`);

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
  if (response.status === 401) throw new RemoteUnavailableError("Session expired.");
  if (response.status === 503) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new RemoteUnavailableError(body.message ?? "Sync backend unavailable.");
  }
  if (!response.ok) throw new RemoteUnavailableError(`Sync failed (${response.status}).`);

  return (await response.json()) as { revision: number; updatedAt: number };
}

export async function deleteRemoteVault(): Promise<void> {
  const response = await authorisedFetch("/api/vault", { method: "DELETE" });
  if (!response.ok && response.status !== 404) {
    throw new RemoteUnavailableError(`Delete failed (${response.status}).`);
  }
}
