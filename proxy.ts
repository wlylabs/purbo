import { NextResponse, type NextRequest } from "next/server";

/**
 * Per-request Content-Security-Policy with a fresh nonce.
 *
 * A nonce-based policy with `strict-dynamic` is what makes the vault's
 * client-side encryption meaningful: the whole design assumes an attacker
 * cannot run script in this origin, and a static allowlist CSP is routinely
 * bypassed via JSONP endpoints and outdated libraries on allowlisted CDNs.
 * With `strict-dynamic`, only scripts carrying this request's nonce (and
 * whatever they themselves load) execute — an injected `<script>` tag has no
 * nonce to guess.
 */

const PRIVY_ORIGINS = [
  "https://auth.privy.io",
  "https://*.privy.io",
  "wss://*.privy.io",
  "https://*.rpc.privy.systems",
  "https://explorer-api.walletconnect.com",
];

function buildCsp(nonce: string, isDev: boolean): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      // Argon2id runs as WebAssembly; without this the KDF cannot start.
      "'wasm-unsafe-eval'",
      // Next's dev overlay and Fast Refresh use eval.
      ...(isDev ? ["'unsafe-eval'"] : []),
    ],
    // Next injects style tags without a nonce; script injection is the real
    // threat here, and CSS-only injection cannot read the vault.
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", ...PRIVY_ORIGINS, ...(isDev ? ["ws:", "http://localhost:*"] : [])],
    // Privy renders its login flow in an iframe.
    "frame-src": ["'self'", "https://auth.privy.io", "https://*.privy.io"],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'none'"],
    "form-action": ["'self'"],
    // Nothing may frame Purbo — removes clickjacking of the unlock screen.
    "frame-ancestors": ["'none'"],
  };

  const policy = Object.entries(directives)
    .map(([key, values]) => `${key} ${values.join(" ")}`)
    .join("; ");

  return isDev ? policy : `${policy}; upgrade-insecure-requests`;
}

export default function proxy(request: NextRequest) {
  const isDev = process.env.NODE_ENV !== "production";

  // 128 bits of nonce, base64 — well past the CSP spec's 128-bit guidance.
  const nonce = Buffer.from(crypto.randomUUID().replace(/-/g, ""), "hex").toString("base64");
  const csp = buildCsp(nonce, isDev);

  const requestHeaders = new Headers(request.headers);
  // Next reads this to stamp its own bootstrap scripts, and the root layout
  // reads it to nonce the theme script.
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  response.headers.set("content-security-policy", csp);
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("x-frame-options", "DENY");
  // No URL — not even the origin — leaks to sites the user opens from an entry.
  response.headers.set("referrer-policy", "no-referrer");
  response.headers.set(
    "permissions-policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  );
  // Cross-origin isolation: blocks the classic XS-leak and Spectre-adjacent
  // read paths against a tab that holds decrypted secrets.
  response.headers.set("cross-origin-opener-policy", "same-origin");
  response.headers.set("cross-origin-resource-policy", "same-origin");
  response.headers.set("x-dns-prefetch-control", "off");

  if (!isDev) {
    response.headers.set(
      "strict-transport-security",
      "max-age=63072000; includeSubDomains; preload",
    );
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets, which are immutable and public —
     * running the nonce generator for each of them is pure overhead.
     */
    {
      source: "/((?!_next/static|_next/image|favicon.ico|robots.txt|manifest.webmanifest).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
