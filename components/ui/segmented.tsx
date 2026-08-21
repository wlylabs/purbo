"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export interface SegmentedItem<T extends string> {
  id: T;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
}

/** Ids shared between a tab and the panel it controls. */
export function segmentedIds(name: string, id: string) {
  return { tabId: `${name}-tab-${id}`, panelId: `${name}-panel-${id}` };
}

// Measuring runs before paint on the client; on the server there is no layout
// to measure, so fall back to the passive effect to keep React quiet.
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * A tab strip whose selected state is a single element that moves.
 *
 * Recolouring two separate buttons makes the change look like two unrelated
 * events; one travelling pill reads as the same object moving, which is what
 * actually happened. The indicator is measured rather than assumed equal-width
 * so labels of different lengths still get a snug fit.
 */
export function Segmented<T extends string>({
  name,
  label,
  items,
  value,
  onChange,
  fill = false,
  className,
}: {
  /** Namespace for the generated tab/panel ids. */
  name: string;
  /** Accessible name for the strip itself. */
  label: string;
  items: SegmentedItem<T>[];
  value: T;
  onChange: (next: T) => void;
  /** Stretch to the full width of the container, splitting it evenly. */
  fill?: boolean;
  className?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  const activeIndex = Math.max(
    0,
    items.findIndex((item) => item.id === value),
  );

  /*
   * What the measurement depends on is which items are in the strip, not
   * which array object carries them.
   *
   * Keying the effect on the array itself is a trap, because writing the
   * items inline at the call site is the obvious thing to do: a fresh array
   * every render re-runs the effect, the effect sets state, the state renders
   * again, and React cuts the loop off — leaving the indicator unmeasured and
   * therefore transparent, with the selected label still painted in the
   * colour that only works on top of it.
   */
  const itemKey = items.map((item) => item.id).join("\u0000");

  useIsomorphicLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const measure = () => {
      const active = list.querySelector<HTMLButtonElement>('[data-active="true"]');
      if (!active) return;
      const next = { left: active.offsetLeft, width: active.offsetWidth };
      // The observer fires on every layout pass, most of which change
      // nothing; re-rendering on those would restart the pill's transition
      // mid-travel.
      setIndicator((current) =>
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
      ?.querySelector<HTMLButtonElement>(`#${CSS.escape(segmentedIds(name, next.id).tabId)}`)
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
      className={cn(
        "relative inline-flex rounded-[var(--radius)] border border-line bg-surface p-1",
        fill && "w-full",
        className,
      )}
    >
      {/* The travelling pill. Hidden until measured so it never flashes at
          the origin on first paint. */}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-1 rounded-[calc(var(--radius)-0.25rem)]",
          "bg-invert-bg",
          indicator ? "opacity-100" : "opacity-0",
          "transition-[transform,width,opacity] duration-[250ms] ease-[cubic-bezier(0.16,1,0.3,1)]",
        )}
        style={
          indicator
            ? { width: indicator.width, transform: `translateX(${indicator.left - 4}px)` }
            : undefined
        }
      />

      {items.map((item) => {
        const selected = item.id === value;
        const { tabId, panelId } = segmentedIds(name, item.id);
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
              "relative z-10 inline-flex items-center justify-center gap-2 rounded-[calc(var(--radius)-0.25rem)]",
              "px-3 py-1.5 text-[0.8125rem] font-medium transition-colors duration-200",
              // `min-w-0` is what lets a filled strip actually divide the
              // width. A flex item defaults to min-width:auto and refuses to
              // shrink below its label, so on a narrow phone two long labels
              // overflow the strip and collide with the travelling pill
              // instead of wrapping inside their own half.
              fill && "min-w-0 flex-1",
              selected ? "text-invert-fg" : "text-ink-muted hover:text-ink",
            )}
          >
            {Icon ? <Icon className="size-3.5" /> : null}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
