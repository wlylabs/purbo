"use client";

import {
  AlertTriangle,
  Check,
  ChevronRight,
  Copy,
  KeyRound,
  Lock,
  Plus,
  Search,
  User,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Kbd, useModifierKey } from "@/components/ui/kbd";
import { Notice } from "@/components/ui/primitives";
import { useVault } from "@/lib/vault/provider";
import type { VaultItem } from "@/lib/vault/types";
import { cn, copyWithAutoClear, formatRelativeTime, hostnameOf, monogram } from "@/lib/utils";
import { ItemDetail } from "./item-detail";
import { ItemForm } from "./item-form";
import { StepUp } from "./step-up";

type CopyField = "username" | "password";

export function VaultView() {
  const { items, saveItem, removeItem, corrupted, stepUpVerified } = useVault();

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<VaultItem | null>(null);
  const [editing, setEditing] = useState<VaultItem | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  // Quick-copy state for the cards themselves, so username and password can
  // be grabbed straight from the list — the whole point of a dashboard is
  // that the thing you came for is one click away, not behind a detail view.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [liveMessage, setLiveMessage] = useState("");

  useEffect(() => {
    if (!copiedKey) return;
    const timer = window.setTimeout(() => setCopiedKey(null), 2000);
    return () => window.clearTimeout(timer);
  }, [copiedKey]);

  const copyField = async (item: VaultItem, field: CopyField) => {
    const key = `${item.id}:${field}`;
    try {
      await copyWithAutoClear(field === "username" ? item.username : item.password);
      setCopiedKey(key);
      setFailedKey(null);
      setLiveMessage(
        field === "password"
          ? `Password copied for ${item.name}. Clipboard clears in 30 seconds.`
          : `Username copied for ${item.name}.`,
      );
    } catch {
      setFailedKey(key);
      setLiveMessage("Clipboard access was blocked by the browser.");
    }
  };

  const requestPasswordCopy = (item: VaultItem) => {
    if (stepUpVerified) {
      void copyField(item, "password");
      return;
    }
    setConfirmingId(item.id);
  };

  // Search runs over decrypted entries in memory — there is no server-side
  // index to build, because the server cannot read any of this.
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) =>
      [item.name, item.username, item.url ?? "", item.notes ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [items, query]);

  // Keep the open detail view in sync with edits made behind it.
  const selectedLive = selected
    ? (items.find((item) => item.id === selected.id) ?? null)
    : null;

  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchField value={query} onChange={setQuery} />
        <Button onClick={openNew}>
          <Plus className="size-4" aria-hidden />
          New entry
        </Button>
      </div>

      {corrupted.length > 0 ? (
        <Notice tone="critical" icon={<AlertTriangle className="size-4" />}>
          {corrupted.length} {corrupted.length === 1 ? "entry" : "entries"} failed
          authentication and could not be decrypted. They were stored with a different key or
          have been altered; the rest of your vault is unaffected.
        </Notice>
      ) : null}

      {items.length === 0 ? (
        <EmptyState onAdd={openNew} />
      ) : filtered.length === 0 ? (
        <div className="animate-fade rounded-[var(--radius-lg)] border border-line bg-elevated raised py-12 text-center sm:py-16">
          <p className="text-[0.9375rem] font-medium">No matches</p>
          <p className="mt-1 text-[0.8125rem] text-ink-muted">
            Nothing in your vault matches &ldquo;{query}&rdquo;.
          </p>
        </div>
      ) : (
        <>
          <p className="text-label">
            {filtered.length} {filtered.length === 1 ? "entry" : "entries"}
            {query ? ` of ${items.length}` : ""}
          </p>
          <ul className="stagger grid gap-px overflow-hidden rounded-[var(--radius-lg)] border border-line bg-line raised sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((item, index) => (
              <li
                key={item.id}
                // Drives the entrance delay from globals.css, so the list
                // arrives as a sweep rather than all at once.
                style={{ "--stagger-index": index } as React.CSSProperties}
                className="flex flex-col bg-canvas"
              >
                <div className="flex items-center gap-1 p-2.5">
                  <button
                    type="button"
                    onClick={() => setSelected(item)}
                    className="group flex min-w-0 flex-1 items-center gap-3 rounded-[var(--radius-sm)] p-1.5 text-left transition-colors hover:bg-surface"
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-line bg-surface text-[0.6875rem] font-medium text-ink-muted transition-colors group-hover:border-line-strong group-hover:text-ink">
                      {monogram(item.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.875rem] font-medium">
                        {item.name}
                      </span>
                      <span className="block truncate text-xs text-ink-subtle">
                        {item.username || hostnameOf(item.url) || "No username"}
                        <span className="text-ink-subtle/70"> · {formatRelativeTime(item.updatedAt)}</span>
                      </span>
                    </span>
                    <ChevronRight
                      aria-hidden
                      className="size-3.5 shrink-0 text-ink-subtle opacity-0 transition-opacity group-hover:opacity-100"
                    />
                  </button>

                  {/* Straight off the card: the whole point of putting the
                      vault on the dashboard is that a saved password is one
                      click away, not one click into a detail view and then
                      another to copy it. */}
                  <div className="flex shrink-0 items-center gap-0.5">
                    {item.username ? (
                      <QuickAction
                        label={`Copy username for ${item.name}`}
                        done={copiedKey === `${item.id}:username`}
                        failed={failedKey === `${item.id}:username`}
                        onClick={() => copyField(item, "username")}
                      >
                        <User className="size-4" aria-hidden />
                      </QuickAction>
                    ) : null}
                    <QuickAction
                      label={
                        stepUpVerified
                          ? `Copy password for ${item.name}`
                          : `Confirm it's you to copy the password for ${item.name}`
                      }
                      done={copiedKey === `${item.id}:password`}
                      failed={failedKey === `${item.id}:password`}
                      onClick={() => requestPasswordCopy(item)}
                    >
                      {stepUpVerified ? (
                        <Copy className="size-4" aria-hidden />
                      ) : (
                        <Lock className="size-4" aria-hidden />
                      )}
                    </QuickAction>
                  </div>
                </div>

                {confirmingId === item.id ? (
                  <div className="animate-fade border-t border-line p-3">
                    <StepUp
                      action={`copy the password for ${item.name}`}
                      onCancel={() => setConfirmingId(null)}
                      onVerified={() => {
                        setConfirmingId(null);
                        void copyField(item, "password");
                      }}
                    />
                  </div>
                ) : null}
              </li>
            ))}
            <GridFillers count={filtered.length} />
          </ul>

          <p aria-live="polite" className="sr-only">
            {liveMessage}
          </p>
        </>
      )}

      <ItemDetail
        item={selectedLive}
        onClose={() => setSelected(null)}
        onEdit={(item) => {
          setSelected(null);
          setEditing(item);
          setFormOpen(true);
        }}
        onDelete={(item) => removeItem(item.id)}
      />

      <ItemForm
        open={formOpen}
        item={editing}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onSave={saveItem}
      />
    </div>
  );
}

