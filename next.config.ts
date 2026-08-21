import { execSync } from "node:child_process";

import type { NextConfig } from "next";

/**
 * The identity of this build, as far as the service worker is concerned.
 *
 * It has to satisfy two things at once.
 *
 * It must change whenever the deployed code changes. A browser only looks for
 * a new worker when the script it registered differs, and `public/sw.js` is a
 * static file that is byte-identical from one deploy to the next — so left to
 * itself it never announces anything, and the update prompt that exists to ask
 * before throwing away an unlocked vault would never appear.
 *
 * And it must be derived from the commit rather than from the moment of the
 * build, because it is inlined into a client chunk. A timestamp or a random
 * value would change that chunk's content hash on every rebuild, and
 * `scripts/verify-build.mjs` — which asks whether a local rebuild of a commit
 * reproduces the bytes a deployment serves — would then call an honest rebuild
 * a mismatch.
 */
function buildId(): string {
  const fromCi = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA;
  if (fromCi) return fromCi.slice(0, 12);

  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim()
      .slice(0, 12);
  } catch {
    // A tarball with no git history and no CI to ask. The worker still
    // installs and still caches; it just cannot tell two such builds apart.
    return "dev";
  }
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The header advertises the framework version to anyone fingerprinting.
  poweredByHeader: false,

  // Inlined at build time. Read by the service worker registration, which
  // hands it back to the worker as the cache version it should use.
  env: {
    NEXT_PUBLIC_BUILD_ID: buildId(),
  },

  async headers() {
    return [
      {
        // Vault responses must never be cached by a proxy or the browser;
        // the route sets this too, belt and braces.
        source: "/api/:path*",
        headers: [
          { key: "cache-control", value: "no-store, no-cache, must-revalidate, private" },
          { key: "x-content-type-options", value: "nosniff" },
        ],
      },
      {
        // The worker must be revalidated on every check, or a cached copy of
        // it can pin an old app shell in place indefinitely. Matching is on
        // the pathname, so the `?v=` the registration appends stays covered.
        source: "/sw.js",
        headers: [
          { key: "cache-control", value: "no-cache, must-revalidate" },
          { key: "content-type", value: "text/javascript; charset=utf-8" },
          // Served from /, so it already controls the whole origin; explicit
          // for the day it moves.
          { key: "service-worker-allowed", value: "/" },
        ],
      },
      {
        // Not content-hashed, so cached for a week rather than forever.
        source: "/icons/:path*",
        headers: [{ key: "cache-control", value: "public, max-age=604800" }],
      },
    ];
  },
};

export default nextConfig;
