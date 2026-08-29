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
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { ApprovalCard } from "@/components/ui/approval";
import { Button } from "@/components/ui/button";
import { CopyRow } from "@/components/ui/copy-row";
import { Kbd } from "@/components/ui/kbd";
import { Badge, Card, Chip, Notice, Reveal } from "@/components/ui/primitives";
import { estimateStrength } from "@/lib/crypto/password";
import { useVault } from "@/lib/vault/provider";
import { collectTags, hasTag } from "@/lib/vault/tags";
import type { VaultItem } from "@/lib/vault/types";
import {
  cn,
  copyWithAutoClear,
  formatRelativeTime,
  hostnameOf,
  monogram,
  safeExternalUrl,
} from "@/lib/utils";
import { ItemForm } from "./item-form";
import { StrengthMeter } from "./strength-meter";
import { TotpCode } from "./totp-code";

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

/** What the health tiles filter down to. */
type HealthFilter = "weak" | "reused" | "ageing";

/**
 * A password that has not been changed in a year.
 *
 * Rotation on a schedule is discredited advice for its own sake — NIST
 * dropped it precisely because forced rotation produces `Summer2024!` — so
 * this is not a warning, it is a shelf date. It earns its place next to
 * "weak" and "reused" because the entries nobody has touched in years are
 * where the passwords predating this vault are hiding.
 */
const AGEING_AFTER_DAYS = 365;

/** An instruction from somewhere outside this view — the command palette. */
export type VaultIntent = { kind: "new-entry" } | { kind: "edit"; id: string };