/**
 * Search, with a shortcut that reaches it from anywhere on the page.
 *
 * Search is the whole interaction loop of a password manager — open, find,
 * copy, leave — so it gets a real accelerator rather than a field you have to
 * point at. `/` alone works too, but only when focus is not already in a text
 * field, or typing a URL into an entry would hijack itself.
 */
function SearchField({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const modifier = useModifierKey();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true;

      const accelerator = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      const slash = event.key === "/" && !typing && !event.metaKey && !event.ctrlKey;

      if (accelerator || slash) {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="relative flex-1">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle"
        aria-hidden
      />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value) {
            event.preventDefault();
            onChange("");
          }
        }}
        placeholder="Search entries"
        aria-label="Search entries"
        autoComplete="off"
        spellCheck={false}
        className={cn(
          "w-full rounded-[var(--radius)] border border-line bg-elevated raised",
          "py-2.5 pl-9 pr-16 text-sm placeholder:text-ink-subtle transition-colors",
          "hover:border-line-strong focus:border-ink focus:outline-none",
        )}
      />

      <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
        {value ? (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Clear search"
            className="grid size-6 place-items-center rounded-[var(--radius-sm)] text-ink-subtle transition-colors hover:bg-surface hover:text-ink"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        ) : modifier ? (
          // Hidden from assistive tech: the shortcut is a pointer-free
          // affordance, and a screen reader user already has focus commands.
          <span aria-hidden className="hidden items-center gap-0.5 sm:flex">
            <Kbd>{modifier}</Kbd>
            <Kbd>K</Kbd>
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Icon-only action on a card: copy username, copy (or unlock) password. */
function QuickAction({
  label,
  done,
  failed,
  onClick,
  children,
}: {
  label: string;
  done: boolean;
  failed: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-[var(--radius-sm)] text-ink-subtle transition-colors",
        "hover:bg-surface hover:text-ink",
        failed && "text-critical hover:text-critical",
      )}
    >
      {done ? <Check className="size-4 text-positive" aria-hidden /> : children}
    </button>
  );
}

/**
 * Blank tiles that complete the last row of the entry grid.
 *
 * The grid draws its separators as a 1px gap over a coloured container, so an
 * unfilled trailing cell would show that divider colour as a solid block.
 * These fillers paint it back to the page background at each breakpoint where
 * the row is short.
 */
function GridFillers({ count }: { count: number }) {
  const missingAtTwo = (2 - (count % 2)) % 2;
  const missingAtThree = (3 - (count % 3)) % 3;
  const missingAtFour = (4 - (count % 4)) % 4;

  // A single column is never short, so every filler stays hidden at base.
  return (
    <>
      {[0, 1, 2].map((index) => {
        const atTwo = index < missingAtTwo;
        const atThree = index < missingAtThree;
        const atFour = index < missingAtFour;
        if (!atTwo && !atThree && !atFour) return null;

        return (
          <li
            key={`filler-${index}`}
            aria-hidden
            className={cn(
              "hidden bg-canvas",
              atTwo && "sm:block",
              atThree ? "lg:block" : "lg:hidden",
              atFour ? "xl:block" : "xl:hidden",
            )}
          />
        );
      })}
    </>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="animate-in-up rounded-[var(--radius-lg)] border border-line bg-elevated raised px-5 py-14 text-center sm:px-6 sm:py-20">
      <div className="mx-auto grid size-11 place-items-center rounded-[var(--radius)] border border-line bg-surface raised">
        <KeyRound className="size-5 text-ink-muted" aria-hidden />
      </div>
      <h2 className="mt-5 text-[1.0625rem] font-semibold tracking-tight">Your vault is empty</h2>
      <p className="mx-auto mt-2 max-w-sm text-[0.8125rem] leading-relaxed text-ink-muted">
        Add your first entry. It is encrypted in this browser before anything is stored, so
        only your passphrase or recovery phrase can bring it back.
      </p>
      <Button className="mt-6" onClick={onAdd}>
        <Plus className="size-4" aria-hidden />
        Add your first entry
      </Button>
    </div>
  );
}
