/**
 * App launches: what happens when something outside Purbo points at Purbo.
 *
 * An installed app that captures links (`handle_links` in the manifest) is
 * handed the URL that was clicked, even when a window is already open. The
 * manifest asks for `focus-existing`, so the browser raises the running
 * window and hands the target over here rather than navigating the document —
 * a navigation would reload the page, and a reload throws away the
 * decryption key held in memory, locking the vault the link was meant to open.
 *
 * Applying the target is therefore the app's job, which is what this module
 * and `components/pwa/launch-handler` do between them: resolve the URL
 * safely, navigate to it client-side, and let views that read the query
 * string know it has changed underneath them.
 */

/** The single argument the browser hands a launch consumer. */
interface LaunchParams {
  readonly targetURL?: string;
}

declare global {
  interface Window {
    launchQueue?: {
      setConsumer(consumer: (params: LaunchParams) => void): void;
    };
  }
}

/**
 * The manifest's `scope`. Anything outside it is not this app's to open, and
 * the two have to agree — a launch is only handled for pages the manifest
 * claims.
 */
const SCOPE = "/";

/**
 * Fired once a launch has been applied to the current document.
 *
 * The app is a single page whose state is read from the URL at mount — the
 * dashboard's `?tab=`, for one. Focusing an open window remounts nothing, so
 * without an announcement a captured link would raise the app and leave it
 * showing whatever it was showing before.
 */
export const LAUNCH_EVENT = "purbo:launch";

/** Subscribe to launches; returns the unsubscribe. */
export function onLaunch(handler: () => void): () => void {
  window.addEventListener(LAUNCH_EVENT, handler);
  return () => window.removeEventListener(LAUNCH_EVENT, handler);
}

export function announceLaunch(): void {
  window.dispatchEvent(new Event(LAUNCH_EVENT));
}

/**
 * The path a launch target names, or null if there is nothing to do with it.
 *
 * A launch URL arrives from outside the app and is treated as such. Anything
 * that is not an ordinary in-scope page of this origin is dropped rather than
 * followed: an absolute URL elsewhere would be an open redirect performed by
 * the app on itself, and a `javascript:` or `data:` target dressed up as a
 * launch would be worse. Browsers are specified to only ever launch an app
 * with a URL inside its own scope; this does not take that on trust.
 *
 * A target that names the page already open returns null too, so a launch
 * that changes nothing does not push a navigation through the router.
 */
export function resolveLaunchTarget(raw: string | undefined, current: URL): string | null {
  if (!raw) return null;

  let target: URL;
  try {
    target = new URL(raw, current);
  } catch {
    return null;
  }

  if (target.origin !== current.origin) return null;
  if (!target.pathname.startsWith(SCOPE)) return null;

  const path = `${target.pathname}${target.search}${target.hash}`;
  const here = `${current.pathname}${current.search}${current.hash}`;
  return path === here ? null : path;
}
