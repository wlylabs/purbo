"use client";

import {
  AlertTriangle,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { ApprovalCard } from "@/components/ui/approval";
import { Button } from "@/components/ui/button";
import { CopyRow } from "@/components/ui/copy-row";
import { Kbd, useModifierKey } from "@/components/ui/kbd";
import { Badge, Card, Notice } from "@/components/ui/primitives";
import { estimateStrength } from "@/lib/crypto/password";
import { useVault } from "@/lib/vault/provider";
import type { VaultItem } from "@/lib/vault/types";
import {
  cn,
  formatRelativeTime,
  hostnameOf,
  monogram,
  safeExternalUrl,
} from "@/lib/utils";
import { ItemForm } from "./item-form";
import { StrengthMeter } from "./strength-meter";

/**
 * The vault, as a dashboard rather than a directory.
 *
 * Every entry shows what it holds where it sits — username, password field,
 * website, notes, health — so nothing is one click away behind a detail view.
 * Opening a vault is not browsing; it is looking something up, and a list of
 * names that each have to be clicked to become useful makes the lookup take
 * two steps instead of none.
 *
 * Passwords are masked on arrival and unmask on a toggle — the board's own,
 * for all of them at once, or the eye on a single row. The unlock is the
 * check; asking for the passphrase a second time to read what that passphrase
 * already decrypted bought a shoulder-surfing defence a keystroke provides,
 * and charged an Argon2id derivation for it.
 */
export function VaultView() {
  const { items, saveItem, removeItem, corrupted } = useVault();

  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<VaultItem | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [revealAll, setRevealAll] = useState(false);

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

  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (item: VaultItem) => {
    setEditing(item);
    setFormOpen(true);
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchField value={query} onChange={setQuery} />
        <div className="flex items-center gap-2">
          {/* One switch for the whole board. Each row keeps its own eye for
              the case where only one password is wanted on screen. */}
          {items.length > 0 ? (
            <Button
              variant="secondary"
              className="flex-1 sm:flex-none"
              aria-pressed={revealAll}
              onClick={() => setRevealAll((revealed) => !revealed)}
            >
              {revealAll ? (
                <EyeOff className="size-4" aria-hidden />
              ) : (
                <Eye className="size-4" aria-hidden />
              )}
              {revealAll ? "Hide passwords" : "Show passwords"}
            </Button>
          ) : null}
          <Button className="flex-1 sm:flex-none" onClick={openNew}>
            <Plus className="size-4" aria-hidden />
            New entry
          </Button>
        </div>
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
      ) : (
        <>
          <Overview items={items} revealed={revealAll} />

          {filtered.length === 0 ? (
            <div className="animate-fade rounded-[var(--radius-lg)] border border-line bg-elevated py-12 text-center sm:py-16">
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
              <ul className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {filtered.map((item, index) => (
                  <li
                    key={item.id}
                    // Drives the entrance delay from globals.css, so the board
                    // arrives as a sweep rather than all at once.
                    style={{ "--stagger-index": index } as React.CSSProperties}
                    // A grid item defaults to min-width:auto, which sizes the
                    // column to the widest thing inside the card rather than
                    // to the column — on a phone that is what pushes the whole
                    // page sideways.
                    className="flex min-w-0"
                  >
                    <EntryCard
                      item={item}
                      revealed={revealAll}
                      onEdit={openEdit}
                      onDelete={() => removeItem(item.id)}
                    />
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

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
 * What the vault looks like as a whole, above the entries themselves.
 *
 * These are counts, not secrets: how much is stored, how much of it is weak,
 * how much of it is the same password wearing different names. A password
 * manager that only ever shows one entry at a time can never answer those,
 * which is how a reused password survives for years.
 */
function Overview({ items, revealed }: { items: VaultItem[]; revealed: boolean }) {
  const { weak, reused } = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      counts.set(item.password, (counts.get(item.password) ?? 0) + 1);
    }

    return {
      weak: items.filter((item) => estimateStrength(item.password).score <= 1).length,
      // Entries sharing a password, counted as entries rather than as groups:
      // "3 entries reuse a password" is the number that means something.
      reused: items.filter((item) => (counts.get(item.password) ?? 0) > 1).length,
    };
  }, [items]);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Stat label="Entries" value={String(items.length)} />
      <Stat
        label="Weak"
        value={String(weak)}
        tone={weak > 0 ? "critical" : "positive"}
        note={weak > 0 ? "Worth replacing" : "None"}
      />
      <Stat
        label="Reused"
        value={String(reused)}
        tone={reused > 0 ? "caution" : "positive"}
        note={reused > 0 ? "Share a password" : "All unique"}
      />
      <div className="rounded-[var(--radius)] border border-line bg-elevated px-3.5 py-3">
        <p className="text-label">Passwords</p>
        <div className="mt-2">
          {revealed ? (
            <Badge tone="positive">
              <ShieldCheck className="size-3" aria-hidden />
              Visible
            </Badge>
          ) : (
            <Badge>
              <Lock className="size-3" aria-hidden />
              Masked
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  note,
  tone = "neutral",
}: {
  label: string;
  value: string;
  note?: string;
  tone?: "neutral" | "positive" | "caution" | "critical";
}) {
  const tones = {
    neutral: "text-ink",
    positive: "text-ink",
    caution: "text-caution",
    critical: "text-critical",
  } as const;

  return (
    <div className="rounded-[var(--radius)] border border-line bg-elevated px-3.5 py-3">
      <p className="text-label">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold tracking-tight tabular-nums", tones[tone])}>
        {value}
      </p>
      {note ? <p className="mt-0.5 text-[0.6875rem] text-ink-subtle">{note}</p> : null}
    </div>
  );
}

/**
 * One entry, in full.
 *
 * Everything the old detail dialog held is here on the surface — the dialog
 * existed only to give these fields somewhere to be, and a card can hold them
 * just as well without costing a click and a context switch.
 */
function EntryCard({
  item,
  revealed,
  onEdit,
  onDelete,
}: {
  item: VaultItem;
  /** Resting state of the password row, driven by the board's own switch. */
  revealed: boolean;
  onEdit: (item: VaultItem) => void;
  onDelete: () => Promise<void>;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const href = safeExternalUrl(item.url);
  const host = hostnameOf(item.url);

  return (
    <Card className="flex w-full flex-col overflow-hidden">
      <header className="flex items-start gap-3 border-b border-line px-3.5 py-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-line bg-surface text-[0.6875rem] font-medium text-ink-muted">
          {monogram(item.name)}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[0.9375rem] font-medium leading-snug">{item.name}</h3>
          <p className="truncate text-xs text-ink-subtle">
            {host ?? "No website"} · updated {formatRelativeTime(item.updatedAt)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Edit ${item.name}`}
            title="Edit"
            onClick={() => onEdit(item)}
          >
            <Pencil className="size-4" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Delete ${item.name}`}
            title="Delete"
            className="hover:text-critical"
            onClick={() => setConfirmingDelete(true)}
          >
            <Trash2 className="size-4" aria-hidden />
          </Button>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-3 p-3.5">
        {item.username ? (
          <CopyRow label="Username" value={item.username} />
        ) : (
          <div className="rounded-[var(--radius)] border border-dashed border-line px-3 py-2.5">
            <p className="text-label">Username</p>
            <p className="mt-1 text-[0.9375rem] leading-snug text-ink-subtle">Not set</p>
          </div>
        )}

        {/* Masked by default and copyable while masked — the eye is for the
            times the value has to be read out or typed elsewhere. The meter
            reads the strength, not the password, so it stays legible either
            way; that is the whole point of putting vault health on a
            dashboard. */}
        <div className="space-y-2">
          <CopyRow
            label="Password"
            value={item.password}
            secret
            initiallyRevealed={revealed}
          />
          <StrengthMeter password={item.password} className="px-1" />
        </div>

        {href ? (
          <div className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5">
            <p className="text-label">Website</p>
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-1 inline-flex items-center gap-1.5 break-all text-[0.875rem] text-ink underline underline-offset-4 hover:no-underline"
            >
              {item.url}
              <ExternalLink className="size-3.5 shrink-0" aria-hidden />
            </a>
          </div>
        ) : null}

        {item.notes ? (
          <div className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5">
            <p className="text-label">Notes</p>
            <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-[0.8125rem] leading-relaxed text-ink-muted">
              {item.notes}
            </p>
          </div>
        ) : null}

        {confirmingDelete ? (
          <ApprovalCard
            title="Confirm deletion"
            question={`Delete “${item.name}” from your vault?`}
            consequences={[
              "The entry is removed from this device and from every other device on the next sync.",
              "The stored password is not recoverable — it exists nowhere else in Purbo.",
            ]}
            confirmLabel="Delete permanently"
            loading={deleting}
            onCancel={() => setConfirmingDelete(false)}
            onConfirm={async () => {
              setDeleting(true);
              try {
                await onDelete();
              } finally {
                setDeleting(false);
              }
            }}
          />
        ) : null}

        <p className="mt-auto pt-1 text-meta">
          Created {formatRelativeTime(item.createdAt)}
        </p>
      </div>
    </Card>
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
          "w-full rounded-[var(--radius)] border border-line-control bg-elevated",
          "py-2.5 pl-9 pr-16 text-sm placeholder:text-ink-subtle transition-colors",
          "hover:border-ink-subtle focus:border-ink focus:outline-none",
        )}
      />

      <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
        {value ? (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Clear search"
            className="grid size-6 place-items-center rounded-[var(--radius-sm)] text-ink-subtle transition-colors hover:bg-tint hover:text-ink"
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

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="animate-in-up rounded-[var(--radius-lg)] border border-line bg-elevated px-5 py-14 text-center sm:px-6 sm:py-20">
      <div className="mx-auto grid size-11 place-items-center rounded-[var(--radius)] border border-line bg-surface">
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
