"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import { formatElapsed } from "./status";

/**
 * A skeleton block.
 *
 * Used in place of a spinner wherever the shape of the incoming content is
 * already known — a list of entries, a row of metadata. The layout then
 * settles once instead of twice.
 */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn("animate-shimmer rounded-[var(--radius-sm)]", className)}
      {...props}
    />
  );
}

/** A placeholder in the shape of one vault entry. */
export function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 bg-canvas p-4">
      <Skeleton className="size-9 shrink-0" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-3 w-28 rounded-full" />
        <Skeleton className="h-2.5 w-20 rounded-full" />
      </div>
      <Skeleton className="h-2.5 w-10 shrink-0 rounded-full" />
    </div>
  );
}

// Column-major so the sweep reads left to right rather than as a diagonal.
const PIXEL_DELAYS = [0, 90, 180, 45, 135, 225, 90, 180, 270];

/**
 * Pixel-grid loader: nine cells pulsing on a staggered delay.
 *
 * The point of using it over a spinner is that it has no implied progress. A
 * rotating arc suggests something is being fetched; unlocking a vault is
 * Argon2id burning 64 MiB of memory locally, which finishes when it finishes.
 */
export function PixelLoader({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("grid grid-cols-3 gap-[3px]", className)}
    >
      {PIXEL_DELAYS.map((delay, index) => (
        <span
          key={index}
          className="size-1.5 rounded-[2px] bg-ink animate-pixel"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}

/**
 * Full-height wait state: mark, loader, message and a running clock.
 *
 * The clock is the honest part. Argon2id at 64 MiB is deliberately slow, and
 * an unexplained three-second pause on a password screen reads as a hang; a
 * counter says the work is real and still going.
 */
export function WaitState({
  message,
  hint,
  showElapsedAfterMs = 3000,
  className,
}: {
  message: string;
  hint?: string;
  /** Below this, the counter would only add noise to a fast load. */
  showElapsedAfterMs?: number;
  className?: string;
}) {
  const [startedAt] = useState(() => Date.now());
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(
      () => setSeconds(Math.round((Date.now() - startedAt) / 1000)),
      1000,
    );
    return () => window.clearInterval(interval);
  }, [startedAt]);

  const showElapsed = seconds * 1000 >= showElapsedAfterMs;

  return (
    <div className={cn("flex flex-col items-center gap-4 text-center", className)}>
      <PixelLoader />
      <div className="space-y-1">
        <p className="text-[0.8125rem] text-ink-muted" role="status">
          {message}
        </p>
        {hint ? <p className="text-xs text-ink-subtle">{hint}</p> : null}
      </div>
      {/* Reserved height, so the counter appearing does not shift the block. */}
      <p className="text-meta h-3.5">{showElapsed ? formatElapsed(seconds) : ""}</p>
    </div>
  );
}
