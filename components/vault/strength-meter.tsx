"use client";

import { useMemo } from "react";

import { STRENGTH_LABELS, estimateStrength } from "@/lib/crypto/password";
import { cn } from "@/lib/utils";

const SEGMENT_TONES = [
  "bg-critical",
  "bg-critical",
  "bg-caution",
  "bg-positive",
  "bg-positive",
] as const;

const TEXT_TONES = [
  "text-critical",
  "text-critical",
  "text-caution",
  "text-positive",
  "text-positive",
] as const;

export function StrengthMeter({
  password,
  showDetails = true,
  className,
}: {
  password: string;
  showDetails?: boolean;
  className?: string;
}) {
  const result = useMemo(() => estimateStrength(password), [password]);
  const filled = password ? result.score + 1 : 0;

  return (
    <div className={cn("space-y-2", className)}>
      <div
        className="flex gap-1"
        role="meter"
        aria-valuenow={filled}
        aria-valuemin={0}
        aria-valuemax={5}
        aria-label={`Password strength: ${STRENGTH_LABELS[result.label]}`}
      >
        {Array.from({ length: 5 }, (_, index) => (
          <span
            key={index}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors duration-200",
              index < filled ? SEGMENT_TONES[result.score] : "bg-line",
            )}
          />
        ))}
      </div>

      {showDetails && password ? (
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className={cn("text-xs font-medium", TEXT_TONES[result.score])}>
            {STRENGTH_LABELS[result.label]}
          </span>
          <span className="font-mono text-[0.6875rem] text-ink-subtle">
            {result.bits} bits · {result.crackTime} to crack
          </span>
        </div>
      ) : null}

      {showDetails && result.warnings.length > 0 ? (
        <ul className="space-y-1">
          {result.warnings.map((warning) => (
            <li key={warning} className="text-[0.6875rem] leading-relaxed text-ink-subtle">
              {warning}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
