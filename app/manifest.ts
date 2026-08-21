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

    /*
     * What the install dialog shows before anyone commits to installing.
     *
     * Without these Chrome falls back to a one-line prompt that names the
     * origin and nothing else — for a password manager, asked for at the
     * moment someone is deciding whether to trust it with every credential
     * they own, that is the wrong amount of information. The narrow pair share
     * an aspect ratio because a form factor whose screenshots disagree is
     * dropped rather than letterboxed.
     *
     * They are captures of the real thing at the sizes named here, light
     * theme, taken from a production build. `npm run screenshots` retakes
     * them; see the note in the README about why that needs a browser you
     * bring yourself.
     */
    screenshots: [
      {
        src: "/screenshots/home-narrow.png",
        sizes: "412x915",
        type: "image/png",
        form_factor: "narrow",
        label: "Purbo's home page on a phone: the pitch, and a vault holding four entries.",
      },
      {
        src: "/screenshots/vault-narrow.png",
        sizes: "412x915",
        type: "image/png",
        form_factor: "narrow",
        // The screen `start_url` actually lands on, so the dialog is not
        // promising a different app from the one that opens.
        label: "Opening a vault: create a new one, restore a recovery phrase, or use a passkey.",
      },
      {
        src: "/screenshots/home-wide.png",
        sizes: "1280x800",
        type: "image/png",
        form_factor: "wide",
        label: "Purbo's home page on a desktop, beside a vault holding four entries.",
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
