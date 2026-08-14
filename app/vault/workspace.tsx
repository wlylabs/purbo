"use client";

import { Wordmark } from "@/components/logo";
import { WaitState } from "@/components/ui/loader";
import { AppHeader } from "@/components/vault/app-header";
import { Dashboard } from "@/components/vault/dashboard";
import { LockScreen } from "@/components/vault/lock-screen";
import { Onboarding } from "@/components/vault/onboarding";
import { useVault } from "@/lib/vault/provider";

/**
 * Route shell for the app.
 *
 * There is no auth gate in front of this any more, and there is nothing to
 * redirect a "signed-out" visitor to: with identity derived from the
 * recovery phrase, arriving here without a vault is not an error state, it is
 * the first screen. The whole gate collapses into one question the browser
 * can answer locally — is there a vault on this device?
 */
export function VaultWorkspace() {
  const { status } = useVault();

  if (status === "loading") {
    return (
      <div className="grid min-h-dvh place-items-center px-5 py-10 sm:py-12">
        <div className="flex w-full max-w-md flex-col items-center gap-7">
          <Wordmark />
          <WaitState
            message="Looking for a vault on this device…"
            hint="Nothing is decrypted until you unlock."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <main id="main" className="flex flex-1 flex-col">
        {status === "absent" ? <Onboarding /> : null}
        {status === "locked" ? <LockScreen /> : null}
        {status === "unlocked" ? <Dashboard /> : null}
      </main>
    </div>
  );
}
