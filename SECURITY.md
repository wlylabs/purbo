# Security policy

Purbo is a zero-knowledge password manager (see `README.md` for the full
threat model). **It has not been independently audited.** It is built from
standard, well-reviewed primitives rather than hand-rolled cryptography, but
until a third party has reviewed it, treat any security claim here as
best-effort, not a guarantee.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for a suspected vulnerability.

Use [GitHub's private vulnerability reporting](https://github.com/wlylabs/purbo/security/advisories/new)
for this repository. It reaches the maintainer directly and keeps the report
out of public view until a fix ships.

Include, as far as you can:

- What the vulnerability is and why it matters (which security property in
  the README it breaks — confidentiality of the vault, the zero-knowledge
  property, authentication, etc.).
- Steps to reproduce, or a proof-of-concept.
- The affected file(s)/route(s), if known.

There is no bug bounty. Expect an acknowledgement within a few days and a
best-effort timeline for a fix, communicated back through the same report.

## Scope

**In scope:**

- The key-derivation and encryption hierarchy (`lib/crypto/`, `lib/vault/`)
  — anything that would let the server, a network observer, or another
  account read or forge vault contents.
- The authentication flow (`lib/auth/`, `app/api/auth/`) — anything that lets
  a request be accepted without a valid signature, or a session token be
  forged or replayed.
- The passkey/WebAuthn wrapping (`lib/auth/passkey.ts`) — anything that lets
  a sealed passkey record be opened without the authenticator that sealed it.
- CSP, header, and same-origin bypasses (`proxy.ts`, `next.config.ts`) that
  would let script run in the vault's origin.
- The service worker (`public/sw.js`) caching or serving vault data, or
  applying an update without user consent.

**Out of scope** — these are documented, intentional trade-offs, not bugs:

- "There is no way to recover a vault without the recovery phrase or the
  passphrase." That is the zero-knowledge guarantee working as designed.
- Attacks that require a fully compromised client device (a keylogger, a
  malicious browser extension with host permissions, physical access to an
  unlocked, unattended session). Purbo defends the origin, not the OS.
- Social engineering, phishing look-alike domains, or a recovery phrase the
  user disclosed themselves.
- Denial of service against the rate limiter or the KV store.

If you are unsure whether something is in scope, report it anyway — it is
easier to close a report as out of scope than to miss a real finding.
