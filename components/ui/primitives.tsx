"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";
import { Button } from "./button";

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "bg-elevated border border-line rounded-[var(--radius-lg)]",
        className,
      )}
      {...props}
    />
  );
}

export function Badge({
  tone = "neutral",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  tone?: "neutral" | "positive" | "caution" | "critical";
}) {
  const tones = {
    neutral: "border-line text-ink-muted",
    positive: "border-positive/30 text-positive",
    caution: "border-caution/30 text-caution",
    critical: "border-critical/30 text-critical",
  } as const;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5",
        "text-[0.6875rem] font-medium tracking-wide",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

export function Separator({ className }: { className?: string }) {
  return <div role="separator" className={cn("h-px w-full bg-line", className)} />;
}

/**
 * Modal dialog built on <dialog>, so focus trapping, Escape handling and
 * inertness of the background come from the platform rather than from a
 * hand-rolled keydown listener that will eventually get one of them wrong.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    const handleCancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    dialog.addEventListener("cancel", handleCancel);
    return () => dialog.removeEventListener("cancel", handleCancel);
  }, [onClose]);

  // Lock background scrolling while the dialog is up.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="modal-title"
      onClick={(event) => {
        // Clicks land on the backdrop only when the target is the dialog
        // element itself; anything inside the panel stops here.
        if (event.target === ref.current) onClose();
      }}
      className={cn(
        "m-auto w-[calc(100vw-2rem)] max-w-lg bg-transparent p-0 text-ink",
        "backdrop:bg-overlay backdrop:backdrop-blur-[2px]",
        "open:animate-fade",
      )}
    >
      <div
        className={cn(
          "bg-elevated border border-line rounded-[var(--radius-lg)] overflow-hidden",
          "max-h-[85vh] flex flex-col",
          className,
        )}
      >
        <header className="flex items-start justify-between gap-4 px-5 py-4 border-b border-line shrink-0">
          <div className="space-y-1">
            <h2 id="modal-title" className="text-[0.9375rem] font-semibold tracking-tight">
              {title}
            </h2>
            {description ? (
              <p className="text-[0.8125rem] text-ink-muted leading-relaxed">{description}</p>
            ) : null}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close dialog">
            <X className="size-4" aria-hidden />
          </Button>
        </header>
        <div className="overflow-y-auto px-5 py-5">{children}</div>
      </div>
    </dialog>
  );
}

/** Small inline notice. Never used for secrets. */
export function Notice({
  tone = "neutral",
  icon,
  children,
  className,
}: {
  tone?: "neutral" | "positive" | "caution" | "critical";
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const tones = {
    neutral: "border-line bg-surface text-ink-muted",
    positive: "border-positive/25 bg-positive/5 text-positive",
    caution: "border-caution/25 bg-caution/5 text-caution",
    critical: "border-critical/25 bg-critical/5 text-critical",
  } as const;

  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-[var(--radius-sm)] border px-3 py-2.5",
        "text-[0.8125rem] leading-relaxed",
        tones[tone],
        className,
      )}
    >
      {icon ? <span className="shrink-0 mt-0.5">{icon}</span> : null}
      <div className="min-w-0">{children}</div>
    </div>
  );
}
