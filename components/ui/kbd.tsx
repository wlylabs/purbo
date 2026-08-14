"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/** A keycap. Purely presentational — the shortcut itself lives with the handler. */
export function Kbd({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-[0.3125rem] border border-line",
        "bg-elevated px-1.5 font-mono text-[0.625rem] font-medium text-ink-subtle raised",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/**
 * "⌘" on Apple platforms, "Ctrl" everywhere else.
 *
 * Resolved after mount: the server has no idea which keyboard is in front of
 * the user, and rendering the wrong modifier is worse than rendering none for
 * one frame.
 */
export function useModifierKey(): string | null {
  const [key, setKey] = useState<string | null>(null);

  useEffect(() => {
    const apple = /Mac|iPhone|iPad|iPod/.test(navigator.platform ?? "") ||
      /Mac OS X/.test(navigator.userAgent);
    setKey(apple ? "⌘" : "Ctrl");
  }, []);

  return key;
}
