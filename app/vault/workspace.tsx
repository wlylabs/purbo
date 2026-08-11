"use client";

import { usePrivy } from "@privy-io/react-auth";
import { Loader2, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { Wordmark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Card, Notice } from "@/components/ui/primitives";
import { AppHeader } from "@/components/vault/app-header";
import { Dashboard } from "@/components/vault/dashboard";
import { LockScreen } from "@/components/vault/lock-screen";
import { Onboarding } from "@/components/vault/onboarding";
import { isStandalone } from "@/lib/pwa/install";
import { useVault } from "@/lib/vault/provider";

/**
 * Route shell for the authenticated app.
 *
 * Split into three components so no hook is ever called conditionally: the
 * vault context only exists when Privy is configured, and `usePrivy` only
 * exists inside the provider.
 */
export function VaultWorkspace({ configured }: { configured: boolean }) {
  if (!configured) return <NotConfigured />;
  return <AuthGate />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center px-5 py-12">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}

function NotConfigured() {
  return (
    <Centered>
      <Card className="p-6 sm:p-8">
        <ShieldAlert className="size-6" aria-hidden />
        <h1 className="text-display mt-4 text-2xl">Sign-in is not configured</h1>
        <p className="mt-2 text-[0.8125rem] leading-relaxed text-ink-muted">
          This deployment has no Privy app id, so the vault cannot be opened.
        </p>
        <Notice tone="caution" className="mt-5">
          Set <code className="font-mono">NEXT_PUBLIC_PRIVY_APP_ID</code> and{" "}
          <code className="font-mono">PRIVY_APP_SECRET</code> in your Vercel project, then
          redeploy.
        </Notice>
        <Link
          href="/"
          className="mt-6 inline-flex h-10 w-full items-center justify-center rounded-[var(--radius)] border border-line bg-elevated text-sm font-medium transition-colors hover:border-line-strong hover:bg-surface"
        >
          Back to home
        </Link>
      </Card>
    </Centered>
  );
}

function LoadingState({ message }: { message: string }) {
  return (
    <Centered>
      <div className="flex flex-col items-center gap-4 text-center">
        <Wordmark />
        <Loader2 className="size-5 animate-spin text-ink-subtle" aria-hidden />
        <p className="text-[0.8125rem] text-ink-muted" role="status">
          {message}
        </p>
      </div>
    </Centered>
  );
}

function AuthGate() {
  const { ready, authenticated, login } = usePrivy();
  const router = useRouter();

  // A signed-out visitor who lands here directly goes back to the marketing
  // page rather than staring at a dead screen. An installed app starts here
  // by design, though — bouncing it to the pitch page would be absurd.
  useEffect(() => {
    if (ready && !authenticated && !isStandalone()) {
      const timer = window.setTimeout(() => router.replace("/"), 4000);
      return () => window.clearTimeout(timer);
    }
  }, [ready, authenticated, router]);

  if (!ready) return <LoadingState message="Connecting…" />;

  if (!authenticated) {
    return (
      <Centered>
        <Card className="p-6 text-center sm:p-8">
          <Wordmark className="justify-center" />
          <h1 className="text-display mt-5 text-2xl">Sign in to open your vault</h1>
          <p className="mt-2 text-[0.8125rem] leading-relaxed text-ink-muted">
            Your vault is encrypted with keys that never leave your device.
          </p>
          <Button size="lg" className="mt-6 w-full" onClick={() => login()}>
            Continue
          </Button>
          <Link
            href="/"
            className="mt-4 inline-block text-[0.8125rem] text-ink-muted underline underline-offset-4 hover:text-ink"
          >
            Back to home
          </Link>
        </Card>
      </Centered>
    );
  }

  return <VaultShell />;
}

function VaultShell() {
  const { status } = useVault();

  if (status === "loading") return <LoadingState message="Loading your encrypted vault…" />;

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
