import type { MetadataRoute } from "next";

/**
 * Manifest members Next's `Manifest` type does not know about yet.
 *
 * The manifest route hands whatever this function returns to `JSON.stringify`
 * without inspecting it, so an unmodelled member is served verbatim; the type
 * is the only thing in the way.
 */
type AppManifest = MetadataRoute.Manifest & {
  handle_links?: "auto" | "preferred" | "not-preferred";
};

/**
 * Web app manifest.
 *
 * Purbo installs as a standalone app because that is how a password manager
 * is actually used: opened dozens of times a day, from a home screen or a
 * dock, never through a bookmark bar. The vault already keeps its ciphertext
 * in IndexedDB, so an installed copy that has been unlocked once on a device
 * stays usable with no network at all.
 */
export default function manifest(): AppManifest {
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

    /*
     * Links to Purbo open in Purbo, the way they would for any app the
     * operating system knows about.
     *
     * Installed, the app owns everything under `scope`, so a vault link from
     * a note, a chat, or a search result arrives in the app window instead of
     * a browser tab that happens to be pointed at the same origin. It is
     * "preferred" rather than "auto" because auto leaves the decision to the
     * browser, which today means it does not happen at all.
     */
    handle_links: "preferred",

    /*
     * A captured link focuses the window that is already open; it does not
     * navigate it.
     *
     * This is the one place where a password manager parts company with the
     * usual advice. `navigate-existing` is the natural choice for a link that
     * names a destination — but navigating a document reloads it, and a reload
     * discards the decryption key held in memory. Following a link to a vault
     * section would therefore lock the vault that was open a second ago, which
     * is precisely what the service worker's update prompt exists to avoid
     * doing silently.
     *
     * So the running window is focused instead, and the app applies the
     * launch URL itself, client-side, from `components/pwa/launch-handler`.
     * `auto` follows for browsers that implement no client mode at all: a new
     * window, which is the pre-launch-handler behaviour and still correct.
     */
    launch_handler: { client_mode: ["focus-existing", "auto"] },

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
