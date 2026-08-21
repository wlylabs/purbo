/**
 * Purbo service worker.
 *
 * What it caches: the application shell and immutable build assets. That is
 * all. A password manager's service worker is a cache sitting inside the
 * origin that holds the vault, so the rule here is narrow and absolute —
 *
 *   nothing from /api/ is ever read from or written to a cache,
 *   no cross-origin response is ever stored,
 *   only GET requests are considered at all.
 *
 * Encrypted vault data already has a home in IndexedDB (lib/storage/local),
 * written by the app itself and keyed per user. The worker's only job is to
 * make sure the code that decrypts it loads without a network.
 *
 * Strategies:
 *   navigations        network first, falling back to cache, then /offline
 *   /_next/static/*    cache first (content-hashed, immutable)
 *   same-origin assets stale-while-revalidate
 *
 * Every cache this worker opens is namespaced by the build it belongs to, and
 * anything from an older build is deleted on activate. See VERSION below for
 * where that name comes from and why it is not written down here.
 */

/**
 * This build's identity, handed over by the page as `?v=` on the script URL.
 *
 * It is not written here as a literal because a literal is exactly what stops
 * working: this file is static, so a hand-maintained version only changes when
 * somebody remembers to change it, and every deploy in between reuses the
 * caches of the one before it and never announces itself as an update. Taking
 * it from `self.location` instead means the file stays reproducible — the same
 * bytes on every deploy — while still getting a different version each time.
 *
 * The whole cache is therefore per-build, and `activate` drops the previous
 * build's on the way in. That costs a re-download of assets that had not
 * actually changed; the alternative is an asset cache that no deploy ever
 * prunes, which is not what a password manager should be growing quietly on
 * someone's device.
 */
const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";

const SHELL_CACHE = `purbo-shell-${VERSION}`;
const ASSET_CACHE = `purbo-assets-${VERSION}`;
const CURRENT_CACHES = new Set([SHELL_CACHE, ASSET_CACHE]);

const OFFLINE_URL = "/offline";

/** Fetched on install so a first-run offline launch still has something to show. */
const SHELL_URLS = ["/", "/vault", OFFLINE_URL];

/** Never touched by the cache, under any strategy. */
function isExcluded(url) {
  return url.pathname.startsWith("/api/");
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Individually, so one failure (an offline install, a 404) does not
      // abandon the whole precache the way cache.addAll would.
      await Promise.all(
        SHELL_URLS.map(async (url) => {
          try {
            const response = await fetch(url, { cache: "reload", credentials: "same-origin" });
            if (response.ok) await cache.put(url, response);
          } catch {
            /* Precaching is best effort; runtime caching fills the gaps. */
          }
        }),
      );
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => !CURRENT_CACHES.has(key)).map((key) => caches.delete(key)),
      );
      // Navigation preload lets the network request start before this worker
      // has even booted, which removes the usual SW cold-start penalty.
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
      await self.clients.claim();
    })(),
  );
});

/**
 * The page asks for an update when the user accepts one; a worker never
 * swaps itself out from under a tab that may be holding an unlocked vault.
 */
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") void self.skipWaiting();
});

async function handleNavigation(event) {
  const cache = await caches.open(SHELL_CACHE);

  try {
    const preloaded = await event.preloadResponse;
    const response = preloaded || (await fetch(event.request));
    // Only the shell is worth keeping, and only when the server actually
    // served it: opaque and error responses are not cache material.
    if (response.ok && response.type === "basic") {
      cache.put(event.request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    const cached = await cache.match(event.request);
    if (cached) return cached;

    // The vault is one client-rendered route, so its cached shell answers
    // any URL beneath it — /vault?tab=generator included.
    if (new URL(event.request.url).pathname.startsWith("/vault")) {
      const shell = await cache.match("/vault");
      if (shell) return shell;
    }

    // Anything else gets the offline page, not some other page of the app
    // rendered under a URL it does not belong to.
    return (await cache.match(OFFLINE_URL)) || Response.error();
  }
}

async function handleImmutableAsset(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok && response.type === "basic") {
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

async function handleAsset(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      if (response.ok && response.type === "basic") {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => cached ?? Response.error());

  return cached ?? network;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isExcluded(url)) return;

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(event));
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(handleImmutableAsset(request));
    return;
  }

  if (["style", "script", "font", "image"].includes(request.destination)) {
    event.respondWith(handleAsset(request));
  }
});
