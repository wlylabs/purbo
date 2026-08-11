import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The header advertises the framework version to anyone fingerprinting.
  poweredByHeader: false,

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
        // it can pin an old app shell in place indefinitely.
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
