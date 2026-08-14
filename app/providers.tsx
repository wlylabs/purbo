"use client";

import { VaultProvider } from "@/lib/vault/provider";

/**
 * App-wide providers.
 *
 * There is exactly one, and it holds no credentials: Purbo has no identity
 * provider to configure, no SDK to boot, and nothing to wait for before the
 * page can render. Identity is derived from the recovery phrase inside the
 * vault provider itself, at the moment the user unlocks.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return <VaultProvider>{children}</VaultProvider>;
}
