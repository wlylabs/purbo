"use client";

import {
  Command,
  KeyRound,
  Lock,
  Plus,
  Search,
  Settings,
  User,
  Wand2,
} from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { Kbd, useModifierKey } from "@/components/ui/kbd";
import { useVault } from "@/lib/vault/provider";
import type { VaultItem } from "@/lib/vault/types";
import { cn, copyWithAutoClear, hostnameOf } from "@/lib/utils";

/**
 * The whole app on one keystroke.
 *
 * A password manager is used in bursts of a few seconds — open, find, copy,
 * leave — and every one of those seconds spent moving a pointer between a tab
 * strip, a search field and a copy button is the reason people leave the
 * vault open in a tab instead. The chord that used to focus the search box
 * now opens this, because searching was only ever the first half of the job.
 *
 * Nothing here reaches past the unlocked session: it reads the same decrypted
 * items the dashboard is already rendering, and copying goes through the same
 * clipboard helper that clears itself after thirty seconds.
 */

type Action =
  | { kind: "command"; id: string; label: string; hint: string; icon: typeof Plus; run: () => void }
  | { kind: "entry"; id: string; item: VaultItem };

export type PaletteTab = "vault" | "generator" | "settings";

export function CommandPalette({
  onNavigate,
  onNewEntry,
}: {
  onNavigate: (tab: PaletteTab) => void;
  onNewEntry: () => void;
}) {
  const { items, lock } = useVault();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dismissRef = useRef<number | null>(null);
  const listId = useId();
  const modifier = useModifierKey();

  const close = useCallback(() => {
    if (dismissRef.current !== null) window.clearTimeout(dismissRef.current);
    dismissRef.current = null;
    setOpen(false);
    setQuery("");
    setActive(0);
    setFeedback(null);
  }, []);

  // ---- the chord ------------------------------------------------------
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      // Another dialog is up — the entry form, a confirmation. Opening a
      // second one over it would bury the thing the user is mid-way through.
      if (!open && document.querySelector("dialog[open]")) return;
      event.preventDefault();
      setOpen((current) => !current);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      inputRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onCancel = (event: Event) => {
      event.preventDefault();
      close();
    };
    dialog.addEventListener("cancel", onCancel);
    return () => dialog.removeEventListener("cancel", onCancel);
  }, [close]);

  // ---- what is on offer ------------------------------------------------
  const commands = useMemo<Action[]>(
    () => [
      {
        kind: "command",
        id: "new-entry",
        label: "New entry",
        hint: "Add a password to the vault",
        icon: Plus,
        run: () => {
          onNavigate("vault");
          onNewEntry();
        },
      },
      {
        kind: "command",
        id: "vault",
        label: "Go to vault",
        hint: "Every entry, with its health",
        icon: KeyRound,
        run: () => onNavigate("vault"),
      },
      {
        kind: "command",
        id: "generator",
        label: "Open the generator",
        hint: "Passwords and passphrases",
        icon: Wand2,
        run: () => onNavigate("generator"),
      },
      {
        kind: "command",
        id: "settings",
        label: "Open settings",
        hint: "Auto-lock, passkeys, import, export",
        icon: Settings,
        run: () => onNavigate("settings"),
      },
      {
        kind: "command",
        id: "lock",
        label: "Lock the vault",
        hint: "Drops the keys from memory now",
        icon: Lock,
        run: lock,
      },
    ],
    [lock, onNavigate, onNewEntry],
  );

  const results = useMemo<Action[]>(() => {
    const needle = query.trim().toLowerCase();

    const matchingCommands = needle
      ? commands.filter(
          (action) =>
            action.kind === "command" && action.label.toLowerCase().includes(needle),
        )
      : commands;

    const ranked = [...items].sort(
      (a, b) => Number(b.favourite ?? false) - Number(a.favourite ?? false),
    );

    const matchingEntries = (
      needle
        ? ranked.filter((item) =>
            [item.name, item.username, item.url ?? "", ...(item.tags ?? [])]
              .join(" ")
              .toLowerCase()
              .includes(needle),
          )
        : // With nothing typed the list is a shortcut, not a directory: the
          // handful most likely to be wanted, then get out of the way.
          ranked.slice(0, 5)
    ).map<Action>((item) => ({ kind: "entry", id: item.id, item }));

    return [...matchingCommands, ...matchingEntries];
  }, [commands, items, query]);

  // Any change to the result set puts the selection back at the top, where
  // the best match is — otherwise the fifth keystroke runs whatever happens
  // to sit at the index the third keystroke left behind.
  useEffect(() => setActive(0), [query]);

  const withFeedback = useCallback(
    (message: string) => {
      setFeedback(message);
      // Long enough to read, short enough that the palette is not something
      // the user has to dismiss after every copy.
      if (dismissRef.current !== null) window.clearTimeout(dismissRef.current);
      dismissRef.current = window.setTimeout(close, 1200);
    },
    [close],
  );

  const run = useCallback(
    async (action: Action, secondary: boolean) => {
      if (action.kind === "command") {
        close();
        action.run();
        return;
      }

      const { item } = action;

      if (secondary && !item.username) {
        setFeedback(`${item.name} has no username stored.`);
        return;
      }

      try {
        if (secondary) {
          await copyWithAutoClear(item.username);
          withFeedback(`Copied the username for ${item.name}.`);
        } else {
          await copyWithAutoClear(item.password);
          withFeedback(
            `Copied the password for ${item.name} — the clipboard clears in 30 seconds.`,
          );
        }
      } catch {
        // A denied clipboard is the one failure here that is not the user's
        // doing, and silently doing nothing would look like a missed keypress.
        setFeedback("The browser blocked clipboard access.");
      }
    },
    [close, withFeedback],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => (results.length === 0 ? 0 : (current + 1) % results.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) =>
        results.length === 0 ? 0 : (current - 1 + results.length) % results.length,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      const action = results[active];
      if (action) void run(action, event.shiftKey);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      aria-label="Command palette"
      onClick={(event) => {
        if (event.target === dialogRef.current) close();
      }}
      className={cn(
        "m-auto mt-[12vh] w-[calc(100vw-2rem)] max-w-xl bg-transparent p-0 text-ink",
        // The palette is opened and dismissed more often than anything else
        // in the app, so it is the one place a jump-cut close is most worth
        // not having. See `.dialog-reveal` in `app/globals.css`.
        "dialog-reveal",
      )}
    >
      <div className="flex max-h-[70vh] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-line bg-elevated shadow-modal">
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
          <Search className="size-4 shrink-0 text-ink-subtle" aria-hidden />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={results[active] ? `${listId}-${results[active]!.id}` : undefined}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search entries, or jump somewhere"
            aria-label="Search entries or run a command"
            autoComplete="off"
            spellCheck={false}
            className="flex-1 bg-transparent text-[0.9375rem] text-ink placeholder:text-ink-subtle focus:outline-none"
          />
          <Kbd>Esc</Kbd>
        </div>

        <ul id={listId} role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {results.length === 0 ? (
            <li className="px-3 py-8 text-center text-[0.8125rem] text-ink-muted">
              Nothing matches “{query}”.
            </li>
          ) : (
            results.map((action, index) => (
              <li key={action.id} id={`${listId}-${action.id}`} role="option" aria-selected={index === active}>
                <button
                  type="button"
                  // Pointer selection follows the pointer, so clicking always
                  // runs the row under it rather than the keyboard's.
                  onMouseMove={() => setActive(index)}
                  onClick={(event) => void run(action, event.shiftKey)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2.5 text-left",
                    // The highlight eases between rows instead of blinking
                    // from one to the next, which is what stops a held arrow
                    // key from strobing down the list. The press fill answers
                    // a tap, where there is no hover to have answered it.
                    "interactive active:bg-tint-strong",
                    index === active ? "bg-tint" : "bg-transparent",
                  )}
                >
                  <Row action={action} />
                </button>
              </li>
            ))
          )}
        </ul>

        <footer className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line px-4 py-2.5 text-[0.6875rem] text-ink-subtle">
          {feedback ? (
            // Keyed on the message so a second copy in the same session
            // re-plays the fade rather than silently swapping the words.
            <p key={feedback} role="status" className="animate-fade text-ink-muted">
              {feedback}
            </p>
          ) : (
            <>
              <span className="flex items-center gap-1">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd>
                move
              </span>
              <span className="flex items-center gap-1">
                <Kbd>↵</Kbd>
                copy password
              </span>
              <span className="flex items-center gap-1">
                <Kbd>⇧</Kbd>
                <Kbd>↵</Kbd>
                copy username
              </span>
              {modifier ? (
                <span className="ml-auto flex items-center gap-1">
                  <Kbd>{modifier}</Kbd>
                  <Kbd>K</Kbd>
                </span>
              ) : null}
            </>
          )}
        </footer>
      </div>
    </dialog>
  );
}

function Row({ action }: { action: Action }) {
  if (action.kind === "command") {
    const Icon = action.icon;
    return (
      <>
        <span className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-line bg-surface">
          <Icon className="size-4 text-ink-muted" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.875rem] font-medium">{action.label}</span>
          <span className="block truncate text-[0.75rem] text-ink-subtle">{action.hint}</span>
        </span>
        <Command className="size-3.5 shrink-0 text-ink-subtle" aria-hidden />
      </>
    );
  }

  const { item } = action;
  const host = hostnameOf(item.url);

  return (
    <>
      <span className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-line bg-surface">
        <User className="size-4 text-ink-muted" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.875rem] font-medium">{item.name}</span>
        <span className="block truncate text-[0.75rem] text-ink-subtle">
          {item.username || host || "No username"}
        </span>
      </span>
      <span className="shrink-0 text-[0.6875rem] text-ink-subtle">copy password</span>
    </>
  );
}
