import {
  Clock,
  Fingerprint,
  KeyRound,
  Layers,
  RefreshCw,
  ScanLine,
  ServerOff,
  ShieldCheck,
  Sparkles,
  WifiOff,
} from "lucide-react";

import { AuthButton } from "@/components/auth-button";
import { Trace, TraceStep } from "@/components/ui/trace";

function SectionHeader({
  label,
  title,
  description,
}: {
  label: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="max-w-2xl">
      <p className="text-label">{label}</p>
      <h2 className="text-display mt-3 text-[1.875rem] sm:text-[2.5rem]">{title}</h2>
      {description ? (
        <p className="mt-4 text-[0.9375rem] leading-relaxed text-ink-muted">{description}</p>
      ) : null}
    </div>
  );
}

export function HowItWorks() {
  return (
    <section id="how" className="border-b border-line">
      <div className="mx-auto max-w-6xl px-5 py-12 sm:px-6 sm:py-20 lg:py-28">
        <SectionHeader
          label="How it works"
          title="Three steps, then it disappears into the background."
          description="Each step below opens onto what actually happens, for anyone who would rather not take the summary on faith."
        />

        {/*
          A sequence, not three tiles. Setting up Purbo is one ordered flow
          where each step consumes the previous step's output, and a grid of
          equal cards deliberately hides that ordering.
        */}
        <Trace className="mt-8 max-w-3xl sm:mt-12">
          <TraceStep
            title="Sign in with Privy"
            state="done"
            meta="step 01"
            summary="Email, Google, GitHub or an existing wallet."
          >
            Privy proves who you are and issues a short-lived session token that our API
            verifies cryptographically on every request. It decides which encrypted blob
            belongs to you — never what is inside it. No password of yours reaches Purbo, and
            no key material reaches Privy.
          </TraceStep>

          <TraceStep
            title="Create your wallet"
            state="done"
            meta="step 02"
            summary="A 24-word recovery phrase and a passphrase, both generated and used locally."
          >
            The phrase comes from WebCrypto randomness in your tab and is encoded with BIP39,
            the same standard a hardware wallet uses. Your passphrase is stretched with
            Argon2id at 64 MiB and wraps the resulting root key. Neither the phrase nor the
            passphrase is ever transmitted, which is exactly why neither can be reset for you.
          </TraceStep>

          <TraceStep
            title="Save and sync"
            state="done"
            meta="step 03"
            summary="Entries are sealed before they leave the tab."
            last
          >
            Each entry is encrypted with AES-256-GCM under a key derived from the root, then
            pushed as an opaque blob alongside a revision counter used to resolve two devices
            writing at once. A full database dump reveals how many entries you have and when
            they last changed — not one field of what they say.
          </TraceStep>
        </Trace>
      </div>
    </section>
  );
}

