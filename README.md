# Purbo

A password manager built around a web3 wallet flow: you sign in, create a
"wallet", and get a 24-word recovery phrase that is the only root of your
vault. Every entry is encrypted in the browser before it touches the network.

Landing page → sign in with Privy → create your wallet → save passwords.
The server stores ciphertext and nothing else.

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| Styling | Tailwind CSS v4, Geist Sans/Mono |
| Auth | [Privy](https://privy.io) — email, Google, GitHub or an existing wallet |
| Storage | Upstash / Vercel KV (encrypted blobs only) |
| Crypto | WebCrypto (AES-256-GCM, HKDF-SHA-256), Argon2id via `hash-wasm`, BIP39 via `@scure/bip39` |
| Hosting | Vercel |

## Security model

The whole design follows from one rule: **the server must never be able to
read a vault.** Everything else is a consequence.

```
24-word recovery phrase  ──PBKDF2-HMAC-SHA512──▶  BIP39 seed
                                                      │ HKDF "purbo:root:v1"
                                                      ▼
                                                  root key ──HKDF "purbo:data:v1"──▶ data key
                                                      │                                  │
                     passphrase ──Argon2id──▶ KEK ──AES-GCM wrap──┘                      │
                                              │                                          ▼
                                              ▼                          AES-256-GCM per entry
                                        KeyEnvelope                      (random IV, AAD-bound)
                                   (safe to store anywhere)
```

Two independent paths reach the root key:

- **Passphrase** — fast, per-device. Stretched with Argon2id (64 MiB, 3 passes,
  1 lane), comfortably above the OWASP floor, then used to unwrap the stored
  root key.
- **Recovery phrase** — offline and portable. Reconstructs the root key from
  scratch, so a forgotten passphrase is recoverable and a new device needs
  nothing but the words.

What the server holds, in full: a wrapped root key, its public KDF parameters,
an array of sealed entries, and a revision counter. Account ids are stored as
truncated SHA-256 hashes rather than raw Privy identifiers.

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
- **Keys are non-extractable.** The data key is a `CryptoKey` that script can
  use but cannot read out, and intermediate key bytes are zeroed after use.
- **The vault re-locks** after inactivity, and copied passwords are cleared
  from the clipboard after 30 seconds if nothing has overwritten them.
- **A nonce-based CSP with `strict-dynamic`** is issued per request. Allowlist
  CSPs are routinely bypassed through JSONP endpoints on allowlisted hosts; a
  nonce leaves an injected `<script>` with nothing to guess. Paired with HSTS
  preload, `frame-ancestors 'none'`, COOP/CORP isolation and `no-referrer`.
- **Rate limits** on every vault route, keyed per user.

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
cp .env.example .env.local   # fill in the Privy values
npm run dev
```

Without `NEXT_PUBLIC_PRIVY_APP_ID` the marketing site still renders and the
app shows setup instructions instead of a broken sign-in. Without Upstash
credentials, development falls back to an in-process store; production
refuses to start rather than silently losing vaults on a cold start.

```bash
npm test        # crypto and key-hierarchy checks
npm run typecheck
npm run build
```

## Deploying to Vercel

1. Import the repository into Vercel. The framework preset is detected
   automatically.
2. Add the environment variables from `.env.example`:
   - `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_SECRET` (from
     [dashboard.privy.io](https://dashboard.privy.io))
   - `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` — adding a Redis
     integration in Vercel populates `KV_REST_API_URL` / `KV_REST_API_TOKEN`,
     which are read as fallbacks, so either pair works.
3. In the Privy dashboard, add your deployment domain to the allowed origins.
4. Deploy.

`vercel.json` pins the region to `sin1`; change it to whatever is closest to
your users.

## Layout

```
app/
  page.tsx            Landing page
  vault/              Authenticated app (onboarding, unlock, dashboard)
  api/vault/          GET/PUT/DELETE encrypted blobs
lib/
  crypto/             Primitives, KDFs, AEAD, BIP39, generator
  vault/              Key hierarchy, record encryption, state machine
  storage/            IndexedDB cache and the remote sync client
  server/             Auth, KV driver, rate limiting, wire validation
components/           Landing sections, vault UI, design-system primitives
proxy.ts              Per-request CSP nonce and security headers
tests/                Crypto and key-hierarchy checks
```

## Licence

MIT.
