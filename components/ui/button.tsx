"use client";

import { Loader2 } from "lucide-react";
import { forwardRef } from "react";

import { cn } from "@/lib/utils";

import { buttonStyles, type ButtonSize, type ButtonVariant } from "./button-styles";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", size = "md", loading, disabled, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonStyles({ variant, size, loading, className })}
      {...props}
    >
      {/*
       * The spinner is laid over the label rather than let into the row beside
       * it.
       *
       * Letting it in meant a 16px icon and a gap opening up under the pointer
       * at the exact moment of the click: the label lurched sideways, and a
       * button that was not `flex-1` grew and shoved its neighbours along with
       * it. Keeping the label's box means nothing that was measured before the
       * click measures differently after it — the same thing the rest of the
       * system is saying when it refuses to let a control move under a press.
       * MUI settles its centred loading buttons this way too: the label is made
       * transparent in place and the indicator is centred over it.
       *
       * Primer's alternative is to swap the button's leading visual for the
       * spinner, which keeps the label readable. It needs to know which child
       * is the leading visual, though, and most of the buttons here are text
       * with no icon at all — so it would have left the majority still shifting.
       *
       * `gap-[inherit]` because the label is now the button's only flow child:
       * the gap the size chose has nothing left to space out at that level, so
       * the wrapper takes it over for the icon-and-text case.
       */}
      <span
        className={cn(
          "inline-flex items-center justify-center gap-[inherit]",
          /*
           * Not `invisible`. `visibility: hidden` takes the label out of the
           * accessibility tree as well, and a button that draws its name from
           * its own contents would be left with no name at all — at the moment
           * a screen reader is most likely to be asking for one. Opacity is
           * hiding content here, which is not the thing the palette rules out:
           * it is still never allowed to stand in for a fill.
           */
          loading && "opacity-0",
        )}
      >
        {children}
      </span>

      {loading ? (
        <span className="absolute inset-0 grid place-items-center" aria-hidden>
          <Loader2 className="size-4 animate-spin" />
        </span>
      ) : null}
    </button>
  );
});