export function Security() {
  const guarantees = [
    {
      icon: ServerOff,
      title: "The server cannot read your vault",
      body: "Names, usernames, URLs and notes are all inside the ciphertext — not just the password field. A full database dump reveals how many entries you have and when they changed. Nothing else.",
    },
    {
      icon: Layers,
      title: "Argon2id, not a fast hash",
      body: "Your passphrase runs through Argon2id at 64 MiB and three passes. Memory-hardness is what makes GPU and ASIC cracking rigs lose their advantage — the attacker pays 64 MiB per guess.",
    },
    {
      icon: ScanLine,
      title: "Every ciphertext is context-bound",
      body: "Each entry is sealed with associated data tying it to your account and its own id. Moving a blob between records or between users makes decryption fail rather than succeed quietly.",
    },
    {
      icon: Clock,
      title: "Locks itself, clears the clipboard",
      body: "The vault re-locks after inactivity and keys are dropped from memory. Copied passwords are wiped from the clipboard after 30 seconds if nothing else has overwritten them.",
    },
  ];

  return (
    <section id="security" className="border-b border-line bg-surface">
      <div className="mx-auto max-w-6xl px-5 py-12 sm:px-6 sm:py-20 lg:py-28">
        <SectionHeader
          label="Security"
          title="Built so that breaking the server gets you nothing."
          description="Zero-knowledge is a claim that only means something if the architecture forces it. Here is what forces it."
        />

        <div className="mt-8 grid gap-px overflow-hidden rounded-[var(--radius-lg)] border border-line bg-line raised sm:mt-12 sm:grid-cols-2">
          {guarantees.map((item) => (
            <div
              key={item.title}
              className="group bg-canvas p-5 transition-colors hover:bg-elevated sm:p-8"
            >
              <span className="grid size-9 place-items-center rounded-[var(--radius-sm)] border border-line bg-surface transition-colors group-hover:border-line-strong">
                <item.icon className="size-4 text-ink" aria-hidden />
              </span>
              <h3 className="mt-4 text-[0.9375rem] font-semibold tracking-tight sm:mt-5">{item.title}</h3>
              <p className="mt-2.5 text-[0.8125rem] leading-relaxed text-ink-muted">{item.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 rounded-[var(--radius-lg)] border border-line bg-canvas raised p-5 sm:mt-8 sm:p-8">
          <h3 className="text-[0.9375rem] font-semibold tracking-tight">
            The trade-off, stated plainly
          </h3>
          <p className="mt-2.5 max-w-3xl text-[0.8125rem] leading-relaxed text-ink-muted">
            Because no key material reaches the server, nobody can reset your passphrase for
            you — not support, not an administrator, not us. Lose both the passphrase and the
            24-word recovery phrase and the vault is mathematically unrecoverable. That is the
            cost of the guarantee above, and it is the honest trade every zero-knowledge system
            makes. Write the phrase down on paper before you save anything real.
          </p>
        </div>
      </div>
    </section>
  );
}

export function Features() {
  const features = [
    {
      icon: Sparkles,
      title: "Generator with real entropy",
      body: "Rejection sampling over WebCrypto — no modulo bias, no Math.random. Length up to 128, plus BIP39 passphrases when you need something you can type.",
    },
    {
      icon: RefreshCw,
      title: "Sync across devices",
      body: "Encrypted blobs sync through Vercel KV with optimistic concurrency, so two devices editing at once resolve instead of overwriting.",
    },
    {
      icon: WifiOff,
      title: "Installs and works offline",
      body: "Add Purbo to a home screen or dock and it opens in its own window. The app and your encrypted vault are both cached on the device, so unlocking needs no network; changes push when you reconnect.",
    },
    {
      icon: KeyRound,
      title: "Strength that tells the truth",
      body: "Entropy estimates penalise keyboard runs, repeats and breach-list prefixes, then translate to an offline crack time at 10¹¹ guesses per second.",
    },
    {
      icon: Fingerprint,
      title: "Wallet-native recovery",
      body: "A standard 24-word BIP39 phrase is the root of the vault. It restores everything on a new device without contacting support.",
    },
    {
      icon: ShieldCheck,
      title: "Hardened by default",
      body: "Nonce-based CSP with strict-dynamic, HSTS preload, frame-ancestors none, cross-origin isolation, and rate limits on every route.",
    },
  ];

  return (
    <section id="features" className="border-b border-line">
      <div className="mx-auto max-w-6xl px-5 py-12 sm:px-6 sm:py-20 lg:py-28">
        <SectionHeader label="Features" title="Everything the daily loop needs." />

        <div className="mt-8 grid gap-px overflow-hidden rounded-[var(--radius-lg)] border border-line bg-line raised sm:mt-12 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="group bg-canvas p-5 transition-colors hover:bg-elevated sm:p-7"
            >
              <span className="grid size-9 place-items-center rounded-[var(--radius-sm)] border border-line bg-surface transition-colors group-hover:border-line-strong">
                <feature.icon className="size-4 text-ink" aria-hidden />
              </span>
              <h3 className="mt-4 text-[0.9375rem] font-semibold tracking-tight sm:mt-5">
                {feature.title}
              </h3>
              <p className="mt-2 text-[0.8125rem] leading-relaxed text-ink-muted">
                {feature.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Faq() {
  const items = [
    {
      q: "Do I need cryptocurrency to use Purbo?",
      a: "No. Purbo borrows the wallet model — a recovery phrase you own, keys that never leave your device — but stores passwords, not funds. There is no chain, no gas and no token. If you sign in with an existing wallet, it is used purely as an identity.",
    },
    {
      q: "What exactly does the server store?",
      a: "One record per account: the wrapped root key with its Argon2id parameters, an array of encrypted entries, and a revision counter. Account ids are stored as truncated SHA-256 hashes rather than raw identifiers. There is no plaintext field anywhere in that record.",
    },
    {
      q: "What happens if I forget my passphrase?",
      a: "Enter your 24-word recovery phrase and set a new one. The phrase reconstructs the root key directly, so your existing entries stay readable — only the wrapper around the key is replaced.",
    },
    {
      q: "Can Purbo recover my vault if I lose both?",
      a: "No, and this is deliberate. Neither secret is ever transmitted, so there is nothing on the server to recover from. Anyone offering to restore a zero-knowledge vault is either not zero-knowledge or not telling the truth.",
    },
    {
      q: "Why Privy instead of a normal login?",
      a: "It gives the wallet-style entry point — email, social or an existing wallet — without Purbo ever handling credentials. Privy issues a short-lived token that the API verifies cryptographically on every request; it decides who you are, never what you can decrypt.",
    },
    {
      q: "Is this audited?",
      a: "Not yet. It uses standard, well-reviewed primitives — Argon2id, AES-256-GCM, HKDF-SHA-256, BIP39 — through WebCrypto and @scure/bip39 rather than hand-rolled cryptography, and the whole implementation is open for review. Treat it accordingly until an independent audit exists.",
    },
  ];

  return (
    <section id="faq" className="border-b border-line bg-surface">
      <div className="mx-auto max-w-6xl px-5 py-12 sm:px-6 sm:py-20 lg:py-28">
        <SectionHeader label="FAQ" title="Questions worth asking." />

        <div className="mt-8 divide-line overflow-hidden rounded-[var(--radius-lg)] border border-line bg-elevated raised sm:mt-12">
          {items.map((item) => (
            <details key={item.q} className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-[0.9375rem] font-medium transition-colors hover:bg-surface sm:px-6 sm:py-5 [&::-webkit-details-marker]:hidden">
                {item.q}
                {/* A plus that loses its vertical stroke on open, so the
                    control animates into a minus instead of swapping glyphs. */}
                <span
                  aria-hidden
                  className="relative size-4 shrink-0 text-ink-subtle before:absolute before:left-0 before:top-1/2 before:h-px before:w-4 before:bg-current after:absolute after:left-1/2 after:top-0 after:h-4 after:w-px after:bg-current after:transition-transform after:duration-200 group-open:after:scale-y-0"
                />
              </summary>
              <p className="animate-fade -mt-1 max-w-3xl px-5 pb-4 text-[0.8125rem] leading-relaxed text-ink-muted sm:px-6 sm:pb-5">
                {item.a}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

export function CallToAction({ configured }: { configured: boolean }) {
  return (
    <section className="border-b border-line">
      <div className="mx-auto max-w-6xl px-5 py-12 sm:px-6 sm:py-20 lg:py-28">
        <div className="relative overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface raised-float px-5 py-10 text-center sm:px-12 sm:py-14">
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-grid opacity-40" />
          {/* Positioned so the decorative grid stays behind the copy — an
              absolute sibling would otherwise paint over in-flow content. */}
          <div className="relative">
            <h2 className="text-display mx-auto max-w-2xl text-[1.875rem] sm:text-[2.75rem]">
              Take your passwords off someone else&rsquo;s server.
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-[0.9375rem] leading-relaxed text-ink-muted sm:mt-5">
              Creating a vault takes about a minute. Have somewhere safe to write down 24
              words before you start.
            </p>
            <div className="mt-6 flex justify-center sm:mt-8">
              <AuthButton configured={configured} size="lg" label="Create your wallet" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
