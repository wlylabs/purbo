import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { headers } from "next/headers";

import { ServiceWorker } from "@/components/pwa/service-worker";
import { THEME_SCRIPT } from "@/components/theme";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Purbo — End-to-end encrypted password manager",
    template: "%s · Purbo",
  },
  description:
    "Purbo is a zero-knowledge password manager with a wallet-style recovery phrase. " +
    "Everything is encrypted in your browser before it leaves the device.",
  applicationName: "Purbo",
  manifest: "/manifest.webmanifest",
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
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
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
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

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
        <Providers appId={appId}>{children}</Providers>
        <ServiceWorker />
      </body>
    </html>
  );
}
