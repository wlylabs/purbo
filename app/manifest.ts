import type { MetadataRoute } from "next";

/**
 * Web app manifest.
 *
 * Purbo installs as a standalone app because that is how a password manager
 * is actually used: opened dozens of times a day, from a home screen or a
 * dock, never through a bookmark bar. The vault already keeps its ciphertext
 * in IndexedDB, so an installed copy that has been unlocked once on a device
 * stays usable with no network at all.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Purbo — Encrypted password manager",
    short_name: "Purbo",
    description:
      "A zero-knowledge password manager. Everything is encrypted in your browser " +
      "before it leaves the device.",

    // Installed users are returning users: open the vault, not the pitch.
    start_url: "/vault",
    scope: "/",

    display: "standalone",
    display_override: ["standalone", "minimal-ui"],

    // The splash screen matches the icon rather than the active theme —
    // one identity, not two.
    background_color: "#09090b",
    theme_color: "#09090b",

    categories: ["productivity", "security", "utilities"],
    dir: "ltr",
    lang: "en",
    orientation: "any",
    prefer_related_applications: false,

    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],

    shortcuts: [
      {
        name: "Open vault",
        short_name: "Vault",
        url: "/vault",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Password generator",
        short_name: "Generator",
        url: "/vault?tab=generator",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}
