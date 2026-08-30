import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { headers } from "next/headers";

import { LaunchHandler } from "@/components/pwa/launch-handler";
import { ServiceWorker } from "@/components/pwa/service-worker";
import { THEME_SCRIPT } from "@/components/theme";
import { Providers } from "./providers";
import "./globals.css";

/**
 * Absolute base for canonical and social URLs. Open Graph consumers reject
 * relative paths, so without this the card image would never resolve.
 * `VERCEL_PROJECT_PRODUCTION_URL` keeps preview deploys pointing at the
 * production domain rather than advertising their own throwaway hostname.
 */
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  alternates: { canonical: "/" },
  title: {
    default: "Purbo — End-to-end encrypted password manager",
    template: "%s · Purbo",
  },
  description:
    "Purbo is a zero-knowledge password manager with a wallet-style recovery phrase. " +
    "Everything is encrypted in your browser before it leaves the device.",
  applicationName: "Purbo",
  manifest: "/manifest.webmanifest",
  icons: {
    // favicon.ico, icon.svg and apple-icon.png are picked up automatically
    // from their app/ file conventions; only the Safari pinned-tab mask
    // needs declaring explicitly, since it isn't one of those conventions.
    other: [{ rel: "mask-icon", url: "/safari-pinned-tab.svg", color: "#09090b" }],
  },
  // Installed on iOS, Purbo runs without Safari's chrome; the status bar is
  // left to follow the page's theme colour rather than being forced dark.
  appleWebApp: {
    capable: true,
    title: "Purbo",
    statusBarStyle: "default",
  },
  // Vault entries contain digits that are not phone numbers; iOS turning
  // them into call links is both wrong and ugly.
  formatDetection: { telephone: false, address: false, email: false },
  robots: {
    index: true,
    follow: true,
    // Vault pages are behind auth, but be explicit that nothing gets archived.
    noarchive: true,
  },
  openGraph: {
    title: "Purbo — End-to-end encrypted password manager",
    description:
      "A password vault only you can open. Argon2id, AES-256-GCM, and a 24-word recovery phrase.",
    type: "website",
    url: "/",
    siteName: "Purbo",
    // The image itself comes from app/opengraph-image.tsx.
  },
  twitter: {
    card: "summary_large_image",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    // --canvas from app/globals.css, per theme. A mismatch here paints a
    // seam across the top of the screen on mobile, where the browser bar
    // takes this colour and the page underneath takes the token.
    { media: "(prefers-color-scheme: light)", color: "#f4f4f5" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Supplied by middleware; used to satisfy the nonce-based CSP.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable}`}
    >
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh bg-canvas text-ink antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-4 focus:left-4 focus:rounded-md focus:bg-invert-bg focus:px-4 focus:py-2 focus:text-invert-fg"
        >
          Skip to content
        </a>
        <Providers>{children}</Providers>
        <LaunchHandler />
        <ServiceWorker />
      </body>
    </html>
  );
}
