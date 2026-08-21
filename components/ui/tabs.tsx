"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export interface TabItem<T extends string> {
  id: T;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  /** Counter shown after the label, for sections that hold a countable thing. */
  badge?: number;
}

/** Ids shared between a tab and the panel it controls. */
export function tabIds(name: string, id: string) {
  return { tabId: `${name}-tab-${id}`, panelId: `${name}-panel-${id}` };
}

// Measuring runs before paint on the client; on the server there is no layout
// to measure, so fall back to the passive effect to keep React quiet.
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Top-level navigation as an underlined tab bar.
 *
 * A pill strip reads as a control — one setting among the others on the page —
 * which is the wrong weight for the thing that decides which page you are on.
 * Tabs sitting on a rule read as structure: the sections are peers, the rule
 * is the edge of the bar they live in, and the marker under the active label
 * says which one the content below belongs to.
 *
 * The rule itself belongs to whatever bar hosts the strip, not to the strip,
 * so it can run the full width of the window while the labels stay inside the
 * page gutter. The marker is measured rather than assumed equal-width, so
 * labels of different lengths each get a snug underline.
 */
export function Tabs<T extends string>({
  name,
  label,
  items,
  value,
  onChange,
  className,
}: {
  /** Namespace for the generated tab/panel ids. */
  name: string;
  /** Accessible name for the strip itself. */
  label: string;
  items: TabItem<T>[];
  value: T;
  onChange: (next: T) => void;
  className?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [marker, setMarker] = useState<{ left: number; width: number } | null>(null);

  const activeIndex = Math.max(
    0,
    items.findIndex((item) => item.id === value),
  );

  /*
   * Keyed on which tabs are in the strip rather than on the array carrying
   * them, so a caller writing its items inline still gets a measured marker
   * instead of a render loop that ends with no marker at all.
   */
  const itemKey = items.map((item) => `${item.id}:${item.badge ?? ""}`).join("\u0000");

  useIsomorphicLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const measure = () => {
      const active = list.querySelector<HTMLButtonElement>('[data-active="true"]');
      if (!active) return;
      const next = { left: active.offsetLeft, width: active.offsetWidth };
      // Most observer callbacks change nothing; re-rendering on those would
      // restart the marker's travel mid-slide.
      setMarker((current) =>
        current && current.left === next.left && current.width === next.width ? current : next,
      );
    };

    measure();

    // Fonts landing late and container resizes both move the target.
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    for (const child of list.children) observer.observe(child);
    return () => observer.disconnect();
  }, [value, itemKey]);

  const move = (delta: number) => {
    const next = items[(activeIndex + delta + items.length) % items.length];
    if (!next) return;
    onChange(next.id);
    // Follow the selection with focus, which is what a roving tablist does.
    listRef.current
      ?.querySelector<HTMLButtonElement>(`#${CSS.escape(tabIds(name, next.id).tabId)}`)
      ?.focus();
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight" || event.key === "ArrowDown") {
          event.preventDefault();
          move(1);
        } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
          event.preventDefault();
          move(-1);
        }
      }}
      className={cn("relative flex items-stretch", className)}
    >
      {items.map((item) => {
        const selected = item.id === value;
        const { tabId, panelId } = tabIds(name, item.id);
        const Icon = item.icon;

        return (
          <button
            key={item.id}
            id={tabId}
            type="button"
            role="tab"
            data-active={selected}
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.id)}
            className={cn(
              "relative inline-flex items-center justify-center gap-2 whitespace-nowrap",
              "px-3 pb-3 pt-2.5 text-[0.8125rem] font-medium transition-colors duration-200",
              "sm:px-4 sm:text-sm",
              // Even thirds on a phone, where the bar is the width of the
              // screen and thumbs need the target; natural width from `sm` up,
              // where a stretched label leaves the marker floating in space.
              "min-w-0 flex-1 sm:flex-none",
              selected ? "text-ink" : "text-ink-muted hover:text-ink",
            )}
          >
            {Icon ? <Icon className="size-4 shrink-0" /> : null}
            <span className="truncate">{item.label}</span>
            {typeof item.badge === "number" ? (
              <span
                className={cn(
                  "hidden rounded-full border px-1.5 py-px text-[0.6875rem] tabular-nums",
                  "transition-colors duration-200 sm:inline-block",
                  selected ? "border-line-strong text-ink-muted" : "border-line text-ink-subtle",
                )}
              >
                {item.badge}
              </span>
            ) : null}
          </button>
        );
      })}

      {/* Sits a pixel below the strip so it lands on the host bar's rule
          rather than beside it. Hidden until measured, so it never flashes
          at the origin on first paint. */}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute -bottom-px left-0 h-0.5 rounded-full bg-ink",
          marker ? "opacity-100" : "opacity-0",
          "transition-[transform,width,opacity] duration-[250ms] ease-[cubic-bezier(0.16,1,0.3,1)]",
        )}
        style={
          marker ? { width: marker.width, transform: `translateX(${marker.left}px)` } : undefined
        }
      />
    </div>
  );
}
