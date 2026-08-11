import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Copies text and schedules a clipboard wipe.
 *
 * A password sitting in the system clipboard is readable by every other app
 * on the machine and, on some platforms, by the next page that asks. Clearing
 * it after a short window is a meaningful reduction in exposure — best-effort,
 * since a browser can refuse the write when the tab is not focused.
 */
export async function copyWithAutoClear(value: string, clearAfterMs = 30_000) {
  await navigator.clipboard.writeText(value);

  window.setTimeout(() => {
    void navigator.clipboard.readText().then(
      (current) => {
        // Only wipe if the clipboard still holds *our* value — the user may
        // have copied something else since, and clobbering that is hostile.
        if (current === value) void navigator.clipboard.writeText("");
      },
      () => {
        // Read permission is commonly denied. Overwriting blindly would
        // destroy unrelated clipboard content, so do nothing instead.
      },
    );
  }, clearAfterMs);
}

export function formatRelativeTime(timestamp: number): string {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 45) return "just now";

  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const divisions: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, "second"],
    [60, "minute"],
    [24, "hour"],
    [7, "day"],
    [4.34524, "week"],
    [12, "month"],
    [Number.POSITIVE_INFINITY, "year"],
  ];

  let value = seconds;
  for (const [amount, unit] of divisions) {
    if (Math.abs(value) < amount) return formatter.format(-Math.round(value), unit);
    value /= amount;
  }
  return formatter.format(-Math.round(value), "year");
}

/** Domain of a URL, for display. Returns null for anything unparseable. */
export function hostnameOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url.includes("://") ? url : `https://${url}`);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Normalises a user-entered URL for use in an `href`.
 *
 * Returns null for anything that is not http(s) — a stored `javascript:` URL
 * would otherwise become a self-XSS vector the moment the user clicks it.
 */
export function safeExternalUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url.includes("://") ? url : `https://${url}`);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

/** Deterministic two-letter monogram for an entry avatar. */
export function monogram(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return "—";
  const words = cleaned.split(/\s+/);
  if (words.length === 1) return cleaned.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}
