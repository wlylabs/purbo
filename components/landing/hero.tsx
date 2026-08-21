import { Check, Lock } from "lucide-react";

import { VaultLink } from "@/components/vault-link";
import { buttonStyles } from "@/components/ui/button-styles";
import { Badge } from "@/components/ui/primitives";
import { StatusPill } from "@/components/ui/status";

/** Static, non-interactive preview of the vault. Purely decorative. */
function VaultPreview() {
  const rows = [
    { name: "Gmail", user: "purbo.vault@gmail.com", host: "gmail.com" },
    { name: "Tokopedia", user: "purbo.vault", host: "tokopedia.com" },
    { name: "Bank BCA", user: "0821••••7790", host: "klikbca.com" },
    { name: "Instagram", user: "@purbo.vault", host: "instagram.com" },
  ];

  return (
    <div
      aria-hidden
      className="select-none overflow-hidden rounded-[var(--radius-lg)] border border-line bg-elevated"
    >
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <Lock className="size-3.5 text-positive" />
          <span className="text-[0.8125rem] font-medium">Vault</span>
          <span className="text-xs text-ink-subtle">4 items</span>
        </div>
        <StatusPill tone="positive" label="Synced" detail="2m" />
      </div>

      {/* The same staged reveal the real list uses, so the preview behaves
          like the product rather than being a still of it. */}
      <div className="stagger divide-line">
        {rows.map((row, index) => (
          <div
            key={row.name}
            style={{ "--stagger-index": index + 2 } as React.CSSProperties}
            className="flex items-center gap-3 px-4 py-3"
          >
            <div className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-line bg-surface text-[0.6875rem] font-medium text-ink-muted">
              {row.name.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[0.8125rem] font-medium">{row.name}</p>
              <p className="truncate text-xs text-ink-subtle">{row.user}</p>
            </div>
            <span className="hidden font-mono text-[0.6875rem] text-ink-subtle sm:block">
              ••••••••••••
            </span>
          </div>
        ))}
      </div>

      <div className="border-t border-line bg-surface px-4 py-2.5">
        <p className="text-meta">AES-256-GCM · sealed on this device</p>
      </div>
    </div>
  );
}

export function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-line">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-grid opacity-60" />

      <div className="relative mx-auto max-w-6xl px-5 sm:px-6 pt-10 pb-14 sm:pt-24 sm:pb-28">
        <div className="grid items-center gap-9 sm:gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
          <div className="animate-in-up">
            <Badge className="mb-5 sm:mb-6">
              <span className="size-1.5 rounded-full bg-positive" />
              Zero-knowledge by design
            </Badge>

            <h1 className="text-display text-[2.5rem] sm:text-[3.5rem] lg:text-[4rem]">
              Your passwords,
              <br />
              sealed like a wallet.
            </h1>

            <p className="mt-5 max-w-xl text-[1.0625rem] leading-relaxed text-ink-muted sm:mt-6">
              Purbo encrypts every entry in your browser before it touches the network. You
              get a 24-word recovery phrase and a passphrase — the same shape as a crypto
              wallet, pointed at the thing you actually log into every day.
            </p>

            <div className="mt-7 flex flex-col gap-3 sm:mt-8 sm:flex-row">
              <VaultLink size="lg" label="Create your vault" />
              {/* The same styles the real buttons use, on a real anchor —
                  a hand-rolled copy is what drifts the moment the button
                  variants change. */}
              <a href="#how" className={buttonStyles({ variant: "secondary", size: "lg" })}>
                See how it works
              </a>
            </div>

            <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 sm:mt-8">
              {[
                "No master password on our servers",
                "Argon2id + AES-256-GCM",
                "Works offline",
              ].map((point) => (
                <li key={point} className="flex items-center gap-2 text-[0.8125rem] text-ink-muted">
                  <Check className="size-3.5 shrink-0 text-positive" aria-hidden />
                  {point}
                </li>
              ))}
            </ul>
          </div>

          <div className="animate-in-up [animation-delay:120ms]">
            <VaultPreview />
          </div>
        </div>
      </div>
    </section>
  );
}
