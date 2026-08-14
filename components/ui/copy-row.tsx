"use client";

import { Check, Copy, Eye, EyeOff } from "lucide-react";
import { useEffect, useState } from "react";

import { cn, copyWithAutoClear } from "@/lib/utils";

/**
 * A labelled value with its actions attached to it.
 *
 * Copying is the single most frequent thing anyone does in a password
 * manager, so the control sits on the value itself rather than in a menu, and
 * the row reports what happened: whether the copy landed, and — for a secret —
 * that the clipboard is on a timer. Silence after a copy leaves the user
 * checking the paste target to find out.
 */
export function CopyRow({
  label,
  value,
  secret = false,
  mono = false,
  className,
}: {
  label: string;
  value: string;
  /** Masks the value and adds a reveal toggle. */
  secret?: boolean;
  mono?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  // Re-mask whenever the row is pointed at a different secret.
  useEffect(() => setRevealed(false), [value]);

  const copy = async () => {
    try {
      await copyWithAutoClear(value);
      setCopied(true);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  };

  const masked = secret && !revealed;
  const display = masked ? "•".repeat(Math.min(value.length || 8, 24)) : value || "—";

  return (
    <div
      className={cn(
        "group rounded-[var(--radius)] border border-line bg-surface transition-colors",
        "hover:border-line-strong",
        className,
      )}
    >
      <div className="flex items-start gap-2 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-label">{label}</p>
          <p
            className={cn(
              "mt-1 break-all text-[0.9375rem] leading-snug",
              (secret || mono) && "font-mono tracking-tight",
              masked && "select-none text-ink-muted",
            )}
          >
            {display}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {secret ? (
            <RowAction
              onClick={() => setRevealed((current) => !current)}
              label={revealed ? `Hide ${label}` : `Show ${label}`}
            >
              {revealed ? (
                <EyeOff className="size-4" aria-hidden />
              ) : (
                <Eye className="size-4" aria-hidden />
              )}
            </RowAction>
          ) : null}
          <RowAction onClick={copy} label={`Copy ${label}`}>
            {copied ? (
              <Check className="size-4 text-positive" aria-hidden />
            ) : (
              <Copy className="size-4" aria-hidden />
            )}
          </RowAction>
        </div>
      </div>

      {/* Feedback replaces nothing above it, so the row grows rather than
          swapping content the user was mid-read of. */}
      {failed ? (
        <p className="animate-fade border-t border-line px-3 py-1.5 text-[0.6875rem] text-critical">
          Clipboard access was blocked by the browser.
        </p>
      ) : copied ? (
        <p className="animate-fade border-t border-line px-3 py-1.5 text-[0.6875rem] text-ink-subtle">
          {secret
            ? "Copied — the clipboard clears itself in 30 seconds."
            : "Copied to the clipboard."}
        </p>
      ) : null}
    </div>
  );
}

function RowAction({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "grid size-8 place-items-center rounded-[var(--radius-sm)] text-ink-subtle",
        "transition-colors hover:bg-elevated hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