export function VaultView({
  intent,
  onIntentHandled,
}: {
  intent?: VaultIntent | null;
  onIntentHandled?: () => void;
}) {
  const { items, saveItem, removeItem, toggleFavourite, corrupted } = useVault();

  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<VaultItem | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [revealAll, setRevealAll] = useState(false);
  const [favouritesOnly, setFavouritesOnly] = useState(false);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [healthFilter, setHealthFilter] = useState<HealthFilter | null>(null);

  const tags = useMemo(() => collectTags(items), [items]);

  /**
   * The three questions a vault can answer about itself, computed once.
   *
   * Sets of ids rather than counts, because the tiles above and the list below
   * have to agree: a "4" that filters to three entries is worse than no tile.
   */
  const health = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      counts.set(item.password, (counts.get(item.password) ?? 0) + 1);
    }

    const cutoff = Date.now() - AGEING_AFTER_DAYS * 24 * 60 * 60 * 1000;
    const weak = new Set<string>();
    const reused = new Set<string>();
    const ageing = new Set<string>();

    for (const item of items) {
      if (estimateStrength(item.password).score <= 1) weak.add(item.id);
      // Entries sharing a password, counted as entries rather than as groups:
      // "3 entries reuse a password" is the number that means something.
      if ((counts.get(item.password) ?? 0) > 1) reused.add(item.id);
      if (item.updatedAt < cutoff) ageing.add(item.id);
    }

    return { weak, reused, ageing };
  }, [items]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();

    const matches = items.filter((item) => {
      if (favouritesOnly && !item.favourite) return false;
      if (tagFilter && !hasTag(item, tagFilter)) return false;
      if (healthFilter && !health[healthFilter].has(item.id)) return false;
      if (!needle) return true;
      return [item.name, item.username, item.url ?? "", item.notes ?? "", ...(item.tags ?? [])]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });

    // Favourites first, then whatever order the provider handed over (most
    // recently changed first). A stable sort keeps the second key intact.
    return matches.sort((a, b) => Number(b.favourite ?? false) - Number(a.favourite ?? false));
  }, [items, query, favouritesOnly, tagFilter, healthFilter, health]);

  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (item: VaultItem) => {
    setEditing(item);
    setFormOpen(true);
  };

  // Acting on an intent from the palette. Handled once and reported back, or
  // switching tabs and returning would re-open the dialog.
  useEffect(() => {
    if (!intent) return;
    if (intent.kind === "new-entry") {
      setEditing(null);
      setFormOpen(true);
    } else {
      const target = items.find((item) => item.id === intent.id);
      if (target) {
        setEditing(target);
        setFormOpen(true);
      }
    }
    onIntentHandled?.();
  }, [intent, items, onIntentHandled]);

  const filtering = favouritesOnly || tagFilter !== null || healthFilter !== null;
  const clearFilters = () => {
    setFavouritesOnly(false);
    setTagFilter(null);
    setHealthFilter(null);
  };

  const favourites = items.filter((item) => item.favourite).length;

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
          <Overview
            items={items}
            health={health}
            active={healthFilter}
            onSelect={(next) => setHealthFilter((current) => (current === next ? null : next))}
          />

          {favourites > 0 || tags.length > 0 ? (
            <FilterBar
              favourites={favourites}
              favouritesOnly={favouritesOnly}
              onFavouritesOnly={setFavouritesOnly}
              tags={tags}
              tagFilter={tagFilter}
              onTagFilter={setTagFilter}
            />
          ) : null}

          {filtered.length === 0 ? (
            <div className="animate-fade rounded-[var(--radius-lg)] border border-line bg-elevated py-12 text-center sm:py-16">
              <p className="text-[0.9375rem] font-medium">No matches</p>
              <p className="mt-1 text-[0.8125rem] text-ink-muted">
                {query
                  ? `Nothing in your vault matches “${query}”.`
                  : "Nothing matches the filters you have on."}
              </p>
              {filtering ? (
                <Button variant="secondary" size="sm" className="mt-4" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : null}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <p className="text-label">
                  {filtered.length} {filtered.length === 1 ? "entry" : "entries"}
                  {filtered.length !== items.length ? ` of ${items.length}` : ""}
                </p>
                <Badge tone={revealAll ? "caution" : "neutral"}>
                  {revealAll ? (
                    <ShieldCheck className="size-3" aria-hidden />
                  ) : (
                    <Lock className="size-3" aria-hidden />
                  )}
                  {revealAll ? "Passwords visible" : "Passwords masked"}
                </Badge>
                {filtering ? (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="text-[0.75rem] text-ink-muted underline underline-offset-4 interactive hover:text-ink"
                  >
                    Clear filters
                  </button>
                ) : null}
              </div>
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
                      ageing={health.ageing.has(item.id)}
                      reused={health.reused.has(item.id)}
                      onEdit={openEdit}
                      onToggleFavourite={() => toggleFavourite(item.id)}
                      onSelectTag={setTagFilter}
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
        tagSuggestions={tags.map((entry) => entry.tag)}
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
 * These were counts once, and a count is where the thought stops: "4 weak"
 * tells someone there is work to do and nothing about where. Each tile is now
 * the filter for what it counts, so the number and the list it describes are
 * one control — which is the difference between a dashboard and a scoreboard.
 */
function Overview({
  items,
  health,
  active,
  onSelect,
}: {
  items: VaultItem[];
  health: Record<HealthFilter, Set<string>>;
  active: HealthFilter | null;
  onSelect: (filter: HealthFilter) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div className="rounded-[var(--radius)] border border-line bg-elevated px-3.5 py-3">
        <p className="text-label">Entries</p>
        <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{items.length}</p>
        <p className="mt-0.5 text-[0.6875rem] text-ink-subtle">All encrypted</p>
      </div>

      <StatFilter
        label="Weak"
        count={health.weak.size}
        tone="critical"
        active={active === "weak"}
        note={health.weak.size > 0 ? "Worth replacing" : "None"}
        onClick={() => onSelect("weak")}
      />
      <StatFilter
        label="Reused"
        count={health.reused.size}
        tone="caution"
        active={active === "reused"}
        note={health.reused.size > 0 ? "Share a password" : "All unique"}
        onClick={() => onSelect("reused")}
      />
      <StatFilter
        label="Ageing"
        count={health.ageing.size}
        tone="caution"
        active={active === "ageing"}
        note={health.ageing.size > 0 ? "Over a year old" : "All recent"}
        onClick={() => onSelect("ageing")}
      />
    </div>
  );
}

/**
 * A count that is also the way to see what it counted.
 *
 * A zero is not a button: there is nothing behind it, and leaving it pressable
 * would filter the board down to an empty state as a reward for curiosity.
 */
function StatFilter({
  label,
  count,
  note,
  tone,
  active,
  onClick,
}: {
  label: string;
  count: number;
  note?: string;
  tone: "caution" | "critical";
  active: boolean;
  onClick: () => void;
}) {
  const empty = count === 0;

  return (
    <button
      type="button"
      disabled={empty}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-[var(--radius)] border px-3.5 py-3 text-left interactive",
        active ? "border-ink bg-tint" : "border-line bg-elevated",
        empty ? "cursor-default" : "hover:border-ink-subtle",
      )}
    >
      <p className="text-label">{label}</p>
      <p
        className={cn(
          "mt-1 text-2xl font-semibold tracking-tight tabular-nums",
          empty ? "text-ink" : tone === "critical" ? "text-critical" : "text-caution",
        )}
      >
        {count}
      </p>
      <p className="mt-0.5 text-[0.6875rem] text-ink-subtle">
        {empty ? note : active ? "Showing these" : note}
      </p>
    </button>
  );
}

/** Favourites and tags — the filters the user made, rather than the ones the vault found. */
function FilterBar({
  favourites,
  favouritesOnly,
  onFavouritesOnly,
  tags,
  tagFilter,
  onTagFilter,
}: {
  favourites: number;
  favouritesOnly: boolean;
  onFavouritesOnly: (next: boolean) => void;
  tags: { tag: string; count: number }[];
  tagFilter: string | null;
  onTagFilter: (next: string | null) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {favourites > 0 ? (
        <Chip
          selected={favouritesOnly}
          aria-pressed={favouritesOnly}
          onClick={() => onFavouritesOnly(!favouritesOnly)}
        >
          <Star
            className={cn("mr-1.5 inline size-3.5 align-[-2px]", favouritesOnly && "fill-current")}
            aria-hidden
          />
          Favourites
          <span className="ml-1.5 tabular-nums opacity-60">{favourites}</span>
        </Chip>
      ) : null}

      {tags.map(({ tag, count }) => {
        const selected = tagFilter === tag;
        return (
          <Chip
            key={tag}
            selected={selected}
            aria-pressed={selected}
            onClick={() => onTagFilter(selected ? null : tag)}
          >
            {tag}
            <span className="ml-1.5 tabular-nums opacity-60">{count}</span>
          </Chip>
        );
      })}
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
  ageing,
  reused,
  onEdit,
  onToggleFavourite,
  onSelectTag,
  onDelete,
}: {
  item: VaultItem;
  /** Resting state of the password row, driven by the board's own switch. */
  revealed: boolean;
  ageing: boolean;
  reused: boolean;
  onEdit: (item: VaultItem) => void;
  onToggleFavourite: () => Promise<void>;
  onSelectTag: (tag: string) => void;
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
          <p className={cn("truncate text-xs", ageing ? "text-caution" : "text-ink-subtle")}>
            {host ?? "No website"} · updated {formatRelativeTime(item.updatedAt)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            aria-label={
              item.favourite ? `Remove ${item.name} from favourites` : `Add ${item.name} to favourites`
            }
            aria-pressed={item.favourite === true}
            title={item.favourite ? "Remove from favourites" : "Add to favourites"}
            onClick={() => {
              // The only way this rejects is a failed local write, which the
              // header's sync state already reports; an unhandled rejection
              // on a star would say nothing and log everything.
              void onToggleFavourite().catch(() => undefined);
            }}
          >
            {/* Keyed on the state so the filled star is a fresh element and
                plays its entrance: starring something is a click whose only
                result is four pixels changing colour, and without the pop it
                is easy to miss whether it landed. Unstarring is the quieter
                event and swaps plainly. */}
            <Star
              key={item.favourite ? "on" : "off"}
              className={cn(
                "size-4",
                item.favourite && "animate-pop fill-current text-caution",
              )}
              aria-hidden
            />
          </Button>
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
          {reused ? (
            <p className="px-1 text-[0.6875rem] text-caution">
              This password is used by another entry too.
            </p>
          ) : null}
        </div>

        {item.totp ? (
          <TotpCode secret={item.totp} onCopy={(code) => copyWithAutoClear(code)} />
        ) : null}

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

        {item.tags && item.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {item.tags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => onSelectTag(tag)}
                title={`Show everything tagged ${tag}`}
                className={cn(
                  "rounded-full border border-line bg-surface px-2.5 py-0.5",
                  "text-[0.6875rem] font-medium text-ink-muted",
                  "interactive hover:border-ink-subtle hover:text-ink",
                )}
              >
                {tag}
              </button>
            ))}
          </div>
        ) : null}

        {/* Backing out of a deletion is the click most worth animating in the
            whole card: the card is asking a question, and a question that
            disappears between two frames leaves the reader unsure whether they
            answered it or mis-clicked something else. */}
        <Reveal open={confirmingDelete}>
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
        </Reveal>

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
 * point at. `/` alone works, but only when focus is not already in a text
 * field, or typing a URL into an entry would hijack itself. The modifier
 * chord belongs to the command palette, which does this and more from any
 * section of the app.
 */
function SearchField({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true;

      if (event.key === "/" && !typing && !event.metaKey && !event.ctrlKey) {
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
            className="grid size-6 place-items-center rounded-[var(--radius-sm)] text-ink-subtle interactive hover:bg-tint hover:text-ink active:bg-tint-strong"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        ) : (
          // Hidden from assistive tech: the shortcut is a pointer-free
          // affordance, and a screen reader user already has focus commands.
          <span aria-hidden className="hidden items-center gap-0.5 sm:flex">
            <Kbd>/</Kbd>
          </span>
        )}
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
        Add your first entry, or bring one in from another password manager in Settings. It
        is encrypted in this browser before anything is stored, so only your passphrase or
        recovery phrase can bring it back.
      </p>
      <Button className="mt-6" onClick={onAdd}>
        <Plus className="size-4" aria-hidden />
        Add your first entry
      </Button>
    </div>
  );
}
