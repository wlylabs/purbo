"use client";

import { AlertTriangle, Check, Copy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  formatTotpCode,
  generateTotpCode,
  parseTotpInput,
  secondsRemaining,
  type TotpConfig,
} from "@/lib/crypto/totp";
import { Reveal } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

/**
 * The current code, and how long it has left.
 *
 * Unlike the password beside it, this is not masked. A code that expires in
 * under thirty seconds and is worthless without the password is not the
 * secret a mask protects — the secret is the seed, which never appears here.
 * Hiding the code behind a toggle would add a click to the one field whose
 * entire value is being readable in the seconds before it changes.
 *
 * The clock is the device's. A phone whose time has drifted produces codes
 * the server rejects, which is why the remaining seconds are shown rather
 * than implied: a countdown that is visibly wrong is a diagnosis.
 */
export function TotpCode({
  secret,
  onCopy,
  className,
}: {
  /** The stored value: a base32 secret or an `otpauth://` URI. */
  secret: string;
  /** Copies through the caller's clipboard helper, so auto-clear applies. */
  onCopy: (code: string) => Promise<void>;
  className?: string;
}) {
  const config = useMemo<TotpConfig | null>(() => {
    try {
      return parseTotpInput(secret);
    } catch {
      return null;
    }
  }, [secret]);

  const [code, setCode] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!config) return;
    let cancelled = false;

    const tick = async () => {
      const now = Date.now();
      const next = await generateTotpCode(config, now);
      if (cancelled) return;
      setCode(next);
      setRemaining(secondsRemaining(config, now));
    };

    void tick();
    // A second is fine: the code only changes on a period boundary, and
    // recomputing an HMAC once a second costs nothing measurable.
    const timer = window.setInterval(() => void tick(), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [config]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  if (!config) {
    return (
      <div
        className={cn(
          "flex items-start gap-2 rounded-[var(--radius)] border border-caution/25 bg-caution/5 px-3 py-2.5",
          className,
        )}
      >
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-caution" aria-hidden />
        <div className="min-w-0">
          <p className="text-label">Authenticator</p>
          <p className="mt-1 text-[0.8125rem] leading-relaxed text-caution">
            The stored secret is not one this version can read, so no code can be produced.
            Edit the entry to replace it.
          </p>
        </div>
      </div>
    );
  }

  const expiring = remaining <= 5;

  const copy = async () => {
    if (!code) return;
    try {
      await onCopy(code);
      setCopied(true);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  };

  return (
    <div
      className={cn(
        "group rounded-[var(--radius)] border border-line bg-surface transition-colors hover:border-line-strong",
        className,
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-label">Authenticator code</p>
          <p
            className={cn(
              "mt-1 font-mono text-[1.0625rem] leading-snug tracking-[0.12em] tabular-nums",
              expiring && "text-caution",
            )}
          >
            {code ? formatTotpCode(code) : "······"}
          </p>
        </div>

        <Countdown remaining={remaining} period={config.period} expiring={expiring} />

        <button
          type="button"
          onClick={copy}
          aria-label="Copy authenticator code"
          disabled={!code}
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-[var(--radius-sm)] text-ink-subtle",
            "interactive hover:bg-tint hover:text-ink active:bg-tint-strong",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          {copied ? (
            <Check className="animate-pop size-4 text-positive" aria-hidden />
          ) : (
            <Copy className="size-4" aria-hidden />
          )}
        </button>
      </div>

      <Reveal open={failed}>
        <p
          role="status"
          className="border-t border-line px-3 py-1.5 text-[0.6875rem] text-critical"
        >
          Clipboard access was blocked by the browser.
        </p>
      </Reveal>
      <Reveal open={!failed && copied}>
        <p
          role="status"
          className="border-t border-line px-3 py-1.5 text-[0.6875rem] text-ink-subtle"
        >
          Copied — the clipboard clears itself in 30 seconds.
        </p>
      </Reveal>
    </div>
  );
}

/**
 * The remaining life of the code, as a ring.
 *
 * A number alone makes the reader do the arithmetic that decides whether to
 * use this code or wait for the next one; a ring answers it at a glance and
 * keeps the number for when the answer is close.
 */
function Countdown({
  remaining,
  period,
  expiring,
}: {
  remaining: number;
  period: number;
  expiring: boolean;
}) {
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.max(0, Math.min(1, remaining / period));

  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1.5 tabular-nums",
        expiring ? "text-caution" : "text-ink-subtle",
      )}
      // One label rather than a spoken ring plus a spoken number.
      role="timer"
      aria-label={`${remaining} seconds until this code changes`}
    >
      <svg viewBox="0 0 18 18" className="size-4" aria-hidden>
        <circle
          cx="9"
          cy="9"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          opacity="0.2"
        />
        <circle
          cx="9"
          cy="9"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress)}
          transform="rotate(-90 9 9)"
        />
      </svg>
      <span className="text-[0.6875rem] font-medium">{remaining}s</span>
    </span>
  );
}
