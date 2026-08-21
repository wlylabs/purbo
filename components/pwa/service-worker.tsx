"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * Service worker registration and the update prompt that goes with it.
 *
 * An update is never applied silently. Activating a new worker means
 * reloading the page, and a reload throws away the in-memory decryption key —
 * so the user is asked, told what it costs, and left alone until they say
 * yes. `skipWaiting()` is deliberately not called from inside the worker's
 * install handler for the same reason.
 */
export function ServiceWorker() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const reloading = useRef(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    let registration: ServiceWorkerRegistration | undefined;

    const track = (worker: ServiceWorker | null) => {
      if (!worker) return;
      const check = () => {
        // `controller` is null on the very first install — that is a fresh
        // page load, not an update, and needs no prompt.
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          setWaiting(worker);
        }
      };
      check();
      worker.addEventListener("statechange", check);
    };

    const onControllerChange = () => {
      if (reloading.current) return;
      reloading.current = true;
      window.location.reload();
    };

    void navigator.serviceWorker
      /*
       * The build id rides along on the script URL, and it is what makes an
       * update detectable at all.
       *
       * A browser decides there is a new worker by comparing the bytes of the
       * script it registered. `/sw.js` is a static file that does not change
       * when the app around it does, so registering it bare meant a deploy
       * shipped new code and nothing ever noticed — no `updatefound`, no
       * waiting worker, and this component's prompt never shown. An installed
       * app left open, which is how a password manager is used, could go on
       * running the build it started with.
       *
       * Registering a different URL for the same scope updates the existing
       * registration in place and runs the ordinary install flow, so the
       * worker below still waits for the user rather than swapping itself in
       * under an unlocked vault. The worker reads the same value back out of
       * its own location and names its caches after it.
       */
      .register(`/sw.js?v=${process.env.NEXT_PUBLIC_BUILD_ID || "dev"}`, {
        scope: "/",
        updateViaCache: "none",
      })
      .then((reg) => {
        registration = reg;
        track(reg.waiting);
        reg.addEventListener("updatefound", () => track(reg.installing));
      })
      .catch(() => {
        /* An unavailable worker degrades to a plain online-only app. */
      });

    // Re-check when the app comes back to the foreground; installed apps can
    // stay open for weeks without ever reloading.
    const onVisible = () => {
      if (document.visibilityState === "visible") void registration?.update();
    };
    document.addEventListener("visibilitychange", onVisible);
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  const applyUpdate = useCallback(() => {
    if (!waiting) return;
    // The reload follows from `controllerchange`, once the new worker is live.
    waiting.postMessage({ type: "SKIP_WAITING" });
    setWaiting(null);
  }, [waiting]);

  if (!waiting) return null;

  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
    >
      <div className="animate-in-up pointer-events-auto flex items-center gap-3 rounded-full border border-line bg-elevated py-2 pl-4 pr-2 shadow-pop">
        <p className="text-[0.8125rem] text-ink-muted">
          A new version is ready.
          <span className="hidden sm:inline"> Reloading locks the vault.</span>
        </p>
        <Button size="sm" variant="secondary" onClick={applyUpdate}>
          <RefreshCw className="size-3.5" aria-hidden />
          Reload
        </Button>
      </div>
    </div>
  );
}
