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
| App shell | Installable PWA — web app manifest, link handling, hand-written service worker |
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
an array of sealed entries, a list of deleted entry ids, a revision counter,
and any sealed passkey records — each with a device name that is itself
ciphertext. It is filed under a hash of the account's public key — there is no
email, username or third-party identifier anywhere in it.

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
- **A reload is not a logout, and nothing more.** A tab caches the keys it is
  already holding so returning to it costs no second of Argon2id — but only
  the derived data key and the auth secret, sealed under a second
  non-extractable key, scoped to that tab by a handle in `sessionStorage`, and
  capped by a hard expiry. The root key is never written anywhere: it survives
  every passphrase change and cannot be rotated, so it stays in memory alone.
  Locking deletes the record, which is what keeps auto-lock meaningful.
- **The fast path is hardware-gated, not disk-gated.** Where other apps "keep
  you signed in" by leaving a usable key on disk, the unattended path here is a
  passkey: the secret that unwraps the vault never leaves the authenticator and
  is released only after a biometric or device PIN. An attacker who copies the
  browser profile gets a sealed record and no way to open it.
- **Being unlocked is not being confirmed.** Taking a plaintext export or
  deleting the vault re-checks the passphrase or a passkey, and that
  confirmation lasts two minutes rather than the session. It is a check against
  whoever is at the keyboard now, not against script — anything running in an
  unlocked tab already has the data key — which is precisely the gap between
  "I unlocked this at nine" and "someone is deleting it at four". Reading and
  editing an entry are not behind it: passwords are masked until asked for,
  and a mask is what a shoulder over the screen is up against. Charging an
  Argon2id derivation to read what the unlock already decrypted bought
  nothing the eye toggle does not.
- **The app switcher is a screenshot, and the web cannot opt out of it.** A
  phone keeps a thumbnail of every backgrounded app, and for a decrypted vault
  that thumbnail is the leak. Native apps set one flag to be excluded; there is
  no such flag on the web, so Purbo blurs the page instead — on the same
  signal, before the system takes its picture, leaving the app recognisable in
  the switcher and nothing on it readable. Against a browser tab, a second
  monitor or a screen share that is exact, because the page is still being
  painted. Against the phone's own snapshot it is best-effort, and is stated
  that way in the setting rather than sold as the native guarantee.
- **Second factors sit beside the first, and that is a trade.** An entry can
  hold a TOTP secret, and the code is computed here from WebCrypto's HMAC —
  no network, no service, and the seed never leaves the entry's AES-GCM box.
  What it costs is honest to state: a vault holding both factors is one thing
  to steal rather than two. What it buys is a second factor that gets turned
  on at all, because it is reachable in the place the password already is. An
  authenticator app on a separate device is still the stronger arrangement,
  and nothing here stops you keeping one.
- **The vault re-locks** after inactivity, optionally the moment the tab stops
  being what is on screen, and copied passwords are cleared from the clipboard
  after 30 seconds if nothing has overwritten them.
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

### Syncing between devices

Two devices holding the same vault is the ordinary case, and it is where a
password manager quietly loses data. The rule cannot be "newest revision
wins": that is not a merge, it is one device's copy replacing the other's, and
the entry you added on your phone is gone because your laptop saved after it.

So the two copies are merged, entry by entry, on the client:

- an entry only one side has is kept
- an entry both sides have is kept at its newer `updatedAt`
- an identical timestamp is broken by comparing ciphertext, so both devices
  independently reach the same answer instead of each preferring its own
- a **tombstone** — an id and a time, no ciphertext — carries a deletion, which
  a union of two vaults otherwise cannot express: an entry deleted here is
  simply an entry the other device still has, and it would come back
- an entry edited after it was deleted elsewhere survives, and the deletion is
  discarded: an edit is evidence somebody still wants it

Merging is convergent — running it in either direction gives the same vault —
and every rule runs on metadata that is already outside the ciphertext, so
none of it asks the server to understand anything. Tombstones are forgotten
after ninety days, which is the one limit worth stating: a device that has
been offline longer than that can resurrect an entry it never heard was
deleted.

The envelope is the one thing that cannot be merged, since it is a single
wrapped root key rather than a collection. The device that changed it wins, so
a passphrase rotated on a laptop is not reverted by a phone that syncs
afterwards.

An open vault reconciles when it unlocks, when the network comes back, when
its tab returns to the foreground, and on a slow timer in between. That last
one is what makes two tabs open side by side converge rather than diverge
until one of them is reloaded.

### Getting your data in and out

Nothing here is a lock-in. Settings exports every entry as plaintext JSON —
the largest single disclosure the app can make, so it re-checks the passphrase
first and says plainly what the file is.

Import reads Purbo's own export, Bitwarden's JSON and CSV, 1Password, LastPass,
Chrome, and any CSV with a header row it can map. The file is read with
`File.text()` and parsed in the tab: nothing is uploaded to be parsed, because
an import that posted a plaintext CSV somewhere "just to read the columns"
would hand over in one request exactly what the rest of this design protects.
Counts are shown before anything is written, and entries matching one you
already have — same name, same username — are left out unless you say
otherwise, since an accidental double import is not undoable one row at a time.

Changing a passphrase is a re-wrap, not a re-encryption: the root key is
unchanged, so entries stay valid and registered passkeys keep working. Proving
the current passphrase is enough for it — requiring the 24 words to rotate a
passphrase would mean taking the recovery phrase out of wherever it is safely
written down, which is the larger risk of the two.

