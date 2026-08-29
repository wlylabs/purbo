"use client";

import { ChevronDown, Lock, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { Wordmark } from "@/components/logo";
import { ThemeToggle } from "@/components/theme";
import { Button } from "@/components/ui/button";
import {
  StatusDot,
  StatusPill,
  formatElapsed,
  useElapsed,
  type Tone,
} from "@/components/ui/status";
import { useVault, type SyncState } from "@/lib/vault/provider";

const SYNC_LABELS: Record<SyncState, { text: string; tone: Tone; live: boolean }> = {
  idle: { text: "Synced", tone: "positive", live: false },
  syncing: { text: "Syncing", tone: "info", live: true },
  offline: { text: "Offline", tone: "caution", live: false },
  error: { text: "Conflict", tone: "critical", live: false },
};

/**
 * Sync state with the age of the last confirmed round-trip.
 *
 * "Synced" on its own is not falsifiable — it looks the same one second and
 * one hour after the connection dropped. The clock is what makes the claim
 * checkable, so it is only shown for states that actually reached the server.
 */
function SyncBadge() {
  const { syncState, syncMessage, lastSyncedAt } = useVault();
  const label = SYNC_LABELS[syncState];
  const elapsed = useElapsed(lastSyncedAt);

  const detail =
    syncState === "idle" && elapsed !== null
      ? elapsed < 5
        ? "now"
        : formatElapsed(elapsed)
      : null;

  return (
    <StatusPill
      className="hidden sm:inline-flex"
      tone={label.tone}
      live={label.live}
      label={label.text}
      detail={detail}
      title={syncMessage ?? (detail ? `Last confirmed by the server ${detail} ago` : undefined)}
    />
  );
}

/**
 * The account, such as it is.
 *
 * There is no email or username to show — the account *is* a key pair, and
 * its id is a hash of the public half. Showing that hash is not decoration:
 * it is the only way to tell which vault this browser is holding, and it is
 * what two devices can be compared on to confirm they are the same account.
 */
function AccountMenu() {
  const { accountId, forgetDevice } = useVault();
  const [open, setOpen] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  /**
   * Close, putting focus back where it came from.
   *
   * The panel goes `inert` on the way out, and inert does not politely hand
   * focus back — whatever was focused inside simply stops being focusable and
   * the document falls back to `<body>`. So a keyboard user who tabbed to
   * "Forget this device" and pressed Escape would land nowhere, with the next
   * Tab restarting from the top of the page. Returning to the trigger is both
   * the fix and the right place to be: it is what was just closed.
   *
   * Guarded on focus actually being inside, so the click-outside path — where
   * the pointer has already chosen somewhere else to be — is not fought.
   */
  const close = () => {
    setOpen(false);
    if (ref.current?.contains(document.activeElement)) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!accountId) return null;

  const short = `${accountId.slice(0, 6)}…${accountId.slice(-4)}`;

  return (
    <div className="relative" ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-line-control px-2.5 py-1.5 text-[0.8125rem] interactive hover:bg-tint active:bg-tint-strong"
      >
        <span className="max-w-32 truncate font-mono text-[0.75rem] text-ink-muted">
          {short}
        </span>
        <ChevronDown className="size-3.5 text-ink-subtle" aria-hidden />
      </button>

      {/*
        A disclosure, not a menu.
        `role="menu"` is the same kind of promise `<ChipRadioGroup>` exists to
        stop being made loosely: it says arrow keys move between items and
        that every child is one. This panel is two paragraphs of prose, a
        button and a footnote — prose is not a `menuitem`, and a menu with one
        item has nothing for an arrow key to reach. Naming it for what it is
        leaves Tab working, which is what actually gets a keyboard user to the
        button.
      */}
      <div
        id={panelId}
        // `aria-label` needs a role to land on: on a bare `<div>` it is not
        // exposed at all, so the panel the trigger points at would have no
        // name when a screen reader followed `aria-controls` into it.
        role="group"
        aria-label="Account"
        data-open={open}
        inert={!open}
        // A blur crossfade reads as intentional on something the size of a
        // modal; on a menu this small it just muddies the text mid-transition.
        style={{ "--panel-blur": "0px" } as React.CSSProperties}
        className="panel-reveal absolute right-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-[var(--radius)] border border-line bg-elevated shadow-pop"
      >
        <div className="border-b border-line px-3 py-2.5">
          <p className="text-[0.8125rem] font-medium">Account</p>
          <p className="mt-1 break-all font-mono text-[0.6875rem] leading-relaxed text-ink-subtle">
            {accountId}
          </p>
          <p className="mt-2 text-[0.6875rem] leading-relaxed text-ink-subtle">
            Derived from your recovery phrase. It identifies your vault to the
            server and nothing else.
          </p>
        </div>
        {/* Not "sign out": there is no session anywhere to end. What this
            does is delete the encrypted copy cached here, which is a real
            and irreversible local action, so it is named for that. */}
        <button
          type="button"
          disabled={forgetting}
          onClick={async () => {
            setForgetting(true);
            try {
              await forgetDevice();
            } finally {
              setForgetting(false);
              close();
            }
          }}
          className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[0.8125rem] text-ink-muted interactive hover:bg-tint hover:text-ink active:bg-tint-strong disabled:pointer-events-none disabled:text-ink-subtle"
        >
          <Trash2 className="size-3.5" aria-hidden />
          Forget this device
        </button>
        <p className="border-t border-line px-3 py-2 text-[0.6875rem] leading-relaxed text-ink-subtle">
          Removes the local copy only. Your vault stays on the server — come
          back with the recovery phrase or a passkey.
        </p>
      </div>
    </div>
  );
}

export function AppHeader() {
  const { status, lock, syncState } = useVault();
  const sync = SYNC_LABELS[syncState];

  return (
    <header className="pt-safe sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-5 sm:px-6">
        <div className="flex items-center gap-2.5">
          <Wordmark />
          {/* The full pill does not fit on a phone; the dot alone still
              distinguishes settled from in-flight, which is the part that
              changes without the user doing anything. */}
          <span className="sm:hidden" title={sync.text}>
            <StatusDot tone={sync.tone} live={sync.live} />
            <span className="sr-only">{sync.text}</span>
          </span>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <SyncBadge />
          <ThemeToggle className="hidden sm:inline-flex" />
          {status === "unlocked" ? (
            <Button variant="secondary" size="sm" onClick={lock}>
              <Lock className="size-3.5" aria-hidden />
              <span className="hidden sm:inline">Lock</span>
            </Button>
          ) : null}
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}
