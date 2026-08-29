"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { Button } from "./button";

/**
 * A panel on the page.
 *
 * It reads as a card because its fill is a step off the canvas and a hairline
 * closes the shape — not because it is floating. Nesting one inside another
 * therefore needs no special case: the fills stop being different, and a
 * hairline is all that is left, which is exactly right for a group inside a
 * group.
 */
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("bg-elevated border border-line rounded-[var(--radius-lg)]", className)}
      {...props}
    />
  );
}

/**
 * A pill-shaped toggle: one option out of a row of them.
 *
 * The selected state is the inverted fill and nothing else — no bevel to say
 * "pushed in", which never survived being looked at next to an unselected
 * neighbour anyway. Role and state stay at the call site, because the same
 * shape is a `radio` in one place (auto-lock delay: exactly one) and a
 * `pressed` button in another (generator charsets: any number).
 */
export function Chip({
  selected = false,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "rounded-full border px-3.5 py-1.5 text-[0.8125rem] font-medium",
        "interactive",
        selected
          ? "border-transparent bg-invert-bg text-invert-fg hover:bg-invert-hover active:bg-invert-active"
          : "border-line-control bg-control text-ink-muted hover:bg-control-hover hover:text-ink active:bg-control-active",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A row of chips where exactly one is chosen.
 *
 * It exists because `role="radiogroup"` is a promise: a radio group takes one
 * tab stop and moves between its options with the arrow keys. Writing that
 * role over a row of buttons and stopping there is worse than using no role
 * at all — the roving `tabIndex` it implies takes the unselected options out
 * of the tab order, and with nothing listening for arrows they become
 * unreachable without a mouse. Keeping the behaviour in one component is what
 * stops the next such row from making the same promise.
 *
 * Selection follows focus, which is what a radio group does: arrowing to an
 * option chooses it.
 */
export function ChipRadioGroup<T extends string | number>({
  label,
  value,
  onChange,
  options,
  className,
}: {
  /** Accessible name for the group itself. */
  label: string;
  value: T;
  onChange: (next: T) => void;
  options: { value: T; label: string }[];
  className?: string;
}) {
  const activeIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  const move = (event: React.KeyboardEvent<HTMLDivElement>, next: number) => {
    event.preventDefault();
    const option = options[(next + options.length) % options.length];
    if (!option) return;
    onChange(option.value);
    // Focus follows the selection, so the next arrow press continues from
    // where the user actually is rather than from the old option.
    const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    buttons[(next + options.length) % options.length]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight" || event.key === "ArrowDown") move(event, activeIndex + 1);
        else if (event.key === "ArrowLeft" || event.key === "ArrowUp") move(event, activeIndex - 1);
        else if (event.key === "Home") move(event, 0);
        else if (event.key === "End") move(event, options.length - 1);
      }}
      className={cn("flex flex-wrap gap-2", className)}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Chip
            key={String(option.value)}
            role="radio"
            selected={selected}
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </Chip>
        );
      })}
    </div>
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
 * Content a click adds to the page, arriving and leaving at the same rate.
 *
 * The obvious way to write one of these is `{open ? <Panel /> : null}`, and it
 * is what most of this app used to do. It cannot animate a dismissal: the
 * moment the flag flips the node is gone, so "cancel" is a jump-cut and the
 * page below it lurches up to fill the hole. This keeps the children mounted
 * for exactly as long as the closing transition needs and then drops them,
 * which is what makes the two halves of the interaction match.
 *
 * Mounting on open rather than rendering hidden is deliberate. Panels here are
 * forms — a typed confirmation word, a staged import — and their reset-on-mount
 * behaviour is load-bearing: a permanently mounted panel would hand the next
 * caller the last one's half-finished state.
 */
export function Reveal({
  open,
  children,
  className,
}: {
  open: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  // Mounted-ness, which outlives `open` by the length of the close.
  const [present, setPresent] = useState(open);
  // The animated state, which lags `open` by a frame on the way in so the
  // grid has a collapsed row to travel from rather than starting at its
  // final height.
  const [expanded, setExpanded] = useState(open);
  /*
   * Whether the opening has finished.
   *
   * While the panel is moving its content has to be clipped to the row, or it
   * hangs out of a box that has not grown to hold it yet. Once it has arrived
   * the clip has to go: it would otherwise cut the focus ring off anything at
   * the panel's edge — and the first thing inside one of these is usually a
   * button or a field, which is exactly what gets focused.
   */
  const [settled, setSettled] = useState(open);

  useEffect(() => {
    if (!open) {
      setExpanded(false);
      setSettled(false);
      return;
    }

    setPresent(true);

    /*
     * Two frames, not one.
     *
     * A click is a discrete event, so React flushes this effect and the
     * re-render it schedules before the browser paints. One `rAF` lands in
     * that same frame: the collapsed row is mounted and expanded again
     * without ever having been painted, the browser sees a single computed
     * style, and there is no transition to run — the panel snaps open and,
     * with no `transitionend` to follow, never reports itself settled either.
     * Waiting for the second frame is what guarantees `0fr` was actually
     * rendered to travel from.
     */
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setExpanded(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [open]);

  if (!present) return null;

  return (
    <div
      className={cn("reveal", className)}
      data-open={expanded}
      data-settled={settled}
      // Focus must not stay inside something that is on its way out — and
      // this is the closing half only, so an autofocus on open still lands.
      inert={!open}
      onTransitionEnd={(event) => {
        // Transitions from the panel's own contents bubble through here; only
        // the row itself finishing means the panel has arrived or gone.
        if (event.target !== event.currentTarget) return;
        if (event.propertyName !== "grid-template-rows") return;
        if (open) setSettled(true);
        else setPresent(false);
      }}
    >
      <div>{children}</div>
    </div>
  );
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
  /*
   * Generated rather than a fixed string.
   *
   * A constant id is a promise there is only ever one of these on the page,
   * and nothing enforces it: two modals mounted at once — one closing while
   * the next opens — leave two elements answering to the same name, and
   * `aria-labelledby` resolves to whichever the document happens to hold
   * first. That is a dialog announced with another dialog's title.
   */
  const id = useId();

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
      aria-labelledby={`${id}-title`}
      // The description says what the dialog is for — "encrypted in this
      // browser before it is saved" — which is context for the whole panel
      // rather than for the first field in it, so it belongs here.
      aria-describedby={description ? `${id}-description` : undefined}
      onClick={(event) => {
        // Clicks land on the backdrop only when the target is the dialog
        // element itself; anything inside the panel stops here.
        if (event.target === ref.current) onClose();
      }}
      className={cn(
        "m-auto w-[calc(100vw-2rem)] max-w-lg bg-transparent p-0 text-ink",
        // Opens and closes with the same motion, backdrop included. See the
        // class in `app/globals.css` for why the exit needs CSS rather than a
        // `close()` the moment the flag flips.
        "dialog-reveal",
      )}
    >
      <div
        className={cn(
          "bg-elevated border border-line rounded-[var(--radius-lg)] overflow-hidden shadow-modal",
          "max-h-[85vh] flex flex-col",
          className,
        )}
      >
        {/* The header stays put while the body scrolls, so the title of a long
            entry is still on screen when the delete control is reached. */}
        <header className="flex items-start justify-between gap-4 px-5 py-4 border-b border-line shrink-0 bg-elevated">
          <div className="space-y-1">
            <h2 id={`${id}-title`} className="text-[0.9375rem] font-semibold tracking-tight">
              {title}
            </h2>
            {description ? (
              <p
                id={`${id}-description`}
                className="text-[0.8125rem] text-ink-muted leading-relaxed"
              >
                {description}
              </p>
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
