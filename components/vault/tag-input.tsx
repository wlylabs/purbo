"use client";

import { Plus, X } from "lucide-react";
import { useId, useMemo, useState } from "react";

import { Chip } from "@/components/ui/primitives";
import { addTag, removeTag, MAX_TAGS_PER_ITEM, normaliseTag } from "@/lib/vault/tags";
import { cn } from "@/lib/utils";

/**
 * Tags, entered the way people expect a tag field to behave.
 *
 * Comma and Enter both commit, because half the world learned this from an
 * email "To" field and the other half from an issue tracker. Backspace on an
 * empty box removes the last chip, which is the one gesture that makes a
 * mistyped tag cost nothing.
 *
 * Suggestions are drawn from the vault's own tags rather than a fixed list:
 * the point of the field is that entries end up filed under the same spelling
 * twice, and offering what already exists is what actually achieves that.
 */
export function TagInput({
  value,
  onChange,
  suggestions = [],
  disabled,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  /** Tags already in use elsewhere in the vault, most-used first. */
  suggestions?: string[];
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const fieldId = useId();

  const full = value.length >= MAX_TAGS_PER_ITEM;

  const offered = useMemo(() => {
    const chosen = new Set(value.map((tag) => tag.toLocaleLowerCase()));
    const needle = normaliseTag(draft).toLocaleLowerCase();
    return suggestions
      .filter((tag) => !chosen.has(tag.toLocaleLowerCase()))
      .filter((tag) => !needle || tag.toLocaleLowerCase().includes(needle))
      .slice(0, 6);
  }, [suggestions, value, draft]);

  const commit = (raw: string) => {
    const next = addTag(value, raw);
    if (next.length !== value.length) onChange(next);
    setDraft("");
  };

  return (
    <div className="space-y-1.5">
      <label htmlFor={fieldId} className="block text-[0.8125rem] font-medium text-ink">
        Tags
      </label>

      <div
        className={cn(
          "flex flex-wrap items-center gap-1.5 rounded-[var(--radius-sm)] border border-line-control",
          "bg-elevated px-2 py-2 transition-colors focus-within:border-ink",
          disabled && "opacity-50",
        )}
      >
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full border border-line bg-surface py-0.5 pl-2.5 pr-1 text-[0.75rem] font-medium"
          >
            {tag}
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(removeTag(value, tag))}
              aria-label={`Remove tag ${tag}`}
              className="grid size-4 place-items-center rounded-full text-ink-subtle interactive hover:bg-tint hover:text-ink"
            >
              <X className="size-3" aria-hidden />
            </button>
          </span>
        ))}

        <input
          id={fieldId}
          type="text"
          value={draft}
          disabled={disabled || full}
          onChange={(event) => {
            // A pasted "work, shared" is two tags, not one badly named one.
            if (event.target.value.includes(",")) {
              const parts = event.target.value.split(",");
              const last = parts.pop() ?? "";
              let next = value;
              for (const part of parts) next = addTag(next, part);
              if (next !== value) onChange(next);
              setDraft(last);
              return;
            }
            setDraft(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              // The form around this would otherwise submit on the keystroke
              // that was meant to finish a tag.
              event.preventDefault();
              if (draft.trim()) commit(draft);
            } else if (event.key === "Backspace" && draft === "" && value.length > 0) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => {
            if (draft.trim()) commit(draft);
          }}
          placeholder={full ? "" : value.length === 0 ? "work, banking, shared…" : "Add another"}
          autoComplete="off"
          spellCheck={false}
          className="min-w-24 flex-1 bg-transparent px-1 py-0.5 text-sm text-ink placeholder:text-ink-subtle focus:outline-none disabled:cursor-not-allowed"
        />
      </div>

      {offered.length > 0 && !full ? (
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="text-[0.6875rem] text-ink-subtle">Already used:</span>
          {offered.map((tag) => (
            <Chip
              key={tag}
              disabled={disabled}
              onClick={() => commit(tag)}
              className="px-2.5 py-0.5 text-[0.75rem]"
            >
              <Plus className="mr-1 inline size-3 align-[-1px]" aria-hidden />
              {tag}
            </Chip>
          ))}
        </div>
      ) : null}

      <p className="text-xs text-ink-subtle">
        {full
          ? `That is the ${MAX_TAGS_PER_ITEM}-tag limit. Tags are stored inside the entry's ciphertext — the server never sees one.`
          : "Stored inside the entry's ciphertext, like everything else. The server never sees a tag."}
      </p>
    </div>
  );
}
