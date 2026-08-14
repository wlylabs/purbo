# Purbo

A password manager built around a web3 wallet flow: you create a "wallet" and
get a 24-word recovery phrase that is the only root of your vault. Every entry
is encrypted in the browser before it touches the network.

There is no sign-up, no email and no identity provider. The phrase derives
both the key that encrypts your entries and the key that authenticates you to
the server, so "signed in" and "can decrypt" are the same fact. Day to day you
open the vault with a passphrase or a device passkey.

Landing page → create your vault → write down 24 words → save passwords.
The server stores ciphertext and nothing else.

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| Styling | Tailwind CSS v4, Geist Sans/Mono |
| App shell | Installable PWA — web app manifest, hand-written service worker |
| Auth | Self-derived — Ed25519 challenge–response from the recovery phrase, plus WebAuthn passkeys |
| Storage | Upstash / Vercel KV (encrypted blobs only) |
| Crypto | WebCrypto (AES-256-GCM, HKDF-SHA-256, HMAC), Argon2id via `hash-wasm`, BIP39 via `@scure/bip39`, Ed25519 via `@noble/curves` |
| Hosting | Vercel |

## Security model

The whole design follows from one rule: **the server must never be able to
read a vault.** Everything else is a consequence.

```
24-word recovery phrase  ──PBKDF2-HMAC-SHA512──▶  BIP39 seed
                                        ┌─────────────┴─────────────┐
                    HKDF "purbo:auth:v1"│                           │HKDF "purbo:root:v1"
                                        ▼                           ▼
                                Ed25519 secret                  root key ──HKDF──▶ data key
                                        │                           │                  │
                            public key ─┴─SHA-256─▶ accountId       │                  ▼
                                                                    │   AES-256-GCM per entry
                     passphrase ──Argon2id──▶ KEK ──AES-GCM wrap────┤   (random IV, AAD-bound)
                                              │                     │
                                              ▼                     └──▶ wraps the Ed25519
                                        KeyEnvelope                      secret into the envelope
                                   (safe to store anywhere)
```

Three independent paths reach the root key:

- **Passphrase** — fast, per-device. Stretched with Argon2id (64 MiB, 3 passes,
  1 lane), comfortably above the OWASP floor, then used to unwrap the stored
  root key.
- **Recovery phrase** — offline and portable. Reconstructs the root key from
  scratch, so a forgotten passphrase is recoverable and a new device needs
  nothing but the words.
- **Passkey** — optional, per-authenticator. WebAuthn's PRF extension yields a
  32-byte secret only that authenticator can reproduce, and only behind a
  biometric or device PIN; it wraps a copy of the root key stored server-side
  as ciphertext.

What the server holds, in full: a wrapped root key, its public KDF parameters,
an array of sealed entries, a revision counter, and any sealed passkey records.
It is filed under a hash of the account's public key — there is no email,
username or third-party identifier anywhere in it.

### Authentication

Requests carry a bearer token, and the only way to get one is to sign for it:

```
POST /api/auth/challenge   { publicKey }            ──▶  { nonce }        (single-use, 120s)
                 sign "purbo-auth-v1\n<origin>\n<nonce>\n<publicKey>"
POST /api/auth/session     { publicKey, nonce, sig } ──▶  { token }        (HMAC, 1 hour)
```

The nonce is redeemed with an atomic read-and-delete, so two requests racing on
one nonce cannot both win. The origin is taken from the request URL rather than
a header, so a signature made against one deployment will not verify on
another. The token is an HMAC-SHA-256 tag over `{sub, iat, exp}` — not a JWT,
because the one field of a JWT that matters here is the one an attacker gets to
choose.

Two consequences worth stating plainly. The operator cannot mint a session for
an account, because doing so requires a signature only the phrase can produce.
And `/api/auth/session` deliberately issues a token for *any* valid signature,
including keys with no vault — refusing unknown keys would turn login into an
account-existence oracle.

Passkeys are a key-wrapping factor, not an identity: the server never verifies
a WebAuthn assertion and stores no credential public key. The credential id is
an unguessable lookup handle for a sealed record, which is exactly why the
record is sealed.

### Specific properties

- **Nothing is stored in the clear** — the entry name, username, URL and notes
  live inside the ciphertext, not just the password. Search runs in memory
  over decrypted entries while the vault is unlocked.
- **Ciphertexts are context-bound.** Each is sealed with associated data tying
  it to its owner and its own record id, so relocating a blob between records
  or between users fails to decrypt instead of succeeding quietly.
- **KDF parameters are validated on both sides.** Cost parameters travel with
  the ciphertext, so a compromised server could otherwise hand back
  `iterations: 1` and silently downgrade every future unlock.
- **Recovery fails closed.** The envelope carries a verifier — a constant
  sealed under a subkey of the root key — so a checksum-valid phrase that
  belongs to a *different* vault is rejected instead of re-wrapping the vault
  around a key that decrypts nothing.
