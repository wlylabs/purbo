"use client";

import { Loader2 } from "lucide-react";
import { forwardRef } from "react";

import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg" | "icon";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-invert-bg text-invert-fg border border-transparent raised hover:opacity-90 active:opacity-80",
  secondary:
    "bg-elevated text-ink border border-line raised hover:border-line-strong hover:bg-surface",
  ghost: "bg-transparent text-ink-muted border border-transparent hover:bg-surface hover:text-ink",
  danger:
    "bg-transparent text-critical border border-critical/30 hover:bg-critical/10 hover:border-critical/50",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-[0.8125rem] rounded-[var(--radius-sm)] gap-1.5",
  md: "h-10 px-4 text-sm rounded-[var(--radius)] gap-2",
  lg: "h-12 px-6 text-[0.9375rem] rounded-[var(--radius)] gap-2",
  icon: "h-9 w-9 rounded-[var(--radius-sm)] shrink-0",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

/**
 * The button's classes without the element.
 *
 * Some of these controls are navigation, not actions, and a link that only
 * looks like a button loses middle-click, "open in new tab" and the status
 * bar preview. Sharing the styles is what lets those stay real anchors.
 */
export function buttonStyles({
  variant = "primary",
  size = "md",
  className,
}: {
  variant?: Variant;
  size?: Size;
  className?: string;
} = {}): string {
  return cn(
    "inline-flex items-center justify-center font-medium whitespace-nowrap",
    "transition-[opacity,background-color,border-color,transform] duration-150",
    "active:translate-y-px",
    "disabled:pointer-events-none disabled:opacity-45",
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", size = "md", loading, disabled, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      // The 1px dip on press lives in `buttonStyles`: enough to feel like the
      // control took the click on a touchscreen, where there is no hover
      // state to confirm it.
      className={buttonStyles({ variant, size, className })}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
});
