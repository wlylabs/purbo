"use client";

import { Download, Share, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { useInstall } from "@/lib/pwa/install";

/**
 * A one-line invitation to install, shown at the bottom of the marketing
 * page. It appears only when the browser has already decided the app is
 * installable, waits a few seconds so it never competes with the hero, and
 * stays dismissed once dismissed.
 */
export function InstallBanner() {
  const { platform, dismissed, install, dismiss } = useInstall();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (platform !== "prompt" || dismissed) return;
    const timer = window.setTimeout(() => setVisible(true), 2500);
    return () => window.clearTimeout(timer);
  }, [platform, dismissed]);

  if (!visible || platform !== "prompt" || dismissed) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <div className="animate-in-up shadow-pop pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-[var(--radius-lg)] border border-line bg-elevated p-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-invert-bg text-invert-fg">
          <Logo className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[0.8125rem] font-medium">Install Purbo</p>
          <p className="truncate text-xs text-ink-subtle">
            Opens like an app, works offline.
          </p>
        </div>
        <Button size="sm" onClick={() => void install()}>
          Install
        </Button>
        <Button size="icon" variant="ghost" onClick={dismiss} aria-label="Dismiss">
          <X className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

/**
 * The same capability as a settings row: always present, and honest about
 * what each platform can actually do — Safari has no install API, so it gets
 * instructions rather than a button that would do nothing.
 */
export function InstallSection() {
  const { platform, install } = useInstall();

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[0.9375rem] font-semibold tracking-tight">Install Purbo</h2>
          <p className="mt-1 max-w-prose text-[0.8125rem] leading-relaxed text-ink-muted">
            Installed, Purbo opens in its own window and keeps working without a
            connection — your encrypted vault is already stored on this device, so an
            offline unlock uses the same key material as an online one.
          </p>
        </div>

        {platform === "prompt" ? (
          <Button variant="secondary" size="sm" onClick={() => void install()}>
            <Download className="size-3.5" aria-hidden />
            Install
          </Button>
        ) : null}
      </div>

      {platform === "installed" ? (
        <p className="mt-4 text-[0.8125rem] text-ink-muted">
          Purbo is installed on this device.
        </p>
      ) : null}

      {platform === "manual" ? (
        <p className="mt-4 flex flex-wrap items-center gap-1.5 text-[0.8125rem] text-ink-muted">
          On iPhone and iPad, tap
          <Share className="size-3.5" aria-hidden />
          <span className="font-medium text-ink">Share</span>
          then
          <span className="font-medium text-ink">Add to Home Screen</span>.
        </p>
      ) : null}

      {platform === "unavailable" ? (
        <p className="mt-4 text-[0.8125rem] text-ink-muted">
          Your browser will offer an install option in its address bar or menu once it
          decides Purbo qualifies.
        </p>
      ) : null}
    </>
  );
}
