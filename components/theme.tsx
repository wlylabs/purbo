"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

export type Theme = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "purbo:theme";

/**
 * Applied before first paint by the inline script in the root layout, and
 * again here whenever the user changes it.
 */
function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>("system");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY) as Theme | null;
    if (stored === "light" || stored === "dark" || stored === "system") setTheme(stored);
    setMounted(true);
  }, []);

  const choose = (next: Theme) => {
    setTheme(next);
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
    applyTheme(next);
  };

  const options: { value: Theme; icon: typeof Sun; label: string }[] = [
    { value: "light", icon: Sun, label: "Light" },
    { value: "dark", icon: Moon, label: "Dark" },
    { value: "system", icon: Monitor, label: "System" },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full border border-line-control bg-elevated p-0.5",
        className,
      )}
    >
      {options.map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          type="button"
          role="radio"
          // Before hydration the stored value is unknown; reporting every
          // option as unchecked is more honest than guessing "system".
          aria-checked={mounted && theme === value}
          aria-label={label}
          onClick={() => choose(value)}
          className={cn(
            "grid place-items-center size-7 rounded-full interactive",
            mounted && theme === value
              ? "bg-invert-bg text-invert-fg active:bg-invert-active"
              : "text-ink-subtle hover:text-ink active:bg-tint-strong",
          )}
        >
          <Icon className="size-3.5" aria-hidden />
        </button>
      ))}
    </div>
  );
}

/**
 * Runs before paint to stop a light-mode flash on a dark-themed device.
 * Kept tiny and dependency-free because it is inlined into the document.
 */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t)}}catch(e){}})();`;
