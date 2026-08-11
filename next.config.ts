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
    ];
  },
};

export default nextConfig;