Passkeys are revoked one at a time. Each carries a name you give it when you
register it — sealed under the vault's data key, so the server stores a device
list it cannot read — and that name is the whole point: revoking the phone you
lost should not mean revoking the three devices you still have. Deleting the
vault revokes all of them server-side, because a sealed passkey record holds a
copy of the root key and leaving it behind would mean "delete my vault" kept
the keys to it.

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
- **Every cache is namespaced by the build it belongs to**, and the previous
  build's caches are deleted when the new worker activates. The worker takes
  that name from the `?v=` the page registers it with rather than from a
  version literal, which is also what lets a deploy be noticed at all: a
  browser looks for a new worker by comparing the script's bytes, and a static
  `sw.js` never changes on its own. The id is the commit, so an installed app
  left open for weeks still finds out that a new version shipped.

Icons are generated from the same keyhole mark the app draws, rasterised from
signed distance fields by `scripts/generate-icons.mjs` — `npm run icons` — so
no image toolchain enters the dependency tree. The output is committed.

The manifest's screenshots — what an install dialog shows before anyone
commits to installing — cannot be drawn from shapes, because they are
photographs of the running app. `scripts/generate-screenshots.mjs` retakes
them against a local server or a deployment, and asks for a browser to be
brought along rather than carrying one in the tree for three PNGs that change
only when the interface does:

```bash
npm i --no-save playwright && npx playwright install chromium
npm run build && npm start &
npm run screenshots
```

The output is committed too, so a deploy never depends on either script
having run.

### Links open in the app

Installed, Purbo behaves the way an app the system knows about behaves: a link
to it opens *in* it. The manifest asks to handle the links in its scope
(`handle_links`), so a vault link from a note, a chat, or a search result
arrives in the app window instead of a browser tab that happens to be pointed
at the same origin.

What should happen when a window is already open is where a password manager
parts company with the usual advice. The natural client mode for a link that
names a destination is `navigate-existing` — but navigating a document reloads
it, and a reload discards the key held in memory, so following a link to a
section would lock the vault that was open a second earlier. The manifest asks
for `focus-existing` instead: the browser raises the running window and hands
the URL to the page, and `components/pwa/launch-handler` applies it as a
client-side navigation. The window that was open stays open, still unlocked,
now showing what the link asked for. A launch target that is not an ordinary
in-scope page of this origin is dropped rather than followed — browsers are
specified never to send one, and this does not take that on trust.

Sections are addressable so there is something for a link to point at:
`?tab=generator` is read on the way in and written back as you move between
tabs, which is what makes the manifest's shortcuts, a bookmark, and a link
someone sends you all land in the same place. Link capturing is Chromium's for
now; elsewhere a link opens a window at that URL in the ordinary way, which is
the behaviour this improves on rather than depends on.

### The trade-off

Because no key material reaches the server, **nobody can reset a passphrase or
recover a vault** — not an administrator, not the operator. Losing both the
passphrase and the recovery phrase means the data is gone. That is the cost of
the guarantee above, and it is the honest trade every zero-knowledge system
makes.

This has not been independently audited. It uses standard, well-reviewed
primitives rather than hand-rolled cryptography, but treat it accordingly.
See `SECURITY.md` for how to report a suspected vulnerability.

### Build integrity

Every page load trusts JS freshly served by the origin — that is true of any
web app, not just this one, and no amount of client-side crypto changes it.
Browser-enforced Subresource Integrity does not fit here either: Next.js
injects its own script tags at request time with no `integrity` attribute,
and which chunks a page loads is not fixed ahead of time.

What is checkable is whether a live deployment is serving the code in a given
commit at all. `scripts/verify-build.mjs` builds that commit locally, crawls
the deployment's own pages for the `_next/static/*` scripts they reference,
fetches each one, and hashes it against the local build's copy:

```bash
git checkout <commit>
npm ci && npm run build
npm run verify-build -- https://your-deployment.example.com
```

The build carries its commit — `next.config.ts` reads it from the CI
environment, or from `git rev-parse HEAD`, and inlines it — so this stays a
byte-for-byte comparison: a rebuild of the same commit produces the same id
and therefore the same chunks. That is the reason the id is not a timestamp.

A mismatch means the live site is not running the code you just built from
that commit — reason enough to stop trusting it before typing a passphrase
into it. This only covers scripts referenced by the crawled pages' initial
HTML, not everything a session could eventually `import()`; see the script's
own header comment for the exact scope.

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
  crypto/             Primitives, KDFs, AEAD, BIP39, generator, TOTP
  auth/               Identity derivation, session tokens, passkeys
  vault/              Key hierarchy, record encryption, state machine, merge, tags, import
  storage/            IndexedDB cache, tab session keys, remote sync client
  pwa/                Install-prompt state, launch (link) handling
  server/             Auth, tokens, KV driver, rate limiting, wire validation
components/           Landing sections, vault UI, design-system primitives
public/sw.js          Service worker — app shell only, never vault data
public/screenshots/   Manifest screenshots for the install dialog
scripts/              Icon and screenshot generation, build-integrity verification
proxy.ts              Per-request CSP nonce and security headers
tests/                Crypto, merge and API-route checks
SECURITY.md           Vulnerability disclosure policy
```

## Licence

MIT.
