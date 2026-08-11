"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Install-to-home-screen state.
 *
 * Chromium fires `beforeinstallprompt` and lets the page trigger the native
 * dialog later; Safari fires nothing at all and requires the user to go
 * through the Share sheet by hand. Both are represented here so the UI can
 * say something true on either platform instead of showing a button that
 * does nothing on iOS.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type InstallPlatform = "prompt" | "manual" | "installed" | "unavailable";

const DISMISSED_KEY = "purbo:install-dismissed";

/** True when the page is running as an installed app rather than a tab. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: minimal-ui)").matches ||
    // iOS never adopted the display-mode media query for home-screen apps.
    ("standalone" in window.navigator && Boolean(window.navigator.standalone))
  );
}

function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
  // Chrome and Firefox on iOS cannot add to the home screen at all.
  return iOS && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

export function useInstall() {
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [platform, setPlatform] = useState<InstallPlatform>("unavailable");
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (isStandalone()) {
      setPlatform("installed");
      return;
    }

    setDismissed(window.localStorage.getItem(DISMISSED_KEY) === "1");
    if (isIosSafari()) setPlatform("manual");

    const onPrompt = (e: Event) => {
      // Suppress Chrome's own mini-infobar; the app asks in its own words.
      e.preventDefault();
      setEvent(e as BeforeInstallPromptEvent);
      setPlatform("prompt");
    };
    const onInstalled = () => {
      setEvent(null);
      setPlatform("installed");
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (!event) return false;
    await event.prompt();
    const { outcome } = await event.userChoice;
    // The event is single-use; the browser fires a fresh one if it re-qualifies.
    setEvent(null);
    if (outcome === "accepted") setPlatform("installed");
    return outcome === "accepted";
  }, [event]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    window.localStorage.setItem(DISMISSED_KEY, "1");
  }, []);

  return { platform, dismissed, install, dismiss };
}
