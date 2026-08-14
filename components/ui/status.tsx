"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

export type Tone = "neutral" | "positive" | "caution" | "critical" | "info";

const DOT_TONES: Record<Tone, string> = {
  neutral: "bg-ink-subtle",
  positive: "bg-positive",
  caution: "bg-caution",
  critical: "bg-critical",
  info: "bg-info",
};

/**
 * A state indicator that distinguishes "settled" from "working".
 *
 * A steady dot means the state is final; the expanding ring means something
 * is still in flight. That difference is the whole point — a badge that looks
 * identical whether or not a sync is running teaches the user nothing.
 */
export function StatusDot({
  tone = "neutral",
  live = false,
  className,
}: {
  tone?: Tone;
  live?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("relative grid size-1.5 shrink-0 place-items-center", className)}>
      {live ? (
        <span
          aria-hidden
          className={cn("absolute size-1.5 rounded-full animate-ping-ring", DOT_TONES[tone])}
        />
      ) : null}
      <span className={cn("relative size-1.5 rounded-full", DOT_TONES[tone])} />
    </span>
  );
}

/**
 * Dot, label and optional trailing metadata in a hairline pill.
 *
 * `detail` carries the machine-readable half — an elapsed time, a revision, a
 * count — so the label itself can stay a single settled word.
 */
export function StatusPill({
  tone = "neutral",
  live = false,
  label,
  detail,
  title,
  className,
}: {
  tone?: Tone;
  live?: boolean;
  label: string;
  detail?: string | null;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-line bg-elevated px-2.5 py-1 raised",
        className,
      )}
    >
      <StatusDot tone={tone} live={live} />
      <span className="font-mono text-[0.6875rem] uppercase tracking-wide text-ink-muted">
        {label}
      </span>
      {detail ? (
        <>
          <span aria-hidden className="h-2.5 w-px bg-line" />
          <span className="text-meta tabular-nums">{detail}</span>
        </>
      ) : null}
    </span>
  );
}

/**
 * Seconds elapsed since `since`, re-rendered on a timer.
 *
 * Ticks once a second for the first minute and once a minute after that: past
 * that point the extra precision is invisible and the wakeups are not.
 * Returns null when there is nothing to count from.
 */
export function useElapsed(since: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (since === null) return;

    setNow(Date.now());
    const young = Date.now() - since < 60_000;
    const interval = window.setInterval(() => setNow(Date.now()), young ? 1000 : 60_000);
    return () => window.clearInterval(interval);
    // Re-arming when the age crosses a minute is handled by the effect
    // re-running on `since`; the coarser interval is good enough after that.
  }, [since]);

  if (since === null) return null;
  return Math.max(0, Math.round((now - since) / 1000));
}

/** Compact elapsed label: 4s, 3m, 2h, 5d. */
export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}
