"use client";

import { AlertTriangle } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { cn } from "@/lib/utils";
import { Button } from "./button";

/**
 * An explicit ask before an irreversible action.
 *
 * Purbo needs this shape more than most apps do: deletions here are not
 * recoverable by anyone, including us, so "are you sure?" is not a formality.
 * The card therefore always states the consequences as a list rather than a
 * sentence the eye can skip, and the destructive control is never the one
 * under the cursor when the card appears.
 *
 * `confirmWord` adds a typed gate for the worst actions. It is deliberately
 * awkward — the friction is the feature.
 */
export function ApprovalCard({
  tone = "critical",
  title,
  question,
  consequences,
  confirmWord,
  confirmLabel,
  cancelLabel = "Cancel",
  loading = false,
  onConfirm,
  onCancel,
  className,
}: {
  tone?: "critical" | "caution";
  /** Short header, e.g. the name of the thing being acted on. */
  title?: string;
  question: string;
  consequences?: string[];
  confirmWord?: string;
  confirmLabel: string;
  cancelLabel?: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  className?: string;
}) {
  const inputId = useId();
  const [typed, setTyped] = useState("");

  // Reset the gate whenever the card is pointed at something else, so a word
  // typed for a previous target never carries over to this one.
  useEffect(() => setTyped(""), [confirmWord, question]);

  const gated = Boolean(confirmWord);
  const unlocked = !gated || typed.trim() === confirmWord;

  const accents = {
    critical: {
      shell: "border-critical/30 bg-critical/[0.03]",
      icon: "text-critical",
      heading: "text-critical",
    },
    caution: {
      shell: "border-caution/30 bg-caution/[0.03]",
      icon: "text-caution",
      heading: "text-caution",
    },
  }[tone];

  return (
    <div
      role="group"
      aria-label={question}
      className={cn(
        // No entrance of its own: every caller raises this inside a `<Reveal>`,
        // which already animates it in and — unlike an entry keyframe — can
        // animate it back out again when the question is answered.
        "overflow-hidden rounded-[var(--radius)] border",
        accents.shell,
        className,
      )}
    >
      <div className="flex gap-3 px-4 py-3.5">
        <AlertTriangle className={cn("mt-0.5 size-4 shrink-0", accents.icon)} aria-hidden />
        <div className="min-w-0 flex-1">
          {title ? <p className={cn("text-meta uppercase", accents.heading)}>{title}</p> : null}
          <p className="mt-0.5 text-[0.875rem] font-medium leading-relaxed">{question}</p>

          {consequences?.length ? (
            <ul className="mt-2.5 space-y-1.5">
              {consequences.map((line) => (
                <li
                  key={line}
                  className="flex gap-2 text-[0.8125rem] leading-relaxed text-ink-muted"
                >
                  <span aria-hidden className="mt-[0.5em] size-1 shrink-0 rounded-full bg-current opacity-40" />
                  <span className="min-w-0">{line}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {gated ? (
            <div className="mt-4">
              <label htmlFor={inputId} className="block text-[0.8125rem] font-medium">
                Type <span className="font-mono text-ink">{confirmWord}</span> to confirm
              </label>
              <input
                id={inputId}
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder={confirmWord}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="characters"
                spellCheck={false}
                className={cn(
                  "mt-2 w-full rounded-[var(--radius-sm)] border border-line-control bg-elevated px-3 py-2",
                  "font-mono text-sm placeholder:text-ink-subtle transition-colors",
                  "hover:border-ink-subtle focus:border-ink focus:outline-none",
                )}
              />
            </div>
          ) : null}
        </div>
      </div>

      {/* Cancel sits first so the safe choice is the one reached first by
          keyboard, and the destructive one is never the default submit. */}
      <div className="flex flex-wrap gap-2 border-t border-line/60 bg-elevated/40 px-4 py-3">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={loading}>
          {cancelLabel}
        </Button>
        <Button
          type="button"
          variant="danger"
          size="sm"
          loading={loading}
          disabled={!unlocked}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}
