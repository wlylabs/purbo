import { Check, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { StatusDot, type Tone } from "./status";

export type StepState = "done" | "active" | "pending" | "failed";

const STATE_TONES: Record<StepState, Tone> = {
  done: "positive",
  active: "info",
  pending: "neutral",
  failed: "critical",
};

/**
 * A vertical sequence of steps sharing one connector rail.
 *
 * Purbo uses it wherever a process has to be *shown* rather than summarised —
 * the key derivation chain, the setup flow — because "trust us, the maths
 * works" is exactly the claim a zero-knowledge product cannot make. Each step
 * can expand to the detail behind it without pushing the reader into docs.
 */
export function Trace({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <ol
      className={cn(
        "relative overflow-hidden rounded-[var(--radius-lg)] border border-line bg-elevated",
        className,
      )}
    >
      {children}
    </ol>
  );
}

/**
 * One step. Renders as a static row, or as a disclosure when given children.
 *
 * The disclosure is a native `<details>`: it opens with JavaScript disabled,
 * it is findable by in-page search in browsers that support it, and Escape
 * and keyboard activation come for free.
 */
export function TraceStep({
  title,
  state = "pending",
  meta,
  summary,
  children,
  last = false,
}: {
  title: string;
  state?: StepState;
  /** Machine-readable trailing detail: a parameter, a size, a duration. */
  meta?: string;
  /** One line shown collapsed, under the title. */
  summary?: string;
  children?: React.ReactNode;
  last?: boolean;
}) {
  const marker = (
    <span className="grid w-4 shrink-0 justify-center pt-[0.3125rem]">
      <span
        className={cn(
          // Opaque and above the rail, so the line runs behind the marker
          // rather than through it.
          "relative z-10 grid size-4 place-items-center rounded-full border bg-elevated",
          state === "done"
            ? "border-positive/40 text-positive"
            : state === "failed"
              ? "border-critical/40"
              : state === "active"
                ? "border-info/40"
                : "border-line",
        )}
      >
        {state === "done" ? (
          <Check className="size-2.5" aria-hidden strokeWidth={3} />
        ) : (
          <StatusDot tone={STATE_TONES[state]} live={state === "active"} />
        )}
      </span>
    </span>
  );

  const heading = (
    <span className="min-w-0 flex-1">
      <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-[0.875rem] font-medium tracking-tight">{title}</span>
        {meta ? <span className="text-meta">{meta}</span> : null}
      </span>
      {summary ? (
        <span className="mt-1 block text-[0.8125rem] leading-relaxed text-ink-muted">
          {summary}
        </span>
      ) : null}
    </span>
  );

  /*
   * The rail is anchored to the row, not to the marker.
   *
   * Hanging it off the marker looks equivalent until a step is expanded: the
   * marker only stretches to the height of the `<summary>`, so the line stops
   * dead where the disclosure body begins. Positioning it against the `<li>`
   * makes it span whatever the row currently is, open or closed.
   *
   * `left` is the marker's centre: the row's horizontal padding plus half the
   * 1rem marker column.
   */
  const rail = last ? null : (
    <span
      aria-hidden
      className="pointer-events-none absolute bottom-0 left-6 top-5 w-px bg-line sm:left-7"
    />
  );

  if (!children) {
    return (
      <li
        className={cn(
          "relative flex gap-3 px-4 py-3.5 sm:px-5",
          !last && "border-b border-line",
        )}
      >
        {rail}
        {marker}
        {heading}
      </li>
    );
  }

  return (
    <li className={cn("relative", !last && "border-b border-line")}>
      {rail}
      <details className="group/details">
        <summary
          className={cn(
            "flex cursor-pointer list-none gap-3 px-4 py-3.5 interactive sm:px-5",
            "hover:bg-tint active:bg-tint-strong [&::-webkit-details-marker]:hidden",
          )}
        >
          {marker}
          {heading}
          <ChevronRight
            aria-hidden
            className="mt-0.5 size-4 shrink-0 text-ink-subtle transition-transform duration-200 group-open/details:rotate-90"
          />
        </summary>
        {/* Indented to the title's left edge — padding + marker + gap — so the
            detail reads as continuing the step rather than as a new column. */}
        <div className="animate-fade pb-4 pl-11 pr-4 text-[0.8125rem] leading-relaxed text-ink-muted sm:pl-12 sm:pr-5">
          {children}
        </div>
      </details>
    </li>
  );
}
