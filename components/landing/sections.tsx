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
  const steps = [
    {
      icon: Fingerprint,
      title: "Sign in with Privy",
      body: "Email, Google, GitHub or an existing wallet. Privy proves who you are and issues a short-lived session token. It never sees your vault.",
    },
    {
      icon: KeyRound,
      title: "Create your wallet",
      body: "The browser generates a 24-word recovery phrase and asks for a passphrase. Both are used locally; neither is ever transmitted.",
    },
    {
      icon: ShieldCheck,
      title: "Save and sync",
      body: "Every entry is sealed with AES-256-GCM before it leaves the tab. The server stores opaque blobs and a revision number.",
    },
  ];

  return (
    <section id="how" className="border-b border-line">
      <div className="mx-auto max-w-6xl px-5 sm:px-6 py-20 sm:py-28">
        <SectionHeader
          label="How it works"
          title="Three steps, then it disappears into the background."
        />

        <ol className="mt-12 grid gap-px overflow-hidden rounded-[var(--radius-lg)] border border-line bg-line sm:grid-cols-3">
          {steps.map((step, index) => (
            <li key={step.title} className="bg-canvas p-6 sm:p-7">
              <div className="flex items-center justify-between">
                <div className="grid size-9 place-items-center rounded-[var(--radius-sm)] border border-line bg-surface">
                  <step.icon className="size-4 text-ink" aria-hidden />
                </div>
                <span className="font-mono text-xs text-ink-subtle">
                  {String(index + 1).padStart(2, "0")}
                </span>
              </div>
              <h3 className="mt-5 text-[0.9375rem] font-semibold tracking-tight">{step.title}</h3>
              <p className="mt-2 text-[0.8125rem] leading-relaxed text-ink-muted">{step.body}</p>
            </li>
          ))}
        </ol>
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
      <div className="mx-auto max-w-6xl px-5 sm:px-6 py-20 sm:py-28">
        <SectionHeader
          label="Security"
          title="Built so that breaking the server gets you nothing."
          description="Zero-knowledge is a claim that only means something if the architecture forces it. Here is what forces it."
        />

        <div className="mt-12 grid gap-px overflow-hidden rounded-[var(--radius-lg)] border border-line bg-line sm:grid-cols-2">
          {guarantees.map((item) => (
            <div key={item.title} className="bg-canvas p-6 sm:p-8">
              <item.icon className="size-5 text-ink" aria-hidden />
              <h3 className="mt-5 text-[0.9375rem] font-semibold tracking-tight">{item.title}</h3>
              <p className="mt-2.5 text-[0.8125rem] leading-relaxed text-ink-muted">{item.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-8 rounded-[var(--radius-lg)] border border-line bg-canvas p-6 sm:p-8">
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
      <div className="mx-auto max-w-6xl px-5 sm:px-6 py-20 sm:py-28">
        <SectionHeader label="Features" title="Everything the daily loop needs." />

        <div className="mt-12 grid gap-px overflow-hidden rounded-[var(--radius-lg)] border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <div key={feature.title} className="bg-canvas p-6 sm:p-7">
              <feature.icon className="size-5 text-ink" aria-hidden />
              <h3 className="mt-5 text-[0.9375rem] font-semibold tracking-tight">
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
      <div className="mx-auto max-w-6xl px-5 sm:px-6 py-20 sm:py-28">
        <SectionHeader label="FAQ" title="Questions worth asking." />

        <div className="mt-12 divide-line overflow-hidden rounded-[var(--radius-lg)] border border-line bg-canvas">
          {items.map((item) => (
            <details key={item.q} className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-6 py-5 text-[0.9375rem] font-medium transition-colors hover:bg-surface [&::-webkit-details-marker]:hidden">
                {item.q}
                <span
                  aria-hidden
                  className="relative size-4 shrink-0 text-ink-subtle before:absolute before:left-0 before:top-1/2 before:h-px before:w-4 before:bg-current after:absolute after:left-1/2 after:top-0 after:h-4 after:w-px after:bg-current after:transition-transform group-open:after:scale-y-0"
                />
              </summary>
              <p className="px-6 pb-5 -mt-1 max-w-3xl text-[0.8125rem] leading-relaxed text-ink-muted">
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
      <div className="mx-auto max-w-6xl px-5 sm:px-6 py-20 sm:py-28">
        <div className="rounded-[var(--radius-lg)] border border-line bg-surface px-6 py-14 text-center sm:px-12">
          <h2 className="text-display mx-auto max-w-2xl text-[1.875rem] sm:text-[2.75rem]">
            Take your passwords off someone else&rsquo;s server.
          </h2>
          <p className="mx-auto mt-5 max-w-lg text-[0.9375rem] leading-relaxed text-ink-muted">
            Creating a vault takes about a minute. Have somewhere safe to write down 24 words
            before you start.
          </p>
          <div className="mt-8 flex justify-center">
            <AuthButton configured={configured} size="lg" label="Create your wallet" />
          </div>
        </div>
      </div>
    </section>
  );
}
