"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { useEffect, useState } from "react";

import { VaultProvider } from "@/lib/vault/provider";

/**
 * Privy configuration.
 *
 * Purbo keeps the "connect a wallet" mental model but does not need an
 * on-chain wallet to function — the vault's root of trust is the recovery
 * phrase, not an address. Privy supplies identity and session, nothing more,
 * and never sees any key material.
 */
export function Providers({
  children,
  appId,
}: {
  children: React.ReactNode;
  appId?: string;
}) {
  // Privy touches browser-only APIs during init; rendering it on the server
  // pass produces a hydration mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!appId) {
    // Unconfigured deployments still render the marketing site and a clear
    // setup message, instead of crashing on a missing app id.
    return <>{children}</>;
  }

  if (!mounted) return <>{children}</>;

  return (
    <PrivyProvider
      appId={appId}
      config={{
        appearance: {
          theme:
            typeof document !== "undefined" &&
            document.documentElement.getAttribute("data-theme") === "light"
              ? "light"
              : "dark",
          accentColor: "#6E6E78",
          logo: undefined,
          walletChainType: "ethereum-only",
        },
        loginMethods: ["email", "wallet", "google", "github"],
        embeddedWallets: {
          ethereum: {
            // Every account gets a wallet, so the "create wallet" flow is
            // real rather than cosmetic — but the vault never depends on it.
            createOnLogin: "users-without-wallets",
          },
        },
      }}
    >
      <VaultProvider>{children}</VaultProvider>
    </PrivyProvider>
  );
}
