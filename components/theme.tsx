"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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
  const groupRef = useRef<HTMLDivElement>(null);

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

  const selected = options.findIndex((option) => option.value === theme);

  /*
   * The keyboard half of `role="radiogroup"`.
   *
   * The role is a promise — one tab stop, arrows between the options — and
   * `<ChipRadioGroup>` in `components/ui/primitives.tsx` exists precisely
   * because writing the role and stopping there is worse than writing no role
   * at all. This strip was making that promise: three separate tab stops, and
   * arrow keys that did nothing. It cannot borrow the chip group itself — the
   * options here are icons behind one travelling disc — so it borrows the
   * behaviour.
   *
   * Selection follows focus, which is what a radio group does.
   */
  const move = (next: number) => {
    const option = options[(next + options.length) % options.length];
    if (!option) return;
    choose(option.value);
    groupRef.current
      ?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
      [(next + options.length) % options.length]?.focus();
  };

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label="Colour theme"
      onKeyDown={(event) => {
        // `selected` is -1 only before the stored choice is read back, where
        // starting from the first option is the same as starting from where
        // the strip is drawn.
        const from = Math.max(selected, 0);
        if (event.key === "ArrowRight" || event.key === "ArrowDown") move(from + 1);
        else if (event.key === "ArrowLeft" || event.key === "ArrowUp") move(from - 1);
        else if (event.key === "Home") move(0);
        else if (event.key === "End") move(options.length - 1);
        else return;
        event.preventDefault();
      }}
      className={cn(
        "relative inline-flex items-center gap-0.5 rounded-full border border-line-control bg-elevated p-0.5",
        className,
      )}
    >
      {/*
        One disc that moves, rather than three that recolour.
        Two buttons swapping fills is read as two separate events; a single
        mark travelling between them is read as the choice moving, which is
        what actually happened. The offset is arithmetic rather than measured
        because every option here is the same fixed size — 1.75rem of button
        plus the 0.125rem gap — so there is nothing a `ResizeObserver` would
        find that this does not already know.

        Hidden until the stored choice is known, so it never has to slide in
        from "light" on the first frame after hydration.
      */}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute left-0.5 top-0.5 size-7 rounded-full bg-invert-bg",
          mounted && selected >= 0 ? "opacity-100" : "opacity-0",
          "transition-[transform,opacity] duration-[250ms] ease-[cubic-bezier(0.16,1,0.3,1)]",
        )}
        style={{ transform: `translateX(calc(${Math.max(selected, 0)} * 1.875rem))` }}
      />

      {options.map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          type="button"
          role="radio"
          // Before hydration the stored value is unknown; reporting every
          // option as unchecked is more honest than guessing "system".
          aria-checked={mounted && theme === value}
          aria-label={label}
          // One tab stop for the group, on whichever option is chosen. Driven
          // by `theme` rather than by `mounted` so the stop is on the real
          // choice from the first frame after hydration; before that it sits
          // on the default, which is where the strip is drawn anyway.
          tabIndex={theme === value ? 0 : -1}
          onClick={() => choose(value)}
          className={cn(
            "relative z-10 grid size-7 place-items-center rounded-full interactive",
            mounted && theme === value
              ? // The disc behind it is already the pressed state; a tint on
                // top would only muddy it. Same reasoning as `<Segmented>`.
                "text-invert-fg"
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
