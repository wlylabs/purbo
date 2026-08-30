"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { announceLaunch, resolveLaunchTarget } from "@/lib/pwa/launch";

/**
 * Applies the URL an app launch arrived with.
 *
 * Installed and asked to handle links, Purbo is launched with a target URL
 * the way any app registered for a scheme is — from a link in another app, a
 * search result, or one of the manifest's shortcuts. The manifest asks for
 * `focus-existing`, so when a window is already open the browser raises it
 * and leaves the target here instead of navigating the document: navigating
 * reloads, and a reload discards the in-memory key and locks the vault.
 *
 * That makes moving to the target this component's job, and it does it as a
 * client-side navigation — the window that was open stays open, still
 * unlocked, now showing what the link asked for.
 *
 * Renders nothing. On a browser with no launch queue — every engine but
 * Chromium's, today — it does nothing at all, and a launch opens a window
 * pointed at the URL in the ordinary way, which is the behaviour this
 * replaces rather than depends on.
 */
export function LaunchHandler() {
  const router = useRouter();

  useEffect(() => {
    const queue = window.launchQueue;
    if (!queue) return;

    // Setting a consumer replaces any previous one and immediately drains
    // whatever the browser queued before the app was ready. Params are handed
    // over once, so a re-registration after a navigation replays nothing.
    queue.setConsumer(({ targetURL }) => {
      const here = new URL(window.location.href);
      const target = resolveLaunchTarget(targetURL, here);
      if (!target) return;

      if (new URL(target, here).pathname === here.pathname) {
        /*
         * The same page with a different query — `/vault?tab=generator` while
         * the vault is already open, which is what a section link and a
         * long-press shortcut both look like. The router treats that as a
         * navigation to the route it is already on; `replaceState` moves the
         * URL without one, and the announcement is what tells the views
         * reading that query to look again. Replace rather than push: a
         * launch is where the app is now, not a step to come back from.
         */
        window.history.replaceState(null, "", target);
        announceLaunch();
        return;
      }

      // A different page. An ordinary client-side navigation gets there
      // without a reload, and whatever mounts reads the query itself.
      router.replace(target);
    });
  }, [router]);

  return null;
}