- **Keys are non-extractable.** The data key is a `CryptoKey` that script can
  use but cannot read out, and intermediate key bytes are zeroed after use.
- **The vault re-locks** after inactivity, and copied passwords are cleared
  from the clipboard after 30 seconds if nothing has overwritten them.
- **A nonce-based CSP with `strict-dynamic`** is issued per request. Allowlist
  CSPs are routinely bypassed through JSONP endpoints on allowlisted hosts; a
  nonce leaves an injected `<script>` with nothing to guess. Paired with HSTS
  preload, `frame-ancestors 'none'`, COOP/CORP isolation and `no-referrer`.
- **Rate limits** on every route — per account where the caller is
  authenticated, per address where it cannot yet be.
- **No third-party origin is reachable.** `connect-src` is `'self'`, `frame-src`
  is `'none'`, and WebAuthn is granted to this origin alone via
  `publickey-credentials-get=(self)` — an embedded frame can never ask for an
  assertion on Purbo's behalf.

## Installing it

Purbo is a progressive web app. Installed, it opens in its own window from a
home screen or a dock and keeps working with no connection at all: the vault's
ciphertext is already in IndexedDB and the keys are derived on the device, so
`public/sw.js` only has to make sure the code that decrypts it loads. Syncing
is the one thing that waits for the network.

The service worker is written by hand rather than generated, because a cache
living inside the origin that holds the vault deserves to be readable end to
end. Its rules:

- **`/api/` is never cached** — not read from, not written to, under any
  strategy. Vault ciphertext reaches the cache layer only through IndexedDB,
  where the app put it deliberately.
- **Cross-origin responses are never stored**, so nothing from a third party
  ends up in a cache this origin controls. In practice there is nothing to
  store: Purbo makes no cross-origin requests at all.
- **Navigations are network-first**, falling back to the cached shell and then
  to `/offline`; `/_next/static/*` is cache-first because it is
  content-hashed; other same-origin assets are stale-while-revalidate.
- **Updates are never applied silently.** A new worker waits until the user
  accepts the prompt, because activating it reloads the page and a reload
  discards the in-memory key — the vault would lock mid-use.

Icons are generated from the same keyhole mark the app draws, rasterised from
signed distance fields by `scripts/generate-icons.mjs` — `npm run icons` — so
no image toolchain enters the dependency tree. The output is committed.

### The trade-off

Because no key material reaches the server, **nobody can reset a passphrase or
recover a vault** — not an administrator, not the operator. Losing both the
passphrase and the recovery phrase means the data is gone. That is the cost of
the guarantee above, and it is the honest trade every zero-knowledge system
makes.

This has not been independently audited. It uses standard, well-reviewed
primitives rather than hand-rolled cryptography, but treat it accordingly.

## Running locally

```bash
npm install
cp .env.example .env.local   # everything in it is optional in development
npm run dev
```

Development runs with an empty `.env.local`. Without `AUTH_SESSION_SECRET` an
ephemeral per-process secret is used, so sessions do not survive a restart —
the client just re-signs a challenge. Without Upstash credentials, storage
falls back to an in-process map. Production refuses both fallbacks rather than
signing everyone out at random or silently losing vaults on a cold start.

Passkeys need a secure context. `localhost` counts, so they work in `npm run
dev` without a certificate.

```bash
npm test        # crypto and key-hierarchy checks
npm run typecheck
npm run build
```

## Deploying to Vercel

1. Import the repository into Vercel. The framework preset is detected
   automatically.
2. Add the environment variables from `.env.example`:
   - `AUTH_SESSION_SECRET` — `openssl rand -base64 48`
   - `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` — adding a Redis
     integration in Vercel populates `KV_REST_API_URL` / `KV_REST_API_TOKEN`,
     which are read as fallbacks, so either pair works.
3. Deploy.

Passkeys are bound to the domain that created them (the WebAuthn relying-party
id), so a passkey registered on a preview URL will not work on the production
domain. Pick the domain before asking users to register one.

`vercel.json` pins the region to `sin1`; change it to whatever is closest to
your users.

## Layout

```
app/
  page.tsx            Landing page
  vault/              Authenticated app (onboarding, unlock, dashboard)
  offline/            Service-worker fallback for uncached navigations
  manifest.ts         Web app manifest
  api/vault/          GET/PUT/DELETE encrypted blobs
  api/auth/           Challenge, session, passkey records
lib/
  crypto/             Primitives, KDFs, AEAD, BIP39, generator
  auth/               Identity derivation, session tokens, passkeys
  vault/              Key hierarchy, record encryption, state machine
  storage/            IndexedDB cache and the remote sync client
  pwa/                Install-prompt state
  server/             Auth, tokens, KV driver, rate limiting, wire validation
components/           Landing sections, vault UI, design-system primitives
public/sw.js          Service worker — app shell only, never vault data
scripts/              Icon generation
proxy.ts              Per-request CSP nonce and security headers
tests/                Crypto and key-hierarchy checks
```

## Licence

MIT.
