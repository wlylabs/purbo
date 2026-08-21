import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

/*
 * Four flat fills, no bevel and no lift.
 *
 * Each variant names its resting, hover and pressed colour outright. Opacity
 * was doing that job before, which is cheaper to write and worse to look at:
 * a faded black button on a grey card is a different colour from the same
 * button on a white one, so the primary action stopped being one recognisable
 * shape across the app.
 */
const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-invert-bg text-invert-fg border border-transparent hover:bg-invert-hover active:bg-invert-active",
  secondary:
    "bg-control text-ink border border-line hover:bg-control-hover hover:border-line-strong active:bg-control-active",
  ghost:
    "bg-transparent text-ink-muted border border-transparent hover:bg-tint hover:text-ink active:bg-tint-strong",
  danger:
    "bg-transparent text-critical border border-critical/35 hover:bg-critical/10 hover:border-critical/60 active:bg-critical/[0.16]",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[0.8125rem] rounded-[var(--radius-sm)] gap-1.5",
  md: "h-10 px-4 text-sm rounded-[var(--radius)] gap-2",
  lg: "h-12 px-6 text-[0.9375rem] rounded-[var(--radius)] gap-2",
  icon: "h-9 w-9 rounded-[var(--radius-sm)] shrink-0",
};

/**
 * The button's classes without the element.
 *
 * Some of these controls are navigation, not actions, and a link that only
 * looks like a button loses middle-click, "open in new tab" and the status
 * bar preview. Sharing the styles is what lets those stay real anchors.
 *
 * It lives in its own module rather than beside `<Button>` because that file
 * is a client component, and a server-rendered anchor calling into a client
 * module is a runtime error — one that only shows up when the page is
 * actually requested.
 */
export function buttonStyles({
  variant = "primary",
  size = "md",
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}): string {
  return cn(
    "inline-flex items-center justify-center font-medium whitespace-nowrap",
    // Colour only. Nothing here moves: a control that dips under the cursor
    // is imitating a physical key, and on a touchscreen — where the press is
    // under a fingertip — the one thing it does is get hidden.
    "transition-colors duration-150",
    "disabled:pointer-events-none disabled:opacity-45",
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}
