import { cn } from "@/lib/utils";

/**
 * The Purbo mark: a keyhole cut from a solid square. Drawn with a single
 * even-odd path so it inherits `currentColor` and needs no theme variants.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden
      className={cn("size-7", className)}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M6 3.5h20A2.5 2.5 0 0 1 28.5 6v20a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 26V6A2.5 2.5 0 0 1 6 3.5Zm10 6.25a4 4 0 0 0-1.75 7.6V22a1.75 1.75 0 0 0 3.5 0v-4.65a4 4 0 0 0-1.75-7.6Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <Logo className="size-6" />
      <span className="text-[0.9375rem] font-semibold tracking-tight">Purbo</span>
    </span>
  );
}
