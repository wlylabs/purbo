import type { Metadata } from "next";
import { CloudOff } from "lucide-react";
import Link from "next/link";

import { Wordmark } from "@/components/logo";
import { Card } from "@/components/ui/primitives";

export const metadata: Metadata = {
  title: "Offline",
  robots: { index: false, follow: false },
};

/**
 * Last-resort fallback, served by the service worker when a navigation fails
 * and no cached copy of the requested page exists.
 *
 * It stays deliberately reassuring: an offline Purbo is not a broken Purbo.
 * The vault's ciphertext lives in IndexedDB on this device and the keys are
 * derived locally, so once the app shell is cached the vault opens with no
 * network at all — only syncing waits for the connection to come back.
 */
export default function OfflinePage() {
  return (
    <main id="main" className="grid min-h-dvh place-items-center px-5 py-10 sm:py-12">
      <div className="w-full max-w-md">
        <Card className="p-5 text-center sm:p-8">
          <Wordmark className="justify-center" />

          <CloudOff className="mx-auto mt-6 size-6 text-ink-subtle" aria-hidden />
          <h1 className="text-display mt-4 text-2xl">You are offline</h1>
          <p className="mt-2 text-[0.8125rem] leading-relaxed text-ink-muted">
            This page has not been cached on your device yet. Your vault itself does not
            need a connection — open it and unlock as usual; changes sync once you are
            back online.
          </p>

          <Link
            href="/vault"
            className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-[var(--radius)] bg-invert-bg text-sm font-medium text-invert-fg transition-opacity hover:opacity-90"
          >
            Open vault
          </Link>
        </Card>
      </div>
    </main>
  );
}
